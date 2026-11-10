import { MAX_PUMPS, MAX_SHOTS, RECIPES, sizedPrice, type DrinkSpec, type Recipe, type Size, type Syrup } from './menu.ts';
import { pick, weightedPick, type Rng } from './rng.ts';

/** A customisation the customer asked for, with the chip text shown on the ticket. */
export interface Mod {
  id: ModId;
  label: string;
}

export type ModId = 'extraShot' | 'oneShot' | 'oatSwap' | 'coconutSwap' | 'makeIced' | 'makeHot' | 'extraPump' | 'noSugar' | 'addVanilla' | 'addCheeseFoam';

export interface OrderDraft {
  recipe: Recipe;
  spec: DrinkSpec;
  mods: Mod[];
  price: number;
}

/** How hard the stream is right now. `level` is 0..1 across the shift. */
export interface OrderKnobs {
  tier: number;
  sizeVariety: number;
  modChance: number;
  maxMods: number;
}

export function knobsFor(level: number): OrderKnobs {
  const l = Math.min(1, Math.max(0, level));
  return {
    tier: Math.min(3, Math.floor(l * 4.4)),
    sizeVariety: l < 0.15 ? 0 : Math.min(0.75, 0.25 + l * 0.6),
    modChance: l < 0.25 ? 0 : Math.min(0.7, (l - 0.25) * 1.2 + 0.2),
    maxMods: l < 0.6 ? 1 : 2,
  };
}

export function cloneSpec(spec: DrinkSpec): DrinkSpec {
  return { ...spec, syrups: { ...spec.syrups }, toppings: [...spec.toppings] };
}

/** Mods that make sense for this drink right now (no-ops are filtered out). */
export function applicableMods(spec: DrinkSpec): ModId[] {
  const ids: ModId[] = [];
  if (spec.shots < MAX_SHOTS) ids.push('extraShot');
  if (spec.shots > 1) ids.push('oneShot');
  if (spec.liquid === 'whole') ids.push('oatSwap', 'coconutSwap');
  if (spec.liquid === 'coconut') ids.push('oatSwap');
  if (!spec.iced && spec.liquid !== 'water') ids.push('makeIced');
  if (spec.iced && spec.liquid !== 'water' && !spec.toppings.includes('coconutFlakes')) ids.push('makeHot');
  const syrups = Object.keys(spec.syrups) as Syrup[];
  if (syrups.length > 0) {
    ids.push('noSugar');
    if (syrups.some((s) => (spec.syrups[s] ?? 0) < MAX_PUMPS)) ids.push('extraPump');
  } else if (spec.liquid !== 'water') {
    ids.push('addVanilla');
  }
  if (spec.iced && !spec.toppings.includes('cheeseFoam') && !spec.toppings.includes('milkFoam')) ids.push('addCheeseFoam');
  return ids;
}

/** Apply a mod to a spec in place and return its label. */
export function applyMod(spec: DrinkSpec, id: ModId): Mod {
  switch (id) {
    case 'extraShot':
      spec.shots += 1;
      return { id, label: '+1 shot' };
    case 'oneShot':
      spec.shots = 1;
      return { id, label: 'Single shot' };
    case 'oatSwap':
      spec.liquid = 'oat';
      return { id, label: 'Oat milk' };
    case 'coconutSwap':
      spec.liquid = 'coconut';
      return { id, label: 'Coconut milk' };
    case 'makeIced':
      spec.iced = true;
      return { id, label: 'Iced' };
    case 'makeHot':
      spec.iced = false;
      return { id, label: 'Hot' };
    case 'extraPump': {
      const s = (Object.keys(spec.syrups) as Syrup[]).find((k) => (spec.syrups[k] ?? 0) < MAX_PUMPS)!;
      spec.syrups[s] = (spec.syrups[s] ?? 0) + 1;
      return { id, label: 'Extra sweet' };
    }
    case 'noSugar':
      spec.syrups = {};
      return { id, label: 'No syrup' };
    case 'addVanilla':
      spec.syrups.vanilla = 1;
      return { id, label: '+ Vanilla' };
    case 'addCheeseFoam':
      spec.toppings.push('cheeseFoam');
      return { id, label: '+ Cheese foam' };
  }
}

/** Mods that undo or fight each other never appear on the same ticket. */
const CONFLICTS: Partial<Record<ModId, ModId[]>> = {
  extraShot: ['oneShot'],
  oneShot: ['extraShot'],
  oatSwap: ['coconutSwap'],
  coconutSwap: ['oatSwap'],
  noSugar: ['extraPump', 'addVanilla'],
  extraPump: ['noSugar'],
  addVanilla: ['noSugar'],
  makeIced: ['makeHot', 'addCheeseFoam'],
  makeHot: ['makeIced'],
};

export function generateOrder(rng: Rng, knobs: OrderKnobs, recentIds: readonly string[] = []): OrderDraft {
  const pool = RECIPES.filter((r) => r.tier <= knobs.tier);
  // Newly unlocked drinks show up more, and back-to-back repeats less.
  const recipe = weightedPick(rng, pool, (r) => (r.tier === knobs.tier ? 2 : 1) * (recentIds.includes(r.id) ? 0.35 : 1));
  const size: Size = rng() < knobs.sizeVariety ? pick(rng, ['S', 'L'] as const) : 'M';
  const spec: DrinkSpec = cloneSpec({ ...recipe.base, size });
  const mods: Mod[] = [];
  if (rng() < knobs.modChance) {
    const count = knobs.maxMods > 1 && rng() < 0.4 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const used = mods.map((m) => m.id);
      const options = applicableMods(spec).filter((id) => !used.includes(id) && !used.some((u) => CONFLICTS[u]?.includes(id)));
      if (options.length === 0) break;
      mods.push(applyMod(spec, pick(rng, options)));
    }
  }
  const price = sizedPrice(recipe.price, size) + mods.length;
  return { recipe, spec, mods, price };
}
