import { PlacedTile, TokenPosition } from './types';
import { FIXED_TILES } from './constants';

/**
 * Rotates a cell border coordinate clockwise within a 5x5 grid.
 * Border coordinates range from:
 * - H-walls: r in [0, 3], c in [0, 4]
 * - V-walls: r in [0, 4], c in [0, 3]
 */
export function rotateBorderCoordinate(
  r: number,
  c: number,
  direction: 'H' | 'V',
  rotation: 0 | 90 | 180 | 270
): { r: number; c: number; direction: 'H' | 'V' } {
  if (rotation === 0) return { r, c, direction };

  let nr = r;
  let nc = c;
  let ndir = direction;

  // Perform 90 degree clockwise rotation step by step
  const steps = rotation / 90;
  for (let i = 0; i < steps; i++) {
    if (ndir === 'H') {
      // Horizontal wall between (r, c) and (r+1, c)
      // Becomes a Vertical wall between (c, 4 - r - 1) and (c, 4 - r)
      const prev_r = nr;
      nr = nc;
      nc = 5 - prev_r - 2; // Adjust for 0-indexed wall boundaries
      ndir = 'V';
    } else {
      // Vertical wall between (r, c) and (r, c+1)
      // Becomes a Horizontal wall between (c, 4 - r) and (c+1, 4 - r)
      // Wait: H-wall row is c, col is 4 - r.
      const prev_r = nr;
      nr = nc;
      nc = 5 - prev_r - 1;
      ndir = 'H';
    }
  }

  // Normalize boundary cases
  if (nr < 0) nr = 0;
  if (nc < 0) nc = 0;

  return { r: nr, c: nc, direction: ndir };
}

/**
 * Validates whether a tile placement satisfies adjacency and rule constraints.
 */
export function validateTilePlacement(
  x: number,
  y: number,
  _tileId: number,
  _placedBy: string,
  placedTiles: Record<string, PlacedTile>,
  maxTiles: number
): { valid: boolean; error?: string } {
  const placedCount = Object.keys(placedTiles).length;

  // Rule 1: Max tiles limit
  if (placedCount >= maxTiles) {
    return { valid: false, error: `All ${maxTiles} tiles have already been placed.` };
  }

  // Rule 2: First tile must be at (0, 0)
  if (placedCount === 0) {
    if (x !== 0 || y !== 0) {
      return { valid: false, error: 'The first tile must be placed at (0, 0).' };
    }
    return { valid: true };
  }

  // Rule 3: Space must be empty
  const key = `${x},${y}`;
  if (placedTiles[key]) {
    return { valid: false, error: 'A tile is already placed at these coordinates.' };
  }

  // Rule 4: Subsequent tiles must be adjacent (orthogonally) to at least one placed tile
  const adjacentCoords = [
    `${x + 1},${y}`,
    `${x - 1},${y}`,
    `${x},${y + 1}`,
    `${x},${y - 1}`
  ];

  const hasAdjacent = adjacentCoords.some(coord => !!placedTiles[coord]);
  if (!hasAdjacent) {
    return { valid: false, error: 'Tile must be placed adjacent to an existing tile.' };
  }

  return { valid: true };
}

/**
 * Checks if a border between cells on a tile is blocked by a wall, closed door, or dynamic Raised Stone.
 */
export function isBorderBlocked(
  tileX: number,
  tileY: number,
  r: number,
  c: number,
  direction: 'H' | 'V',
  placedTiles: Record<string, PlacedTile>,
  doorsState: Record<string, 'OPEN' | 'CLOSED'>,
  wallsState?: Record<string, boolean>,
  checkOuter?: boolean
): { blocked: boolean; reason?: string } {
  const tile = placedTiles[`${tileX},${tileY}`];
  if (!tile) return { blocked: true, reason: 'No tile found.' };

  // Check dynamic Raised Stone wall
  const wallKey = `${tileX},${tileY}:${r},${c}:${direction}`;
  if (wallsState && wallsState[wallKey]) {
    return { blocked: true, reason: 'Blocked by a raised stone wall.' };
  }

  // Unrotate boundary coordinate to check native layout
  const unrotation = ((360 - tile.rotation) % 360) as 0 | 90 | 180 | 270;
  const ur = rotateBorderCoordinate(r, c, direction, unrotation);
  const layout = FIXED_TILES[tile.tileId - 1];

  const isGate = !!checkOuter && (
                 (direction === 'V' && r === 2 && (c === 0 || c === 4)) ||
                 (direction === 'H' && c === 2 && (r === 0 || r === 4))
  );

  if (ur.direction === 'H') {
    if (!isGate && layout.hWalls.some(w => w.r === ur.r && w.c === ur.c)) {
      return { blocked: true, reason: 'Blocked by a wall.' };
    }
    if (layout.hDoors.some(d => d.r === ur.r && d.c === ur.c)) {
      const doorKey = `${tileX},${tileY}:${r},${c}:${direction}`;
      if (doorsState[doorKey] !== 'OPEN') {
        return { blocked: true, reason: 'Blocked by a closed door.' };
      }
    }
  } else {
    if (!isGate && layout.vWalls.some(w => w.r === ur.r && w.c === ur.c)) {
      return { blocked: true, reason: 'Blocked by a wall.' };
    }
    if (layout.vDoors.some(d => d.r === ur.r && d.c === ur.c)) {
      const doorKey = `${tileX},${tileY}:${r},${c}:${direction}`;
      if (doorsState[doorKey] !== 'OPEN') {
        return { blocked: true, reason: 'Blocked by a closed door.' };
      }
    }
  }

  return { blocked: false };
}

/**
 * Checks whether there is an unobstructed line of sight (LOS) between two micro-grid coordinates.
 */
export function checkWrapping(
  from: TokenPosition,
  to: TokenPosition,
  placedTiles: Record<string, PlacedTile>
): { isEastWrap: boolean; isWestWrap: boolean; isNorthWrap: boolean; isSouthWrap: boolean; isWrap: boolean } {
  const tileCoords = Object.keys(placedTiles).map(k => k.split(',').map(Number));

  const rowXs = tileCoords.filter(c => c[1] === from.tileY).map(c => c[0]);
  const minTileXOnRow = rowXs.length > 0 ? Math.min(...rowXs) : 0;
  const maxTileXOnRow = rowXs.length > 0 ? Math.max(...rowXs) : 0;

  const colYs = tileCoords.filter(c => c[0] === from.tileX).map(c => c[1]);
  const minTileYOnCol = colYs.length > 0 ? Math.min(...colYs) : 0;
  const maxTileYOnCol = colYs.length > 0 ? Math.max(...colYs) : 0;

  const dx = to.tileX - from.tileX;
  const dy = to.tileY - from.tileY;

  const isEastWrap = from.tileX === maxTileXOnRow && to.tileX === minTileXOnRow && dy === 0 && from.r === 2 && from.c === 4 && to.r === 2 && to.c === 0;
  const isWestWrap = from.tileX === minTileXOnRow && to.tileX === maxTileXOnRow && dy === 0 && from.r === 2 && from.c === 0 && to.r === 2 && to.c === 4;
  const isNorthWrap = from.tileY === minTileYOnCol && to.tileY === maxTileYOnCol && dx === 0 && from.r === 0 && from.c === 2 && to.r === 4 && to.c === 2;
  const isSouthWrap = from.tileY === maxTileYOnCol && to.tileY === minTileYOnCol && dx === 0 && from.r === 4 && from.c === 2 && to.r === 0 && to.c === 2;

  const isWrap = isEastWrap || isWestWrap || isNorthWrap || isSouthWrap;

  return { isEastWrap, isWestWrap, isNorthWrap, isSouthWrap, isWrap };
}

export function getNextCell(
  curr: TokenPosition,
  dir: 'E' | 'W' | 'N' | 'S',
  placedTiles: Record<string, PlacedTile>
): TokenPosition {
  const tileCoords = Object.keys(placedTiles).map(k => k.split(',').map(Number));

  if (dir === 'E') {
    if (curr.c < 4) {
      return { tileX: curr.tileX, tileY: curr.tileY, r: curr.r, c: curr.c + 1 };
    } else {
      const rowXs = tileCoords.filter(c => c[1] === curr.tileY).map(c => c[0]);
      const minTileXOnRow = rowXs.length > 0 ? Math.min(...rowXs) : 0;
      const maxTileXOnRow = rowXs.length > 0 ? Math.max(...rowXs) : 0;
      const nextTileX = curr.tileX === maxTileXOnRow ? minTileXOnRow : curr.tileX + 1;
      return { tileX: nextTileX, tileY: curr.tileY, r: curr.r, c: 0 };
    }
  }
  if (dir === 'W') {
    if (curr.c > 0) {
      return { tileX: curr.tileX, tileY: curr.tileY, r: curr.r, c: curr.c - 1 };
    } else {
      const rowXs = tileCoords.filter(c => c[1] === curr.tileY).map(c => c[0]);
      const minTileXOnRow = rowXs.length > 0 ? Math.min(...rowXs) : 0;
      const maxTileXOnRow = rowXs.length > 0 ? Math.max(...rowXs) : 0;
      const nextTileX = curr.tileX === minTileXOnRow ? maxTileXOnRow : curr.tileX - 1;
      return { tileX: nextTileX, tileY: curr.tileY, r: curr.r, c: 4 };
    }
  }
  if (dir === 'N') {
    if (curr.r > 0) {
      return { tileX: curr.tileX, tileY: curr.tileY, r: curr.r - 1, c: curr.c };
    } else {
      const colYs = tileCoords.filter(c => c[0] === curr.tileX).map(c => c[1]);
      const minTileYOnCol = colYs.length > 0 ? Math.min(...colYs) : 0;
      const maxTileYOnCol = colYs.length > 0 ? Math.max(...colYs) : 0;
      const nextTileY = curr.tileY === maxTileYOnCol ? minTileYOnCol : curr.tileY + 1;
      return { tileX: curr.tileX, tileY: nextTileY, r: 4, c: curr.c };
    }
  }
  if (dir === 'S') {
    if (curr.r < 4) {
      return { tileX: curr.tileX, tileY: curr.tileY, r: curr.r + 1, c: curr.c };
    } else {
      const colYs = tileCoords.filter(c => c[0] === curr.tileX).map(c => c[1]);
      const minTileYOnCol = colYs.length > 0 ? Math.min(...colYs) : 0;
      const maxTileYOnCol = colYs.length > 0 ? Math.max(...colYs) : 0;
      const nextTileY = curr.tileY === minTileYOnCol ? maxTileYOnCol : curr.tileY - 1;
      return { tileX: curr.tileX, tileY: nextTileY, r: 0, c: curr.c };
    }
  }
  return curr;
}

export function hasLineOfSight(
  from: TokenPosition,
  to: TokenPosition,
  placedTiles: Record<string, PlacedTile>,
  doorsState: Record<string, 'OPEN' | 'CLOSED'>,
  wallsState?: Record<string, boolean>
): boolean {
  const ws = wallsState || {};

  // If same cell, LOS is clear
  if (from.tileX === to.tileX && from.tileY === to.tileY && from.r === to.r && from.c === to.c) {
    return true;
  }

  // Check if there is an active Rainbow Bridge connecting these cells
  const bridges = getActiveRainbowBridges(placedTiles);
  const hasBridge = bridges.some(b => {
    return (
      (b.tile1.x === from.tileX && b.tile1.y === from.tileY && b.tile1.r === from.r && b.tile1.c === from.c &&
       b.tile2.x === to.tileX && b.tile2.y === to.tileY && b.tile2.r === to.r && b.tile2.c === to.c) ||
      (b.tile2.x === from.tileX && b.tile2.y === from.tileY && b.tile2.r === from.r && b.tile2.c === from.c &&
       b.tile1.x === to.tileX && b.tile1.y === to.tileY && b.tile1.r === to.r && b.tile1.c === to.c)
    );
  });
  if (hasBridge) {
    return true;
  }

  const { isWrap } = checkWrapping(from, to, placedTiles);

  // If different tiles or wrapping, LOS must be horizontal along row 2 or vertical along col 2
  if (from.tileX !== to.tileX || from.tileY !== to.tileY || isWrap) {
    const isHorizontal = from.r === 2 && to.r === 2;
    const isVertical = from.c === 2 && to.c === 2;

    if (isHorizontal) {
      // Trace East
      let curr = { ...from };
      let steps = 0;
      let eastPathClear = true;
      const maxSteps = 15;
      while (steps < maxSteps) {
        if (curr.tileX === to.tileX && curr.tileY === to.tileY && curr.r === to.r && curr.c === to.c) {
          break;
        }
        const next = getNextCell(curr, 'E', placedTiles);
        if (!validateTokenMove(curr, next, placedTiles, doorsState, ws).valid) {
          eastPathClear = false;
          break;
        }
        curr = next;
        steps++;
      }
      if (eastPathClear && curr.tileX === to.tileX && curr.tileY === to.tileY && curr.r === to.r && curr.c === to.c) {
        return true;
      }

      // Trace West
      curr = { ...from };
      steps = 0;
      let westPathClear = true;
      while (steps < maxSteps) {
        if (curr.tileX === to.tileX && curr.tileY === to.tileY && curr.r === to.r && curr.c === to.c) {
          break;
        }
        const next = getNextCell(curr, 'W', placedTiles);
        if (!validateTokenMove(curr, next, placedTiles, doorsState, ws).valid) {
          westPathClear = false;
          break;
        }
        curr = next;
        steps++;
      }
      if (westPathClear && curr.tileX === to.tileX && curr.tileY === to.tileY && curr.r === to.r && curr.c === to.c) {
        return true;
      }
    }

    if (isVertical) {
      // Trace North
      let curr = { ...from };
      let steps = 0;
      let northPathClear = true;
      const maxSteps = 15;
      while (steps < maxSteps) {
        if (curr.tileX === to.tileX && curr.tileY === to.tileY && curr.r === to.r && curr.c === to.c) {
          break;
        }
        const next = getNextCell(curr, 'N', placedTiles);
        if (!validateTokenMove(curr, next, placedTiles, doorsState, ws).valid) {
          northPathClear = false;
          break;
        }
        curr = next;
        steps++;
      }
      if (northPathClear && curr.tileX === to.tileX && curr.tileY === to.tileY && curr.r === to.r && curr.c === to.c) {
        return true;
      }

      // Trace South
      curr = { ...from };
      steps = 0;
      let southPathClear = true;
      while (steps < maxSteps) {
        if (curr.tileX === to.tileX && curr.tileY === to.tileY && curr.r === to.r && curr.c === to.c) {
          break;
        }
        const next = getNextCell(curr, 'S', placedTiles);
        if (!validateTokenMove(curr, next, placedTiles, doorsState, ws).valid) {
          southPathClear = false;
          break;
        }
        curr = next;
        steps++;
      }
      if (southPathClear && curr.tileX === to.tileX && curr.tileY === to.tileY && curr.r === to.r && curr.c === to.c) {
        return true;
      }
    }

    return false;
  }

  // Same tile:
  const dr = to.r - from.r;
  const dc = to.c - from.c;
  const absDr = Math.abs(dr);
  const absDc = Math.abs(dc);

  if (absDr <= 1 && absDc <= 1) {
    // Orthogonally or diagonally adjacent on same tile
    if (absDr + absDc === 1) {
      // Orthogonal
      let br = 0;
      let bc = 0;
      let bdir: 'H' | 'V' = 'H';
      if (dr === 1) {
        br = from.r;
        bc = from.c;
        bdir = 'H';
      } else if (dr === -1) {
        br = to.r;
        bc = from.c;
        bdir = 'H';
      } else if (dc === 1) {
        br = from.r;
        bc = from.c;
        bdir = 'V';
      } else if (dc === -1) {
        br = from.r;
        bc = to.c;
        bdir = 'V';
      }
      return !isBorderBlocked(from.tileX, from.tileY, br, bc, bdir, placedTiles, doorsState, ws).blocked;
    } else {
      // Diagonal
      const minR = Math.min(from.r, to.r);
      const minC = Math.min(from.c, to.c);
      
      const v1 = isBorderBlocked(from.tileX, from.tileY, from.r, minC, 'V', placedTiles, doorsState, ws).blocked;
      const v2 = isBorderBlocked(from.tileX, from.tileY, to.r, minC, 'V', placedTiles, doorsState, ws).blocked;
      const h1 = isBorderBlocked(from.tileX, from.tileY, minR, from.c, 'H', placedTiles, doorsState, ws).blocked;
      const h2 = isBorderBlocked(from.tileX, from.tileY, minR, to.c, 'H', placedTiles, doorsState, ws).blocked;
      
      return !(v1 || v2 || h1 || h2);
    }
  }

  // Linear raycast check for straight orthogonal/diagonal paths within same tile
  if (from.r === to.r) {
    const r = from.r;
    const startC = Math.min(from.c, to.c);
    const endC = Math.max(from.c, to.c);
    for (let c = startC; c < endC; c++) {
      if (isBorderBlocked(from.tileX, from.tileY, r, c, 'V', placedTiles, doorsState, ws).blocked) {
        return false;
      }
    }
    return true;
  }
  if (from.c === to.c) {
    const c = from.c;
    const startR = Math.min(from.r, to.r);
    const endR = Math.max(from.r, to.r);
    for (let r = startR; r < endR; r++) {
      if (isBorderBlocked(from.tileX, from.tileY, r, c, 'H', placedTiles, doorsState, ws).blocked) {
        return false;
      }
    }
    return true;
  }
  if (absDr === absDc) {
    const stepR = dr > 0 ? 1 : -1;
    const stepC = dc > 0 ? 1 : -1;
    let currR = from.r;
    let currC = from.c;
    while (currR !== to.r && currC !== to.c) {
      const nextR = currR + stepR;
      const nextC = currC + stepC;
      
      const minR = Math.min(currR, nextR);
      const minC = Math.min(currC, nextC);
      
      const v1 = isBorderBlocked(from.tileX, from.tileY, currR, minC, 'V', placedTiles, doorsState, ws).blocked;
      const v2 = isBorderBlocked(from.tileX, from.tileY, nextR, minC, 'V', placedTiles, doorsState, ws).blocked;
      const h1 = isBorderBlocked(from.tileX, from.tileY, minR, currC, 'H', placedTiles, doorsState, ws).blocked;
      const h2 = isBorderBlocked(from.tileX, from.tileY, minR, nextC, 'H', placedTiles, doorsState, ws).blocked;
      
      if (v1 || v2 || h1 || h2) {
        return false;
      }
      
      currR = nextR;
      currC = nextC;
    }
    return true;
  }

  return false;
}

/**
 * Calculates the shortest Manhattan distance between two micro-grid coordinates on a wrapping board.
 */
export function getWrappingManhattanDistance(
  from: TokenPosition,
  to: TokenPosition,
  placedTiles: Record<string, PlacedTile>
): number {
  const tileCoords = Object.keys(placedTiles).map(k => k.split(',').map(Number));
  
  // Row-specific width for horizontal wrapping
  const rowXs = tileCoords.filter(c => c[1] === from.tileY).map(c => c[0]);
  const minTileXOnRow = rowXs.length > 0 ? Math.min(...rowXs) : 0;
  const maxTileXOnRow = rowXs.length > 0 ? Math.max(...rowXs) : 0;
  const rowWidth = (maxTileXOnRow - minTileXOnRow + 1) * 5;

  // Column-specific height for vertical wrapping
  const colYs = tileCoords.filter(c => c[0] === from.tileX).map(c => c[1]);
  const minTileYOnCol = colYs.length > 0 ? Math.min(...colYs) : 0;
  const maxTileYOnCol = colYs.length > 0 ? Math.max(...colYs) : 0;
  const colHeight = (maxTileYOnCol - minTileYOnCol + 1) * 5;

  const globalR_from = from.tileY * 5 + from.r;
  const globalC_from = from.tileX * 5 + from.c;
  const globalR_to = to.tileY * 5 + to.r;
  const globalC_to = to.tileX * 5 + to.c;

  let diffC = Math.abs(globalC_to - globalC_from);
  diffC = Math.min(diffC, rowWidth - diffC);

  let diffR = Math.abs(globalR_to - globalR_from);
  diffR = Math.min(diffR, colHeight - diffR);

  return diffC + diffR;
}


/**
 * Validates player token movement step.
 */
export function validateTokenMove(
  from: TokenPosition,
  to: TokenPosition,
  placedTiles: Record<string, PlacedTile>,
  doorsState: Record<string, 'OPEN' | 'CLOSED'>,
  wallsState?: Record<string, boolean>,
  tokenPositions?: Record<string, TokenPosition>
): { valid: boolean; error?: string } {
  // Check tile coordinate validity
  const fromTile = placedTiles[`${from.tileX},${from.tileY}`];
  const toTile = placedTiles[`${to.tileX},${to.tileY}`];

  if (!fromTile || !toTile) {
    return { valid: false, error: 'Movement must be on placed tiles.' };
  }

  // Check occupancy
  if (tokenPositions) {
    const isOccupied = Object.values(tokenPositions).some(pos => {
      return pos.tileX === to.tileX && pos.tileY === to.tileY && pos.r === to.r && pos.c === to.c;
    });
    if (isOccupied) {
      return { valid: false, error: 'Target cell is already occupied by another player.' };
    }
  }

  // Check if there is an active Rainbow Bridge connecting these cells
  const bridges = getActiveRainbowBridges(placedTiles);
  const hasBridge = bridges.some(b => {
    return (
      (b.tile1.x === from.tileX && b.tile1.y === from.tileY && b.tile1.r === from.r && b.tile1.c === from.c &&
       b.tile2.x === to.tileX && b.tile2.y === to.tileY && b.tile2.r === to.r && b.tile2.c === to.c) ||
      (b.tile2.x === from.tileX && b.tile2.y === from.tileY && b.tile2.r === from.r && b.tile2.c === from.c &&
       b.tile1.x === to.tileX && b.tile1.y === to.tileY && b.tile1.r === to.r && b.tile1.c === to.c)
    );
  });
  if (hasBridge) {
    return { valid: true };
  }


  const dx = to.tileX - from.tileX;
  const dy = to.tileY - from.tileY;

  // Determine if this is a wrapping step (pacman-wrap) using row/col specific bounds
  const { isEastWrap, isWestWrap, isNorthWrap, isSouthWrap, isWrap } = checkWrapping(from, to, placedTiles);

  // 1. Same-Tile Movement validation (excluding wrapping steps)
  if (from.tileX === to.tileX && from.tileY === to.tileY && !isWrap) {
    const dr = to.r - from.r;
    const dc = to.c - from.c;
    const dist = Math.abs(dr) + Math.abs(dc);

    if (dist !== 1) {
      return { valid: false, error: 'Token can only move 1 cell orthogonally.' };
    }

    // Determine path border between cells in placed orientation
    let br = 0;
    let bc = 0;
    let bdir: 'H' | 'V' = 'H';

    if (dr === 1) {
      br = from.r;
      bc = from.c;
      bdir = 'H';
    } else if (dr === -1) {
      br = to.r;
      bc = from.c;
      bdir = 'H';
    } else if (dc === 1) {
      br = from.r;
      bc = from.c;
      bdir = 'V';
    } else if (dc === -1) {
      br = from.r;
      bc = to.c;
      bdir = 'V';
    }

    const check = isBorderBlocked(from.tileX, from.tileY, br, bc, bdir, placedTiles, doorsState, wallsState);
    if (check.blocked) {
      return { valid: false, error: check.reason || 'Blocked by a wall or door.' };
    }

    return { valid: true };
  }

  // 2. Inter-Tile Crossing/Wrapping validation
  const isEastCrossing = (dx === 1 && dy === 0) || isEastWrap;
  if (isEastCrossing) {
    if (from.r === 2 && from.c === 4 && to.r === 2 && to.c === 0) {
      const checkFrom = isBorderBlocked(from.tileX, from.tileY, 2, 4, 'V', placedTiles, doorsState, wallsState, true);
      if (checkFrom.blocked) return { valid: false, error: checkFrom.reason || 'Blocked by a wall or door.' };
      const checkTo = isBorderBlocked(to.tileX, to.tileY, 2, 0, 'V', placedTiles, doorsState, wallsState, true);
      if (checkTo.blocked) return { valid: false, error: checkTo.reason || 'Blocked by a wall or door.' };
      return { valid: true };
    }
  }

  const isWestCrossing = (dx === -1 && dy === 0) || isWestWrap;
  if (isWestCrossing) {
    if (from.r === 2 && from.c === 0 && to.r === 2 && to.c === 4) {
      const checkFrom = isBorderBlocked(from.tileX, from.tileY, 2, 0, 'V', placedTiles, doorsState, wallsState, true);
      if (checkFrom.blocked) return { valid: false, error: checkFrom.reason || 'Blocked by a wall or door.' };
      const checkTo = isBorderBlocked(to.tileX, to.tileY, 2, 4, 'V', placedTiles, doorsState, wallsState, true);
      if (checkTo.blocked) return { valid: false, error: checkTo.reason || 'Blocked by a wall or door.' };
      return { valid: true };
    }
  }

  const isNorthCrossing = (dx === 0 && dy === -1) || isNorthWrap;
  if (isNorthCrossing) {
    if (from.r === 0 && from.c === 2 && to.r === 4 && to.c === 2) {
      const checkFrom = isBorderBlocked(from.tileX, from.tileY, 0, 2, 'H', placedTiles, doorsState, wallsState, true);
      if (checkFrom.blocked) return { valid: false, error: checkFrom.reason || 'Blocked by a wall or door.' };
      const checkTo = isBorderBlocked(to.tileX, to.tileY, 4, 2, 'H', placedTiles, doorsState, wallsState, true);
      if (checkTo.blocked) return { valid: false, error: checkTo.reason || 'Blocked by a wall or door.' };
      return { valid: true };
    }
  }

  const isSouthCrossing = (dx === 0 && dy === 1) || isSouthWrap;
  if (isSouthCrossing) {
    if (from.r === 4 && from.c === 2 && to.r === 0 && to.c === 2) {
      const checkFrom = isBorderBlocked(from.tileX, from.tileY, 4, 2, 'H', placedTiles, doorsState, wallsState, true);
      if (checkFrom.blocked) return { valid: false, error: checkFrom.reason || 'Blocked by a wall or door.' };
      const checkTo = isBorderBlocked(to.tileX, to.tileY, 0, 2, 'H', placedTiles, doorsState, wallsState, true);
      if (checkTo.blocked) return { valid: false, error: checkTo.reason || 'Blocked by a wall or door.' };
      return { valid: true };
    }
  }

  return { valid: false, error: 'Border crossing is only allowed through aligned exits.' };
}

/**
 * Validates door interaction adjacent to player token.
 */
export function validateDoorInteract(
  token: TokenPosition,
  door: { tileX: number; tileY: number; r: number; c: number; direction: 'H' | 'V' },
  placedTiles: Record<string, PlacedTile>
): { valid: boolean; error?: string } {
  if (token.tileX !== door.tileX || token.tileY !== door.tileY) {
    return { valid: false, error: 'You are too far to interact with this door.' };
  }

  const tile = placedTiles[`${door.tileX},${door.tileY}`];
  if (!tile) {
    return { valid: false, error: 'Door is not on a placed tile.' };
  }

  // Check if player is adjacent to the door boundary
  if (door.direction === 'H') {
    if (token.c !== door.c || (token.r !== door.r && token.r !== door.r + 1)) {
      return { valid: false, error: 'You must be in an adjacent cell to open/close this door.' };
    }
  } else {
    if (token.r !== door.r || (token.c !== door.c && token.c !== door.c + 1)) {
      return { valid: false, error: 'You must be in an adjacent cell to open/close this door.' };
    }
  }

  // Verify door exists in the tile layout
  const unrotation = ((360 - tile.rotation) % 360) as 0 | 90 | 180 | 270;
  const ur = rotateBorderCoordinate(door.r, door.c, door.direction, unrotation);
  const layout = FIXED_TILES[tile.tileId - 1];

  if (ur.direction === 'H') {
    if (!layout.hDoors.some(d => d.r === ur.r && d.c === ur.c)) {
      return { valid: false, error: 'No door exists at these coordinates.' };
    }
  } else {
    if (!layout.vDoors.some(d => d.r === ur.r && d.c === ur.c)) {
      return { valid: false, error: 'No door exists at these coordinates.' };
    }
  }

  return { valid: true };
}

export interface RainbowBridge {
  tile1: { x: number; y: number; r: number; c: number };
  tile2: { x: number; y: number; r: number; c: number };
}

export function getActiveRainbowBridges(placedTiles: Record<string, PlacedTile>): RainbowBridge[] {
  const bridges: RainbowBridge[] = [];
  const keys = Object.keys(placedTiles);

  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const [x1, y1] = keys[i].split(',').map(Number);
      const [x2, y2] = keys[j].split(',').map(Number);

      const dx = x2 - x1;
      const dy = y2 - y1;

      if (Math.abs(dx) === 1 && Math.abs(dy) === 1) {
        const corner1Key = `${x1},${y2}`;
        const corner2Key = `${x2},${y1}`;

        if (placedTiles[corner1Key] || placedTiles[corner2Key]) {
          let r1 = 0, c1 = 0, r2 = 0, c2 = 0;
          if (dx === 1 && dy === 1) {
            r1 = 4; c1 = 4;
            r2 = 0; c2 = 0;
          } else if (dx === 1 && dy === -1) {
            r1 = 0; c1 = 4;
            r2 = 4; c2 = 0;
          } else if (dx === -1 && dy === 1) {
            r1 = 4; c1 = 0;
            r2 = 0; c2 = 4;
          } else if (dx === -1 && dy === -1) {
            r1 = 0; c1 = 0;
            r2 = 4; c2 = 4;
          }

          bridges.push({
            tile1: { x: x1, y: y1, r: r1, c: c1 },
            tile2: { x: x2, y: y2, r: r2, c: c2 }
          });
        }
      }
    }
  }
  return bridges;
}
