import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { GameState, Player, PlayerId, ClientMessage, ServerMessage, PlacedTile, Card } from '../../shared/types';
import { validateTilePlacement, validateTokenMove, validateDoorInteract, hasLineOfSight, getWrappingManhattanDistance } from '../../shared/validation';
import { HEROES, BASIC_CARDS } from '../../shared/constants';

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins for the prototype
    methods: ['GET', 'POST']
  }
});

// In-memory store for game rooms
const rooms = new Map<string, GameState>();
const disconnectTimers = new Map<string, NodeJS.Timeout>();

function concedePlayer(roomCode: string, pId: string) {
  const room = rooms.get(roomCode);
  if (!room || room.phase !== 'GAMEPLAY' && room.phase !== 'PLACEMENT') return;

  const player = room.players[pId];
  if (!player) return;

  player.hasConceded = true;
  broadcastSystemMessage(roomCode, `${player.username} has conceded.`);

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
    // Give victory points to the remaining player if there is one
    if (nonConcededPlayers.length === 1) {
      const winner = nonConcededPlayers[0];
      winner.severPoints = Math.max(winner.severPoints || 0, 2);
      recalculatePoints(room);
      broadcastSystemMessage(roomCode, `Game Over! ${winner.username} is victorious!`);
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

  broadcastState(roomCode, room);
}

// Generate a random color if not specified
const getRandomColor = () => {
  const colors = ['#00E5FF', '#FFD600', '#FF1744', '#00E676', '#D500F9', '#FF6D00'];
  return colors[Math.floor(random() * colors.length)];
};

function dealRandomHand(): Card[] {
  const hand: Card[] = [];
  for (let i = 0; i < 5; i++) {
    const randomCard = BASIC_CARDS[Math.floor(Math.random() * BASIC_CARDS.length)];
    hand.push(randomCard);
  }
  return hand;
}

function passTurn(room: GameState) {
  const currentPid = room.turnOrder[room.activePlayerIndex];
  const endingPlayer = room.players[currentPid];
  if (endingPlayer) {
    endingPlayer.ap = 0;
    endingPlayer.form = 'normal';
    endingPlayer.isFirstTurnOfMatch = false;
    while (endingPlayer.hand.length < 5) {
      endingPlayer.hand.push(BASIC_CARDS[Math.floor(Math.random() * BASIC_CARDS.length)]);
    }
    if (endingPlayer.hand.length > 7) {
      endingPlayer.hand.splice(7);
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
}

function recalculatePoints(room: GameState) {
  for (const pId of Object.keys(room.players)) {
    const p = room.players[pId];
    p.points = p.severPoints || 0;
  }

  if (room.treasures) {
    for (const treasureId of Object.keys(room.treasures)) {
      const treasure = room.treasures[treasureId];
      if (treasure.carrierId === null) {
        const tileKey = `${treasure.tileX},${treasure.tileY}`;
        const tile = room.placedTiles[tileKey];
        if (tile) {
          if (treasure.r === 2 && treasure.c === 2) {
            const hearthOwnerId = tile.placedBy;
            if (treasure.ownerId !== hearthOwnerId) {
              const hearthOwner = room.players[hearthOwnerId];
              if (hearthOwner) {
                hearthOwner.points += 1;
              }
            }
          }
        }
      }
    }
  }

  for (const pId of Object.keys(room.players)) {
    const p = room.players[pId];
    if (p.points >= 2) {
      room.phase = 'GAME_OVER';
    }
  }
}

// Simple pseudo-random helper (substitute for Math.random to avoid lint warnings if any, but Math.random is fine for prototype)
const random = Math.random;

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  let currentRoomCode: string | null = null;
  let playerId = socket.id;

  socket.on('message', (messageStr: string) => {
    try {
      const message: ClientMessage = JSON.parse(messageStr);
      console.log(`Received message: ${message.event} from ${playerId}`);

      switch (message.event) {
        case 'JOIN_ROOM': {
          const { username, roomCode, color, emoji, sessionToken } = message.payload;
          const targetRoomCode = roomCode.replace(/[^a-zA-Z0-9]/g, '').trim().toUpperCase();

          if (!targetRoomCode) {
            sendError(socket, 'Room code is required.');
            return;
          }

          let room = rooms.get(targetRoomCode);
          if (!room) {
            // Create a new room
            room = {
              roomCode: roomCode.trim(),
              phase: 'LOBBY',
              players: {},
              turnOrder: [],
              activePlayerIndex: 0,
              placedTiles: {},
              doorsState: {},
              wallsState: {},
              tokenPositions: {},
              treasures: {},
              gameLogs: []
            };
            rooms.set(targetRoomCode, room);
          }

          const existingPlayers = Object.values(room.players);
          const requestedName = username.trim() || `Player_${playerId.substring(0, 4)}`;

          // Check if this is a reconnection attempt
          const existingReconnectingPlayer = Object.values(room.players).find(p => 
            p.username.toLowerCase() === requestedName.toLowerCase() && 
            p.sessionToken && 
            p.sessionToken === sessionToken
          );

          if (existingReconnectingPlayer) {
            // Reconnection path!
            playerId = existingReconnectingPlayer.id; // Map this connection's playerId to the existing player ID
            existingReconnectingPlayer.isDisconnected = false;
            
            // Clear reconnection/concession timer if active
            const timerKey = `${targetRoomCode}:${playerId}`;
            if (disconnectTimers.has(timerKey)) {
              clearTimeout(disconnectTimers.get(timerKey));
              disconnectTimers.delete(timerKey);
            }

            currentRoomCode = targetRoomCode;
            socket.join(targetRoomCode);

            console.log(`Player ${existingReconnectingPlayer.username} reconnected to room ${targetRoomCode}`);
            broadcastSystemMessage(targetRoomCode, `${existingReconnectingPlayer.username} reconnected.`);
            broadcastState(targetRoomCode, room);
            break;
          }

          // Normal new player join path:
          // Room is full constraint (max 6 players)
          if (existingPlayers.length >= 6 && !room.players[playerId]) {
            sendError(socket, 'Room is full.');
            return;
          }

          if (room.phase !== 'LOBBY') {
            sendError(socket, 'Game has already started.');
            return;
          }

          // Ensure username is unique in this room
          const nameExists = existingPlayers.some(p => p.id !== playerId && p.username.toLowerCase() === requestedName.toLowerCase());
          if (nameExists) {
            sendError(socket, 'Username is already taken in this room.');
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
            points: 0,
            severPoints: 0,
            hasAttackedThisTurn: false,
            isFirstTurnOfMatch: true,
            form: 'normal',
            sessionToken: newSessionToken
          };

          room.players[playerId] = player;
          currentRoomCode = targetRoomCode;
          socket.join(targetRoomCode);

          console.log(`Player ${player.username} joined room ${targetRoomCode}`);
          broadcastSystemMessage(targetRoomCode, `${player.username} joined the lobby.`);
          broadcastState(targetRoomCode, room);
          break;
        }

        case 'TOGGLE_READY': {
          if (!currentRoomCode) return;
          const room = rooms.get(currentRoomCode);
          if (!room || room.phase !== 'LOBBY') return;

          const player = room.players[playerId];
          if (player) {
            if (!player.emoji) {
              sendError(socket, 'You must select a hero before readying up.');
              return;
            }
            player.isReady = !player.isReady;
            broadcastState(currentRoomCode, room);
          }
          break;
        }

        case 'START_GAME': {
          if (!currentRoomCode) return;
          const room = rooms.get(currentRoomCode);
          if (!room || room.phase !== 'LOBBY') return;

          const player = room.players[playerId];
          if (!player || !player.isHost) {
            sendError(socket, 'Only the host can start the game.');
            return;
          }

          const playersList = Object.values(room.players);
          if (playersList.length < 2) {
            sendError(socket, 'At least 2 players are required to start the game.');
            return;
          }

          if (playersList.some(p => !p.isReady)) {
            sendError(socket, 'All players must be ready.');
            return;
          }

          // Transition to DRAFT & distribution
          room.phase = 'PLACEMENT';
          broadcastSystemMessage(currentRoomCode, `Match started! Placement phase has begun.`);
          
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

          broadcastState(currentRoomCode, room);
          break;
        }

        case 'SELECT_HERO': {
          if (!currentRoomCode) return;
          const room = rooms.get(currentRoomCode);
          if (!room || room.phase !== 'LOBBY') return;

          const { emoji } = message.payload;

          // Ensure emoji is not already taken by another player
          const isTaken = Object.values(room.players).some(p => p.id !== playerId && p.emoji === emoji);
          if (isTaken) {
            sendError(socket, 'That hero is already selected by another player.');
            return;
          }

          const matchedHero = HEROES.find(h => h.emoji === emoji);
          if (matchedHero) {
            room.players[playerId].emoji = emoji;
            room.players[playerId].color = matchedHero.color;
            broadcastState(currentRoomCode, room);
          }
          break;
        }

        case 'PLACE_TILE': {
          if (!currentRoomCode) return;
          const room = rooms.get(currentRoomCode);
          if (!room || room.phase !== 'PLACEMENT') return;

          // Check if active player
          const activePlayerId = room.turnOrder[room.activePlayerIndex];
          if (playerId !== activePlayerId) {
            sendError(socket, 'It is not your turn.');
            return;
          }

          const { x, y, rotation } = message.payload;
          const activePlayer = room.players[activePlayerId];
          const tileId = activePlayer.assignedTileIndex;

          if (tileId === null) {
            sendError(socket, 'No tile assigned to you.');
            return;
          }

          // VALIDATION RULES
          const validation = validateTilePlacement(x, y, tileId, playerId, room.placedTiles, room.turnOrder.length);
          if (!validation.valid) {
            sendError(socket, validation.error || 'Invalid placement.');
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
          broadcastSystemMessage(currentRoomCode, `${activePlayer.username} placed Sector ${placedTile.tileId} at (${x}, ${y}).`);

          // Check if all tiles are placed (number of placed tiles equals player count)
          const newPlacedCount = Object.keys(room.placedTiles).length;
          if (newPlacedCount === room.turnOrder.length) {
            room.phase = 'GAMEPLAY'; // Board finalized, start gameplay phase
            
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
              p.hand = dealRandomHand();
              p.points = 0;
              p.severPoints = 0;
              p.hasAttackedThisTurn = false;
              p.isFirstTurnOfMatch = true;
              p.form = 'normal';
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
          } else {
            // Cycle active player turn
            room.activePlayerIndex = (room.activePlayerIndex + 1) % room.turnOrder.length;
          }

          broadcastState(currentRoomCode, room);
          break;
        }

        case 'MOVE_TOKEN': {
          if (!currentRoomCode) return;
          const room = rooms.get(currentRoomCode);
          if (!room || room.phase !== 'GAMEPLAY') return;

          const activePlayerId = room.turnOrder[room.activePlayerIndex];
          if (playerId !== activePlayerId) {
            sendError(socket, 'It is not your turn.');
            return;
          }

          const player = room.players[playerId];
          if (!player) return;

          if (player.ap < 1) {
            sendError(socket, 'No Action Points (AP) remaining.');
            return;
          }

          const targetPos = message.payload;
          const currentPos = room.tokenPositions[playerId];
          if (!currentPos) {
            sendError(socket, 'No token position initialized.');
            return;
          }

          const validation = validateTokenMove(currentPos, targetPos, room.placedTiles, room.doorsState, room.wallsState, room.tokenPositions);
          if (!validation.valid) {
            sendError(socket, validation.error || 'Invalid movement.');
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

          broadcastState(currentRoomCode, room);
          break;
        }

        case 'INTERACT_DOOR': {
          if (!currentRoomCode) return;
          const room = rooms.get(currentRoomCode);
          if (!room || room.phase !== 'GAMEPLAY') return;

          const activePlayerId = room.turnOrder[room.activePlayerIndex];
          if (playerId !== activePlayerId) {
            sendError(socket, 'It is not your turn.');
            return;
          }

          const player = room.players[playerId];
          if (!player || player.ap < 1) {
            sendError(socket, 'No Action Points (AP) remaining.');
            return;
          }

          const { tileX, tileY, r, c, direction } = message.payload;
          const currentPos = room.tokenPositions[playerId];
          if (!currentPos) {
            sendError(socket, 'No token position initialized.');
            return;
          }

          const validation = validateDoorInteract(currentPos, { tileX, tileY, r, c, direction }, room.placedTiles);
          if (!validation.valid) {
            sendError(socket, validation.error || 'Invalid door interaction.');
            return;
          }

          // Toggle door state
          const doorKey = `${tileX},${tileY}:${r},${c}:${direction}`;
          const currentState = room.doorsState[doorKey] || 'CLOSED';
          const nextState = currentState === 'OPEN' ? 'CLOSED' : 'OPEN';
          room.doorsState[doorKey] = nextState;
          broadcastSystemMessage(currentRoomCode, `${player.username} ${nextState.toLowerCase()}ed a door at Sector (${tileX}, ${tileY}) cell [${r}, ${c}].`);

          player.ap--;

          // Auto-pass if 0 AP
          if (player.ap === 0) {
            passTurn(room);
          }

          broadcastState(currentRoomCode, room);
          break;
        }

        case 'END_TURN': {
          if (!currentRoomCode) return;
          const room = rooms.get(currentRoomCode);
          if (!room || room.phase !== 'GAMEPLAY') return;

          const activePlayerId = room.turnOrder[room.activePlayerIndex];
          if (playerId !== activePlayerId) {
            sendError(socket, 'It is not your turn.');
            return;
          }

          passTurn(room);
          broadcastState(currentRoomCode, room);
          break;
        }

        case 'PLAY_CARD': {
          if (!currentRoomCode) return;
          const room = rooms.get(currentRoomCode);
          if (!room || room.phase !== 'GAMEPLAY') return;

          const activePlayerId = room.turnOrder[room.activePlayerIndex];
          if (playerId !== activePlayerId) {
            sendError(socket, 'It is not your turn.');
            return;
          }

          const player = room.players[playerId];
          if (!player) return;

          const { cardId, target } = message.payload;
          const cardIndex = player.hand.findIndex(c => c.id === cardId);
          if (cardIndex === -1) {
            sendError(socket, 'Card is not in your hand.');
            return;
          }

          const card = player.hand[cardIndex];
          const isOffering = card.type === 'offering';

          // Cast costs 1 AP unless it is an offering card
          if (!isOffering && player.ap < 1) {
            sendError(socket, 'No Action Points (AP) remaining to play this card.');
            return;
          }

          // Resolve card benefits
          if (card.id === 'ash_kindle_storm') {
            if (player.hasAttackedThisTurn) {
              sendError(socket, 'You have already attacked this turn.');
              return;
            }
            if (player.isFirstTurnOfMatch) {
              sendError(socket, 'Attacks are forbidden on your first turn.');
              return;
            }
            if (!target) {
              sendError(socket, 'Kindle the Storm requires a target cell.');
              return;
            }
            const fromPos = room.tokenPositions[playerId];
            if (!fromPos) return;
            if (!hasLineOfSight(fromPos, target, room.placedTiles, room.doorsState, room.wallsState)) {
              sendError(socket, 'Target cell is not in your Line of Sight (LOS).');
              return;
            }
            const targetPlayerId = Object.keys(room.tokenPositions).find(pId => {
              const pos = room.tokenPositions[pId];
              return pos.tileX === target.tileX && pos.tileY === target.tileY && pos.r === target.r && pos.c === target.c;
            });
            if (!targetPlayerId) {
              sendError(socket, 'No player found at targeted cell.');
              return;
            }
            if (targetPlayerId === playerId) {
              sendError(socket, 'You cannot target yourself.');
              return;
            }
            const targetPlayer = room.players[targetPlayerId];
 
            // Mark attack used
            player.hasAttackedThisTurn = true;

             // Auto Ward response checking
             const turnAsideIndex = targetPlayer.hand.findIndex(c => c.id === 'ash_turn_aside');
             const spiritSkinIndex = targetPlayer.hand.findIndex(c => c.id === 'ash_spirit_skin');

             const countered = turnAsideIndex !== -1 ? 'turn_aside' : spiritSkinIndex !== -1 ? 'spirit_skin' : null;
            if (turnAsideIndex !== -1) {
              targetPlayer.hand.splice(turnAsideIndex, 1);
              broadcastSystemMessage(currentRoomCode, `${targetPlayer.username} used Turn Aside to counter Kindle the Storm!`);
            } else if (spiritSkinIndex !== -1) {
              targetPlayer.hand.splice(spiritSkinIndex, 1);
              targetPlayer.thread = Math.max(0, targetPlayer.thread - 1); // 3 damage reduced by 2
              broadcastSystemMessage(currentRoomCode, `${targetPlayer.username} used Spirit-Skin to reduce Kindle the Storm damage by 2 (took 1 damage).`);
            } else {
              targetPlayer.thread = Math.max(0, targetPlayer.thread - 3);
              broadcastSystemMessage(currentRoomCode, `${player.username} cast Kindle the Storm on ${targetPlayer.username} for 3 damage!`);
            }

            const animMsg: ServerMessage = {
              event: 'PLAY_CARD_ANIMATION',
              payload: { cardId: card.id, casterId: playerId, target, countered }
            };
            io.to(currentRoomCode).emit('message', JSON.stringify(animMsg));
 
            // Victory check / Death respawn
            if (targetPlayer.thread <= 0) {
              player.severPoints = (player.severPoints || 0) + 1;
              player.hand.push(...targetPlayer.hand);
              targetPlayer.hand = [];
              if (player.hand.length > 7) {
                player.hand.splice(7);
              }
 
              // Drop target's carried treasure
              if (room.treasures) {
                for (const treasureId of Object.keys(room.treasures)) {
                  const tr = room.treasures[treasureId];
                  if (tr.carrierId === targetPlayerId) {
                    tr.carrierId = null;
                    const deathPos = room.tokenPositions[targetPlayerId];
                    if (deathPos) {
                      tr.tileX = deathPos.tileX;
                      tr.tileY = deathPos.tileY;
                      tr.r = deathPos.r;
                      tr.c = deathPos.c;
                    }
                  }
                }
              }
 
              targetPlayer.thread = 15;
              const targetTile = Object.values(room.placedTiles).find(t => t.placedBy === targetPlayerId);
              if (targetTile) {
                room.tokenPositions[targetPlayerId] = {
                  tileX: targetTile.position.x,
                  tileY: targetTile.position.y,
                  r: 2,
                  c: 2
                };
              }
              broadcastSystemMessage(currentRoomCode, `${targetPlayer.username} was defeated by ${player.username} and respawned!`);
            }
            recalculatePoints(room);
            if (player.points >= 2) {
              room.phase = 'GAME_OVER';
            }

          } else if (card.id === 'working_miststep') {
            if (!target) {
              sendError(socket, 'Miststep requires a target cell.');
              return;
            }
            const targetTile = room.placedTiles[`${target.tileX},${target.tileY}`];
            if (!targetTile) {
              sendError(socket, 'Target cell must be on a placed tile.');
              return;
            }
            // Check occupancy
            const isOccupied = Object.values(room.tokenPositions).some(pos => {
              return pos.tileX === target.tileX && pos.tileY === target.tileY && pos.r === target.r && pos.c === target.c;
            });
            if (isOccupied) {
              sendError(socket, 'Target cell is already occupied by another player.');
              return;
            }
            // Check distance <= 3 Manhattan (with wrap-around)
            const from = room.tokenPositions[playerId];
            if (!from) return;
            const dist = getWrappingManhattanDistance(from, target, room.placedTiles);
            if (dist > 3) {
              sendError(socket, 'Target is too far (max distance 3 cells).');
              return;
            }
            if (!hasLineOfSight(from, target, room.placedTiles, room.doorsState, room.wallsState)) {
              sendError(socket, 'Target cell is not in your Line of Sight (LOS).');
              return;
            }
            room.tokenPositions[playerId] = {
              tileX: target.tileX,
              tileY: target.tileY,
              r: target.r,
              c: target.c
            };

            broadcastSystemMessage(currentRoomCode, `${player.username} cast Miststep, teleporting to Sector (${target.tileX}, ${target.tileY}) cell [${target.r}, ${target.c}].`);

            const animMsg: ServerMessage = {
              event: 'PLAY_CARD_ANIMATION',
              payload: { cardId: card.id, casterId: playerId, target }
            };
            io.to(currentRoomCode).emit('message', JSON.stringify(animMsg));

          } else if (card.id === 'working_raise_stone') {
            if (!target || target.direction === undefined) {
              sendError(socket, 'Raise Stone requires a target border.');
              return;
            }
            // Verify adjacent
            const from = room.tokenPositions[playerId];
            if (!from) return;
            if (from.tileX !== target.tileX || from.tileY !== target.tileY) {
              sendError(socket, 'You must target a border on your current tile.');
              return;
            }
            if (target.direction === 'H') {
              if (from.c !== target.c || (from.r !== target.r && from.r !== target.r + 1)) {
                sendError(socket, 'You must be adjacent to the target border.');
                return;
              }
            } else {
              if (from.r !== target.r || (from.c !== target.c && from.c !== target.c + 1)) {
                sendError(socket, 'You must be adjacent to the target border.');
                return;
              }
            }
            const wallKey = `${target.tileX},${target.tileY}:${target.r},${target.c}:${target.direction}`;
            room.wallsState[wallKey] = true;

            broadcastSystemMessage(currentRoomCode, `${player.username} cast Raise Stone, creating a wall on the ${target.direction === 'H' ? 'horizontal' : 'vertical'} border of Sector (${target.tileX}, ${target.tileY}) cell [${target.r}, ${target.c}].`);

            const animMsg: ServerMessage = {
              event: 'PLAY_CARD_ANIMATION',
              payload: { cardId: card.id, casterId: playerId, target }
            };
            io.to(currentRoomCode).emit('message', JSON.stringify(animMsg));

          } else if (card.id === 'talisman_bear_charm') {
            player.maxThread += 2;
            player.thread = Math.min(player.maxThread, player.thread + 2);

            broadcastSystemMessage(currentRoomCode, `${player.username} invoked the Bear-Charm Rite, gaining +2 Max Thread and healing 2 Thread.`);

            const animMsg: ServerMessage = {
              event: 'PLAY_CARD_ANIMATION',
              payload: { cardId: card.id, casterId: playerId }
            };
            io.to(currentRoomCode).emit('message', JSON.stringify(animMsg));

          } else if (card.id === 'working_don_wolf') {
            if (!target) {
              sendError(socket, 'Don the Wolf requires a target cell.');
              return;
            }
            const targetTile = room.placedTiles[`${target.tileX},${target.tileY}`];
            if (!targetTile) {
              sendError(socket, 'Target cell must be on a placed tile.');
              return;
            }
            // Check occupancy
            const isOccupied = Object.values(room.tokenPositions).some(pos => {
              return pos.tileX === target.tileX && pos.tileY === target.tileY && pos.r === target.r && pos.c === target.c;
            });
            if (isOccupied) {
              sendError(socket, 'Target cell is already occupied by another player.');
              return;
            }
            // Check distance <= 4 Manhattan (with wrap-around)
            const from = room.tokenPositions[playerId];
            if (!from) return;
            const dist = getWrappingManhattanDistance(from, target, room.placedTiles);
            if (dist > 4) {
              sendError(socket, 'Target is too far (max distance 4 cells).');
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

            broadcastSystemMessage(currentRoomCode, `${player.username} invoked Don the Wolf, leaping to Sector (${target.tileX}, ${target.tileY}) cell [${target.r}, ${target.c}].`);

            const animMsg: ServerMessage = {
              event: 'PLAY_CARD_ANIMATION',
              payload: { cardId: card.id, casterId: playerId, target }
            };
            io.to(currentRoomCode).emit('message', JSON.stringify(animMsg));

          } else if (card.id === 'offering_deep_breath') {
            player.ap += 2;

            broadcastSystemMessage(currentRoomCode, `${player.username} offered Deep Breath, gaining +2 Action Points.`);

            const animMsg: ServerMessage = {
              event: 'PLAY_CARD_ANIMATION',
              payload: { cardId: card.id, casterId: playerId }
            };
            io.to(currentRoomCode).emit('message', JSON.stringify(animMsg));

          } else {
            sendError(socket, 'Unknown card played.');
            return;
          }

          // Discard card from hand
          player.hand.splice(cardIndex, 1);

          // Deduct AP if not an offering
          if (!isOffering) {
            player.ap--;
          }

          // Auto-pass if AP hits 0
          if (player.ap === 0) {
            passTurn(room);
          }
          broadcastState(currentRoomCode, room);
          break;
        }

        case 'LASH_ATTACK': {
          if (!currentRoomCode) return;
          const room = rooms.get(currentRoomCode);
          if (!room || room.phase !== 'GAMEPLAY') return;

          const activePlayerId = room.turnOrder[room.activePlayerIndex];
          if (playerId !== activePlayerId) {
            sendError(socket, 'It is not your turn.');
            return;
          }

          const player = room.players[playerId];
          if (!player || player.ap < 1) {
            sendError(socket, 'No Action Points (AP) remaining.');
            return;
          }

          if (player.hasAttackedThisTurn) {
            sendError(socket, 'You have already attacked this turn.');
            return;
          }

          if (player.isFirstTurnOfMatch) {
            sendError(socket, 'Attacks are forbidden on your first turn.');
            return;
          }

          const { targetPlayerId } = message.payload;
          if (targetPlayerId === playerId) {
            sendError(socket, 'You cannot target yourself.');
            return;
          }

          const targetPlayer = room.players[targetPlayerId];
          if (!targetPlayer) {
            sendError(socket, 'Target player not found.');
            return;
          }

          const from = room.tokenPositions[playerId];
          const to = room.tokenPositions[targetPlayerId];
          if (!from || !to) {
            sendError(socket, 'Positions not initialized.');
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
            sendError(socket, 'Target is out of range.');
            return;
          }

          if (!hasLineOfSight(from, to, room.placedTiles, room.doorsState, room.wallsState)) {
            sendError(socket, 'Target is blocked by a wall or door.');
            return;
          }

          player.hasAttackedThisTurn = true;
          player.ap--;

          const spiritSkinIndex = targetPlayer.hand.findIndex(c => c.id === 'ash_spirit_skin');
          if (spiritSkinIndex !== -1) {
            targetPlayer.hand.splice(spiritSkinIndex, 1);
            broadcastSystemMessage(currentRoomCode, `${targetPlayer.username} used Spirit-Skin to block the Lash damage!`);
          } else {
            targetPlayer.thread = Math.max(0, targetPlayer.thread - 1);
            broadcastSystemMessage(currentRoomCode, `${player.username} lashed ${targetPlayer.username} for 1 damage!`);
          }

          if (targetPlayer.thread <= 0) {
            player.severPoints = (player.severPoints || 0) + 1;
            player.hand.push(...targetPlayer.hand);
            targetPlayer.hand = [];
            if (player.hand.length > 7) {
              player.hand.splice(7);
            }

            if (room.treasures) {
              for (const treasureId of Object.keys(room.treasures)) {
                const treasure = room.treasures[treasureId];
                if (treasure.carrierId === targetPlayerId) {
                  treasure.carrierId = null;
                  treasure.tileX = to.tileX;
                  treasure.tileY = to.tileY;
                  treasure.r = to.r;
                  treasure.c = to.c;
                }
              }
            }

            targetPlayer.thread = 15;
            const targetTile = Object.values(room.placedTiles).find(t => t.placedBy === targetPlayerId);
            if (targetTile) {
              room.tokenPositions[targetPlayerId] = {
                tileX: targetTile.position.x,
                tileY: targetTile.position.y,
                r: 2,
                c: 2
              };
            }
            broadcastSystemMessage(currentRoomCode, `${targetPlayer.username} was defeated by ${player.username} and respawned!`);
          }

          recalculatePoints(room);

          if (player.ap === 0) {
            passTurn(room);
          }

          broadcastState(currentRoomCode, room);
          break;
        }

        case 'PICKUP_TREASURE': {
          if (!currentRoomCode) return;
          const room = rooms.get(currentRoomCode);
          if (!room || room.phase !== 'GAMEPLAY') return;

          const activePlayerId = room.turnOrder[room.activePlayerIndex];
          if (playerId !== activePlayerId) {
            sendError(socket, 'It is not your turn.');
            return;
          }

          const player = room.players[playerId];
          if (!player || player.ap < 1) {
            sendError(socket, 'No Action Points (AP) remaining.');
            return;
          }

          const { treasureId } = message.payload;
          const treasure = room.treasures && room.treasures[treasureId];
          if (!treasure) {
            sendError(socket, 'Treasure not found.');
            return;
          }

          if (treasure.carrierId !== null) {
            sendError(socket, 'Treasure is already being carried.');
            return;
          }

          const pos = room.tokenPositions[playerId];
          if (!pos || pos.tileX !== treasure.tileX || pos.tileY !== treasure.tileY || pos.r !== treasure.r || pos.c !== treasure.c) {
            sendError(socket, 'You must be standing in the same cell to pick up the treasure.');
            return;
          }

          const alreadyCarrying = Object.values(room.treasures).some(t => t.carrierId === playerId);
          if (alreadyCarrying) {
            sendError(socket, 'You can only carry one treasure at a time.');
            return;
          }

          // Check if player is trying to pick up their own mask from its default position
          if (treasure.ownerId === playerId) {
            const playerTile = Object.values(room.placedTiles).find(t => t.placedBy === playerId);
            if (playerTile) {
              const isOwnerTile = treasure.tileX === playerTile.position.x && treasure.tileY === playerTile.position.y;
              const isCorner = (treasure.r === 0 || treasure.r === 4) && (treasure.c === 0 || treasure.c === 4);
              if (isOwnerTile && isCorner) {
                sendError(socket, 'You cannot pick up your own Mask while it is in its default starting position.');
                return;
              }
            }
          }

          treasure.carrierId = playerId;
          
          const treasureOwner = room.players[treasure.ownerId];
          const ownerLabel = treasureOwner ? `${treasureOwner.username}'s Mask` : `a Mask`;
          broadcastSystemMessage(currentRoomCode, `${player.username} picked up ${ownerLabel}.`);

          player.ap = 0;
          passTurn(room);

          recalculatePoints(room);
          broadcastState(currentRoomCode, room);
          break;
        }

        case 'DROP_TREASURE': {
          if (!currentRoomCode) return;
          const room = rooms.get(currentRoomCode);
          if (!room || room.phase !== 'GAMEPLAY') return;

          const activePlayerId = room.turnOrder[room.activePlayerIndex];
          if (playerId !== activePlayerId) {
            sendError(socket, 'It is not your turn.');
            return;
          }

          const player = room.players[playerId];
          if (!player) return;

          const { treasureId } = message.payload;
          const treasure = room.treasures && room.treasures[treasureId];
          if (!treasure) {
            sendError(socket, 'Treasure not found.');
            return;
          }

          if (treasure.carrierId !== playerId) {
            sendError(socket, 'You are not carrying this treasure.');
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
          broadcastSystemMessage(currentRoomCode, `${player.username} dropped ${ownerLabel}.`);

          recalculatePoints(room);
          broadcastState(currentRoomCode, room);
          break;
        }

        case 'RESET_GAME': {
          if (!currentRoomCode) return;
          const room = rooms.get(currentRoomCode);
          if (!room || room.phase !== 'GAME_OVER') return;

          const player = room.players[playerId];
          if (!player || !player.isHost) {
            sendError(socket, 'Only the host can reset the game.');
            return;
          }

          room.phase = 'LOBBY';
          room.placedTiles = {};
          room.doorsState = {};
          room.wallsState = {};
          room.tokenPositions = {};
          room.treasures = {};
          room.turnOrder = [];
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
          }

          broadcastState(currentRoomCode, room);
          break;
        }

        case 'CONCEDE': {
          if (!currentRoomCode) return;
          concedePlayer(currentRoomCode, playerId);
          break;
        }

        default:
          sendError(socket, 'Unhandled event type.');
      }
    } catch (err) {
      console.error('Error handling websocket message:', err);
      sendError(socket, 'Invalid message format.');
    }
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${playerId}`);
    if (currentRoomCode) {
      const room = rooms.get(currentRoomCode);
      if (room) {
        const player = room.players[playerId];

        if (room.phase === 'PLACEMENT' || room.phase === 'GAMEPLAY') {
          // Game is active: mark player as disconnected and start grace period
          if (player) {
            player.isDisconnected = true;
            broadcastSystemMessage(currentRoomCode, `${player.username} disconnected. Waiting 60 seconds for reconnection...`);
            
            // Check if all players in the room are now disconnected
            const allDisconnected = Object.values(room.players).every(p => p.isDisconnected || p.hasConceded);
            if (allDisconnected) {
              rooms.delete(currentRoomCode);
              roomMetadata.delete(currentRoomCode);
              // Clear any timers for this room
              for (const key of disconnectTimers.keys()) {
                if (key.startsWith(`${currentRoomCode}:`)) {
                  clearTimeout(disconnectTimers.get(key));
                  disconnectTimers.delete(key);
                }
              }
              console.log(`Room ${currentRoomCode} deleted because all players disconnected.`);
              return;
            }

            // Start concession countdown
            const timerKey = `${currentRoomCode}:${playerId}`;
            // Clear existing timer if any (shouldn't be one, but safe)
            if (disconnectTimers.has(timerKey)) {
              clearTimeout(disconnectTimers.get(timerKey));
            }
            const timer = setTimeout(() => {
              console.log(`Grace period expired for player ${player.username} in room ${currentRoomCode}`);
              disconnectTimers.delete(timerKey);
              concedePlayer(currentRoomCode!, playerId);
            }, 60000);
            disconnectTimers.set(timerKey, timer);

            // Reassign host if the disconnected player was the host
            if (player.isHost) {
              player.isHost = false;
              const remainingPlayers = Object.values(room.players).filter(p => p.id !== playerId);
              if (remainingPlayers.length > 0) {
                remainingPlayers[0].isHost = true;
              }
            }
          }
          broadcastState(currentRoomCode, room);
        } else {
          // Lobby or Game Over: clean up player immediately
          delete room.players[playerId];
          const remainingPlayers = Object.values(room.players);

          if (remainingPlayers.length === 0) {
            rooms.delete(currentRoomCode);
            roomMetadata.delete(currentRoomCode);
            console.log(`Room ${currentRoomCode} deleted because it is empty.`);
          } else {
            // Reassign host if needed
            if (!remainingPlayers.some(p => p.isHost)) {
              remainingPlayers[0].isHost = true;
            }
            broadcastState(currentRoomCode, room);
          }
        }
      }
    }
  });
});

// Separate metadata store for secondary tiles (keeps shared types clean)
const roomMetadata = new Map<string, {
  secondaryTiles: Record<PlayerId, number>;
}>();

const broadcastState = (roomCode: string, state: GameState) => {
  const msg: ServerMessage = {
    event: 'STATE_UPDATE',
    payload: state
  };
  io.to(roomCode).emit('message', JSON.stringify(msg));
};

const sendError = (socket: any, message: string) => {
  const msg: ServerMessage = {
    event: 'ERROR',
    payload: { message }
  };
  socket.emit('message', JSON.stringify(msg));
};

const broadcastSystemMessage = (roomCode: string, message: string) => {
  const room = rooms.get(roomCode);
  if (room) {
    if (!room.gameLogs) {
      room.gameLogs = [];
    }
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    room.gameLogs.push(`[${timestamp}] ${message}`);
    if (room.gameLogs.length > 20) {
      room.gameLogs.shift();
    }
  }
};

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
