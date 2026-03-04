/**
 * Character registry — defines all available hatching characters.
 *
 * Sprite sheets are 216x120 (9 cols × 5 rows of 24x24 frames).
 * Row 0: Walk down (8 frames)
 * Row 1: Walk up (3 frames)
 * Row 2: Walk side/right (8 frames) — flip horizontally for left
 * Row 3: Idle (1 frame)
 * Row 4: Special (2 frames)
 */

export interface CharacterDef {
  id: string;
  name: string;
  sheet: string;
  rarity: 'common' | 'uncommon' | 'rare';
}

export const CHARACTERS: CharacterDef[] = [
  // ── Common: Characters 1–21, Basic (~60%) ──
  { id: 'character-1', name: 'Sprout', sheet: '/sprites/characters/character-1.png', rarity: 'common' },
  { id: 'character-2', name: 'Bloom', sheet: '/sprites/characters/character-2.png', rarity: 'common' },
  { id: 'character-3', name: 'Pebble', sheet: '/sprites/characters/character-3.png', rarity: 'common' },
  { id: 'character-4', name: 'Moss', sheet: '/sprites/characters/character-4.png', rarity: 'common' },
  { id: 'character-5', name: 'Clover', sheet: '/sprites/characters/character-5.png', rarity: 'common' },
  { id: 'character-6', name: 'Fern', sheet: '/sprites/characters/character-6.png', rarity: 'common' },
  { id: 'character-7', name: 'Acorn', sheet: '/sprites/characters/character-7.png', rarity: 'common' },
  { id: 'character-8', name: 'Dewdrop', sheet: '/sprites/characters/character-8.png', rarity: 'common' },
  { id: 'character-9', name: 'Bramble', sheet: '/sprites/characters/character-9.png', rarity: 'common' },
  { id: 'character-10', name: 'Twig', sheet: '/sprites/characters/character-10.png', rarity: 'common' },
  { id: 'character-11', name: 'Bud', sheet: '/sprites/characters/character-11.png', rarity: 'common' },
  { id: 'character-12', name: 'Sage', sheet: '/sprites/characters/character-12.png', rarity: 'common' },
  { id: 'character-13', name: 'Thistle', sheet: '/sprites/characters/character-13.png', rarity: 'common' },
  { id: 'character-14', name: 'Reed', sheet: '/sprites/characters/character-14.png', rarity: 'common' },
  { id: 'character-15', name: 'Basil', sheet: '/sprites/characters/character-15.png', rarity: 'common' },
  { id: 'character-16', name: 'Daisy', sheet: '/sprites/characters/character-16.png', rarity: 'common' },
  { id: 'character-17', name: 'Ivy', sheet: '/sprites/characters/character-17.png', rarity: 'common' },
  { id: 'character-18', name: 'Maple', sheet: '/sprites/characters/character-18.png', rarity: 'common' },
  { id: 'character-19', name: 'Willow', sheet: '/sprites/characters/character-19.png', rarity: 'common' },
  { id: 'character-20', name: 'Hazel', sheet: '/sprites/characters/character-20.png', rarity: 'common' },
  { id: 'character-21', name: 'Sorrel', sheet: '/sprites/characters/character-21.png', rarity: 'common' },
  { id: 'basic', name: 'Basic', sheet: '/sprites/characters/basic.png', rarity: 'common' },

  // ── Uncommon: Gato 1–5, Seasonal, Bunny (~30%) ──
  { id: 'gato-1', name: 'Gato', sheet: '/sprites/characters/gato-1.png', rarity: 'uncommon' },
  { id: 'gato-2', name: 'Gato Noir', sheet: '/sprites/characters/gato-2.png', rarity: 'uncommon' },
  { id: 'gato-3', name: 'Gato Ginger', sheet: '/sprites/characters/gato-3.png', rarity: 'uncommon' },
  { id: 'gato-4', name: 'Gato Calico', sheet: '/sprites/characters/gato-4.png', rarity: 'uncommon' },
  { id: 'gato-5', name: 'Gato Tuxedo', sheet: '/sprites/characters/gato-5.png', rarity: 'uncommon' },
  { id: 'spring-1', name: 'Spring Sprite', sheet: '/sprites/characters/spring-1.png', rarity: 'uncommon' },
  { id: 'spring-2', name: 'Spring Bloom', sheet: '/sprites/characters/spring-2.png', rarity: 'uncommon' },
  { id: 'spring-3', name: 'Spring Petal', sheet: '/sprites/characters/spring-3.png', rarity: 'uncommon' },
  { id: 'spring-4', name: 'Spring Blossom', sheet: '/sprites/characters/spring-4.png', rarity: 'uncommon' },
  { id: 'summer-1', name: 'Summer Sun', sheet: '/sprites/characters/summer-1.png', rarity: 'uncommon' },
  { id: 'summer-2', name: 'Summer Breeze', sheet: '/sprites/characters/summer-2.png', rarity: 'uncommon' },
  { id: 'summer-3', name: 'Summer Wave', sheet: '/sprites/characters/summer-3.png', rarity: 'uncommon' },
  { id: 'summer-4', name: 'Summer Glow', sheet: '/sprites/characters/summer-4.png', rarity: 'uncommon' },
  { id: 'autumn-1', name: 'Autumn Leaf', sheet: '/sprites/characters/autumn-1.png', rarity: 'uncommon' },
  { id: 'autumn-2', name: 'Autumn Ember', sheet: '/sprites/characters/autumn-2.png', rarity: 'uncommon' },
  { id: 'autumn-3', name: 'Autumn Harvest', sheet: '/sprites/characters/autumn-3.png', rarity: 'uncommon' },
  { id: 'autumn-4', name: 'Autumn Rustle', sheet: '/sprites/characters/autumn-4.png', rarity: 'uncommon' },
  { id: 'winter-1', name: 'Winter Frost', sheet: '/sprites/characters/winter-1.png', rarity: 'uncommon' },
  { id: 'winter-2', name: 'Winter Chill', sheet: '/sprites/characters/winter-2.png', rarity: 'uncommon' },
  { id: 'winter-3', name: 'Winter Snow', sheet: '/sprites/characters/winter-3.png', rarity: 'uncommon' },
  { id: 'winter-4', name: 'Winter Ice', sheet: '/sprites/characters/winter-4.png', rarity: 'uncommon' },
  { id: 'bunny', name: 'Bunny', sheet: '/sprites/characters/bunny.png', rarity: 'uncommon' },

  // ── Rare: Knights, Specials, Main (~10%) ──
  { id: 'knight-1', name: 'Knight', sheet: '/sprites/characters/knight-1.png', rarity: 'rare' },
  { id: 'knight-2', name: 'Dark Knight', sheet: '/sprites/characters/knight-2.png', rarity: 'rare' },
  { id: 'knight-3', name: 'Holy Knight', sheet: '/sprites/characters/knight-3.png', rarity: 'rare' },
  { id: 'knight-4', name: 'Shadow Knight', sheet: '/sprites/characters/knight-4.png', rarity: 'rare' },
  { id: 'special-1', name: 'Phoenix', sheet: '/sprites/characters/special-1.png', rarity: 'rare' },
  { id: 'special-2', name: 'Dragon', sheet: '/sprites/characters/special-2.png', rarity: 'rare' },
  { id: 'special-3', name: 'Unicorn', sheet: '/sprites/characters/special-3.png', rarity: 'rare' },
  { id: 'special-4', name: 'Griffin', sheet: '/sprites/characters/special-4.png', rarity: 'rare' },
  { id: 'special-5', name: 'Chimera', sheet: '/sprites/characters/special-5.png', rarity: 'rare' },
  { id: 'main', name: 'Hero', sheet: '/sprites/characters/main.png', rarity: 'rare' },
];

const RARITY_WEIGHTS: Record<CharacterDef['rarity'], number> = {
  common: 60,
  uncommon: 30,
  rare: 10,
};

/** Pick a random character using weighted rarity. */
export function pickRandomCharacter(): CharacterDef {
  const roll = Math.random() * 100;
  let rarity: CharacterDef['rarity'];
  if (roll < RARITY_WEIGHTS.common) rarity = 'common';
  else if (roll < RARITY_WEIGHTS.common + RARITY_WEIGHTS.uncommon) rarity = 'uncommon';
  else rarity = 'rare';

  const pool = CHARACTERS.filter((c) => c.rarity === rarity);
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Look up a character by ID. */
export function getCharacterById(id: string): CharacterDef | undefined {
  return CHARACTERS.find((c) => c.id === id);
}
