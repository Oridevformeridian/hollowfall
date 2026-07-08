import { describe, it, expect } from 'vitest';
import { validateTilePlacement, rotateBorderCoordinate } from './validation';
import { PlacedTile } from './types';

describe('validateTilePlacement', () => {
  it('should enforce first tile is placed at (0, 0)', () => {
    const placedTiles: Record<string, PlacedTile> = {};
    
    // Placement at 0,0 should succeed
    const res1 = validateTilePlacement(0, 0, 0, 'player1', placedTiles);
    expect(res1.valid).toBe(true);

    // Placement at other coords should fail
    const res2 = validateTilePlacement(1, 0, 0, 'player1', placedTiles);
    expect(res2.valid).toBe(false);
    expect(res2.error).toContain('first tile must be placed at (0, 0)');
  });

  it('should prevent placing tile in already occupied space', () => {
    const placedTiles: Record<string, PlacedTile> = {
      '0,0': { tileId: 1, position: { x: 0, y: 0 }, rotation: 0, placedBy: 'player1' }
    };

    const res = validateTilePlacement(0, 0, 1, 'player2', placedTiles);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('already placed');
  });

  it('should enforce orthogonal adjacency for subsequent tiles', () => {
    const placedTiles: Record<string, PlacedTile> = {
      '0,0': { tileId: 1, position: { x: 0, y: 0 }, rotation: 0, placedBy: 'player1' }
    };

    // Diagonal coordinate (1, 1) should fail
    const diagonalRes = validateTilePlacement(1, 1, 1, 'player2', placedTiles);
    expect(diagonalRes.valid).toBe(false);
    expect(diagonalRes.error).toContain('placed adjacent to an existing tile');

    // Orthogonal coordinate (1, 0) should succeed
    const orthogonalRes = validateTilePlacement(1, 0, 1, 'player2', placedTiles);
    expect(orthogonalRes.valid).toBe(true);
  });

  it('should cap the board size at 4 tiles total', () => {
    const placedTiles: Record<string, PlacedTile> = {
      '0,0': { tileId: 1, position: { x: 0, y: 0 }, rotation: 0, placedBy: 'p1' },
      '1,0': { tileId: 2, position: { x: 1, y: 0 }, rotation: 0, placedBy: 'p2' },
      '1,1': { tileId: 3, position: { x: 1, y: 1 }, rotation: 0, placedBy: 'p1' },
      '0,1': { tileId: 4, position: { x: 0, y: 1 }, rotation: 0, placedBy: 'p2' }
    };

    const res = validateTilePlacement(2, 0, 1, 'p1', placedTiles);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('All 4 tiles have already been placed');
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
});
