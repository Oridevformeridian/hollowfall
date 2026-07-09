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
 * Validates player token movement step.
 */
export function validateTokenMove(
  from: TokenPosition,
  to: TokenPosition,
  placedTiles: Record<string, PlacedTile>,
  doorsState: Record<string, 'OPEN' | 'CLOSED'>
): { valid: boolean; error?: string } {
  // Check tile coordinate validity
  const fromTile = placedTiles[`${from.tileX},${from.tileY}`];
  const toTile = placedTiles[`${to.tileX},${to.tileY}`];

  if (!fromTile || !toTile) {
    return { valid: false, error: 'Movement must be on placed tiles.' };
  }

  // 1. Same-Tile Movement validation
  if (from.tileX === to.tileX && from.tileY === to.tileY) {
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

    // Unrotate boundary coordinate to check native layout
    const unrotation = ((360 - fromTile.rotation) % 360) as 0 | 90 | 180 | 270;
    const ur = rotateBorderCoordinate(br, bc, bdir, unrotation);
    const layout = FIXED_TILES[fromTile.tileId - 1];

    // Check Wall obstruction
    if (ur.direction === 'H') {
      if (layout.hWalls.some(w => w.r === ur.r && w.c === ur.c)) {
        return { valid: false, error: 'Blocked by a wall.' };
      }
      // Check Door obstruction
      if (layout.hDoors.some(d => d.r === ur.r && d.c === ur.c)) {
        const doorKey = `${from.tileX},${from.tileY}:${br},${bc}:H`;
        if (doorsState[doorKey] !== 'OPEN') {
          return { valid: false, error: 'Blocked by a closed door.' };
        }
      }
    } else {
      if (layout.vWalls.some(w => w.r === ur.r && w.c === ur.c)) {
        return { valid: false, error: 'Blocked by a wall.' };
      }
      // Check Door obstruction
      if (layout.vDoors.some(d => d.r === ur.r && d.c === ur.c)) {
        const doorKey = `${from.tileX},${from.tileY}:${br},${bc}:V`;
        if (doorsState[doorKey] !== 'OPEN') {
          return { valid: false, error: 'Blocked by a closed door.' };
        }
      }
    }

    return { valid: true };
  }

  // 2. Inter-Tile Crossing validation
  const dx = to.tileX - from.tileX;
  const dy = to.tileY - from.tileY;
  const tDist = Math.abs(dx) + Math.abs(dy);

  if (tDist === 1) {
    // East crossing
    if (dx === 1 && dy === 0) {
      if (from.r === 2 && from.c === 4 && to.r === 2 && to.c === 0) {
        return { valid: true };
      }
    }
    // West crossing
    if (dx === -1 && dy === 0) {
      if (from.r === 2 && from.c === 0 && to.r === 2 && to.c === 4) {
        return { valid: true };
      }
    }
    // North crossing (y increases going North in our standard axis or rows)
    // Wait, in grid display, macro grid coordinate y+1 is up (North)
    if (dx === 0 && dy === 1) {
      if (from.r === 0 && from.c === 2 && to.r === 4 && to.c === 2) {
        return { valid: true };
      }
    }
    // South crossing
    if (dx === 0 && dy === -1) {
      if (from.r === 4 && from.c === 2 && to.r === 0 && to.c === 2) {
        return { valid: true };
      }
    }

    return { valid: false, error: 'Border crossing is only allowed through aligned exits.' };
  }

  return { valid: false, error: 'Movement target cell is too far.' };
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
