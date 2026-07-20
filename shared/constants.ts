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
  class: string;
  signatureCards: string[];
}

export const HEROES: Hero[] = [
  // Row 1 (top selection of the 2x5 grid)
  { emoji: '🧙‍♂️', color: '#00E5FF', name: 'Man Mage', class: 'Ashwalk', signatureCards: ['Immolate'] },       // Col 1, Top
  { emoji: '🧝‍♂️', color: '#00E676', name: 'Man Elf', class: 'Stoneshaping', signatureCards: ['Raise Stone'] },       // Col 2, Top
  { emoji: '🤴', color: '#FFD600', name: 'Prince', class: 'Bonecraft', signatureCards: ['Thorns'] },         // Col 3, Top
  { emoji: '🧚‍♂️', color: '#FF6D00', name: 'Man Fairy', class: 'Dreamwalking', signatureCards: ['Shift Spirit'] },      // Col 4, Top
  { emoji: '🧞', color: '#D500F9', name: 'Genie', class: 'Beast Paths', signatureCards: ['Don the Wolf'] },          // Col 5, Top

  // Row 2 (bottom selection of the 2x5 grid)
  { emoji: '🧙‍♀️', color: '#E0F7FA', name: 'Woman Mage', class: 'Ashwalk', signatureCards: ['Immolate'] },     // Col 1, Bottom
  { emoji: '🧝‍♀️', color: '#B9F6CA', name: 'Woman Elf', class: 'Stoneshaping', signatureCards: ['Raise Stone'] },     // Col 2, Bottom
  { emoji: '👸', color: '#F50057', name: 'Princess', class: 'Bonecraft', signatureCards: ['Thorns'] },       // Col 3, Bottom
  { emoji: '🧚‍♀️', color: '#FFAB40', name: 'Woman Fairy', class: 'Dreamwalking', signatureCards: ['Shift Spirit'] },    // Col 4, Bottom
  { emoji: '🦄', color: '#E2E8F0', name: 'Unicorn', class: 'Beast Paths', signatureCards: ['Don the Wolf'] }         // Col 5, Bottom
];

export const BASIC_CARDS: Card[] = [
  {
    id: 'ash_kindle_storm',
    name: 'Kindle the Storm',
    type: 'bane',
    description: 'Deals 3 fire damage to target Walker in LOS.'
  },
  {
    id: 'ash_fireball',
    name: 'Fireball',
    type: 'bane',
    description: 'Deals 4 fire damage to target Walker in LOS.'
  },
  {
    id: 'ash_immolate',
    name: 'Immolate',
    type: 'bane',
    description: 'Deals 6 fire damage to target in LOS. Deals 1 recoil fire damage to caster.',
    expend: true
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
    description: 'Teleport to any cell up to 3 distance in a cardinal direction (N/S/E/W), ignoring LOS.'
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
    description: 'Leap: Teleport up to 3 cells Manhattan distance, even around corners.'
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
    description: 'Offering: Instantly gain +2 Action Points (AP).',
    expend: true
  }
];
