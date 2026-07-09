import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { GameState, Player, PlayerId, ClientMessage, ServerMessage, PlacedTile, Card } from '../../shared/types';
import { validateTilePlacement, validateTokenMove, validateDoorInteract, hasLineOfSight } from '../../shared/validation';
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
    room.players[nextPid].ap = 3;
    room.players[nextPid].hasAttackedThisTurn = false;
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
  const playerId = socket.id;

  socket.on('message', (messageStr: string) => {
    try {
      const message: ClientMessage = JSON.parse(messageStr);
      console.log(`Received message: ${message.event} from ${playerId}`);

      switch (message.event) {
        case 'JOIN_ROOM': {
          const { username, roomCode, color, emoji } = message.payload;
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
              treasures: {}
            };
            rooms.set(targetRoomCode, room);
          }

          const existingPlayers = Object.values(room.players);

          // Room is full constraint (max 2 players for prototype)
          if (existingPlayers.length >= 2 && !room.players[playerId]) {
            sendError(socket, 'Room is full.');
            return;
          }

          if (room.phase !== 'LOBBY') {
            sendError(socket, 'Game has already started.');
            return;
          }

          // Ensure username is unique in this room
          const requestedName = username.trim() || `Player_${playerId.substring(0, 4)}`;
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
          const player: Player = {
            id: playerId,
            username: username.trim() || `Player_${playerId.substring(0, 4)}`,
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
            form: 'normal'
          };

          room.players[playerId] = player;
          currentRoomCode = targetRoomCode;
          socket.join(targetRoomCode);

          console.log(`Player ${player.username} joined room ${targetRoomCode}`);
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
          if (playersList.length !== 2) {
            sendError(socket, 'Exactly 2 players are required to start the game.');
            return;
          }

          if (playersList.some(p => !p.isReady)) {
            sendError(socket, 'All players must be ready.');
            return;
          }

          // Transition to DRAFT & distribution
          room.phase = 'PLACEMENT';
          
          // Randomize turn order
          const playerIds = Object.keys(room.players);
          room.turnOrder = playerIds.sort(() => random() - 0.5);
          room.activePlayerIndex = 0;

          // Distribute 1 starting tile to each player
          // Shuffled indexes: 0, 1, 2, 3 correspond to FIXED_TILES
          const tileIndices = [0, 1, 2, 3].sort(() => random() - 0.5);
          for (let i = 0; i < room.turnOrder.length; i++) {
            const pId = room.turnOrder[i];
            room.players[pId].assignedTileIndex = tileIndices[i];
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

          const isWolf = player.form === 'wolf';
          if (!isWolf && player.ap < 1) {
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

          if (!isWolf) {
            player.ap--;
          }

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
          room.doorsState[doorKey] = currentState === 'OPEN' ? 'CLOSED' : 'OPEN';

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
            // Check distance <= 3 Manhattan
            const from = room.tokenPositions[playerId];
            if (!from) return;
            const globalR_from = from.tileY * 5 + from.r;
            const globalC_from = from.tileX * 5 + from.c;
            const globalR_to = target.tileY * 5 + target.r;
            const globalC_to = target.tileX * 5 + target.c;
            const dist = Math.abs(globalR_from - globalR_to) + Math.abs(globalC_from - globalC_to);
            if (dist > 3) {
              sendError(socket, 'Target is too far (max distance 3 cells).');
              return;
            }
            room.tokenPositions[playerId] = {
              tileX: target.tileX,
              tileY: target.tileY,
              r: target.r,
              c: target.c
            };

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

          } else if (card.id === 'talisman_bear_charm') {
            player.maxThread += 2;
            player.thread = Math.min(player.maxThread, player.thread + 2);

          } else if (card.id === 'working_don_wolf') {
            player.form = 'wolf';

          } else if (card.id === 'offering_deep_breath') {
            player.ap += 2;

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
        // Remove player
        delete room.players[playerId];
        const remainingPlayers = Object.values(room.players);

        if (remainingPlayers.length === 0) {
          // Clean up room
          rooms.delete(currentRoomCode);
          roomMetadata.delete(currentRoomCode);
          console.log(`Room ${currentRoomCode} deleted because it is empty.`);
        } else {
          // If the host disconnected, reassign host
          if (!remainingPlayers.some(p => p.isHost)) {
            remainingPlayers[0].isHost = true;
          }
          // Reset game back to lobby if someone leaves during active play
          if (room.phase !== 'LOBBY') {
            room.phase = 'LOBBY';
            room.placedTiles = {};
            room.tokenPositions = {};
            room.treasures = {};
            room.turnOrder = [];
            for (const p of remainingPlayers) {
              p.isReady = false;
              p.assignedTileIndex = null;
            }
          }
          broadcastState(currentRoomCode, room);
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
  const msg: ServerMessage = {
    event: 'ERROR',
    payload: { message }
  };
  io.to(roomCode).emit('message', JSON.stringify(msg));
};

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
