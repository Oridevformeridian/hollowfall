import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { GameState, Player, PlayerId, ClientMessage, ServerMessage, PlacedTile } from '../../shared/types';
import { validateTilePlacement, validateTokenMove, validateDoorInteract } from '../../shared/validation';
import { HEROES } from '../../shared/constants';

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

function passTurn(room: GameState) {
  const currentPid = room.turnOrder[room.activePlayerIndex];
  if (room.players[currentPid]) {
    room.players[currentPid].ap = 0;
  }
  room.activePlayerIndex = (room.activePlayerIndex + 1) % room.turnOrder.length;
  const nextPid = room.turnOrder[room.activePlayerIndex];
  if (room.players[nextPid]) {
    room.players[nextPid].ap = 3;
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
          const targetRoomCode = roomCode.toUpperCase().trim();

          if (!targetRoomCode) {
            sendError(socket, 'Room code is required.');
            return;
          }

          let room = rooms.get(targetRoomCode);
          if (!room) {
            // Create a new room
            room = {
              roomCode: targetRoomCode,
              phase: 'LOBBY',
              players: {},
              turnOrder: [],
              activePlayerIndex: 0,
              placedTiles: {},
              doorsState: {},
              tokenPositions: {}
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
            ap: 0
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
            for (const pId of room.turnOrder) {
              room.players[pId].ap = 0;
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
          if (!player || player.ap < 1) {
            sendError(socket, 'No Action Points (AP) remaining.');
            return;
          }

          const targetPos = message.payload;
          const currentPos = room.tokenPositions[playerId];
          if (!currentPos) {
            sendError(socket, 'No token position initialized.');
            return;
          }

          const validation = validateTokenMove(currentPos, targetPos, room.placedTiles, room.doorsState);
          if (!validation.valid) {
            sendError(socket, validation.error || 'Invalid movement.');
            return;
          }

          // Move the token
          room.tokenPositions[playerId] = targetPos;
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

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
