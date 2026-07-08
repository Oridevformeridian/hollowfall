export interface WallOrDoor {
  r: number;
  c: number;
}

export interface TileLayout {
  id: number;
  name: string;
  vWalls: WallOrDoor[];
  hWalls: WallOrDoor[];
  vDoors: WallOrDoor[];
  hDoors: WallOrDoor[];
}

export const FIXED_TILES: TileLayout[] = [
  {
    id: 1,
    name: "The Winding Labyrinth",
    vWalls: [
      { r: 0, c: 2 },
      { r: 2, c: 1 },
      { r: 2, c: 3 },
      { r: 3, c: 2 },
      { r: 4, c: 0 }
    ],
    hWalls: [
      { r: 0, c: 1 },
      { r: 0, c: 2 },
      { r: 1, c: 0 },
      { r: 1, c: 4 },
      { r: 2, c: 2 }
    ],
    vDoors: [
      { r: 1, c: 2 }
    ],
    hDoors: [
      { r: 3, c: 3 }
    ]
  },
  {
    id: 2,
    name: "The Core Corridor",
    vWalls: [
      { r: 0, c: 1 },
      { r: 1, c: 3 },
      { r: 2, c: 0 },
      { r: 2, c: 1 },
      { r: 3, c: 1 },
      { r: 3, c: 2 },
      { r: 4, c: 1 }
    ],
    hWalls: [
      { r: 2, c: 0 },
      { r: 3, c: 3 }
    ],
    vDoors: [
      { r: 0, c: 2 },
      { r: 2, c: 2 }
    ],
    hDoors: [
      { r: 3, c: 2 }
    ]
  },
  {
    id: 3,
    name: "The Ring Labyrinth",
    vWalls: [
      { r: 0, c: 0 },
      { r: 0, c: 3 },
      { r: 1, c: 0 },
      { r: 1, c: 3 },
      { r: 2, c: 2 },
      { r: 2, c: 3 }
    ],
    hWalls: [
      { r: 0, c: 2 },
      { r: 1, c: 2 },
      { r: 3, c: 2 }
    ],
    vDoors: [
      { r: 1, c: 1 }
    ],
    hDoors: [
      { r: 2, c: 1 },
      { r: 3, c: 3 }
    ]
  },
  {
    id: 4,
    name: "The Four-Way Vault",
    vWalls: [
      { r: 1, c: 3 },
      { r: 2, c: 1 },
      { r: 3, c: 2 }
    ],
    hWalls: [
      { r: 0, c: 1 },
      { r: 1, c: 1 },
      { r: 1, c: 4 },
      { r: 2, c: 0 },
      { r: 2, c: 2 },
      { r: 2, c: 4 }
    ],
    vDoors: [
      { r: 1, c: 1 }
    ],
    hDoors: [
      { r: 1, c: 2 },
      { r: 2, c: 1 }
    ]
  }
];
