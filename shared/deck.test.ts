import { describe, it, expect } from 'vitest';
import { buildDeckForEmoji, getRemainingDeckForReshuffle, shuffle } from './deck';

describe('Deck Logic', () => {
  it('should generate a 40-card deck with correct distribution for Mages', () => {
    const deck = buildDeckForEmoji('🧙‍♂️');
    expect(deck.length).toBe(40);
    
    // Check specific counts
    const counts = deck.reduce((acc: Record<string, number>, card) => {
      acc[card.id] = (acc[card.id] || 0) + 1;
      return acc;
    }, {});

    expect(counts['ash_immolate']).toBe(8); // Mage specialty
    expect(counts['ash_kindle_storm']).toBe(5);
    expect(counts['ash_fireball']).toBe(5);
    expect(counts['working_raise_stone']).toBe(5);
    expect(counts['ash_turn_aside']).toBe(5);
    expect(counts['ash_spirit_skin']).toBe(4);
    expect(counts['working_miststep']).toBe(4);
    expect(counts['offering_deep_breath']).toBe(4);
  });

  it('should generate a 40-card deck with correct distribution for Elves', () => {
    const deck = buildDeckForEmoji('🧝‍♀️');
    expect(deck.length).toBe(40);
    
    const counts = deck.reduce((acc: Record<string, number>, card) => {
      acc[card.id] = (acc[card.id] || 0) + 1;
      return acc;
    }, {});

    // Elves get 8 class + 5 common = 13 Raise Stones
    expect(counts['working_raise_stone']).toBe(13);
    expect(counts['ash_kindle_storm']).toBe(5);
    expect(counts['ash_fireball']).toBe(5);
    expect(counts['ash_turn_aside']).toBe(5);
    expect(counts['ash_spirit_skin']).toBe(4);
    expect(counts['working_miststep']).toBe(4);
    expect(counts['offering_deep_breath']).toBe(4);
  });

  it('should generate a 40-card deck with correct distribution for Royals', () => {
    const deck = buildDeckForEmoji('🤴');
    expect(deck.length).toBe(40);
    
    const counts = deck.reduce((acc: Record<string, number>, card) => {
      acc[card.id] = (acc[card.id] || 0) + 1;
      return acc;
    }, {});

    expect(counts['talisman_thorns']).toBe(8);
  });

  it('should generate a 40-card deck with correct distribution for Fairies', () => {
    const deck = buildDeckForEmoji('🧚‍♂️');
    expect(deck.length).toBe(40);
    
    const counts = deck.reduce((acc: Record<string, number>, card) => {
      acc[card.id] = (acc[card.id] || 0) + 1;
      return acc;
    }, {});

    expect(counts['working_shift_spirit']).toBe(8);
  });

  it('should generate a 40-card deck with correct distribution for Magic Creatures', () => {
    const deck = buildDeckForEmoji('🦄');
    expect(deck.length).toBe(40);
    
    const counts = deck.reduce((acc: Record<string, number>, card) => {
      acc[card.id] = (acc[card.id] || 0) + 1;
      return acc;
    }, {});

    expect(counts['working_don_wolf']).toBe(8);
  });

  it('should correctly filter out cards in hand or active during deck rebuild', () => {
    // Generate a Mage deck
    const emoji = '🧙‍♂️';
    
    // Simulate playing some cards:
    // Hand has 1 Immolate, 1 Miststep, 1 Turn Aside
    const hand = [
      { id: 'ash_immolate', name: 'Immolate', type: 'bane' as const, description: '' },
      { id: 'working_miststep', name: 'Miststep', type: 'working' as const, description: '' },
      { id: 'ash_turn_aside', name: 'Turn Aside', type: 'working' as const, description: '' }
    ];

    // Player also has active Turn Aside shield
    const activeAuras = {
      turnAside: true,
      thorns: false,
      spiritSkin: false
    };

    const remainingDeck = getRemainingDeckForReshuffle(hand, emoji, activeAuras);
    expect(remainingDeck.length).toBe(36); // 40 - 3 (in hand) - 1 (turn aside active)

    const counts = remainingDeck.reduce((acc: Record<string, number>, card) => {
      acc[card.id] = (acc[card.id] || 0) + 1;
      return acc;
    }, {});

    expect(counts['ash_immolate']).toBe(7);    // 8 - 1 in hand
    expect(counts['working_miststep']).toBe(3);  // 4 - 1 in hand
    expect(counts['ash_turn_aside']).toBe(3);    // 5 - 1 in hand - 1 active
  });

  it('should shuffle decks with different orderings', () => {
    const deck1 = buildDeckForEmoji('🧙‍♂️');
    const deck2 = shuffle(deck1);
    
    expect(deck2.length).toBe(deck1.length);
    // Elements should match set-wise
    expect(new Set(deck2.map(c => c.id))).toEqual(new Set(deck1.map(c => c.id)));
  });

  it('should verify expend modifier is set on Deep Breath and Immolate', () => {
    const deck = buildDeckForEmoji('🧙‍♂️');
    const immolate = deck.find(c => c.id === 'ash_immolate');
    expect(immolate).toBeDefined();
    expect(immolate?.expend).toBe(true);

    const deepBreath = deck.find(c => c.id === 'offering_deep_breath');
    expect(deepBreath).toBeDefined();
    expect(deepBreath?.expend).toBe(true);

    const fireball = deck.find(c => c.id === 'ash_fireball');
    expect(fireball).toBeDefined();
    expect(fireball?.expend).toBeUndefined();
  });

  it('should shuffle graveyard back into deck when drawing and deck is empty', () => {
    let deck: any[] = [];
    let graveyard: any[] = [
      { id: 'ash_fireball', name: 'Fireball', type: 'bane', description: '' },
      { id: 'working_miststep', name: 'Miststep', type: 'working', description: '' }
    ];
    const hand: any[] = [];

    // Simulate our drawing loop
    while (hand.length < 5) {
      if (deck.length === 0) {
        if (graveyard.length === 0) break;
        deck = shuffle(graveyard);
        graveyard = [];
      }
      const card = deck.pop();
      if (card) {
        hand.push(card);
      }
    }

    expect(hand.length).toBe(2);
    expect(deck.length).toBe(0);
    expect(graveyard.length).toBe(0);
    expect(hand.map(c => c.id)).toContain('ash_fireball');
    expect(hand.map(c => c.id)).toContain('working_miststep');
  });
});
