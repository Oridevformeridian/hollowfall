# Hollowfall: Thresholds — Prototype TODO
**Milestone: 2-Player Lobby & Tile Placement**

Legend: `[ ]` todo · `[~]` in progress · `[x]` done

---

## 1. Project Scaffolding
- [ ] Initialize project directories:
  - `server/` - Node.js socket server with TypeScript.
  - `client/` - React + Vite frontend with TypeScript.
  - `shared/` - Common types and constants file.
- [ ] Install base dependencies (Express/Fastify, Socket.io, React, CSS config).
- [ ] Configure `tsconfig.json` for all three folders to enforce strict typings.

## 2. Lobby & Connections (Phase 1)
- [ ] Build Socket.io server to handle room creation/joining (`JOIN_ROOM`).
- [ ] Build React Lobby UI:
  - Room Code creation and input form.
  - Connected player list with names and status (Ready/Not Ready).
- [ ] Implement player slots constraint: exactly 2 players required to begin this prototype.
- [ ] Synchronize and broadcast the Lobby state change when both players are ready and the host clicks "Start".

## 3. Tile Distribution & Start Phase (Phase 2)
- [ ] Define the 4 fixed 5x5 tile layouts on the server (represented as wall/door coordinate boundaries).
- [ ] Shuffle and distribute tiles at start: 2 tiles to Player 1, 2 tiles to Player 2.
- [ ] Determine a random starting player and transition the game phase to `PLACEMENT`.
- [ ] Build the Board UI layout:
  - Macro-grid container (initially showing empty grid slots).
  - "My Tiles" dock displaying the current player's unplaced tiles.
  - Interactive "Rotate" button for the active tile.

## 4. Turn-Based Placement & Validation (Phase 3)
- [ ] Implement interactive hover preview of the active tile on the macro-grid.
- [ ] Implement Client-to-Server `PLACE_TILE` event with coordinates `(X, Y)` and rotation.
- [ ] Build Server-side validation logic:
  - **Adjacency Check**: First tile must be placed at `(0, 0)`. Subsequent tiles must touch at least one placed tile.
  - **Exit Alignment Check**: Border exits must connect to exits, and walls to walls on all shared edges.
- [ ] Implement state update broadcast and turn passing.
- [ ] Alternate turns until all 4 tiles are successfully placed.

## 5. Maze Completed State (Phase 4)
- [ ] Detect when all 4 tiles have been placed.
- [ ] Lock the board layout (disable further placement/rotation).
- [ ] Render a transition screen: "Maze Assembly Complete!" and list the final board layout structure.
