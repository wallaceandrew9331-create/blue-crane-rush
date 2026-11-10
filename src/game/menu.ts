/** Ingredients, recipes and prices. Every name here is original to this game. */

export type Size = 'S' | 'M' | 'L';
export type Liquid = 'whole' | 'oat' | 'coconut' | 'water';
export type Syrup = 'vanilla' | 'caramel' | 'osmanthus' | 'brownSugar';
export type Topping = 'cheeseFoam' | 'milkFoam' | 'cinnamon' | 'coconutFlakes';

export const SIZES: readonly Size[] = ['S', 'M', 'L'];
export const LIQUIDS: readonly Liquid[] = ['whole', 'oat', 'coconut', 'water'];
export const SYRUPS: readonly Syrup[] = ['vanilla', 'caramel', 'osmanthus', 'brownSugar'];
export const TOPPINGS: readonly Topping[] = ['cheeseFoam', 'milkFoam', 'cinnamon', 'coconutFlakes'];

export const MAX_SHOTS = 3;
export const MAX_PUMPS = 3;

/** What a finished drink should contain. */
export interface DrinkSpec {
  size: Size;
  shots: number;
  liquid: Liquid;
  iced: boolean;
  syrups: Partial<Record<Syrup, number>>;
  toppings: Topping[];
}

export interface Recipe {
  id: string;
  name: string;
  /** Chinese menu name, shown small under the English one. */
  cn: string;
  blurb: string;
  /** Price in yuan for a medium. */
  price: number;
  /** Difficulty tier (0–3) at which the drink starts appearing. */
  tier: number;
  base: Omit<DrinkSpec, 'size'>;
}

export const LABELS = {
  size: { S: 'Small', M: 'Medium', L: 'Large' } satisfies Record<Size, string>,
  liquid: { whole: 'Whole milk', oat: 'Oat milk', coconut: 'Coconut milk', water: 'Water' } satisfies Record<Liquid, string>,
  liquidShort: { whole: 'Milk', oat: 'Oat', coconut: 'Coconut', water: 'Water' } satisfies Record<Liquid, string>,
  syrup: { vanilla: 'Vanilla', caramel: 'Caramel', osmanthus: 'Osmanthus', brownSugar: 'Brown sugar' } satisfies Record<Syrup, string>,
  topping: { cheeseFoam: 'Cheese foam', milkFoam: 'Milk foam', cinnamon: 'Cinnamon', coconutFlakes: 'Coconut flakes' } satisfies Record<Topping, string>,
};

export const RECIPES: readonly Recipe[] = [
  {
    id: 'blue-hour',
    name: 'Blue Hour Americano',
    cn: '蓝调美式',
    blurb: 'Two shots over ice and cold water.',
    price: 13,
    tier: 0,
    base: { shots: 2, liquid: 'water', iced: true, syrups: {}, toppings: [] },
  },
  {
    id: 'velvet',
    name: 'Velvet Latte',
    cn: '丝绒拿铁',
    blurb: 'Two shots, steamed whole milk.',
    price: 15,
    tier: 0,
    base: { shots: 2, liquid: 'whole', iced: false, syrups: {}, toppings: [] },
  },
  {
    id: 'coconut-cloud',
    name: 'Coconut Cloud Latte',
    cn: '椰云拿铁',
    blurb: 'Iced coconut milk, two shots, toasted flakes.',
    price: 18,
    tier: 0,
    base: { shots: 2, liquid: 'coconut', iced: true, syrups: {}, toppings: ['coconutFlakes'] },
  },
  {
    id: 'moonlit',
    name: 'Moonlit Osmanthus Oat',
    cn: '月桂燕麦拿铁',
    blurb: 'Hot oat latte with a pump of osmanthus.',
    price: 19,
    tier: 1,
    base: { shots: 2, liquid: 'oat', iced: false, syrups: { osmanthus: 1 }, toppings: [] },
  },
  {
    id: 'snowcap',
    name: 'Snowcap Cold Brew',
    cn: '雪顶冷萃',
    blurb: 'Iced black coffee under salty cheese foam.',
    price: 19,
    tier: 1,
    base: { shots: 2, liquid: 'water', iced: true, syrups: {}, toppings: ['cheeseFoam'] },
  },
  {
    id: 'ember',
    name: 'Ember Brown Sugar Oat',
    cn: '炙烤黑糖燕麦',
    blurb: 'Iced oat milk, two pumps brown sugar.',
    price: 20,
    tier: 2,
    base: { shots: 2, liquid: 'oat', iced: true, syrups: { brownSugar: 2 }, toppings: [] },
  },
  {
    id: 'crane-cap',
    name: 'Crane Cappuccino',
    cn: '白鹤卡布奇诺',
    blurb: 'Hot milk, thick foam, cinnamon dust.',
    price: 17,
    tier: 2,
    base: { shots: 2, liquid: 'whole', iced: false, syrups: {}, toppings: ['milkFoam', 'cinnamon'] },
  },
  {
    id: 'caramel-drift',
    name: 'Caramel Drift',
    cn: '焦糖云朵',
    blurb: 'Iced vanilla-caramel latte with milk foam.',
    price: 21,
    tier: 3,
    base: { shots: 2, liquid: 'whole', iced: true, syrups: { vanilla: 1, caramel: 1 }, toppings: ['milkFoam'] },
  },
  {
    id: 'silk-ristretto',
    name: 'Silk Ristretto',
    cn: '丝滑澳白',
    blurb: 'Three short shots, a little hot milk.',
    price: 18,
    tier: 3,
    base: { shots: 3, liquid: 'whole', iced: false, syrups: {}, toppings: [] },
  },
];

export function recipeById(id: string): Recipe {
  const recipe = RECIPES.find((r) => r.id === id);
  if (!recipe) throw new Error(`unknown recipe ${id}`);
  return recipe;
}

/** Larger cups cost more; a small is cheaper. */
export function sizedPrice(base: number, size: Size): number {
  return base + (size === 'S' ? -2 : size === 'L' ? 3 : 0);
}

export function totalPumps(syrups: Partial<Record<Syrup, number>>): number {
  return SYRUPS.reduce((n, s) => n + (syrups[s] ?? 0), 0);
}
