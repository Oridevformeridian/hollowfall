import { PlacedTile } from './types';

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
