# HOLLOWFALL: THRESHOLDS — Multiplayer Board Setup & Lobby Specification
**Version 1.2 (TypeScript Spec)**

This document specifies the architecture, rules, network protocols, and user experience for a multiplayer prototype of **Hollowfall: Thresholds**, a board-building game of path alignment and turn-based navigation. 

The core focus of this prototype is the **Setup & Board Construction Phase**, where players join a shared lobby, receive random tile assignments, and cooperate/compete to build a contiguous grid of maze tiles with aligned exits.

---

## 1. Technical Stack & Architecture

To optimize for cross-platform web/mobile performance and real-time synchronization, this prototype is specified entirely in **TypeScript (TS)**:

*   **Frontend**: React (Vite) + TypeScript.
    *   *Grid Rendering*: Interactive SVG or CSS Grid for responsive grid scaling and fluid 2D rotation transitions.
    *   *Styling*: Custom Vanilla CSS (dark-themed cyberpunk/animist palette with glow effects).
*   **Backend**: Node.js + TypeScript (Express/Fastify + Socket.io).
    *   *Real-time Sync*: WebSockets (Socket.io) to manage active lobbies, validate grid placements, and broadcast turn-passing events.
    *   *State Storage*: In-memory store keyed by room code (e.g. `Map<string, GameState>`).
*   **Shared Types**: Centralized TypeScript declarations used by both client and server to guarantee API contract safety.

---

## 2. High-Level Game Cycle

1. **Lobby & Matchmaking**: Players join a room using a unique code. The game supports 2 to 4+ players.
2. **Draft & Distribution**:
   - The lobby host starts the match.
   - The server randomly selects the turn order (clockwise rotation).
   - The server distributes the 4 fixed maze tiles to the players.
     - **4 Players**: Each player receives exactly 1 tile.
     - **3 Players**: Each player receives 1 tile; the 4th tile remains in a public pool or is pre-placed as a starting tile.
     - **2 Players**: Each player receives 2 tiles, which they will place alternately.
3. **Tile Placement Turn (Active Phase)**:
   - Starting with P1, players take turns placing their assigned tile onto a shared grid.
   - The tile can be rotated (90°, 180°, 270°) to arrange the path layout.
   - Placement is validated by the server: exits on touching edges must align (since all exits are at the center of the edges, they physically line up, but the orientation determines internal connectivity).
4. **Gameplay Transition**: Once all 4 tiles are placed, the board is finalized. Players spawn their tokens at designated Lairs and can navigate the board along the connected paths, opening doors and collecting treasures.

---

## 3. The 4 Fixed 5×5 Maze Tiles

Each tile is a **5×5 grid** of squares (coordinates `(row, col)` from `(0,0)` to `(4,4)`).
- **Lair (Spawn/Start)**: Always at the absolute center square `(2, 2)`. It remains invariant under rotation.
- **Treasure Spawns**: Located at corners `(0, 0)` and `(4, 4)`. These rotate with the tile.
- **Exits**: Openings at the center of the outer borders:
  - North: `(0, 2)` edge facing North.
  - South: `(4, 2)` edge facing South.
  - East: `(2, 4)` edge facing East.
  - West: `(2, 0)` edge facing West.
- **Walls & Doors**: Placed on the borders between adjacent cells. Doors can be opened/closed during gameplay.

### 3.1 Tile 1: The Winding Labyrinth
- **Walls**:
  - V-walls: `(0, 2)`, `(2, 1)`, `(2, 3)`, `(3, 2)`, `(4, 0)`
  - H-walls: `(0, 1)`, `(0, 2)`, `(1, 0)`, `(1, 4)`, `(2, 2)`
- **Doors**:
  - V-doors: `(1, 2)`
  - H-doors: `(3, 3)`
- **Visual Representation**:
```
+---+---+   +---+---+
| T         |       |
+   +---+---+   +   +
|           |       |
+---+   +---+   +---+
        | S          
+   +   +---+   +   +
|           |   |   |
+   +   +   +---+   +
|   |             T |
+---+---+   +---+---+
```

### 3.2 Tile 2: The Core Corridor
- **Walls**:
  - V-walls: `(0, 1)`, `(1, 3)`, `(2, 0)`, `(2, 1)`, `(3, 1)`, `(3, 2)`, `(4, 1)`
  - H-walls: `(2, 0)`, `(3, 3)`
- **Doors**:
  - V-doors: `(0, 2)`, `(2, 2)`
  - H-doors: `(3, 2)`
- **Visual Representation**:
```
+---+---+   +---+---+
| T     |   |       |
+   +   +   +   +   +
|               |   |
+   +   +   +   +   +
    |   | S |        
+---+   +   +   +   +
|       |   |   |   |
+   +   +---+---+   +
|       |         T |
+---+---+   +---+---+
```

### 3.3 Tile 3: The Ring Labyrinth
- **Walls**:
  - V-walls: `(0, 0)`, `(0, 3)`, `(1, 0)`, `(1, 3)`, `(2, 2)`, `(2, 3)`
  - H-walls: `(0, 2)`, `(1, 2)`, `(3, 2)`
- **Doors**:
  - V-doors: `(1, 1)`
  - H-doors: `(2, 1)`, `(3, 3)`
- **Visual Representation**:
```
+---+---+   +---+---+
| T |           |   |
+   +   +---+   +   +
|   |   |       |   |
+   +   +---+   +   +
          S |   |    
+   +---+   +   +   +
|                   |
+   +   +---+---+   +
|                 T |
+---+---+   +---+---+
```

### 3.4 Tile 4: The Four-Way Vault
- **Walls**:
  - V-walls: `(1, 3)`, `(2, 1)`, `(3, 2)`
  - H-walls: `(0, 1)`, `(1, 1)`, `(1, 4)`, `(2, 0)`, `(2, 2)`, `(2, 4)`
- **Doors**:
  - V-doors: `(1, 1)`
  - H-doors: `(1, 2)`, `(2, 1)`
- **Visual Representation**:
```
+---+---+   +---+---+
| T                 |
+   +---+   +   +   +
|       |       |   |
+   +---+---+   +---+
        | S          
+---+---+---+   +---+
|           |       |
+   +   +   +   +   +
|                 T |
+---+---+   +---+---+
```

---

## 4. Placement & Rotation Rules

A placed tile has a coordinate on a macro board grid `(X, Y)`. The first tile placed defines `(0, 0)`.

### 4.1 Adjacency Constraint
- Any tile placed after the first tile must share at least one edge with an already placed tile (i.e., at `(X±1, Y)` or `(X, Y±1)`).

### 4.2 Exit-to-Exit Alignment
Since each of the 4 tiles is a 5×5 grid with exits at the exact center of its four outer edges (`(0, 2)`, `(4, 2)`, `(2, 4)`, and `(2, 0)`), placing two tiles adjacent will **always** align their physical exits:
- A tile at `(0,0)`'s East exit `(2,4)` naturally connects to an adjacent tile at `(1,0)`'s West exit `(2,0)`.
- The remaining outer border cells (rows 0, 1, 3, 4 for East/West borders; columns 0, 1, 3, 4 for North/South borders) are solid walls, which correctly butt against each other.

### 4.3 Rotation Math
During their turn, a player can rotate their tile by 90°, 180°, or 270° clockwise.
- **Center Invariance**: The Lair at `(2, 2)` remains at `(2, 2)`.
- **Exits Shift**: North exit rotates to East, East to South, South to West, West to North.
- **Treasure Rotation**:
  - 90° CW: `(0, 0) → (0, 4)`, `(4, 4) → (4, 0)`
  - 180° CW: `(0, 0) → (4, 4)`, `(4, 4) → (0, 0)`
  - 270° CW: `(0, 0) → (4, 0)`, `(4, 4) → (0, 4)`
- **Wall/Door Rotation**:
  - Horizontal wall `H(r, c)` becomes Vertical wall `V(c, 4-r-1)` (and vice versa) shifted appropriately.

---

## 5. TypeScript Shared Interfaces & State Model

These declarations represent the source of truth for both server-side validation and client-side rendering:

```typescript
export type PlayerId = string;
export type GamePhase = 'LOBBY' | 'DRAFT' | 'PLACEMENT' | 'GAMEPLAY' | 'GAME_OVER';

export interface Player {
  id: PlayerId;
  username: string;
  color: string;
  isReady: boolean;
  isHost: boolean;
  assignedTileIndex: number | null; // 0..3 index of distributed fixed tiles
}

export interface Coordinate {
  x: number; // Macro grid X coordinate (0,0 is start)
  y: number; // Macro grid Y coordinate
}

export interface PlacedTile {
  tileId: number; // 1..4 corresponding to the fixed tiles
  position: Coordinate;
  rotation: 0 | 90 | 180 | 270;
  placedBy: PlayerId;
}

export interface TokenPosition {
  tileX: number;
  tileY: number;
  r: number; // micro grid cell row (0..4)
  c: number; // micro grid cell col (0..4)
}

export interface GameState {
  roomCode: string;
  phase: GamePhase;
  players: Record<PlayerId, Player>;
  turnOrder: PlayerId[];
  activePlayerIndex: number;
  placedTiles: Record<string, PlacedTile>; // Key format: "x,y"
  doorsState: Record<string, 'OPEN' | 'CLOSED'>; // Key format: "x,y:r,c:direction"
  tokenPositions: Record<PlayerId, TokenPosition>;
}
```

---

## 6. Network Protocol (WebSocket Events)

Using the types defined above, client-server messaging will adhere to the following event shapes:

### 6.1 Client-to-Server Payloads

```typescript
export type ClientMessage =
  | { event: 'JOIN_ROOM'; payload: { username: string; roomCode: string; color: string } }
  | { event: 'TOGGLE_READY' }
  | { event: 'PLACE_TILE'; payload: { x: number; y: number; rotation: 0 | 90 | 180 | 270 } }
  | { event: 'INTERACT_DOOR'; payload: { tileX: number; tileY: number; r: number; c: number; direction: 'H' | 'V' } }
  | { event: 'MOVE_TOKEN'; payload: TokenPosition };
```

### 6.2 Server-to-Client Broadcasts

```typescript
export type ServerMessage =
  | { event: 'STATE_UPDATE'; payload: GameState }
  | { event: 'ERROR'; payload: { message: string } };
```

---

## 7. UI/UX Design System

*   **Grid Rendering**: Renders the macro-grid (where tiles are placed) dynamically centering the `(0,0)` tile. Cell borders are styled as active paths or heavy walls based on the layout maps.
*   **Cyber-Animist Aesthetic**:
    *   *Pathways*: Neon cyan (`#00E5FF`) representing high-tech/magic layout lines.
    *   *Doors*: Yellow/Gold (`#FFD600`) borders that transform to dashed green lines when opened.
    *   *Active Turn*: A pulsing gradient ring surrounding the player avatar currently taking their action.
