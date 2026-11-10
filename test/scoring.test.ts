import { describe, expect, it } from 'vitest';
import type { Judgement } from '../src/game/judge.ts';
import { COMBO_CAP, COMBO_STEP, comboMultiplier, payout } from '../src/game/scoring.ts';

const j = (stars: Judgement['stars'], accuracy = 1, quality = 1): Judgement => ({ stars, accuracy, quality, mistakes: [] });

describe('payout', () => {
  it('pays full price plus a full tip for a perfect, instant drink', () => {
    const p = payout(20, j(3), 1, 0);
    expect(p.base).toBe(20);
    expect(p.tip).toBe(9);
    expect(p.combo).toBe(1);
    expect(p.multiplier).toBeCloseTo(1 + COMBO_STEP);
    expect(p.comboBonus).toBeCloseTo(Math.round(29 * COMBO_STEP * 10) / 10);
    expect(p.total).toBeCloseTo(29 + p.comboBonus);
  });

  it('tips less the longer the customer waited', () => {
    const fast = payout(20, j(3), 0.9, 0).tip;
    const slow = payout(20, j(3), 0.2, 0).tip;
    expect(fast).toBeGreaterThan(slow);
    expect(payout(20, j(3), 0, 0).tip).toBe(0);
  });

  it('scales the base by accuracy for imperfect drinks', () => {
    expect(payout(20, j(2, 0.9, 0.8), 0.5, 0).base).toBe(18);
  });

  it('builds the combo on 3 stars, holds it on 2, breaks it on 1', () => {
    expect(payout(10, j(3), 1, 4).combo).toBe(5);
    expect(payout(10, j(2, 0.9), 1, 4).combo).toBe(4);
    expect(payout(10, j(1, 0.7, 0.5), 1, 4).combo).toBe(0);
  });

  it('pays nothing and resets the combo on a remake', () => {
    expect(payout(20, j(0, 0.4, 0.2), 1, 7)).toMatchObject({ total: 0, combo: 0, rejected: true });
  });

  it('caps the combo multiplier', () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(COMBO_CAP)).toBeCloseTo(1 + COMBO_STEP * COMBO_CAP);
    expect(comboMultiplier(COMBO_CAP + 15)).toBe(comboMultiplier(COMBO_CAP));
  });

  it('never pays more for a worse drink', () => {
    const best = payout(20, j(3), 0.7, 3).total;
    const ok = payout(20, j(2, 0.9, 0.8), 0.7, 3).total;
    const meh = payout(20, j(1, 0.7, 0.4), 0.7, 3).total;
    expect(best).toBeGreaterThan(ok);
    expect(ok).toBeGreaterThan(meh);
  });
});
