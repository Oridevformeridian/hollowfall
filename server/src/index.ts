import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { GameState, Player, PlayerId, ClientMessage, ServerMessage, PlacedTile } from '../../shared/types';
import { validateTilePlacement } from '../../shared/validation';

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
          const { username, roomCode, color } = message.payload;
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

          // Add player
          const isHost = existingPlayers.length === 0;
          const player: Player = {
            id: playerId,
            username: username.trim() || `Player_${playerId.substring(0, 4)}`,
            color: color || getRandomColor(),
            isReady: false,
            isHost,
            assignedTileIndex: null
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

          // Distribute the 4 fixed tiles: 2 to P1, 2 to P2
          // Shuffled indexes: 0, 1, 2, 3 correspond to FIXED_TILES
          const tileIndices = [0, 1, 2, 3].sort(() => random() - 0.5);
          room.players[room.turnOrder[0]].assignedTileIndex = tileIndices[0]; // first tile index
          room.players[room.turnOrder[1]].assignedTileIndex = tileIndices[1];
          // We can store remaining tile pools in custom room state if needed, or simply assign multiple.
          // Let's store unplaced tile indexes for players: P1 gets [tileIndices[0], tileIndices[2]], P2 gets [tileIndices[1], tileIndices[3]]
          // Wait! Let's extend Player definition or keep it simple.
          // To keep it strictly matching our Player interface, we can just change the active assignedTileIndex during their turn, or 
          // distribute them in a way that we keep track of which tile they have remaining.
          // Let's store a list of unplaced tiles for each player locally in the room state, or we can add a mapping of player -> tileIds list.
          // Since our shared Player type only has `assignedTileIndex: number | null`, let's make it so that:
          // P1 has tileIndices[0] active first. When P1 places it, they get assigned tileIndices[2].
          // P2 has tileIndices[1] active first. When P2 places it, they get assigned tileIndices[3].
          // This is incredibly elegant and fits the existing Player interface perfectly without modifying it!
          // Let's store the secondary tiles in a helper map in the room object (we will cast room or keep a separate metadata map).
          
          // Store secondary tiles
          roomMetadata.set(currentRoomCode, {
            secondaryTiles: {
              [room.turnOrder[0]]: tileIndices[2],
              [room.turnOrder[1]]: tileIndices[3]
            }
          });

          broadcastState(currentRoomCode, room);
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
          const validation = validateTilePlacement(x, y, tileId, playerId, room.placedTiles);
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

          // Handle secondary tile distribution
          const meta = roomMetadata.get(currentRoomCode);
          if (meta && meta.secondaryTiles[activePlayerId] !== undefined) {
            // Move secondary tile to active slot
            activePlayer.assignedTileIndex = meta.secondaryTiles[activePlayerId];
            delete meta.secondaryTiles[activePlayerId];
          } else {
            // Player has placed both of their tiles
            activePlayer.assignedTileIndex = null;
          }

          // Check if all tiles are placed (4 tiles total)
          const newPlacedCount = Object.keys(room.placedTiles).length;
          if (newPlacedCount === 4) {
            room.phase = 'GAMEPLAY'; // Board finalized, start gameplay phase
            
            // Set initial token positions to player Lairs
            // Player 1 spawn at their tile's center (2, 2)
            // Player 2 spawn at their tile's center (2, 2)
            for (const pId of room.turnOrder) {
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
          } else {
            // Cycle active player turn
            room.activePlayerIndex = (room.activePlayerIndex + 1) % room.turnOrder.length;
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
