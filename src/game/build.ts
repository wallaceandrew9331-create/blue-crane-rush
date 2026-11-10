import { MAX_PUMPS, MAX_SHOTS, type Liquid, type Size, type Syrup, type Topping } from './menu.ts';

/** One espresso pull, graded when the player stopped the needle. */
export interface ShotPull {
  quality: number;
  grade: PullGrade;
}

export type PullGrade = 'perfect' | 'good' | 'sour' | 'bitter';

/** The drink on the counter, as the player has built it so far. */
export interface Build {
  size: Size | null;
  shots: ShotPull[];
  liquid: Liquid | 'mixed' | null;
  /** Poured liquid as a fraction of the cup (espresso not included). */
  pour: number;
  iced: boolean;
  syrups: Partial<Record<Syrup, number>>;
  toppings: Topping[];
}

/** Each shot fills this much of the cup. */
export const SHOT_FILL = 0.08;
/** Ideal finished fill band (fraction of cup height), espresso + pour. */
export const FILL_MIN = 0.8;
export const FILL_MAX = 0.94;
export const FILL_TARGET = (FILL_MIN + FILL_MAX) / 2;
/** Past this the cup overflows. */
export const FILL_SPILL = 1.02;

export function emptyBuild(): Build {
  return { size: null, shots: [], liquid: null, pour: 0, iced: false, syrups: {}, toppings: [] };
}

export function totalFill(b: Build): number {
  return b.shots.length * SHOT_FILL + b.pour;
}

export function canAddShot(b: Build): boolean {
  return b.size !== null && b.shots.length < MAX_SHOTS;
}

export function addShot(b: Build, pull: ShotPull): void {
  if (canAddShot(b)) b.shots.push(pull);
}

export function pourLiquid(b: Build, liquid: Liquid, amount: number): void {
  if (b.size === null || amount <= 0) return;
  if (b.liquid === null) b.liquid = liquid;
  else if (b.liquid !== liquid) b.liquid = 'mixed';
  b.pour = Math.min(FILL_SPILL + 0.1 - b.shots.length * SHOT_FILL, b.pour + amount);
}

export function addSyrup(b: Build, syrup: Syrup): boolean {
  if (b.size === null) return false;
  const n = b.syrups[syrup] ?? 0;
  if (n >= MAX_PUMPS) return false;
  b.syrups[syrup] = n + 1;
  return true;
}

export function addIce(b: Build): boolean {
  if (b.size === null || b.iced) return false;
  b.iced = true;
  return true;
}

export function addTopping(b: Build, t: Topping): boolean {
  if (b.size === null || b.toppings.includes(t)) return false;
  b.toppings.push(t);
  return true;
}

export function spilled(b: Build): boolean {
  return totalFill(b) > FILL_SPILL;
}
