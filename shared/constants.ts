import { Card } from './types';

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

export interface Hero {
  emoji: string;
  color: string;
  name: string;
}

export const HEROES: Hero[] = [
  { emoji: '🧙‍♂️', color: '#00E5FF', name: 'Man Mage' },
  { emoji: '🧙‍♀️', color: '#E0F7FA', name: 'Woman Mage' },
  { emoji: '🧝‍♂️', color: '#00E676', name: 'Man Elf' },
  { emoji: '🧝‍♀️', color: '#B9F6CA', name: 'Woman Elf' },
  { emoji: '🤴', color: '#FFD600', name: 'Prince' },
  { emoji: '👸', color: '#F50057', name: 'Princess' },
  { emoji: '🧚‍♂️', color: '#FF6D00', name: 'Man Fairy' },
  { emoji: '🧚‍♀️', color: '#FFAB40', name: 'Woman Fairy' },
  { emoji: '🧞', color: '#D500F9', name: 'Genie' },
  { emoji: '🦄', color: '#E2E8F0', name: 'Unicorn' }
];

export const BASIC_CARDS: Card[] = [
  {
    id: 'ash_kindle_storm',
    name: 'Kindle the Storm',
    type: 'bane',
    description: 'Deals 3 fire damage to target Walker in LOS.'
  },
  {
    id: 'ash_turn_aside',
    name: 'Turn Aside',
    type: 'working',
    description: 'Aura: Block and cancel the next incoming attack spell (consumed on trigger).'
  },
  {
    id: 'ash_spirit_skin',
    name: 'Spirit-Skin',
    type: 'working',
    description: 'Aura: Reduce the next incoming attack damage by 2 (consumed on trigger).'
  },
  {
    id: 'working_miststep',
    name: 'Miststep',
    type: 'working',
    description: 'Teleport to any cell up to 3 distance in LOS.'
  },
  {
    id: 'working_raise_stone',
    name: 'Raise Stone',
    type: 'working',
    description: 'Create a permanent stone wall on an adjacent border.'
  },
  {
    id: 'talisman_thorns',
    name: 'Thorns',
    type: 'talisman',
    description: 'Talisman: Retaliate against attacks, dealing 1 damage back to the attacker.'
  },
  {
    id: 'working_don_wolf',
    name: 'Don the Wolf',
    type: 'working',
    description: 'Leap: Teleport up to 4 cells Manhattan distance, even around corners.'
  },
  {
    id: 'working_shift_spirit',
    name: 'Shift Spirit',
    type: 'working',
    description: 'Swap positions with a Walker in your Line of Sight (LOS).'
  },
  {
    id: 'offering_deep_breath',
    name: 'Deep Breath',
    type: 'offering',
    description: 'Offering: Instantly gain +2 Action Points (AP).'
  }
];
