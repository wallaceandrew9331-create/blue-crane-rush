import type { Judgement } from './judge.ts';

export interface Payout {
  /** Drink price, scaled by accuracy. */
  base: number;
  /** Speed tip: faster and better-made drinks tip more. */
  tip: number;
  /** Extra from the combo multiplier. */
  comboBonus: number;
  total: number;
  /** Combo count after this drink. */
  combo: number;
  multiplier: number;
  rejected: boolean;
}

export const COMBO_STEP = 0.05;
export const COMBO_CAP = 10;
export const TIP_RATE = 0.45;

const round1 = (n: number) => Math.round(n * 10) / 10;

export function comboMultiplier(combo: number): number {
  return 1 + COMBO_STEP * Math.min(combo, COMBO_CAP);
}

/**
 * Pay for a served drink.
 * - 3 stars extends the combo, 2 stars holds it, 1 star breaks it, 0 is a remake (no pay).
 * - The multiplier uses the combo *including* this drink, so the first perfect already earns a bonus.
 */
export function payout(price: number, j: Judgement, patienceLeft: number, combo: number): Payout {
  if (j.stars === 0) return { base: 0, tip: 0, comboBonus: 0, total: 0, combo: 0, multiplier: 1, rejected: true };
  const nextCombo = j.stars === 3 ? combo + 1 : j.stars === 2 ? combo : 0;
  const base = round1(price * (j.accuracy >= 0.999 ? 1 : j.accuracy));
  const patience = Math.min(1, Math.max(0, patienceLeft));
  const tip = round1(price * TIP_RATE * patience * j.quality * (j.stars / 3));
  const multiplier = comboMultiplier(nextCombo);
  const comboBonus = round1((base + tip) * (multiplier - 1));
  return { base, tip, comboBonus, total: round1(base + tip + comboBonus), combo: nextCombo, multiplier, rejected: false };
}
