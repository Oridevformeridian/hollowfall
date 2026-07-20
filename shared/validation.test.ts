import { describe, it, expect } from 'vitest';
import { validateTilePlacement, rotateBorderCoordinate, validateTokenMove, validateDoorInteract, hasLineOfSight, hasLineOfSightToWall, getWrappingManhattanDistance, getActiveRainbowBridges, checkBoundFateEliminations, isValidMiststepTarget, isValidStoneGlideTarget, calculateScores } from './validation';
import { PlacedTile, TokenPosition } from './types';

describe('validateTilePlacement', () => {
  it('should enforce first tile is placed at (0, 0)', () => {
    const placedTiles: Record<string, PlacedTile> = {};
    
    // Placement at 0,0 should succeed
    const res1 = validateTilePlacement(0, 0, 0, 'player1', placedTiles, 2);
    expect(res1.valid).toBe(true);

    // Placement at other coords should fail
    const res2 = validateTilePlacement(1, 0, 0, 'player1', placedTiles, 2);
    expect(res2.valid).toBe(false);
    expect(res2.error).toContain('first tile must be placed at (0, 0)');
  });

  it('should prevent placing tile in already occupied space', () => {
    const placedTiles: Record<string, PlacedTile> = {
      '0,0': { tileId: 1, position: { x: 0, y: 0 }, rotation: 0, placedBy: 'player1' }
    };

    const res = validateTilePlacement(0, 0, 1, 'player2', placedTiles, 2);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('already placed');
  });

  it('should enforce orthogonal adjacency for subsequent tiles', () => {
    const placedTiles: Record<string, PlacedTile> = {
      '0,0': { tileId: 1, position: { x: 0, y: 0 }, rotation: 0, placedBy: 'player1' }
    };

    // Diagonal coordinate (1, 1) should fail
    const diagonalRes = validateTilePlacement(1, 1, 1, 'player2', placedTiles, 2);
    expect(diagonalRes.valid).toBe(false);
    expect(diagonalRes.error).toContain('placed adjacent to an existing tile');

    // Orthogonal coordinate (1, 0) should succeed
    const orthogonalRes = validateTilePlacement(1, 0, 1, 'player2', placedTiles, 2);
    expect(orthogonalRes.valid).toBe(true);
  });

  it('should cap the board size at the player count limit', () => {
    // Under a 2-player game limit (maxTiles = 2)
    const placedTiles: Record<string, PlacedTile> = {
      '0,0': { tileId: 1, position: { x: 0, y: 0 }, rotation: 0, placedBy: 'p1' },
      '1,0': { tileId: 2, position: { x: 1, y: 0 }, rotation: 0, placedBy: 'p2' }
    };

    const res = validateTilePlacement(1, 1, 1, 'p1', placedTiles, 2);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('All 2 tiles have already been placed');
  });
});

describe('rotateBorderCoordinate', () => {
  it('should return the original coordinate when rotation is 0', () => {
    const res = rotateBorderCoordinate(1, 2, 'H', 0);
    expect(res).toEqual({ r: 1, c: 2, direction: 'H' });
  });

  it('should rotate horizontal wall to vertical wall on 90 degree CW rotation', () => {
    // A horizontal wall H(0, 1) becomes vertical V(1, 3)
    const res = rotateBorderCoordinate(0, 1, 'H', 90);
    expect(res.direction).toBe('V');
    expect(res.r).toBe(1);
    expect(res.c).toBe(3);
  });

  it('should rotate vertical wall to horizontal wall on 90 degree CW rotation', () => {
    // A vertical wall V(1, 2) becomes horizontal H(2, 3)
    const res = rotateBorderCoordinate(1, 2, 'V', 90);
    expect(res.direction).toBe('H');
    expect(res.r).toBe(2);
    expect(res.c).toBe(3);
  });

  it('should return the original coordinates when applying a rotation followed by its complementary unrotation', () => {
    const rotation: 0 | 90 | 180 | 270 = 90;
    const unrotation = ((360 - rotation) % 360) as 0 | 90 | 180 | 270;
    
    // Rotate V(1, 2) by 90 deg clockwise
    const rotated = rotateBorderCoordinate(1, 2, 'V', rotation);
    // Unrotate the result by 270 deg clockwise
    const unrotated = rotateBorderCoordinate(rotated.r, rotated.c, rotated.direction, unrotation);
    
    expect(unrotated).toEqual({ r: 1, c: 2, direction: 'V' });
  });
});

describe('validateTokenMove', () => {
  const placedTiles: Record<string, PlacedTile> = {
    '0,0': { tileId: 1, position: { x: 0, y: 0 }, rotation: 0, placedBy: 'p1' },
    '1,0': { tileId: 2, position: { x: 1, y: 0 }, rotation: 0, placedBy: 'p2' }
  };

  it('should allow simple cell-to-cell move on unblocked pathway', () => {
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 2 };
    const to: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 3 }; // Move right from center (clear pathway)
    const res = validateTokenMove(from, to, placedTiles, {});
    expect(res.valid).toBe(true);
  });

  it('should block move if path crosses solid wall', () => {
    // Tile 1 has V-wall at r:2, c:1 (separating c:1 and c:2 on row 2)
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 2 };
    const to: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 1 };
    
    // With tile rotation 0, it should block because V-wall at (2,1) exists
    const res = validateTokenMove(from, to, placedTiles, {});
    // Wait, let's verify if V-wall is at (2,1).
    // Yes: in Tile 1 layout, vWalls includes { r: 2, c: 1 } which blocks moving between c:1 and c:2 on row 2!
    // So this should be blocked.
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Blocked by a wall');
  });

  it('should block move if path crosses closed door', () => {
    // Tile 1 has H-door at r:3, c:3 (separating row 3 and 4 at col 3)
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 3, c: 3 };
    const to: TokenPosition = { tileX: 0, tileY: 0, r: 4, c: 3 };
    
    const res = validateTokenMove(from, to, placedTiles, {});
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Blocked by a closed door');
  });

  it('should allow move if path crosses open door', () => {
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 3, c: 3 };
    const to: TokenPosition = { tileX: 0, tileY: 0, r: 4, c: 3 };
    
    const doorsState = { '0,0:3,3:H': 'OPEN' as const };
    const res = validateTokenMove(from, to, placedTiles, doorsState);
    expect(res.valid).toBe(true);
  });

  it('should block move if path crosses dynamically raised stone wall', () => {
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 2 };
    const to: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 3 };
    
    const wallsState = { '0,0:2,2:V': true };
    const res = validateTokenMove(from, to, placedTiles, {}, wallsState);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Blocked by a raised stone wall');
  });

  it('should enforce crossing tile borders only via exits', () => {
    // Correct East exit crossing (tile 0,0 East exit (2,4) to tile 1,0 West exit (2,0))
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 4 };
    const to: TokenPosition = { tileX: 1, tileY: 0, r: 2, c: 0 };
    const res = validateTokenMove(from, to, placedTiles, {});
    expect(res.valid).toBe(true);

    // Invalid border crossing (row 1, col 4 to row 1, col 0)
    const from2: TokenPosition = { tileX: 0, tileY: 0, r: 1, c: 4 };
    const to2: TokenPosition = { tileX: 1, tileY: 0, r: 1, c: 0 };
    const res2 = validateTokenMove(from2, to2, placedTiles, {});
    expect(res2.valid).toBe(false);
    expect(res2.error).toContain('only allowed through aligned exits');
  });

  it('should allow normal vertical crossing between adjacent tiles', () => {
    const twoTilesVert: Record<string, PlacedTile> = {
      '0,0': { tileId: 1, position: { x: 0, y: 0 }, rotation: 0, placedBy: 'p1' },
      '0,1': { tileId: 2, position: { x: 0, y: 1 }, rotation: 0, placedBy: 'p2' }
    };
    // Going South from tile 0,0 South exit to tile 0,1 North exit
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 4, c: 2 };
    const to: TokenPosition = { tileX: 0, tileY: 1, r: 0, c: 2 };
    const res = validateTokenMove(from, to, twoTilesVert, {});
    expect(res.valid).toBe(true);

    // Going North from tile 0,1 North exit to tile 0,0 South exit
    const from2: TokenPosition = { tileX: 0, tileY: 1, r: 0, c: 2 };
    const to2: TokenPosition = { tileX: 0, tileY: 0, r: 4, c: 2 };
    const res2 = validateTokenMove(from2, to2, twoTilesVert, {});
    expect(res2.valid).toBe(true);
  });

  it('should block move if target cell is occupied by another token', () => {
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 2 };
    const to: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 3 };
    const tokens = {
      'player1': { tileX: 0, tileY: 0, r: 2, c: 2 },
      'player2': { tileX: 0, tileY: 0, r: 2, c: 3 }
    };
    const res = validateTokenMove(from, to, placedTiles, {}, {}, tokens);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('already occupied by another player');
  });

  it('should allow wrap-around moves between opposite outer board boundaries', () => {
    // East-to-West wrap: from rightmost tile (1,0) East gate (2,4) to leftmost tile (0,0) West gate (2,0)
    const from: TokenPosition = { tileX: 1, tileY: 0, r: 2, c: 4 };
    const to: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 0 };
    const res = validateTokenMove(from, to, placedTiles, {});
    expect(res.valid).toBe(true);

    // West-to-East wrap: from leftmost tile (0,0) West gate (2,0) to rightmost tile (1,0) East gate (2,4)
    const from2: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 0 };
    const to2: TokenPosition = { tileX: 1, tileY: 0, r: 2, c: 4 };
    const res2 = validateTokenMove(from2, to2, placedTiles, {});
    expect(res2.valid).toBe(true);
  });
});

describe('validateDoorInteract', () => {
  const placedTiles: Record<string, PlacedTile> = {
    '0,0': { tileId: 1, position: { x: 0, y: 0 }, rotation: 0, placedBy: 'p1' }
  };

  it('should allow interaction if adjacent to a valid door', () => {
    // Tile 1 has H-door at r:3, c:3 (separates cell (3,3) and (4,3))
    const token: TokenPosition = { tileX: 0, tileY: 0, r: 3, c: 3 };
    const door = { tileX: 0, tileY: 0, r: 3, c: 3, direction: 'H' as const };
    const res = validateDoorInteract(token, door, placedTiles);
    expect(res.valid).toBe(true);
  });

  it('should block interaction if player is too far', () => {
    const token: TokenPosition = { tileX: 0, tileY: 0, r: 1, c: 1 };
    const door = { tileX: 0, tileY: 0, r: 3, c: 3, direction: 'H' as const };
    const res = validateDoorInteract(token, door, placedTiles);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('You must be in an adjacent cell');
  });
});

describe('hasLineOfSight', () => {
  const placedTiles: Record<string, PlacedTile> = {
    '0,0': { tileId: 1, position: { x: 0, y: 0 }, rotation: 0, placedBy: 'p1' },
    '1,0': { tileId: 2, position: { x: 1, y: 0 }, rotation: 0, placedBy: 'p2' }
  };

  it('should allow line of sight to self', () => {
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 2 };
    expect(hasLineOfSight(from, from, placedTiles, {})).toBe(true);
  });

  it('should check line of sight horizontally (unblocked)', () => {
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 4, c: 1 };
    const to: TokenPosition = { tileX: 0, tileY: 0, r: 4, c: 4 }; // Horizontal line on row 4 is clear of walls
    expect(hasLineOfSight(from, to, placedTiles, {})).toBe(true);
  });

  it('should check line of sight horizontally (blocked by wall)', () => {
    // Tile 1 has V-wall at r:2, c:1 (separating c:1 and c:2 on row 2)
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 2 };
    const to: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 0 };
    expect(hasLineOfSight(from, to, placedTiles, {})).toBe(false);
  });

  it('should check line of sight diagonally (unblocked)', () => {
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 0, c: 3 };
    const to: TokenPosition = { tileX: 0, tileY: 0, r: 1, c: 4 }; // diagonal is clear of walls
    expect(hasLineOfSight(from, to, placedTiles, {})).toBe(true);
  });

  it('should check line of sight diagonally (blocked by wall)', () => {
    // Tile 1 has H-wall at r:1, c:4 (separating row 1 and row 2 at col 4)
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 3 };
    const to: TokenPosition = { tileX: 0, tileY: 0, r: 1, c: 4 };
    expect(hasLineOfSight(from, to, placedTiles, {})).toBe(false);
  });

  it('should block line of sight across non-adjacent tiles', () => {
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 2 };
    const to: TokenPosition = { tileX: 2, tileY: 0, r: 2, c: 2 }; // Tile (2,0) doesn't exist/not adjacent
    expect(hasLineOfSight(from, to, placedTiles, {})).toBe(false);
  });

  it('should block line of sight across tile boundaries if a wall/door blocks it', () => {
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 4 };
    const to: TokenPosition = { tileX: 1, tileY: 0, r: 2, c: 0 };
    // Clear path initially
    expect(hasLineOfSight(from, to, placedTiles, {})).toBe(true);

    // Blocked by a dynamic wall at the boundary
    const wallsState = { '0,0:2,4:V': true };
    expect(hasLineOfSight(from, to, placedTiles, {}, wallsState)).toBe(false);
  });

  it('should correctly evaluate line of sight through open/closed doors on rotated tiles', () => {
    // Tile 1 has a vertical door at r:1, c:2 (separates c=2 and c=3 on row 1).
    // Let's rotate Tile 1 by 90 degrees.
    // rotateBorderCoordinate(1, 2, 'V', 90) -> (2, 3, 'H')
    // So the placed door will be at r:2, c:3, direction: 'H'.
    const rotatedTile1: Record<string, PlacedTile> = {
      '0,0': { tileId: 1, position: { x: 0, y: 0 }, rotation: 90, placedBy: 'p1' }
    };
    // Let's check LOS from (0,0, 2,3) to (0,0, 3,3) which goes across that H-door.
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 3 };
    const to: TokenPosition = { tileX: 0, tileY: 0, r: 3, c: 3 };

    // Initially closed, should block
    expect(hasLineOfSight(from, to, rotatedTile1, {})).toBe(false);

    // Open, should allow
    const doorsState = { '0,0:2,3:H': 'OPEN' as const };
    expect(hasLineOfSight(from, to, rotatedTile1, doorsState)).toBe(true);
  });

  it('should allow line of sight across boundaries between non-exit cells in same straight path', () => {
    const customTiles: Record<string, PlacedTile> = {
      '0,0': { tileId: 4, position: { x: 0, y: 0 }, rotation: 0, placedBy: 'p1' },
      '1,0': { tileId: 4, position: { x: 1, y: 0 }, rotation: 0, placedBy: 'p2' }
    };
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 2 };
    const to: TokenPosition = { tileX: 1, tileY: 0, r: 2, c: 1 };
    expect(hasLineOfSight(from, to, customTiles, {})).toBe(true);
  });

  it('should allow wrap-around line of sight across opposite outer boundaries', () => {
    const from: TokenPosition = { tileX: 1, tileY: 0, r: 2, c: 4 };
    const to: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 0 };
    expect(hasLineOfSight(from, to, placedTiles, {})).toBe(true);
  });

  it('should allow vertical wrap-around movement on a 1-tile high board', () => {
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 0, c: 2 };
    const to: TokenPosition = { tileX: 0, tileY: 0, r: 4, c: 2 };
    const res = validateTokenMove(from, to, placedTiles, {});
    expect(res.valid).toBe(true);
  });

  it('should allow wrap-around movement on a 1-tile wide board', () => {
    const singleTile: Record<string, PlacedTile> = {
      '0,0': { tileId: 1, position: { x: 0, y: 0 }, rotation: 0, placedBy: 'p1' }
    };
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 4 };
    const to: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 0 };
    const res = validateTokenMove(from, to, singleTile, {});
    expect(res.valid).toBe(true);
  });

  it('should allow wrap-around movement on an L-shaped board with row/col specific boundaries', () => {
    const lShapedTiles: Record<string, PlacedTile> = {
      '0,0': { tileId: 1, position: { x: 0, y: 0 }, rotation: 0, placedBy: 'p1' },
      '0,1': { tileId: 2, position: { x: 0, y: 1 }, rotation: 0, placedBy: 'p2' },
      '1,1': { tileId: 3, position: { x: 1, y: 1 }, rotation: 0, placedBy: 'p1' }
    };
    // On row 0, only '0,0' exists. So c=4 (East) should wrap to c=0 (West) of '0,0'.
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 4 };
    const to: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 0 };
    const res = validateTokenMove(from, to, lShapedTiles, {});
    expect(res.valid).toBe(true);
  });

  it('should allow vertical wrap-around line-of-sight and movement on a 2-tile high board', () => {
    const twoTilesVert: Record<string, PlacedTile> = {
      '0,0': { tileId: 4, position: { x: 0, y: 0 }, rotation: 0, placedBy: 'p1' },
      '0,1': { tileId: 4, position: { x: 0, y: 1 }, rotation: 0, placedBy: 'p2' }
    };
    // From South edge of tile 0,1 to North edge of tile 0,0
    const from: TokenPosition = { tileX: 0, tileY: 1, r: 4, c: 2 };
    const to: TokenPosition = { tileX: 0, tileY: 0, r: 0, c: 2 };
    
    // Check movement
    const resMove = validateTokenMove(from, to, twoTilesVert, {});
    expect(resMove.valid).toBe(true);

    // Check LOS
    expect(hasLineOfSight(from, to, twoTilesVert, {})).toBe(true);
  });

  it('should block inner movement on Tile 1 when wall matches a gate coordinate internally', () => {
    const singleTile1: Record<string, PlacedTile> = {
      '0,0': { tileId: 1, position: { x: 0, y: 0 }, rotation: 0, placedBy: 'p1' }
    };
    // Tile 1 has a horizontal wall at r=0, c=2.
    // Moving internally from (0,0, 0,2) to (0,0, 1,2) should be blocked by this wall.
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 0, c: 2 };
    const to: TokenPosition = { tileX: 0, tileY: 0, r: 1, c: 2 };
    const res = validateTokenMove(from, to, singleTile1, {});
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Blocked by a wall');
  });
});

describe('getWrappingManhattanDistance', () => {
  const placedTiles: Record<string, PlacedTile> = {
    '0,0': { tileId: 1, position: { x: 0, y: 0 }, rotation: 0, placedBy: 'p1' },
    '1,0': { tileId: 2, position: { x: 1, y: 0 }, rotation: 0, placedBy: 'p2' }
  };

  it('should calculate shortest path wrapping horizontally', () => {
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 0 };
    const to: TokenPosition = { tileX: 1, tileY: 0, r: 2, c: 4 };
    // Straight distance is 9 subcells. Wrapping distance is 1 subcell.
    expect(getWrappingManhattanDistance(from, to, placedTiles)).toBe(1);
  });

  it('should calculate shortest path wrapping vertically on 1-tile high board', () => {
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 0, c: 2 };
    const to: TokenPosition = { tileX: 0, tileY: 0, r: 4, c: 2 };
    // Straight distance is 4 subcells. Wrapping distance is 1 subcell.
    expect(getWrappingManhattanDistance(from, to, placedTiles)).toBe(1);
  });

  it('should calculate shortest path wrapping horizontally on an L-shaped board', () => {
    const lShapedTiles: Record<string, PlacedTile> = {
      '0,0': { tileId: 1, position: { x: 0, y: 0 }, rotation: 0, placedBy: 'p1' },
      '0,1': { tileId: 2, position: { x: 0, y: 1 }, rotation: 0, placedBy: 'p2' },
      '1,1': { tileId: 3, position: { x: 1, y: 1 }, rotation: 0, placedBy: 'p1' }
    };
    // On row 0, only '0,0' is placed, so wrapping width on row 0 is 5 subcells.
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 4 };
    const to: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 0 };
    // Straight distance is 4 subcells. Wrapping distance is 1 subcell.
    expect(getWrappingManhattanDistance(from, to, lShapedTiles)).toBe(1);
  });
});

describe('getActiveRainbowBridges', () => {
  it('should detect active Rainbow Bridge on L-shaped tile placements', () => {
    const lShapedTiles: Record<string, PlacedTile> = {
      '0,0': { tileId: 1, position: { x: 0, y: 0 }, rotation: 0, placedBy: 'p1' },
      '1,0': { tileId: 2, position: { x: 1, y: 0 }, rotation: 0, placedBy: 'p2' },
      '1,1': { tileId: 3, position: { x: 1, y: 1 }, rotation: 0, placedBy: 'p3' }
    };

    const bridges = getActiveRainbowBridges(lShapedTiles);
    expect(bridges.length).toBe(1);

    // Diagonal tiles (0,0) and (1,1) should be connected at their exits pointing to empty corner (0,1)
    expect(bridges[0].tile1).toEqual({ x: 0, y: 0, r: 0, c: 2 });
    expect(bridges[0].tile2).toEqual({ x: 1, y: 1, r: 2, c: 0 });
  });

  it('should allow movement across an active Rainbow Bridge', () => {
    const lShapedTiles: Record<string, PlacedTile> = {
      '0,0': { tileId: 1, position: { x: 0, y: 0 }, rotation: 0, placedBy: 'p1' },
      '1,0': { tileId: 2, position: { x: 1, y: 0 }, rotation: 0, placedBy: 'p2' },
      '1,1': { tileId: 3, position: { x: 1, y: 1 }, rotation: 0, placedBy: 'p3' }
    };

    const from: TokenPosition = { tileX: 0, tileY: 0, r: 0, c: 2 };
    const to: TokenPosition = { tileX: 1, tileY: 1, r: 2, c: 0 };

    const moveRes = validateTokenMove(from, to, lShapedTiles, {});
    expect(moveRes.valid).toBe(true);
  });
});

describe('hasLineOfSightToWall', () => {
  const placedTiles: Record<string, PlacedTile> = {
    '0,0': { tileId: 4, position: { x: 0, y: 0 }, rotation: 0, placedBy: 'p1' }
  };

  it('should return true if player is at cellA or cellB of the wall', () => {
    const fromA: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 2 };
    const wall = {
      tileX: 0,
      tileY: 0,
      r: 2,
      c: 2,
      direction: 'H' as const
    };
    // cellB will be { tileX: 0, tileY: 0, r: 3, c: 2 }
    const fromB: TokenPosition = { tileX: 0, tileY: 0, r: 3, c: 2 };

    expect(hasLineOfSightToWall(fromA, wall, placedTiles, {})).toBe(true);
    expect(hasLineOfSightToWall(fromB, wall, placedTiles, {})).toBe(true);
  });

  it('should return true if player has line of sight to cellA or cellB from elsewhere', () => {
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 3, c: 0 };
    const wall = {
      tileX: 0,
      tileY: 0,
      r: 3,
      c: 1,
      direction: 'V' as const
    };
    // cellA is { tileX: 0, tileY: 0, r: 3, c: 1 }
    // Line of sight is clear from (0,0, 3,0) to (0,0, 3,1) on Tile 4
    expect(hasLineOfSightToWall(from, wall, placedTiles, {})).toBe(true);
  });

  it('should not block inter-tile crossing when a Raised Stone wall is placed on the internal border of the boundary cell', () => {
    const twoTilesHoriz: Record<string, PlacedTile> = {
      '0,0': { tileId: 4, position: { x: 0, y: 0 }, rotation: 0, placedBy: 'p1' },
      '-1,0': { tileId: 4, position: { x: -1, y: 0 }, rotation: 0, placedBy: 'p2' }
    };

    // West crossing from (0,0) [2,0] to (-1,0) [2,4]
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 0 };
    const to: TokenPosition = { tileX: -1, tileY: 0, r: 2, c: 4 };

    // With NO Raised Stone wall, crossing is valid
    const cleanCrossing = validateTokenMove(from, to, twoTilesHoriz, {});
    expect(cleanCrossing.valid).toBe(true);

    // Place a Raised Stone wall at the internal boundary of the cell: 0,0:2,0:V (between c=0 and c=1)
    const wallsState = {
      '0,0:2,0:V': true
    };

    // Crossing the outer tile boundary should still be valid!
    const crossingWithWall = validateTokenMove(from, to, twoTilesHoriz, {}, wallsState);
    expect(crossingWithWall.valid).toBe(true);

    // But internal movement from (0,0) [2,0] to (0,0) [2,1] should be blocked!
    const internalTo: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 1 };
    const internalMove = validateTokenMove(from, internalTo, twoTilesHoriz, {}, wallsState);
    expect(internalMove.valid).toBe(false);
  });
});

describe('checkBoundFateEliminations', () => {
  const createMockRoom = (): any => ({
    roomCode: 'TEST',
    phase: 'GAMEPLAY',
    players: {
      p1: {
        id: 'p1',
        username: 'Player 1',
        color: '#00E5FF',
        emoji: '🧙',
        isReady: true,
        isHost: true,
        assignedTileIndex: null,
        ap: 0,
        thread: 15,
        maxThread: 15,
        hand: [],
        deck: [],
        points: 0,
        severPoints: 0,
        hasAttackedThisTurn: false,
        isFirstTurnOfMatch: false,
        form: 'normal',
      },
      p2: {
        id: 'p2',
        username: 'Player 2',
        color: '#FFD600',
        emoji: '🧝',
        isReady: true,
        isHost: false,
        assignedTileIndex: null,
        ap: 0,
        thread: 15,
        maxThread: 15,
        hand: [],
        deck: [],
        points: 0,
        severPoints: 0,
        hasAttackedThisTurn: false,
        isFirstTurnOfMatch: false,
        form: 'normal',
      }
    },
    turnOrder: ['p1', 'p2'],
    activePlayerIndex: 0,
    placedTiles: {
      '0,0': { tileId: 1, position: { x: 0, y: 0 }, rotation: 0, placedBy: 'p1' },
      '1,0': { tileId: 2, position: { x: 1, y: 0 }, rotation: 0, placedBy: 'p2' }
    },
    doorsState: {},
    wallsState: {},
    tokenPositions: {
      p1: { tileX: 0, tileY: 0, r: 2, c: 2 },
      p2: { tileX: 1, tileY: 0, r: 2, c: 2 }
    },
    treasures: {
      t1_1: { id: 't1_1', tileX: 0, tileY: 0, r: 0, c: 0, ownerId: 'p1', carrierId: null },
      t1_2: { id: 't1_2', tileX: 0, tileY: 0, r: 4, c: 4, ownerId: 'p1', carrierId: null },
      t2_1: { id: 't2_1', tileX: 1, tileY: 0, r: 0, c: 0, ownerId: 'p2', carrierId: null },
      t2_2: { id: 't2_2', tileX: 1, tileY: 0, r: 4, c: 4, ownerId: 'p2', carrierId: null }
    }
  });

  it('should not eliminate anyone if all masks are at their initial positions', () => {
    const room = createMockRoom();
    const eliminated = checkBoundFateEliminations(room);
    expect(eliminated).toEqual([]);
  });

  it('should not eliminate a player if only one of their masks is in an enemy base', () => {
    const room = createMockRoom();
    // Move one of p1's masks to p2's Hearth (1,0 at 2,2)
    room.treasures.t1_1.tileX = 1;
    room.treasures.t1_1.tileY = 0;
    room.treasures.t1_1.r = 2;
    room.treasures.t1_1.c = 2;

    const eliminated = checkBoundFateEliminations(room);
    expect(eliminated).toEqual([]);
  });

  it('should eliminate a player if both of their masks are in enemy bases', () => {
    const room = createMockRoom();
    // Move both of p1's masks to p2's Hearth (1,0 at 2,2)
    room.treasures.t1_1.tileX = 1;
    room.treasures.t1_1.tileY = 0;
    room.treasures.t1_1.r = 2;
    room.treasures.t1_1.c = 2;

    room.treasures.t1_2.tileX = 1;
    room.treasures.t1_2.tileY = 0;
    room.treasures.t1_2.r = 2;
    room.treasures.t1_2.c = 2;

    const eliminated = checkBoundFateEliminations(room);
    expect(eliminated).toEqual(['p1']);
  });

  it('should not eliminate a player if both of their masks are on the enemy tile but one is carried', () => {
    const room = createMockRoom();
    // Move both of p1's masks to p2's tile, but make one carried by p2
    room.treasures.t1_1.tileX = 1;
    room.treasures.t1_1.tileY = 0;
    room.treasures.t1_1.r = 2;
    room.treasures.t1_1.c = 2; // on enemy hearth, not carried

    room.treasures.t1_2.tileX = 1;
    room.treasures.t1_2.tileY = 0;
    room.treasures.t1_2.r = 2;
    room.treasures.t1_2.c = 2;
    room.treasures.t1_2.carrierId = 'p2'; // carried!

    const eliminated = checkBoundFateEliminations(room);
    expect(eliminated).toEqual([]);
  });

  it('should not eliminate a player if both of their masks are at r: 2, c: 2 but on their own tile', () => {
    const room = createMockRoom();
    // Both of p1's masks are on p1's own Hearth
    room.treasures.t1_1.tileX = 0;
    room.treasures.t1_1.tileY = 0;
    room.treasures.t1_1.r = 2;
    room.treasures.t1_1.c = 2;

    room.treasures.t1_2.tileX = 0;
    room.treasures.t1_2.tileY = 0;
    room.treasures.t1_2.r = 2;
    room.treasures.t1_2.c = 2;

    const eliminated = checkBoundFateEliminations(room);
    expect(eliminated).toEqual([]);
  });

  it('should not eliminate a player under Bound Fate if victoryPointsTarget > 2', () => {
    const room = createMockRoom();
    room.victoryPointsTarget = 3;
    // Both of p1's masks are on p2's Hearth
    room.treasures.t1_1.tileX = 1;
    room.treasures.t1_1.tileY = 0;
    room.treasures.t1_1.r = 2;
    room.treasures.t1_1.c = 2;

    room.treasures.t1_2.tileX = 1;
    room.treasures.t1_2.tileY = 0;
    room.treasures.t1_2.r = 2;
    room.treasures.t1_2.c = 2;

    const eliminated = checkBoundFateEliminations(room);
    expect(eliminated).toEqual([]);
  });
});

describe('isValidMiststepTarget', () => {
  const placedTiles: Record<string, PlacedTile> = {
    '0,0': { tileId: 1, position: { x: 0, y: 0 }, rotation: 0, placedBy: 'p1' },
    '1,0': { tileId: 2, position: { x: 1, y: 0 }, rotation: 0, placedBy: 'p2' }
  };

  it('should return true for valid horizontal cardinal move on same tile', () => {
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 2 };
    const to: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 4 };
    expect(isValidMiststepTarget(from, to, placedTiles)).toBe(true);
  });

  it('should return true for valid vertical cardinal move on same tile', () => {
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 2 };
    const to: TokenPosition = { tileX: 0, tileY: 0, r: 0, c: 2 };
    expect(isValidMiststepTarget(from, to, placedTiles)).toBe(true);
  });

  it('should return true for valid crossing cardinal move across tiles within distance 3', () => {
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 4 };
    const to: TokenPosition = { tileX: 1, tileY: 0, r: 2, c: 1 };
    // globalC_from = 4, globalC_to = 6 -> dist = 2
    expect(isValidMiststepTarget(from, to, placedTiles)).toBe(true);
  });

  it('should return false for diagonal move (non-cardinal)', () => {
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 2 };
    const to: TokenPosition = { tileX: 0, tileY: 0, r: 3, c: 3 };
    expect(isValidMiststepTarget(from, to, placedTiles)).toBe(false);
  });

  it('should return false for L-shaped move (non-cardinal)', () => {
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 2 };
    const to: TokenPosition = { tileX: 0, tileY: 0, r: 3, c: 4 };
    expect(isValidMiststepTarget(from, to, placedTiles)).toBe(false);
  });

  it('should return false for cardinal move that is too far (dist >= 4)', () => {
    // from (0, 0, 2, 4) to (1, 0, 2, 3) -> globalC_from = 4, globalC_to = 8 -> dist = 4
    const fromAcross: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 4 };
    const toAcross: TokenPosition = { tileX: 1, tileY: 0, r: 2, c: 3 };
    expect(isValidMiststepTarget(fromAcross, toAcross, placedTiles)).toBe(false);

    // from (0, 0, 2, 2) to (1, 0, 2, 2) -> globalC_from = 2, globalC_to = 7 -> dist = 5
    const fromFar: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 2 };
    const toFar: TokenPosition = { tileX: 1, tileY: 0, r: 2, c: 2 };
    expect(isValidMiststepTarget(fromFar, toFar, placedTiles)).toBe(false);
  });

  it('should return false for same cell (dist 0)', () => {
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 2 };
    const to: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 2 };
    expect(isValidMiststepTarget(from, to, placedTiles)).toBe(false);
  });
});

describe('isValidStoneGlideTarget', () => {
  const placedTiles: Record<string, PlacedTile> = {
    '0,0': { tileId: 1, position: { x: 0, y: 0 }, rotation: 0, placedBy: 'p1' },
    '1,0': { tileId: 2, position: { x: 1, y: 0 }, rotation: 0, placedBy: 'p2' }
  };
  const doorsState = {};

  it('should return true for orthogonal and diagonal moves of distance 1 or 2', () => {
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 1, c: 0 };
    
    // Dist 1
    expect(isValidStoneGlideTarget(from, { tileX: 0, tileY: 0, r: 1, c: 1 }, placedTiles, doorsState)).toBe(true);
    // Dist 2 orthogonal
    expect(isValidStoneGlideTarget(from, { tileX: 0, tileY: 0, r: 1, c: 2 }, placedTiles, doorsState)).toBe(true);
    // Dist 2 diagonal
    expect(isValidStoneGlideTarget(from, { tileX: 0, tileY: 0, r: 2, c: 1 }, placedTiles, doorsState)).toBe(true);
  });

  it('should return true even if there is a Raised Stone wall in the way', () => {
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 2 };
    const to: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 3 };
    const wallsState = { '0,0:2,2:V': true }; // Raised stone wall between (2,2) and (2,3)
    
    expect(isValidStoneGlideTarget(from, to, placedTiles, doorsState, wallsState)).toBe(true);
  });

  it('should return false for regular wall blockage', () => {
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 2 };
    // Tile 1 has a horizontal wall at r=2, c=2 (Horizontal wall between (2,2) and (3,2))
    // Wait! Horizontal wall between (r, c) and (r+1, c) means horizontal wall between row 2 and 3 at col 2: w.r === 2 && w.c === 2.
    // Yes! Let's verify it blocks:
    const to: TokenPosition = { tileX: 0, tileY: 0, r: 3, c: 2 };
    expect(isValidStoneGlideTarget(from, to, placedTiles, doorsState)).toBe(false);
  });

  it('should return false for distance > 2', () => {
    const from: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 1 };
    const to: TokenPosition = { tileX: 0, tileY: 0, r: 2, c: 4 }; // Dist = 3
    expect(isValidStoneGlideTarget(from, to, placedTiles, doorsState)).toBe(false);
  });
});

describe('calculateScores', () => {
  const players: Record<string, any> = {
    p1: { id: 'p1', username: 'Player 1', severPoints: 1, points: 0 },
    p2: { id: 'p2', username: 'Player 2', severPoints: 0, points: 0 }
  };
  const placedTiles: Record<string, PlacedTile> = {
    '0,0': { tileId: 1, position: { x: 0, y: 0 }, rotation: 0, placedBy: 'p1' },
    '1,0': { tileId: 2, position: { x: 1, y: 0 }, rotation: 0, placedBy: 'p2' }
  };

  it('should initialize points to kills (severPoints)', () => {
    const treasures: Record<string, any> = {};
    const res = calculateScores(players, placedTiles, treasures);
    expect(res.p1.points).toBe(1);
    expect(res.p2.points).toBe(0);
  });

  it('should add 1 point for enemy mask on player Hearth', () => {
    const treasures: Record<string, any> = {
      t1: { id: 't1', tileX: 1, tileY: 0, r: 2, c: 2, ownerId: 'p1', carrierId: null } // p1's mask on p2's hearth
    };
    const res = calculateScores(players, placedTiles, treasures);
    expect(res.p1.points).toBe(1); // p1 points remains 1 (severPoints: 1)
    expect(res.p2.points).toBe(1); // p2 points becomes 1 (severPoints: 0 + 1 mask)
  });

  it('should not add points if player own mask is on their own Hearth', () => {
    const treasures: Record<string, any> = {
      t2: { id: 't2', tileX: 1, tileY: 0, r: 2, c: 2, ownerId: 'p2', carrierId: null } // p2's own mask on p2's hearth
    };
    const res = calculateScores(players, placedTiles, treasures);
    expect(res.p2.points).toBe(0);
  });

  it('should not add points if enemy mask is carried', () => {
    const treasures: Record<string, any> = {
      t1: { id: 't1', tileX: 1, tileY: 0, r: 2, c: 2, ownerId: 'p1', carrierId: 'p2' } // p1's mask carried by p2
    };
    const res = calculateScores(players, placedTiles, treasures);
    expect(res.p2.points).toBe(0);
  });
});


