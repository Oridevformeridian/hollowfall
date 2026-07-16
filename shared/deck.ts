import { Card } from './types';
import { BASIC_CARDS } from './constants';

/**
 * Shuffles an array in place using the Fisher-Yates algorithm.
 */
export function shuffle<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Generates the starting 40-card deck based on the selected hero's emoji.
 * Composition:
 * - 12x class-specific signature card
 * - 4x Kindle the Storm
 * - 4x Fireball
 * - 4x Raise Stone
 * - 4x Turn Aside
 * - 4x Spirit-Skin
 * - 4x Miststep
 * - 4x Deep Breath
 */
export function buildDeckForEmoji(emoji: string): Card[] {
  let classCardId = 'ash_immolate'; // Mage specialty: Immolate
  if (emoji === '🧙‍♂️' || emoji === '🧙‍♀️') {
    classCardId = 'ash_immolate';
  } else if (emoji === '🧝‍♂️' || emoji === '🧝‍♀️') {
    classCardId = 'working_raise_stone'; // Elf specialty: Raise Stone (gives 16x total)
  } else if (emoji === '🤴' || emoji === '👸') {
    classCardId = 'talisman_thorns'; // Royal specialty: Thorns
  } else if (emoji === '🧚‍♂️' || emoji === '🧚‍♀️') {
    classCardId = 'working_shift_spirit'; // Fairy specialty: Shift Spirit
  } else if (emoji === '🧞' || emoji === '🦄') {
    classCardId = 'working_don_wolf'; // Magic Creatures specialty: Don the Wolf
  }

  const findCard = (id: string) => {
    const found = BASIC_CARDS.find(c => c.id === id);
    if (!found) {
      throw new Error(`Card with ID ${id} not found in BASIC_CARDS.`);
    }
    return found;
  };

  const deck: Card[] = [];

  // 8x class-specific card
  const classCard = findCard(classCardId);
  for (let i = 0; i < 8; i++) {
    deck.push({ ...classCard });
  }

  // 5x Kindle the Storm
  const kindle = findCard('ash_kindle_storm');
  for (let i = 0; i < 5; i++) {
    deck.push({ ...kindle });
  }

  // 5x Fireball
  const fireball = findCard('ash_fireball');
  for (let i = 0; i < 5; i++) {
    deck.push({ ...fireball });
  }

  // 5x Raise Stone
  const raiseStone = findCard('working_raise_stone');
  for (let i = 0; i < 5; i++) {
    deck.push({ ...raiseStone });
  }

  // 5x Turn Aside
  const turnAside = findCard('ash_turn_aside');
  for (let i = 0; i < 5; i++) {
    deck.push({ ...turnAside });
  }

  // 4x Spirit-Skin
  const spiritSkin = findCard('ash_spirit_skin');
  for (let i = 0; i < 4; i++) {
    deck.push({ ...spiritSkin });
  }

  // 4x Miststep
  const miststep = findCard('working_miststep');
  for (let i = 0; i < 4; i++) {
    deck.push({ ...miststep });
  }

  // 4x Deep Breath
  const deepBreath = findCard('offering_deep_breath');
  for (let i = 0; i < 4; i++) {
    deck.push({ ...deepBreath });
  }

  return deck;
}

/**
 * Rebuilds the deck from the initial 40-card composition, filtering out cards that
 * are currently in hand or actively deployed as auras/talismans.
 */
export function getRemainingDeckForReshuffle(
  hand: Card[],
  emoji: string,
  activeAuras: { thorns?: boolean; turnAside?: boolean; spiritSkin?: boolean }
): Card[] {
  const fullDeck = buildDeckForEmoji(emoji);
  const inHandIds = hand.map(c => c.id);
  
  const activeCounts: Record<string, number> = {};
  for (const id of inHandIds) {
    activeCounts[id] = (activeCounts[id] || 0) + 1;
  }
  if (activeAuras.thorns) {
    activeCounts['talisman_thorns'] = (activeCounts['talisman_thorns'] || 0) + 1;
  }
  if (activeAuras.turnAside) {
    activeCounts['ash_turn_aside'] = (activeCounts['ash_turn_aside'] || 0) + 1;
  }
  if (activeAuras.spiritSkin) {
    activeCounts['ash_spirit_skin'] = (activeCounts['ash_spirit_skin'] || 0) + 1;
  }

  const remainingCards: Card[] = [];
  for (const card of fullDeck) {
    if (activeCounts[card.id] && activeCounts[card.id] > 0) {
      activeCounts[card.id]--;
    } else {
      remainingCards.push(card);
    }
  }
  return remainingCards;
}
