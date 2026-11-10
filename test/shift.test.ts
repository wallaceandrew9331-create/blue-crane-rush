import { describe, expect, it } from 'vitest';
import { emptyBuild } from '../src/game/build.ts';
import { applicableMods, applyMod, cloneSpec, generateOrder, knobsFor } from '../src/game/orders.ts';
import { RECIPES } from '../src/game/menu.ts';
import { makeRng } from '../src/game/rng.ts';
import { pacing, Shift, shiftGrade, SHIFT_SECONDS, type ShiftEvent } from '../src/game/shift.ts';
import { perfectBuild } from './helpers.ts';

function run(shift: Shift, seconds: number, dt = 0.1): ShiftEvent[] {
  const events: ShiftEvent[] = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) events.push(...shift.update(dt));
  return events;
}

describe('orders', () => {
  it('are reproducible from a seed', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    for (let i = 0; i < 20; i++) expect(generateOrder(a, knobsFor(i / 20))).toEqual(generateOrder(b, knobsFor(i / 20)));
  });

  it('start simple: tier-0 drinks, medium, no mods', () => {
    const rng = makeRng(1);
    for (let i = 0; i < 50; i++) {
      const o = generateOrder(rng, knobsFor(0));
      expect(o.recipe.tier).toBe(0);
      expect(o.spec.size).toBe('M');
      expect(o.mods).toEqual([]);
    }
  });

  it('ramp up: late orders use every tier, sizes and mods', () => {
    const rng = makeRng(7);
    const orders = Array.from({ length: 300 }, () => generateOrder(rng, knobsFor(1)));
    expect(new Set(orders.map((o) => o.recipe.id)).size).toBe(RECIPES.length);
    expect(orders.some((o) => o.spec.size !== 'M')).toBe(true);
    expect(orders.filter((o) => o.mods.length > 0).length).toBeGreaterThan(100);
    expect(orders.some((o) => o.mods.length === 2)).toBe(true);
  });

  it('only offers mods that change the drink', () => {
    const rng = makeRng(3);
    for (const r of RECIPES) {
      for (const id of applicableMods(cloneSpec({ ...r.base, size: 'M' }))) {
        const before = cloneSpec({ ...r.base, size: 'M' });
        const after = cloneSpec(before);
        applyMod(after, id);
        expect(after, `${r.id} ${id}`).not.toEqual(before);
      }
    }
    for (let i = 0; i < 200; i++) {
      const o = generateOrder(rng, knobsFor(1));
      expect(o.spec.shots).toBeGreaterThanOrEqual(1);
      expect(o.spec.shots).toBeLessThanOrEqual(3);
      expect(o.price).toBeGreaterThan(0);
    }
  });
});

describe('shift', () => {
  it('opens with a customer straight away and ends on time', () => {
    const shift = new Shift(5);
    const first = shift.update(0.1);
    expect(first.some((e) => e.type === 'spawn')).toBe(true);
    const events = run(shift, SHIFT_SECONDS);
    expect(shift.over).toBe(true);
    expect(events.filter((e) => e.type === 'end')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'warning').map((e) => (e as { secondsLeft: number }).secondsLeft)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it('customers walk out when patience runs out, breaking the combo', () => {
    const shift = new Shift(9);
    shift.update(0.1);
    shift.stats.combo = 4;
    const t = shift.tickets[0]!;
    const events = run(shift, t.patienceMax + 1);
    expect(events.some((e) => e.type === 'walkout' && e.ticket.id === t.id)).toBe(true);
    expect(shift.stats.walkouts).toBeGreaterThan(0);
    expect(shift.stats.combo).toBe(0);
  });

  it('never queues more tickets than the pacing allows', () => {
    const shift = new Shift(11);
    for (let i = 0; i < SHIFT_SECONDS * 10; i++) {
      shift.update(0.1);
      expect(shift.tickets.length).toBeLessThanOrEqual(pacing(shift.level).maxTickets);
    }
  });

  it('pays for a perfect drink and removes the ticket', () => {
    const shift = new Shift(2);
    shift.update(0.1);
    const t = shift.tickets[0]!;
    const res = shift.serve(t.id, perfectBuild(t.spec))!;
    expect(res.judgement.stars).toBe(3);
    expect(res.payout.total).toBeGreaterThan(t.price);
    expect(shift.tickets).not.toContain(t);
    expect(shift.stats).toMatchObject({ served: 1, perfect: 1, combo: 1, bestCombo: 1 });
    expect(shift.stats.earnings).toBe(res.payout.total);
  });

  it('a remake keeps the ticket open and costs patience', () => {
    const shift = new Shift(2);
    shift.update(0.1);
    const t = shift.tickets[0]!;
    const before = t.patience;
    const res = shift.serve(t.id, emptyBuild())!;
    expect(res.payout.rejected).toBe(true);
    expect(shift.tickets).toContain(t);
    expect(t.patience).toBeLessThan(before);
    expect(shift.stats.remakes).toBe(1);
    expect(shift.stats.earnings).toBe(0);
  });

  it('a flawless bot clears the shift with a top grade', () => {
    const shift = new Shift(123);
    // Serve each ticket ~8 s after it appears: a quick but human pace.
    const age = new Map<number, number>();
    for (let i = 0; i < SHIFT_SECONDS * 10; i++) {
      shift.update(0.1);
      for (const t of [...shift.tickets]) {
        age.set(t.id, (age.get(t.id) ?? 0) + 0.1);
        if (age.get(t.id)! >= 8 && t === shift.tickets[0]) shift.serve(t.id, perfectBuild(t.spec));
      }
    }
    expect(shift.stats.walkouts).toBe(0);
    expect(shift.stats.served).toBeGreaterThan(10);
    expect(shiftGrade(shift.stats)).toBe('S');
  });

  it('grades an idle shift as a D', () => {
    const shift = new Shift(1);
    run(shift, SHIFT_SECONDS);
    expect(shift.stats.served).toBe(0);
    expect(shiftGrade(shift.stats)).toBe('D');
  });
});
