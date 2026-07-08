# Hollowfall: Thresholds — Prototype TODO
**Milestone: 2-Player Lobby & Tile Placement**

Legend: `[ ]` todo · `[~]` in progress · `[x]` done

---

## 1. Project Scaffolding
- [x] Initialize project directories:
  - `server/` - Node.js socket server with TypeScript.
  - `client/` - React + Vite frontend with TypeScript.
  - `shared/` - Common types and constants file.
- [x] Install base dependencies (Express/Fastify, Socket.io, React, CSS config).
- [x] Configure `tsconfig.json` for all three folders to enforce strict typings.

## 2. Lobby & Connections (Phase 1)
- [x] Build Socket.io server to handle room creation/joining (`JOIN_ROOM`).
- [x] Build React Lobby UI:
  - Room Code creation and input form.
  - Connected player list with names and status (Ready/Not Ready).
- [x] Implement player slots constraint: exactly 2 players required to begin this prototype.
- [x] Synchronize and broadcast the Lobby state change when both players are ready and the host clicks "Start".

## 3. Tile Distribution & Start Phase (Phase 2)
- [x] Define the 4 fixed 5x5 tile layouts on the server (represented as wall/door coordinate boundaries).
- [x] Shuffle and distribute tiles at start: 2 tiles to Player 1, 2 tiles to Player 2.
- [x] Determine a random starting player and transition the game phase to `PLACEMENT`.
- [x] Build the Board UI layout:
  - Macro-grid container (initially showing empty grid slots).
  - "My Tiles" dock displaying the current player's unplaced tiles.
  - Interactive "Rotate" button for the active tile.

## 4. Turn-Based Placement & Validation (Phase 3)
- [x] Implement interactive hover preview of the active tile on the macro-grid.
- [x] Implement Client-to-Server `PLACE_TILE` event with coordinates `(X, Y)` and rotation.
- [x] Build Server-side validation logic:
  - **Adjacency Check**: First tile must be placed at `(0, 0)`. Subsequent tiles must touch at least one placed tile.
  - **Exit Alignment Check**: Border exits must connect to exits, and walls to walls on all shared edges.
- [x] Implement state update broadcast and turn passing.
- [x] Alternate turns until all 4 tiles are successfully placed.

## 5. Maze Completed State (Phase 4)
- [x] Detect when all 4 tiles have been placed.
- [x] Lock the board layout (disable further placement/rotation).
- [x] Render a transition screen: "Maze Assembly Complete!" and list the final board layout structure.
