import express from 'express';
import cors from 'cors';
import path from 'path';
import { GameState, Player, PlacedTile, Card } from '../../shared/types';
import { validateTilePlacement, validateTokenMove, validateDoorInteract, hasLineOfSight, hasLineOfSightToWall, getWrappingManhattanDistance, checkBoundFateEliminations, isValidMiststepTarget, isValidStoneGlideTarget, calculateScores } from '../../shared/validation';
import { HEROES, BASIC_CARDS } from '../../shared/constants';
import { buildDeckForEmoji, shuffle } from '../../shared/deck';
import { Firestore } from '@google-cloud/firestore';
import { OAuth2Client } from 'google-auth-library';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const JWT_SECRET = process.env.JWT_SECRET || 'hollowfall_dev_secret';
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'hollowfall-game';

initializeApp({
  projectId: PROJECT_ID,
  databaseURL: `https://${PROJECT_ID}-default-rtdb.firebaseio.com`
});
const rtdb = getDatabase();

const firestore = new Firestore({
  projectId: PROJECT_ID,
  // Firestore throws on any `undefined` field value. Several code paths intentionally
  // clear fields by assigning undefined (e.g. startTurnTimer clearing
  // turnPausedRemainingMs, or clearing concessionExpiresAt on reconnect). Without this,
  // those writes throw and roll back the whole transaction — which is why placing the
  // final setup tile (it triggers the GAMEPLAY transition -> startTurnTimer -> t.set)
  // silently failed. Ignoring undefined makes those clears drop the field instead.
  ignoreUndefinedProperties: true
});

const activePresence = new Map<string, Set<string>>();
// Guards against the loop treating "presence snapshot not loaded yet" (e.g. right after
// an instance start/deploy) as "everyone is offline" — which would mark all players
// disconnected in the same tick. Only trust presence once RTDB has delivered a snapshot.
let presenceInitialized = false;

rtdb.ref('matchPresence').on('value', (snapshot: any) => {
  presenceInitialized = true;
  activePresence.clear();
  const val = snapshot.val();
  if (!val) return;
  for (const matchId of Object.keys(val)) {
    const players = Object.keys(val[matchId]);
    activePresence.set(matchId, new Set(players));
  }
});

const activeMatchesCache = new Map<string, GameState>();

firestore.collection('matches')
  .where('phase', 'in', ['GAMEPLAY', 'PLACEMENT'])
  .onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'removed') {
        activeMatchesCache.delete(change.doc.id);
      } else {
        activeMatchesCache.set(change.doc.id, change.doc.data() as GameState);
      }
    });
  });

setInterval(async () => {
  const now = Date.now();

  for (const [matchId, room] of activeMatchesCache.entries()) {
    // 1. Process Turn Expiration
    if (!room.isTurnPaused && room.turnExpiresAt && room.turnExpiresAt <= now) {
      // It's safer to process this inside a transaction to prevent race conditions
      // But since we are the only server (always-on CPU), we can just execute passTurn here
      // However, to be perfectly safe, we'll run a transaction.
      try {
        await firestore.runTransaction(async (t) => {
          const matchRef = firestore.collection('matches').doc(matchId);
          const doc = await t.get(matchRef);
          if (!doc.exists) return;
          const currentRoom = doc.data() as GameState;
          if (!currentRoom.isTurnPaused && currentRoom.turnExpiresAt && currentRoom.turnExpiresAt <= now) {
            passTurn(currentRoom);
            t.update(matchRef, currentRoom as any);
          }
        });
      } catch (err) {
        console.error(`Failed to pass turn for match ${matchId}:`, err);
      }
      continue; // Skip disconnect processing this tick if we just passed turn
    }

    // 2. Process Presence & Disconnects
    // Don't act on presence until RTDB has delivered its first snapshot, otherwise a
    // freshly-started instance would mark every player offline on its first tick.
    if (!presenceInitialized) continue;
    const presenceSet = activePresence.get(matchId);

    // We need to work with a mutable copy if we intend to save it, but we can't save it without a transaction.
    // So we'll detect if a change is needed, and then run a transaction.
    let requiresTransaction = false;
    
    for (const p of Object.values(room.players)) {
      const isOnline = presenceSet ? presenceSet.has(p.id) : false;
      
      if (!isOnline && !p.isDisconnected) {
        requiresTransaction = true;
      } else if (isOnline && p.isDisconnected) {
        requiresTransaction = true;
      }
      
      if (p.isDisconnected && p.concessionExpiresAt && p.concessionExpiresAt <= now) {
        requiresTransaction = true;
      }
    }

    if (requiresTransaction) {
      try {
        await firestore.runTransaction(async (t) => {
          const matchRef = firestore.collection('matches').doc(matchId);
          const doc = await t.get(matchRef);
          if (!doc.exists) return;
          const currentRoom = doc.data() as GameState;
          let changed = false;
          
          for (const p of Object.values(currentRoom.players)) {
            const isOnline = presenceSet ? presenceSet.has(p.id) : false;
            
            // Mark as disconnected
            if (!isOnline && !p.isDisconnected) {
              p.isDisconnected = true;
              p.concessionExpiresAt = now + 45000;
              currentRoom.gameLogs = currentRoom.gameLogs || [];
              currentRoom.gameLogs.push(`[${new Date().toLocaleTimeString()}] ${p.username} disconnected. They have 45 seconds to return.`);
              
              // If it's their turn, pause the timer
              if (currentRoom.turnOrder[currentRoom.activePlayerIndex] === p.id && !currentRoom.isTurnPaused) {
                currentRoom.isTurnPaused = true;
                currentRoom.turnPausedRemainingMs = currentRoom.turnExpiresAt ? Math.max(0, currentRoom.turnExpiresAt - now) : 45000;
              }
              changed = true;
            } 
            // Mark as reconnected
            else if (isOnline && p.isDisconnected) {
              p.isDisconnected = false;
              p.concessionExpiresAt = undefined;
              currentRoom.gameLogs = currentRoom.gameLogs || [];
              currentRoom.gameLogs.push(`[${new Date().toLocaleTimeString()}] ${p.username} reconnected.`);
              
              // If it's their turn, resume the timer
              if (currentRoom.turnOrder[currentRoom.activePlayerIndex] === p.id && currentRoom.isTurnPaused) {
                startTurnTimer(matchId, currentRoom);
              }
              changed = true;
            }
            
            // Check concession. The `includes` guard stops an already-forfeited player
            // (still in players{} but out of turnOrder) from being re-processed every tick.
            if (p.isDisconnected && p.concessionExpiresAt && p.concessionExpiresAt <= now && currentRoom.turnOrder.includes(p.id)) {
               // If the forfeiting player is the active one, advance the turn first
               // (this also re-arms the timer for whoever is next).
               if (currentRoom.turnOrder[currentRoom.activePlayerIndex] === p.id) {
                 passTurn(currentRoom);
               }

               // Capture who is active NOW, remove the forfeiter, then re-align the index
               // to that same player. Filtering shifts indices, so activePlayerIndex must be
               // recomputed — otherwise it points at the wrong player or off the end, which
               // silently rejects the real active player's actions (the "stuck" bug).
               const currentTurnPlayerId = currentRoom.turnOrder[currentRoom.activePlayerIndex];
               currentRoom.turnOrder = currentRoom.turnOrder.filter(id => id !== p.id);
               const newIndex = currentRoom.turnOrder.indexOf(currentTurnPlayerId);
               currentRoom.activePlayerIndex = newIndex !== -1 ? newIndex : 0;

               // Stop this player from being forfeited again on subsequent ticks.
               p.concessionExpiresAt = undefined;

               currentRoom.gameLogs = currentRoom.gameLogs || [];
               currentRoom.gameLogs.push(`[${new Date().toLocaleTimeString()}] ${p.username} forfeited due to disconnect.`);

               if (currentRoom.turnOrder.length === 1) {
                 const remainingPlayerId = currentRoom.turnOrder[0];
                 const remainingPlayer = currentRoom.players[remainingPlayerId];
                 if (remainingPlayer) remainingPlayer.points = currentRoom.victoryPointsTarget || 2;
                 currentRoom.phase = 'GAME_OVER';
                 currentRoom.gameLogs.push(`[${new Date().toLocaleTimeString()}] Match ended.`);
               } else if (currentRoom.turnOrder.length === 0) {
                 currentRoom.phase = 'GAME_OVER';
               }
               changed = true;
            }
          }
          
          if (changed) {
            t.update(matchRef, currentRoom as any);
          }
        });
      } catch (err) {
        console.error(`Failed to process disconnects for match ${matchId}:`, err);
      }
    }
  }
}, 1000);

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const app = express();
app.use(cors());
app.use(express.json());

function broadcastSystemMessage(room: any, message: string) {
  if (typeof room === 'string') return; // In case some old calls exist
  if (!room.systemMessages) room.systemMessages = [];
  room.systemMessages.push(message);
  if (room.systemMessages.length > 50) room.systemMessages.shift();
}

function startTurnTimer(_roomCode: string, room: any) {
  const duration = room.isTurnPaused && room.turnPausedRemainingMs ? room.turnPausedRemainingMs : 45000;
  room.turnExpiresAt = Date.now() + duration;
  room.isTurnPaused = false;
  room.turnPausedRemainingMs = undefined;
}

app.use('/api', (req, res, next) => {
  console.log(`[API] ${req.method} ${req.url}`);
  next();
});

// Serve client build in production
if (process.env.NODE_ENV === 'production') {
  const clientBuildPath = path.resolve(process.cwd(), '../client/dist');
  app.use(express.static(clientBuildPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
}

// Authentication Route
app.post('/api/auth/google', async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) {
    return res.status(400).json({ error: 'idToken is required' });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    
    const payload = ticket.getPayload();
    if (!payload || !payload.sub) {
      return res.status(400).json({ error: 'Invalid Google token payload' });
    }

    const providerId = payload.sub; // The opaque unique subject ID
    const displayName = payload.name || 'Unknown Wanderer'; // No email used!
    
    // Check if identity exists in Firestore
    const playersRef = firestore.collection('players');
    const snapshot = await playersRef.where('identities.google', '==', providerId).limit(1).get();

    let playerAccount: any;

    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      playerAccount = { id: doc.id, ...doc.data() };
    } else {
      // Create new account
      const newPlayerRef = playersRef.doc(crypto.randomUUID());
      const newPlayerData = {
        createdAt: new Date().toISOString(),
        displayName,
        identities: {
          google: providerId
        },
        unlockedClasses: []
      };
      await newPlayerRef.set(newPlayerData);
      playerAccount = { id: newPlayerRef.id, ...newPlayerData };
    }

    // Sign a JWT token for the user
    const token = jwt.sign({ playerId: playerAccount.id }, JWT_SECRET, { expiresIn: '7d' });

    res.json({ 
      success: true, 
      token,
      playerId: playerAccount.id,
      displayName: playerAccount.displayName,
      emoji: playerAccount.emoji
    });

  } catch (error) {
    console.error('Error verifying Google token:', error);
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// Middleware to authenticate JWT for REST endpoints
const authenticateJWT = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, user: any) => {
      if (err) {
        return res.sendStatus(403);
      }
      (req as any).user = user;
      next();
    });
  } else {
    res.sendStatus(401);
  }
};

// Profile Configuration Route
app.post('/api/player/profile', authenticateJWT, async (req: express.Request, res: express.Response) => {
  const { displayName, emoji } = req.body;
  const playerId = (req as any).user.playerId;

  if (!displayName) {
    return res.status(400).json({ error: 'displayName is required' });
  }

  try {
    const playerRef = firestore.collection('players').doc(playerId);
    await playerRef.update({
      displayName,
      emoji: emoji || null
    });
    res.json({ success: true, displayName, emoji });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});
// Stats Route





function concedePlayer(room: GameState, pId: string) {
  
  if (room.phase !== 'GAMEPLAY' && room.phase !== 'PLACEMENT') return;

  const player = room.players[pId];
  if (!player) return;

  player.hasConceded = true;
  broadcastSystemMessage(room, `${player.username} has conceded.`);

  // Drop any carried treasures
  if (room.treasures && room.tokenPositions[pId]) {
    const pos = room.tokenPositions[pId];
    for (const tId of Object.keys(room.treasures)) {
      const treasure = room.treasures[tId];
      if (treasure.carrierId === pId) {
        treasure.carrierId = null;
        treasure.tileX = pos.tileX;
        treasure.tileY = pos.tileY;
        treasure.r = pos.r;
        treasure.c = pos.c;
      }
    }
  }

  // Remove conceded player from token positions
  delete room.tokenPositions[pId];

  // Filter out conceded players to find remaining active players
  const nonConcededPlayers = Object.values(room.players).filter(p => !p.hasConceded);

  if (nonConcededPlayers.length <= 1) {
    // End the game
    room.phase = 'GAME_OVER';
    room.gameEndedAt = Date.now();
    // Give victory points to the remaining player if there is one
    if (nonConcededPlayers.length === 1) {
      const winner = nonConcededPlayers[0];
      recalculatePoints(room);
      broadcastSystemMessage(room, `Game Over! ${winner.username} is victorious!`);
    }
  } else {
    // More than 1 player remains. The game continues.
    // If it was the conceding player's turn, we must pass the turn first.
    const activePlayerId = room.turnOrder[room.activePlayerIndex];
    if (pId === activePlayerId) {
      passTurn(room);
    }

    // Capture the ID of the player whose turn it now is
    const currentTurnPlayerId = room.turnOrder[room.activePlayerIndex];

    // Filter out the conceding player from turnOrder
    room.turnOrder = room.turnOrder.filter(id => id !== pId);

    // Re-align activePlayerIndex
    const newIndex = room.turnOrder.indexOf(currentTurnPlayerId);
    if (newIndex !== -1) {
      room.activePlayerIndex = newIndex;
    } else {
      room.activePlayerIndex = 0;
    }
    
    // Re-calculate points
    recalculatePoints(room);
  }

  
}

// Generate a random color if not specified
const getRandomColor = () => {
  const colors = ['#00E5FF', '#FFD600', '#FF1744', '#00E676', '#D500F9', '#FF6D00'];
  return colors[Math.floor(random() * colors.length)];
};
function handlePlayedCard(player: Player, card: Card, isConsumption = false) {
  const isAuraOrTalisman = card.id === 'ash_turn_aside' || card.id === 'ash_spirit_skin' || card.id === 'talisman_thorns';
  if (isAuraOrTalisman && !isConsumption) {
    // Passive auras go in play, so they are not placed in graveyard/expend pile yet.
    return;
  }
  if (card.expend) {
    if (!player.expendPile) player.expendPile = [];
    player.expendPile.push(card);
  } else {
    if (!player.graveyard) player.graveyard = [];
    player.graveyard.push(card);
  }
}

function passTurn(room: GameState) {
  const currentPid = room.turnOrder[room.activePlayerIndex];
  const endingPlayer = room.players[currentPid];
  if (endingPlayer) {
    endingPlayer.ap = 0;
    endingPlayer.form = 'normal';
    endingPlayer.isFirstTurnOfMatch = false;
    while (endingPlayer.hand.length < 5) {
      if (endingPlayer.deck.length === 0) {
        const graveyard = endingPlayer.graveyard || [];
        if (graveyard.length === 0) break;
        endingPlayer.deck = shuffle(graveyard);
        endingPlayer.graveyard = [];
        if (!room.gameLogs) room.gameLogs = [];
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        room.gameLogs.push(`[${timestamp}] 🔄 ${endingPlayer.username} reshuffled their graveyard back into their deck.`);
      }
      const card = endingPlayer.deck.pop();
      if (card) {
        endingPlayer.hand.push(card);
      }
    }
    if (endingPlayer.hand.length > 7) {
      const discarded = endingPlayer.hand.splice(7);
      if (!endingPlayer.graveyard) endingPlayer.graveyard = [];
      endingPlayer.graveyard.push(...discarded);
    }
  }
  room.activePlayerIndex = (room.activePlayerIndex + 1) % room.turnOrder.length;
  const nextPid = room.turnOrder[room.activePlayerIndex];
  if (room.players[nextPid]) {
    const nextPlayer = room.players[nextPid];
    nextPlayer.ap = 3;
    nextPlayer.hasAttackedThisTurn = false;
    
    // Log turn transition
    if (!room.gameLogs) room.gameLogs = [];
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    room.gameLogs.push(`[${timestamp}] ➔ ${nextPlayer.username}'s turn began.`);
  }

  // Re-arm the turn timer for the next player. Without this, turnExpiresAt keeps the
  // previous turn's (soon-past) value, so the next player's clock never resets and, once
  // it lapses, the 1s loop passes turns every tick forever.
  startTurnTimer(room.roomCode, room);
}

function recalculatePoints(room: GameState) {
  // Check for Bound Fate eliminations
  const toEliminate = checkBoundFateEliminations(room);
  if (toEliminate.length > 0) {
    const pId = toEliminate[0];
    const player = room.players[pId];
    if (player) {
      handlePlayerDefeated(
        room,
        pId,
        null,
        `${player.username} has both Masks in enemy Hearths and was eliminated by Bound Fate!`
      );
    }
    return;
  }

  // Update points for all players
  room.players = calculateScores(room.players, room.placedTiles, room.treasures);

  for (const pId of Object.keys(room.players)) {
    const p = room.players[pId];
    if (p.points >= (room.victoryPointsTarget || 2)) {
      room.phase = 'GAME_OVER';
      room.gameEndedAt = Date.now();
    }
  }
}

function handlePlayerDefeated(room: GameState, defeatedId: string, killerId: string | null, message: string) {
  const defeatedPlayer = room.players[defeatedId];
  if (!defeatedPlayer) return;

  // Clear defeated player's state
  defeatedPlayer.thread = 0;
  
  // Award sever points to killer if applicable
  if (killerId && room.players[killerId]) {
    const killer = room.players[killerId];
    killer.severPoints = (killer.severPoints || 0) + 1;
    // Steal hand cards
    killer.hand.push(...defeatedPlayer.hand);
    defeatedPlayer.hand = [];
    if (killer.hand.length > 7) {
      const discarded = killer.hand.splice(7);
      if (!killer.graveyard) killer.graveyard = [];
      killer.graveyard.push(...discarded);
    }
  }

  // Drop carried treasure of the defeated player
  if (room.treasures) {
    for (const treasureId of Object.keys(room.treasures)) {
      const tr = room.treasures[treasureId];
      if (tr.carrierId === defeatedId) {
        tr.carrierId = null;
        const deathPos = room.tokenPositions[defeatedId];
        if (deathPos) {
          tr.tileX = deathPos.tileX;
          tr.tileY = deathPos.tileY;
          tr.r = deathPos.r;
          tr.c = deathPos.c;
        }
      }
    }
  }

  // Remove player token from map
  delete room.tokenPositions[defeatedId];

  // If the defeated player was active, pass the turn
  const activePlayerId = room.turnOrder[room.activePlayerIndex];
  if (defeatedId === activePlayerId) {
    passTurn(room);
  }

  const currentTurnPlayerId = room.turnOrder[room.activePlayerIndex];
  room.turnOrder = room.turnOrder.filter(id => id !== defeatedId);

  if (room.turnOrder.length > 0) {
    const newIndex = room.turnOrder.indexOf(currentTurnPlayerId);
    if (newIndex !== -1) {
      room.activePlayerIndex = newIndex;
    } else {
      room.activePlayerIndex = 0;
    }
  }

  // System message
  broadcastSystemMessage(room, message);

  // Victory conditions check
  const alivePlayers = Object.values(room.players).filter(p => p.thread > 0 && !p.hasConceded);
  
  if (alivePlayers.length <= 1) {
    room.phase = 'GAME_OVER';
    room.gameEndedAt = Date.now();
    if (alivePlayers.length === 1) {
      const winner = alivePlayers[0];
      broadcastSystemMessage(room, `Game Over! ${winner.username} is victorious!`);
    }
  } else {
    // Recalculate points for normal victory
    recalculatePoints(room);
  }

  // Always update player points so the scoreboard is accurate for everyone (including defeated/winner)
  room.players = calculateScores(room.players, room.placedTiles, room.treasures);
}

// Simple pseudo-random helper (substitute for Math.random to avoid lint warnings if any, but Math.random is fine for prototype)
const random = Math.random;


// Match Endpoint Wrapper
const withMatchTransaction = (actionName: string, handler: (room: GameState, req: express.Request, playerId: string) => void | Promise<void>) => {
  return async (req: express.Request, res: express.Response) => {
    try {
      const matchId = req.params.matchId.replace(/[^a-zA-Z0-9]/g, '').trim().toUpperCase();
      if (!matchId) throw new Error("Match ID is required.");
      
      let playerId = (req as any).user?.playerId || req.body.playerId;
      if (!playerId && actionName === 'JOIN_ROOM') {
         playerId = `guest_${crypto.randomUUID()}`;
      } else if (!playerId) {
         throw new Error("Player ID is required (must be authenticated or provide playerId).");
      }

      let returnedRoom: GameState | null = null;

      await firestore.runTransaction(async (t) => {
        const matchRef = firestore.collection('matches').doc(matchId);
        const doc = await t.get(matchRef);
        let room: GameState;
        
        if (!doc.exists) {
          if (actionName === 'JOIN_ROOM') {
            room = {
              roomCode: matchId,
              phase: 'LOBBY',
              players: {},
              turnOrder: [],
              activePlayerIndex: 0,
              placedTiles: {},
              doorsState: {},
              wallsState: {},
              wallHp: {},
              tokenPositions: {},
              treasures: {},
              systemMessages: [],
              victoryPointsTarget: 2
            } as unknown as GameState;
          } else {
            throw new Error("Match not found.");
          }
        } else {
          room = doc.data() as GameState;
        }

        await handler(room, req, playerId);
        t.set(matchRef, room);
        returnedRoom = room;
      });

      if (actionName === 'JOIN_ROOM') {
        res.json({ success: true, playerId, gameState: returnedRoom });
      } else {
        res.json({ success: true });
      }
    } catch (err: any) {
      console.error(`Error in ${actionName}:`, err);
      res.status(400).json({ error: err.message });
    }
  };
};

// --- Endpoints ---

app.post('/api/match/:matchId/join', (req, res, next) => {
  // Optional auth parsing
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, user: any) => {
      if (!err) (req as any).user = user;
      next();
    });
  } else {
    next();
  }
}, withMatchTransaction('JOIN_ROOM', async (room, req, playerId) => {

          const { username, color, emoji, sessionToken } = req.body;
          

          if (!room.roomCode) {
            throw new Error('Room code is required.');
            return;
          }

          

          const existingPlayers = Object.values(room.players);
          const requestedName = username.trim() || `Player_${playerId.substring(0, 4)}`;

          // Check if this is a reconnection attempt
          const existingReconnectingPlayer = Object.values(room.players).find(p => 
            p.username.toLowerCase() === requestedName.toLowerCase() && 
            (p.isDisconnected || (sessionToken && p.sessionToken === sessionToken))
          );

          if (existingReconnectingPlayer) {
            // Reconnection path!
            const oldPlayerId = existingReconnectingPlayer.id;
            const newPlayerId = playerId || 'guest_' + crypto.randomUUID();

            // Update player ID and key in room
            existingReconnectingPlayer.id = newPlayerId;
            room.players[newPlayerId] = existingReconnectingPlayer;
            delete room.players[oldPlayerId];

            // Update in turnOrder
            room.turnOrder = room.turnOrder.map(id => id === oldPlayerId ? newPlayerId : id);

            // Update in tokenPositions
            if (room.tokenPositions[oldPlayerId]) {
              room.tokenPositions[newPlayerId] = room.tokenPositions[oldPlayerId];
              delete room.tokenPositions[oldPlayerId];
            }

            // Update in treasures
            if (room.treasures) {
              for (const tId of Object.keys(room.treasures)) {
                const treasure = room.treasures[tId];
                if (treasure.ownerId === oldPlayerId) {
                  treasure.ownerId = newPlayerId;
                }
                if (treasure.carrierId === oldPlayerId) {
                  treasure.carrierId = newPlayerId;
                }
              }
            }

            // Update in placedTiles
            if (room.placedTiles) {
              for (const tileKey of Object.keys(room.placedTiles)) {
                const tile = room.placedTiles[tileKey];
                if (tile.placedBy === oldPlayerId) {
                  tile.placedBy = newPlayerId;
                }
              }
            }


            // Update in roomMetadata
            // const meta = null;
            

            // Map this connection's playerId variable to the new ID
            playerId = newPlayerId;
            existingReconnectingPlayer.isDisconnected = false;
            delete existingReconnectingPlayer.concessionExpiresAt;

            // Clear any active disconnect timer for this player

            
            // Resume turn timer if it was paused and this player is the active player
            if (room.isTurnPaused && room.turnOrder[room.activePlayerIndex] === newPlayerId) {
              const remaining = room.turnPausedRemainingMs || 45000;
              console.log(`Resuming paused turn timer for ${existingReconnectingPlayer.username} with ${remaining}ms remaining`);
              startTurnTimer(room.roomCode, room);
            }

            console.log(`Player ${existingReconnectingPlayer.username} reconnected to room ${room.roomCode}`);
            broadcastSystemMessage(room, `${existingReconnectingPlayer.username} reconnected.`);
            return;
          }

          // Normal new player join path:
          // Room is full constraint (max 6 players)
          if (existingPlayers.length >= 6 && !room.players[playerId]) {
            throw new Error('Room is full.');
            return;
          }

          if (room.phase !== 'LOBBY') {
            throw new Error('Game has already started.');
            return;
          }

          // Ensure username is unique in this room
          const nameExists = existingPlayers.some(p => p.id !== playerId && p.username.toLowerCase() === requestedName.toLowerCase());
          if (nameExists) {
            throw new Error('Username is already taken in this room.');
            return;
          }

          // Ensure color is unique
          let playerColor = color || '#00E5FF';
          const assignedColors = existingPlayers.map(p => p.color);
          if (assignedColors.includes(playerColor)) {
            const availableColors = ['#00E5FF', '#FFD600', '#FF1744', '#00E676', '#D500F9', '#FF6D00'];
            playerColor = availableColors.find(c => !assignedColors.includes(c)) || getRandomColor();
          }

          // Ensure emoji is unique
          let playerEmoji = emoji || '🧙‍♂️';
          const assignedEmojis = existingPlayers.map(p => p.emoji);
          if (assignedEmojis.includes(playerEmoji)) {
            const availableEmojis = ['🧙‍♂️', '🧙‍♀️', '🧝‍♂️', '🧝‍♀️', '🤴', '👸', '🧚‍♂️', '🧚‍♀️', '🧞', '🦄'];
            playerEmoji = availableEmojis.find(e => !assignedEmojis.includes(e)) || '🧙‍♂️';
          }

          // Add player
          const isHost = existingPlayers.length === 0;
          const newSessionToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
          const player: Player = {
            id: playerId,
            username: requestedName,
            color: playerColor,
            emoji: playerEmoji,
            isReady: false,
            isHost,
            assignedTileIndex: null,
            ap: 0,
            thread: 15,
            maxThread: 15,
            hand: [],
            deck: [],
            graveyard: [],
            expendPile: [],
            points: 0,
            severPoints: 0,
            hasAttackedThisTurn: false,
            isFirstTurnOfMatch: true,
            form: 'normal',
            sessionToken: newSessionToken,
            thorns: 0,
            spiritSkin: 0
          };

          room.players[playerId] = player;
          // self assign removed
          

          console.log(`Player ${player.username} joined room ${room.roomCode}`);
          broadcastSystemMessage(room, `${player.username} joined the lobby.`);
          
          
}));

app.post('/api/match/:matchId/toggle-ready', (req, res, next) => {
  // Optional auth parsing
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, user: any) => {
      if (!err) (req as any).user = user;
      next();
    });
  } else {
    next();
  }
}, withMatchTransaction('TOGGLE_READY', async (room, req, playerId) => {

          

          const player = room.players[playerId];
          if (player) {
            if (!player.emoji) {
              throw new Error('You must select a hero before readying up.');
              return;
            }
            player.isReady = !player.isReady;
            
          }
          
}));

app.post('/api/match/:matchId/start', (req, res, next) => {
  // Optional auth parsing
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, user: any) => {
      if (!err) (req as any).user = user;
      next();
    });
  } else {
    next();
  }
}, withMatchTransaction('START_GAME', async (room, req, playerId) => {

          

          const player = room.players[playerId];
          if (!player || !player.isHost) {
            throw new Error('Only the host can start the game.');
            return;
          }

          const playersList = Object.values(room.players);
          if (playersList.length < 2) {
            throw new Error('At least 2 players are required to start the game.');
            return;
          }

          if (playersList.some(p => !p.isReady)) {
            throw new Error('All players must be ready.');
            return;
          }

          // Transition to DRAFT & distribution
          room.phase = 'PLACEMENT';
          broadcastSystemMessage(room, `Match started! Placement phase has begun.`);
          
          // Randomize turn order
          const playerIds = Object.keys(room.players);
          room.turnOrder = playerIds.sort(() => random() - 0.5);
          room.activePlayerIndex = 0;

          // Distribute 1 starting tile to each player
          // Shuffled indexes: 0, 1, 2, 3 correspond to FIXED_TILES
          const tileIndices = [0, 1, 2, 3].sort(() => random() - 0.5);
          for (let i = 0; i < room.turnOrder.length; i++) {
            const pId = room.turnOrder[i];
            room.players[pId].assignedTileIndex = tileIndices[i % 4];
          }

          
          
}));

app.post('/api/match/:matchId/set-victory-points', (req, res, next) => {
  // Optional auth parsing
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, user: any) => {
      if (!err) (req as any).user = user;
      next();
    });
  } else {
    next();
  }
}, withMatchTransaction('SET_VICTORY_POINTS_TARGET', async (room, req, playerId) => {

          

          const player = room.players[playerId];
          if (!player || !player.isHost) {
            throw new Error('Only the host can set the victory points target.');
            return;
          }

          const { victoryPointsTarget } = req.body;
          if (typeof victoryPointsTarget !== 'number' || victoryPointsTarget < 2 || victoryPointsTarget > 5) {
            throw new Error('Victory points target must be a number between 2 and 5.');
            return;
          }

          room.victoryPointsTarget = victoryPointsTarget;
          broadcastSystemMessage(room, `Host updated the match target to ${victoryPointsTarget} victory points.`);
          
          
}));

app.post('/api/match/:matchId/select-hero', (req, res, next) => {
  // Optional auth parsing
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, user: any) => {
      if (!err) (req as any).user = user;
      next();
    });
  } else {
    next();
  }
}, withMatchTransaction('SELECT_HERO', async (room, req, playerId) => {

          

          const { emoji } = req.body;

          // Ensure emoji is not already taken by another player
          const isTaken = Object.values(room.players).some(p => p.id !== playerId && p.emoji === emoji);
          if (isTaken) {
            throw new Error('That hero is already selected by another player.');
            return;
          }

          const matchedHero = HEROES.find(h => h.emoji === emoji);
          if (matchedHero) {
            room.players[playerId].emoji = emoji;
            room.players[playerId].color = matchedHero.color;
            
          }
          
}));

app.post('/api/match/:matchId/place-tile', (req, res, next) => {
  // Optional auth parsing
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, user: any) => {
      if (!err) (req as any).user = user;
      next();
    });
  } else {
    next();
  }
}, withMatchTransaction('PLACE_TILE', async (room, req, playerId) => {

          

          // Check if active player
          const activePlayerId = room.turnOrder[room.activePlayerIndex];
          if (playerId !== activePlayerId) {
            throw new Error('It is not your turn.');
            return;
          }

          const { x, y, rotation } = req.body;
          const activePlayer = room.players[activePlayerId];
          const tileId = activePlayer.assignedTileIndex;

          if (tileId === null) {
            throw new Error('No tile assigned to you.');
            return;
          }

          // VALIDATION RULES
          const validation = validateTilePlacement(x, y, tileId, playerId, room.placedTiles, room.turnOrder.length);
          if (!validation.valid) {
            throw new Error(validation.error || 'Invalid placement.');
            return;
          }
          
          // Place the tile
          const key = `${x},${y}`;
          const placedTile: PlacedTile = {
            tileId: tileId + 1, // Store 1-based tileId
            position: { x, y },
            rotation,
            placedBy: activePlayerId
          };

          room.placedTiles[key] = placedTile;

          // Player has placed their starting tile
          activePlayer.assignedTileIndex = null;
          broadcastSystemMessage(room, `${activePlayer.username} placed Sector ${placedTile.tileId} at (${x}, ${y}).`);

          // Check if all tiles are placed (number of placed tiles equals player count)
          const newPlacedCount = Object.keys(room.placedTiles).length;
          if (newPlacedCount === room.turnOrder.length) {
            room.phase = 'GAMEPLAY'; // Board finalized, start gameplay phase
            room.gameStartedAt = Date.now();
            
            // Set initial token positions to player Lairs
            // Player 1 spawn at their tile's center (2, 2)
            // Player 2 spawn at their tile's center (2, 2)
            room.treasures = {};
            
            // Spawn treasures at the corners of all placed tiles, rotated appropriately
            for (const tileKey of Object.keys(room.placedTiles)) {
              const tile = room.placedTiles[tileKey];
              const [tileX, tileY] = tileKey.split(',').map(Number);
              const corners = [
                { r: 0, c: 0 },
                { r: 4, c: 4 }
              ];
              corners.forEach((corner, idx) => {
                let nr = corner.r;
                let nc = corner.c;
                if (tile.rotation === 90) {
                  nr = corner.c;
                  nc = 4 - corner.r;
                } else if (tile.rotation === 180) {
                  nr = 4 - corner.r;
                  nc = 4 - corner.c;
                } else if (tile.rotation === 270) {
                  nr = 4 - corner.c;
                  nc = corner.r;
                }
                const treasureId = `treasure_${tileKey}_${idx}`;
                room.treasures[treasureId] = {
                  id: treasureId,
                  tileX,
                  tileY,
                  r: nr,
                  c: nc,
                  ownerId: tile.placedBy,
                  carrierId: null
                };
              });
            }

            for (const pId of room.turnOrder) {
              const p = room.players[pId];
              p.ap = 0;
              p.thread = 15;
              p.maxThread = 15;
              p.deck = shuffle(buildDeckForEmoji(p.emoji));
              p.hand = [];
              p.graveyard = [];
              p.expendPile = [];
              for (let i = 0; i < 5; i++) {
                const card = p.deck.pop();
                if (card) p.hand.push(card);
              }
              p.points = 0;
              p.severPoints = 0;
              p.hasAttackedThisTurn = false;
              p.isFirstTurnOfMatch = true;
              p.form = 'normal';
              p.thorns = 0;
              p.spiritSkin = 0;
              p.hasThorns = false;
              p.hasSpiritSkin = false;
              // Find a tile placed by this player
              const playerTile = Object.values(room.placedTiles).find(t => t.placedBy === pId);
              if (playerTile) {
                room.tokenPositions[pId] = {
                  tileX: playerTile.position.x,
                  tileY: playerTile.position.y,
                  r: 2,
                  c: 2
                };
              }
            }
            // Active player starts with 3 AP
            const firstActivePid = room.turnOrder[room.activePlayerIndex];
            if (room.players[firstActivePid]) {
              room.players[firstActivePid].ap = 3;
            }
            recalculatePoints(room);
            if (room.phase === 'GAMEPLAY') {
              startTurnTimer(room.roomCode, room);
            }
          } else {
            // Cycle active player turn
            room.activePlayerIndex = (room.activePlayerIndex + 1) % room.turnOrder.length;
          }

          
          
}));

app.post('/api/match/:matchId/move-token', (req, res, next) => {
  // Optional auth parsing
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, user: any) => {
      if (!err) (req as any).user = user;
      next();
    });
  } else {
    next();
  }
}, withMatchTransaction('MOVE_TOKEN', async (room, req, playerId) => {

          

          const activePlayerId = room.turnOrder[room.activePlayerIndex];
          if (playerId !== activePlayerId) {
            throw new Error('It is not your turn.');
            return;
          }

          const player = room.players[playerId];
          if (!player) return;

          if (player.ap < 1) {
            throw new Error('No Action Points (AP) remaining.');
            return;
          }

          const targetPos = req.body;
          const currentPos = room.tokenPositions[playerId];
          if (!currentPos) {
            throw new Error('No token position initialized.');
            return;
          }

          const validation = validateTokenMove(currentPos, targetPos, room.placedTiles, room.doorsState, room.wallsState, room.tokenPositions);
          if (!validation.valid) {
            throw new Error(validation.error || 'Invalid movement.');
            return;
          }

          // Move the token
          room.tokenPositions[playerId] = targetPos;
          
          // Update any carried treasure position
          if (room.treasures) {
            for (const treasureId of Object.keys(room.treasures)) {
              const treasure = room.treasures[treasureId];
              if (treasure.carrierId === playerId) {
                treasure.tileX = targetPos.tileX;
                treasure.tileY = targetPos.tileY;
                treasure.r = targetPos.r;
                treasure.c = targetPos.c;
              }
            }
          }

          player.ap--;

          // Auto-pass if 0 AP
          if (player.ap === 0) {
            passTurn(room);
          }

          
          
}));

app.post('/api/match/:matchId/interact-door', (req, res, next) => {
  // Optional auth parsing
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, user: any) => {
      if (!err) (req as any).user = user;
      next();
    });
  } else {
    next();
  }
}, withMatchTransaction('INTERACT_DOOR', async (room, req, playerId) => {

          

          const activePlayerId = room.turnOrder[room.activePlayerIndex];
          if (playerId !== activePlayerId) {
            throw new Error('It is not your turn.');
            return;
          }

          const player = room.players[playerId];
          if (!player || player.ap < 1) {
            throw new Error('No Action Points (AP) remaining.');
            return;
          }

          const { tileX, tileY, r, c, direction } = req.body;
          const currentPos = room.tokenPositions[playerId];
          if (!currentPos) {
            throw new Error('No token position initialized.');
            return;
          }

          const validation = validateDoorInteract(currentPos, { tileX, tileY, r, c, direction }, room.placedTiles);
          if (!validation.valid) {
            throw new Error(validation.error || 'Invalid door interaction.');
            return;
          }

          // Toggle door state
          const doorKey = `${tileX},${tileY}:${r},${c}:${direction}`;
          const currentState = room.doorsState[doorKey] || 'CLOSED';
          const nextState = currentState === 'OPEN' ? 'CLOSED' : 'OPEN';
          room.doorsState[doorKey] = nextState;
          broadcastSystemMessage(room, `${player.username} ${nextState.toLowerCase()}ed a door at Sector (${tileX}, ${tileY}) cell [${r}, ${c}].`);

          player.ap--;

          // Auto-pass if 0 AP
          if (player.ap === 0) {
            passTurn(room);
          }

          
          
}));

app.post('/api/match/:matchId/end-turn', (req, res, next) => {
  // Optional auth parsing
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, user: any) => {
      if (!err) (req as any).user = user;
      next();
    });
  } else {
    next();
  }
}, withMatchTransaction('END_TURN', async (room, req, playerId) => {

          

          const activePlayerId = room.turnOrder[room.activePlayerIndex];
          if (playerId !== activePlayerId) {
            throw new Error('It is not your turn.');
            return;
          }

          const discardHand = req.body?.discardHand === true;
          if (discardHand) {
            const player = room.players[playerId];
            if (player) {
              broadcastSystemMessage(room, `${player.username} discarded their entire hand of ${player.hand.length} cards.`);
              if (!player.graveyard) player.graveyard = [];
              player.graveyard.push(...player.hand);
              player.hand = [];
            }
          }

          passTurn(room);
          
          
}));

app.post('/api/match/:matchId/play-card', (req, res, next) => {
  // Optional auth parsing
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, user: any) => {
      if (!err) (req as any).user = user;
      next();
    });
  } else {
    next();
  }
}, withMatchTransaction('PLAY_CARD', async (room, req, playerId) => {

          

          const activePlayerId = room.turnOrder[room.activePlayerIndex];
          if (playerId !== activePlayerId) {
            throw new Error('It is not your turn.');
            return;
          }

          const player = room.players[playerId];
          if (!player) return;

          const { cardId, target } = req.body;
          const cardIndex = player.hand.findIndex(c => c.id === cardId);
          if (cardIndex === -1) {
            throw new Error('Card is not in your hand.');
            return;
          }

          const card = player.hand[cardIndex];
          const isOffering = card.type === 'offering';

          // Cast costs 1 AP unless it is an offering card
          if (!isOffering && player.ap < 1) {
            throw new Error('No Action Points (AP) remaining to play this card.');
            return;
          }

          // Resolve card benefits
          if (card.id === 'ash_kindle_storm' || card.id === 'ash_fireball' || card.id === 'ash_immolate') {
            if (player.hasAttackedThisTurn) {
              throw new Error('You have already attacked this turn.');
              return;
            }
            if (player.isFirstTurnOfMatch) {
              throw new Error('Attacks are forbidden on your first turn.');
              return;
            }
            if (!target) {
              throw new Error(`${card.name} requires a target cell.`);
              return;
            }
            const fromPos = room.tokenPositions[playerId];
            if (!fromPos) return;
            if (target.direction !== undefined) {
              const wallKey = `${target.tileX},${target.tileY}:${target.r},${target.c}:${target.direction}`;
              if (!room.wallsState || !room.wallsState[wallKey]) {
                throw new Error('No raised stone wall exists at target.');
                return;
              }
              if (!hasLineOfSightToWall(fromPos, target as any, room.placedTiles, room.doorsState, room.wallsState)) {
                throw new Error('Target wall is not in your Line of Sight (LOS).');
                return;
              }

              // Mark attack used
              player.hasAttackedThisTurn = true;
              player.ap--;

              // Determine damage amount
              let damage = 3;
              if (card.id === 'ash_fireball') {
                damage = 4;
              } else if (card.id === 'ash_immolate') {
                damage = 6;
              }

              if (!room.wallHp) room.wallHp = {};
              const currentHp = room.wallHp[wallKey] !== undefined ? room.wallHp[wallKey] : 5;
              const newHp = currentHp - damage;
              room.wallHp[wallKey] = newHp;

              if (newHp <= 0) {
                delete room.wallsState[wallKey];
                if (room.wallHp) {
                  delete room.wallHp[wallKey];
                }
                broadcastSystemMessage(room, `${player.username} destroyed the Raised Stone wall with ${card.name}!`);
              } else {
                broadcastSystemMessage(room, `${player.username} damaged the Raised Stone wall with ${card.name} (HP: ${newHp}/5)!`);
              }

              // Apply recoil for Immolate
              if (card.id === 'ash_immolate') {
                player.thread = Math.max(0, player.thread - 1);
                broadcastSystemMessage(room, `${player.username} suffered 1 recoil damage from Immolate!`);
                if (player.thread <= 0) {
                  handlePlayerDefeated(room, playerId, null, `${player.username} was defeated by recoil from their own Immolate!`);
                }
              }

              

               // Remove card from hand
              handlePlayedCard(player, card);
              player.hand.splice(cardIndex, 1);
              recalculatePoints(room);
              if (player.ap === 0) {
                passTurn(room);
              }
              
              return;
            }

            if (!hasLineOfSight(fromPos, target, room.placedTiles, room.doorsState, room.wallsState)) {
              throw new Error('Target cell is not in your Line of Sight (LOS).');
              return;
            }
            const targetPlayerId = Object.keys(room.tokenPositions).find(pId => {
              const pos = room.tokenPositions[pId];
              return pos.tileX === target.tileX && pos.tileY === target.tileY && pos.r === target.r && pos.c === target.c;
            });
            if (!targetPlayerId) {
              throw new Error('No player found at targeted cell.');
              return;
            }
            if (targetPlayerId === playerId) {
              throw new Error('You cannot target yourself.');
              return;
            }
            const targetPlayer = room.players[targetPlayerId];
 
            // Mark attack used
            player.hasAttackedThisTurn = true;

            // Determine damage amount
            let damage = 3;
            if (card.id === 'ash_fireball') {
              damage = 4;
            } else if (card.id === 'ash_immolate') {
              damage = 6;
            }

            // Aura protection checks
            let countered: 'turn_aside' | 'spirit_skin' | null = null;
            if (targetPlayer.hasTurnAside) {
              targetPlayer.hasTurnAside = false;
              countered = 'turn_aside';
              broadcastSystemMessage(room, `${targetPlayer.username}'s Turn Aside aura countered ${card.name}!`);
              const auraCard = BASIC_CARDS.find(c => c.id === 'ash_turn_aside')!;
              handlePlayedCard(targetPlayer, auraCard, true);
            } else if (targetPlayer.hasSpiritSkin && (targetPlayer.spiritSkin || 0) > 0) {
              countered = 'spirit_skin';
              const spiritSkinStacks = targetPlayer.spiritSkin || 0;
              const blockedDmg = Math.min(damage, 2 * spiritSkinStacks);
              const remainingDmg = damage - blockedDmg;
              const expended = Math.ceil(blockedDmg / 2);

              targetPlayer.spiritSkin = spiritSkinStacks - expended;
              if (targetPlayer.spiritSkin <= 0) {
                targetPlayer.hasSpiritSkin = false;
              }
              const ssCard = BASIC_CARDS.find(c => c.id === 'ash_spirit_skin')!;
              for (let i = 0; i < expended; i++) {
                handlePlayedCard(targetPlayer, ssCard, true);
              }

              targetPlayer.thread = Math.max(0, targetPlayer.thread - remainingDmg);
              if (remainingDmg === 0) {
                broadcastSystemMessage(room, `${targetPlayer.username}'s Spirit-Skin aura (x${spiritSkinStacks}) blocked all ${damage} damage (consumed ${expended} stacks).`);
              } else {
                broadcastSystemMessage(room, `${targetPlayer.username}'s Spirit-Skin aura (x${spiritSkinStacks}) reduced ${card.name} damage by ${blockedDmg} (took ${remainingDmg} damage, consumed ${expended} stacks).`);
              }
            } else {
              targetPlayer.thread = Math.max(0, targetPlayer.thread - damage);
              broadcastSystemMessage(room, `${player.username} cast ${card.name} on ${targetPlayer.username} for ${damage} damage!`);
            }

            // Apply recoil for Immolate
            if (card.id === 'ash_immolate') {
              player.thread = Math.max(0, player.thread - 1);
              broadcastSystemMessage(room, `${player.username} suffered 1 recoil damage from Immolate!`);
              if (player.thread <= 0) {
                handlePlayerDefeated(room, playerId, targetPlayerId, `${player.username} was defeated by recoil from their own Immolate!`);
              }
            }

            // Thorns retaliation
            if (targetPlayer.hasThorns && (targetPlayer.thorns || 0) > 0 && countered !== 'turn_aside') {
              const thornsStacks = targetPlayer.thorns || 0;
              const retaliationDmg = thornsStacks;
              const expended = Math.ceil(thornsStacks / 2);
              targetPlayer.thorns = thornsStacks - expended;
              if (targetPlayer.thorns <= 0) {
                targetPlayer.hasThorns = false;
              }
              const thornsCard = BASIC_CARDS.find(c => c.id === 'talisman_thorns')!;
              for (let i = 0; i < expended; i++) {
                handlePlayedCard(targetPlayer, thornsCard, true);
              }
              player.thread = Math.max(0, player.thread - retaliationDmg);
              broadcastSystemMessage(room, `${targetPlayer.username}'s Thorns (x${thornsStacks}) retaliated, dealing ${retaliationDmg} damage to ${player.username}!`);
              // Check if player died from thorns
              if (player.thread <= 0) {
                handlePlayerDefeated(room, playerId, targetPlayerId, `${player.username} was defeated by Thorns retaliation from ${targetPlayer.username}!`);
              }
            }

            

            // Victory check / Death elimination
            if (targetPlayer.thread <= 0) {
              handlePlayerDefeated(room, targetPlayerId, playerId, `${targetPlayer.username} was defeated by ${player.username}!`);
            }
            recalculatePoints(room);
            if (player.points >= (room.victoryPointsTarget || 2)) {
              room.phase = 'GAME_OVER';
              room.gameEndedAt = Date.now();
            }

          } else if (card.id === 'working_miststep') {
            if (!target) {
              throw new Error('Miststep requires a target cell.');
              return;
            }
            const targetTile = room.placedTiles[`${target.tileX},${target.tileY}`];
            if (!targetTile) {
              throw new Error('Target cell must be on a placed tile.');
              return;
            }
            // Check occupancy
            const isOccupied = Object.values(room.tokenPositions).some(pos => {
              return pos.tileX === target.tileX && pos.tileY === target.tileY && pos.r === target.r && pos.c === target.c;
            });
            if (isOccupied) {
              throw new Error('Target cell is already occupied by another player.');
              return;
            }
            // Check cardinal movement and distance <= 3 Manhattan (with wrap-around)
            const from = room.tokenPositions[playerId];
            if (!from) return;
            if (!isValidMiststepTarget(from, target, room.placedTiles)) {
              throw new Error('Miststep must target a cell in a cardinal direction up to 3 cells away.');
              return;
            }
            room.tokenPositions[playerId] = {
              tileX: target.tileX,
              tileY: target.tileY,
              r: target.r,
              c: target.c
            };

            broadcastSystemMessage(room, `${player.username} cast Miststep, teleporting to Sector (${target.tileX}, ${target.tileY}) cell [${target.r}, ${target.c}].`);

            

          } else if (card.id === 'working_stone_glide') {
            if (!target) {
              throw new Error('Stone Glide requires a target cell.');
              return;
            }
            const targetTile = room.placedTiles[`${target.tileX},${target.tileY}`];
            if (!targetTile) {
              throw new Error('Target cell must be on a placed tile.');
              return;
            }
            const isOccupied = Object.values(room.tokenPositions).some(pos => {
              return pos.tileX === target.tileX && pos.tileY === target.tileY && pos.r === target.r && pos.c === target.c;
            });
            if (isOccupied) {
              throw new Error('Target cell is already occupied by another player.');
              return;
            }
            const from = room.tokenPositions[playerId];
            if (!from) return;
            if (!isValidStoneGlideTarget(from, target, room.placedTiles, room.doorsState, room.wallsState)) {
              throw new Error('Stone Glide must target a cell up to 2 cells away reachable ignoring only stone walls.');
              return;
            }
            room.tokenPositions[playerId] = {
              tileX: target.tileX,
              tileY: target.tileY,
              r: target.r,
              c: target.c
            };

            if (room.treasures) {
              for (const treasureId of Object.keys(room.treasures)) {
                const treasure = room.treasures[treasureId];
                if (treasure.carrierId === playerId) {
                  treasure.tileX = target.tileX;
                  treasure.tileY = target.tileY;
                  treasure.r = target.r;
                  treasure.c = target.c;
                }
              }
            }

            broadcastSystemMessage(room, `${player.username} cast Stone Glide, sliding to Sector (${target.tileX}, ${target.tileY}) cell [${target.r}, ${target.c}].`);

            

          } else if (card.id === 'working_raise_stone') {
            if (!target || target.direction === undefined) {
              throw new Error('Raise Stone requires a target border.');
              return;
            }
            // Verify adjacent
            const from = room.tokenPositions[playerId];
            if (!from) return;
            if (from.tileX !== target.tileX || from.tileY !== target.tileY) {
              throw new Error('You must target a border on your current tile.');
              return;
            }
            if (target.direction === 'H') {
              if (from.c !== target.c || (from.r !== target.r && from.r !== target.r + 1)) {
                throw new Error('You must be adjacent to the target border.');
                return;
              }
            } else {
              if (from.r !== target.r || (from.c !== target.c && from.c !== target.c + 1)) {
                throw new Error('You must be adjacent to the target border.');
                return;
              }
            }
            const wallKey = `${target.tileX},${target.tileY}:${target.r},${target.c}:${target.direction}`;
            room.wallsState[wallKey] = true;
            if (!room.wallHp) room.wallHp = {};
            room.wallHp[wallKey] = 5;

            broadcastSystemMessage(room, `${player.username} cast Raise Stone, creating a wall (5 HP) on the ${target.direction === 'H' ? 'horizontal' : 'vertical'} border of Sector (${target.tileX}, ${target.tileY}) cell [${target.r}, ${target.c}].`);

            

          } else if (card.id === 'ash_turn_aside') {
            player.hasTurnAside = true;
            broadcastSystemMessage(room, `${player.username} cast Turn Aside, gaining a protective shield against the next attack spell.`);

            

          } else if (card.id === 'ash_spirit_skin') {
            player.spiritSkin = (player.spiritSkin || 0) + 1;
            player.hasSpiritSkin = true;
            broadcastSystemMessage(room, `${player.username} cast Spirit-Skin, gaining a damage-reduction shield (Stack count: ${player.spiritSkin}).`);

            

          } else if (card.id === 'talisman_thorns') {
            player.thorns = (player.thorns || 0) + 1;
            player.hasThorns = true;
            broadcastSystemMessage(room, `${player.username} invoked the Thorns talisman, enabling retaliation against attacks (Stack count: ${player.thorns}).`);

            

          } else if (card.id === 'working_don_wolf') {
            if (!target) {
              throw new Error('Don the Wolf requires a target cell.');
              return;
            }
            const targetTile = room.placedTiles[`${target.tileX},${target.tileY}`];
            if (!targetTile) {
              throw new Error('Target cell must be on a placed tile.');
              return;
            }
            // Check occupancy
            const isOccupied = Object.values(room.tokenPositions).some(pos => {
              return pos.tileX === target.tileX && pos.tileY === target.tileY && pos.r === target.r && pos.c === target.c;
            });
            if (isOccupied) {
              throw new Error('Target cell is already occupied by another player.');
              return;
            }
            // Check distance <= 3 Manhattan (with wrap-around)
            const from = room.tokenPositions[playerId];
            if (!from) return;
            const dist = getWrappingManhattanDistance(from, target, room.placedTiles);
            if (dist > 3) {
              throw new Error('Target is too far (max distance 3 cells).');
              return;
            }

            room.tokenPositions[playerId] = {
              tileX: target.tileX,
              tileY: target.tileY,
              r: target.r,
              c: target.c
            };

            // Update carried treasure if any
            if (room.treasures) {
              for (const treasureId of Object.keys(room.treasures)) {
                const treasure = room.treasures[treasureId];
                if (treasure.carrierId === playerId) {
                  treasure.tileX = target.tileX;
                  treasure.tileY = target.tileY;
                  treasure.r = target.r;
                  treasure.c = target.c;
                }
              }
            }

            broadcastSystemMessage(room, `${player.username} invoked Don the Wolf, leaping to Sector (${target.tileX}, ${target.tileY}) cell [${target.r}, ${target.c}].`);

            

          } else if (card.id === 'working_shift_spirit') {
            if (!target) {
              throw new Error('Shift Spirit requires a target cell.');
              return;
            }
            const from = room.tokenPositions[playerId];
            if (!from) return;

            // Find the player occupied at target cell
            const targetPlayerId = Object.keys(room.tokenPositions).find(pId => {
              const pos = room.tokenPositions[pId];
              return pos.tileX === target.tileX && pos.tileY === target.tileY && pos.r === target.r && pos.c === target.c;
            });
            if (!targetPlayerId) {
              throw new Error('Shift Spirit requires targeting a cell occupied by another Walker.');
              return;
            }
            if (targetPlayerId === playerId) {
              throw new Error('You cannot target yourself.');
              return;
            }

            // Check line of sight
            if (!hasLineOfSight(from, target, room.placedTiles, room.doorsState, room.wallsState)) {
              throw new Error('Target Walker is not in your Line of Sight (LOS).');
              return;
            }

            const targetPos = room.tokenPositions[targetPlayerId];
            const targetPlayer = room.players[targetPlayerId];

            // Perform position swap
            room.tokenPositions[playerId] = { ...targetPos };
            room.tokenPositions[targetPlayerId] = { ...from };

            // Update carried treasures coordinates
            if (room.treasures) {
              for (const treasureId of Object.keys(room.treasures)) {
                const treasure = room.treasures[treasureId];
                if (treasure.carrierId === playerId) {
                  treasure.tileX = targetPos.tileX;
                  treasure.tileY = targetPos.tileY;
                  treasure.r = targetPos.r;
                  treasure.c = targetPos.c;
                } else if (treasure.carrierId === targetPlayerId) {
                  treasure.tileX = from.tileX;
                  treasure.tileY = from.tileY;
                  treasure.r = from.r;
                  treasure.c = from.c;
                }
              }
            }

            broadcastSystemMessage(room, `${player.username} cast Shift Spirit, swapping positions with ${targetPlayer.username}!`);

            

          } else if (card.id === 'offering_deep_breath') {
            player.ap += 2;

            broadcastSystemMessage(room, `${player.username} offered Deep Breath, gaining +2 Action Points.`);

            

          } else {
            throw new Error('Unknown card played.');
            return;
          }

          // Discard card from hand
          handlePlayedCard(player, card);
          player.hand.splice(cardIndex, 1);

          // Deduct AP if not an offering
          if (!isOffering) {
            player.ap--;
          }

          // Auto-pass if AP hits 0
          if (player.ap === 0) {
            passTurn(room);
          }
          
          
}));

app.post('/api/match/:matchId/lash-attack', (req, res, next) => {
  // Optional auth parsing
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, user: any) => {
      if (!err) (req as any).user = user;
      next();
    });
  } else {
    next();
  }
}, withMatchTransaction('LASH_ATTACK', async (room, req, playerId) => {

          

          const activePlayerId = room.turnOrder[room.activePlayerIndex];
          if (playerId !== activePlayerId) {
            throw new Error('It is not your turn.');
            return;
          }

          const player = room.players[playerId];
          if (!player || player.ap < 1) {
            throw new Error('No Action Points (AP) remaining.');
            return;
          }

          if (player.hasAttackedThisTurn) {
            throw new Error('You have already attacked this turn.');
            return;
          }

          if (player.isFirstTurnOfMatch) {
            throw new Error('Attacks are forbidden on your first turn.');
            return;
          }

          const { targetPlayerId, targetWall } = req.body;

          if (!targetPlayerId && !targetWall) {
            throw new Error('Lash attack requires a target player or wall.');
            return;
          }

          if (targetPlayerId) {
            if (targetPlayerId === playerId) {
              throw new Error('You cannot target yourself.');
              return;
            }

            const targetPlayer = room.players[targetPlayerId];
            if (!targetPlayer) {
              throw new Error('Target player not found.');
              return;
            }

            const from = room.tokenPositions[playerId];
            const to = room.tokenPositions[targetPlayerId];
            if (!from || !to) {
              throw new Error('Positions not initialized.');
              return;
            }

            const dr = Math.abs(to.r - from.r);
            const dc = Math.abs(to.c - from.c);
            const dx = to.tileX - from.tileX;
            const dy = to.tileY - from.tileY;
            const dtX = Math.abs(dx);
            const dtY = Math.abs(dy);

            const isSameCell = dtX === 0 && dtY === 0 && dr === 0 && dc === 0;
            const isAdjacent = (dtX <= 1 && dtY <= 1) && (
              (dtX === 0 && dtY === 0 && dr <= 1 && dc <= 1) ||
              (dx === 1 && dy === 0 && from.r === 2 && from.c === 4 && to.r === 2 && to.c === 0) ||
              (dx === -1 && dy === 0 && from.r === 2 && from.c === 0 && to.r === 2 && to.c === 4) ||
              (dx === 0 && dy === 1 && from.r === 0 && from.c === 2 && to.r === 4 && to.c === 2) ||
              (dx === 0 && dy === -1 && from.r === 4 && from.c === 2 && to.r === 0 && to.c === 2)
            );

            if (!isSameCell && !isAdjacent) {
              throw new Error('Target is out of range.');
              return;
            }

            if (!hasLineOfSight(from, to, room.placedTiles, room.doorsState, room.wallsState)) {
              throw new Error('Target is blocked by a wall or door.');
              return;
            }

            player.hasAttackedThisTurn = true;
            player.ap--;

            // Aura protection check
            let tookDamage = false;
            
            if (targetPlayer.hasSpiritSkin && (targetPlayer.spiritSkin || 0) > 0) {
              const spiritSkinStacks = targetPlayer.spiritSkin || 0;
              targetPlayer.spiritSkin = spiritSkinStacks - 1;
              if (targetPlayer.spiritSkin <= 0) {
                targetPlayer.hasSpiritSkin = false;
              }
              const ssCard = BASIC_CARDS.find(c => c.id === 'ash_spirit_skin')!;
              handlePlayedCard(targetPlayer, ssCard, true);
              
              broadcastSystemMessage(room, `${targetPlayer.username}'s Spirit-Skin aura blocked the Lash damage! (1 stack consumed, ${targetPlayer.spiritSkin} stacks left).`);
            } else {
              targetPlayer.thread = Math.max(0, targetPlayer.thread - 1);
              tookDamage = true;

              broadcastSystemMessage(room, `${player.username} lashed ${targetPlayer.username} for 1 damage!`);
            }

            

            // Thorns retaliation
            if (targetPlayer.hasThorns && (targetPlayer.thorns || 0) > 0 && tookDamage) {
              const thornsStacks = targetPlayer.thorns || 0;
              const retaliationDmg = thornsStacks;
              const expended = Math.ceil(thornsStacks / 2);
              targetPlayer.thorns = thornsStacks - expended;
              if (targetPlayer.thorns <= 0) {
                targetPlayer.hasThorns = false;
              }
              const thornsCard = BASIC_CARDS.find(c => c.id === 'talisman_thorns')!;
              for (let i = 0; i < expended; i++) {
                handlePlayedCard(targetPlayer, thornsCard, true);
              }
              player.thread = Math.max(0, player.thread - retaliationDmg);
              broadcastSystemMessage(room, `${targetPlayer.username}'s Thorns (x${thornsStacks}) retaliated, dealing ${retaliationDmg} damage to ${player.username}!`);
              // Check if player died from Thorns
              if (player.thread <= 0) {
                handlePlayerDefeated(room, playerId, targetPlayerId, `${player.username} was defeated by Thorns retaliation from ${targetPlayer.username}!`);
              }
            }

            if (targetPlayer.thread <= 0) {
              handlePlayerDefeated(room, targetPlayerId, playerId, `${targetPlayer.username} was defeated by ${player.username}!`);
            }
          } else if (targetWall) {
            const wallKey = `${targetWall.tileX},${targetWall.tileY}:${targetWall.r},${targetWall.c}:${targetWall.direction}`;
            if (!room.wallsState || !room.wallsState[wallKey]) {
              throw new Error('No raised stone wall exists at target.');
              return;
            }

            const from = room.tokenPositions[playerId];
            if (!from) {
              throw new Error('Positions not initialized.');
              return;
            }

            // Verify player is adjacent to the target wall border
            const cellA = { tileX: targetWall.tileX, tileY: targetWall.tileY, r: targetWall.r, c: targetWall.c };
            const cellB = targetWall.direction === 'H'
              ? { tileX: targetWall.tileX, tileY: targetWall.tileY, r: targetWall.r + 1, c: targetWall.c }
              : { tileX: targetWall.tileX, tileY: targetWall.tileY, r: targetWall.r, c: targetWall.c + 1 };

            const isPlayerAtCellA = from.tileX === cellA.tileX && from.tileY === cellA.tileY && from.r === cellA.r && from.c === cellA.c;
            const isPlayerAtCellB = from.tileX === cellB.tileX && from.tileY === cellB.tileY && from.r === cellB.r && from.c === cellB.c;

            if (!isPlayerAtCellA && !isPlayerAtCellB) {
              throw new Error('You must be adjacent to the target wall to lash it.');
              return;
            }

            if (!hasLineOfSightToWall(from, targetWall, room.placedTiles, room.doorsState, room.wallsState)) {
              throw new Error('Target wall is not in your Line of Sight (LOS).');
              return;
            }

            player.hasAttackedThisTurn = true;
            player.ap--;

            if (!room.wallHp) room.wallHp = {};
            const currentHp = room.wallHp[wallKey] !== undefined ? room.wallHp[wallKey] : 5;
            const newHp = currentHp - 1;
            room.wallHp[wallKey] = newHp;

            if (newHp <= 0) {
              delete room.wallsState[wallKey];
              if (room.wallHp) {
                delete room.wallHp[wallKey];
              }
              broadcastSystemMessage(room, `${player.username} destroyed the Raised Stone wall!`);
            } else {
              broadcastSystemMessage(room, `${player.username} damaged the Raised Stone wall (HP: ${newHp}/5)!`);
            }

            
          }

          recalculatePoints(room);

          if (player.ap === 0) {
            passTurn(room);
          }

          
          
}));

app.post('/api/match/:matchId/pickup-treasure', (req, res, next) => {
  // Optional auth parsing
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, user: any) => {
      if (!err) (req as any).user = user;
      next();
    });
  } else {
    next();
  }
}, withMatchTransaction('PICKUP_TREASURE', async (room, req, playerId) => {

          

          const activePlayerId = room.turnOrder[room.activePlayerIndex];
          if (playerId !== activePlayerId) {
            throw new Error('It is not your turn.');
            return;
          }

          const player = room.players[playerId];
          if (!player || player.ap < 1) {
            throw new Error('No Action Points (AP) remaining.');
            return;
          }

          const { treasureId } = req.body;
          const treasure = room.treasures && room.treasures[treasureId];
          if (!treasure) {
            throw new Error('Treasure not found.');
            return;
          }

          if (treasure.carrierId !== null) {
            throw new Error('Treasure is already being carried.');
            return;
          }

          const pos = room.tokenPositions[playerId];
          if (!pos || pos.tileX !== treasure.tileX || pos.tileY !== treasure.tileY || pos.r !== treasure.r || pos.c !== treasure.c) {
            throw new Error('You must be standing in the same cell to pick up the treasure.');
            return;
          }

          const alreadyCarrying = Object.values(room.treasures).some(t => t.carrierId === playerId);
          if (alreadyCarrying) {
            throw new Error('You can only carry one treasure at a time.');
            return;
          }

          // Check if player is trying to pick up their own mask from its default position
          if (treasure.ownerId === playerId) {
            const playerTile = Object.values(room.placedTiles).find(t => t.placedBy === playerId);
            if (playerTile) {
              const isOwnerTile = treasure.tileX === playerTile.position.x && treasure.tileY === playerTile.position.y;
              const isCorner = (treasure.r === 0 || treasure.r === 4) && (treasure.c === 0 || treasure.c === 4);
              if (isOwnerTile && isCorner) {
                throw new Error('You cannot pick up your own Mask while it is in its default starting position.');
                return;
              }
            }
          }

          treasure.carrierId = playerId;
          
          const treasureOwner = room.players[treasure.ownerId];
          const ownerLabel = treasureOwner ? `${treasureOwner.username}'s Mask` : `a Mask`;
          broadcastSystemMessage(room, `${player.username} picked up ${ownerLabel}.`);

          player.ap = 0;
          passTurn(room);

          recalculatePoints(room);
          
          
}));

app.post('/api/match/:matchId/drop-treasure', (req, res, next) => {
  // Optional auth parsing
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, user: any) => {
      if (!err) (req as any).user = user;
      next();
    });
  } else {
    next();
  }
}, withMatchTransaction('DROP_TREASURE', async (room, req, playerId) => {

          

          const activePlayerId = room.turnOrder[room.activePlayerIndex];
          if (playerId !== activePlayerId) {
            throw new Error('It is not your turn.');
            return;
          }

          const player = room.players[playerId];
          if (!player) return;

          const { treasureId } = req.body;
          const treasure = room.treasures && room.treasures[treasureId];
          if (!treasure) {
            throw new Error('Treasure not found.');
            return;
          }

          if (treasure.carrierId !== playerId) {
            throw new Error('You are not carrying this treasure.');
            return;
          }

          const pos = room.tokenPositions[playerId];
          if (!pos) return;

          treasure.carrierId = null;
          treasure.tileX = pos.tileX;
          treasure.tileY = pos.tileY;
          treasure.r = pos.r;
          treasure.c = pos.c;

          const treasureOwner = room.players[treasure.ownerId];
          const ownerLabel = treasureOwner ? `${treasureOwner.username}'s Mask` : `a Mask`;
          broadcastSystemMessage(room, `${player.username} dropped ${ownerLabel}.`);

          recalculatePoints(room);
          
          
}));

app.post('/api/match/:matchId/reset-game', (req, res, next) => {
  // Optional auth parsing
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, user: any) => {
      if (!err) (req as any).user = user;
      next();
    });
  } else {
    next();
  }
}, withMatchTransaction('RESET_GAME', async (room, req, playerId) => {

          

          const player = room.players[playerId];
          if (!player || !player.isHost) {
            throw new Error('Only the host can reset the game.');
            return;
          }

          room.phase = 'LOBBY';
          room.placedTiles = {};
          room.doorsState = {};
          room.wallsState = {};
          room.wallHp = {};
          room.tokenPositions = {};
          room.treasures = {};
          room.turnOrder = [];
          delete room.turnExpiresAt;
          delete room.gameEndedAt;
          delete room.gameLogs;
          
          for (const pId of Object.keys(room.players)) {
            const p = room.players[pId];
            p.isReady = false;
            p.assignedTileIndex = null;
            p.ap = 0;
            p.thread = 15;
            p.maxThread = 15;
            p.hand = [];
            p.points = 0;
            p.severPoints = 0;
            p.hasAttackedThisTurn = false;
            p.isFirstTurnOfMatch = true;
            p.form = 'normal';
            p.hasConceded = false;
            p.isDisconnected = false;
            p.concessionExpiresAt = undefined;
          }

          
          
}));

app.post('/api/match/:matchId/concede', (req, res, next) => {
  // Optional auth parsing
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, user: any) => {
      if (!err) (req as any).user = user;
      next();
    });
  } else {
    next();
  }
}, withMatchTransaction('CONCEDE', async (room, req, playerId) => {

          concedePlayer(room, playerId);
          
}));


const PORT = process.env.PORT || 3001;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

export { app };
