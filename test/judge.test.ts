import { describe, expect, it } from 'vitest';
import { addShot, addSyrup, addTopping, FILL_MAX, FILL_MIN, FILL_TARGET, pourLiquid } from '../src/game/build.ts';
import { fillQuality, judge } from '../src/game/judge.ts';
import { RECIPES, recipeById, type DrinkSpec } from '../src/game/menu.ts';
import { gradeAt } from '../src/game/meters.ts';
import { cloneSpec } from '../src/game/orders.ts';
import { perfectBuild } from './helpers.ts';

const spec = (id: string, size: DrinkSpec['size'] = 'M'): DrinkSpec => cloneSpec({ ...recipeById(id).base, size });

describe('judge', () => {
  it('gives every menu drink three stars when built exactly', () => {
    for (const r of RECIPES) {
      const s = cloneSpec({ ...r.base, size: 'L' });
      const j = judge(s, perfectBuild(s));
      expect(j, r.id).toMatchObject({ accuracy: 1, stars: 3, mistakes: [] });
      expect(j.quality).toBeCloseTo(1);
    }
  });

  it('rejects a drink with no cup', () => {
    const j = judge(spec('velvet'), { size: null, shots: [], liquid: null, pour: 0, iced: false, syrups: {}, toppings: [] });
    expect(j.stars).toBe(0);
    expect(j.mistakes).toEqual(['No cup']);
  });

  it('flags the wrong milk and drops below three stars', () => {
    const s = spec('coconut-cloud');
    const b = perfectBuild({ ...s, liquid: 'oat' });
    const j = judge(s, b);
    expect(j.accuracy).toBeLessThan(1);
    expect(j.stars).toBeLessThan(3);
    expect(j.mistakes).toContain('Oat milk, wanted coconut milk');
  });

  it('treats two milks in one cup as mixed, with a little credit', () => {
    const s = spec('velvet');
    const b = perfectBuild(s);
    pourLiquid(b, 'oat', 0.01);
    expect(b.liquid).toBe('mixed');
    const j = judge(s, b);
    expect(j.mistakes).toContain('Mixed two milks');
    expect(j.accuracy).toBeGreaterThan(0.75);
  });

  it('gives partial credit per missing shot', () => {
    const s = spec('velvet');
    const one = perfectBuild({ ...s, shots: 1 });
    const none = perfectBuild({ ...s, shots: 0 });
    const a1 = judge(s, one).accuracy;
    const a0 = judge(s, none).accuracy;
    expect(a1).toBeLessThan(1);
    expect(a0).toBeLessThan(a1);
    expect(judge(s, one).mistakes[0]).toBe('1 shot, wanted 2');
  });

  it('notices forgotten ice and iced hot drinks', () => {
    expect(judge(spec('blue-hour'), perfectBuild({ ...spec('blue-hour'), iced: false })).mistakes).toContain('Forgot the ice');
    expect(judge(spec('velvet'), perfectBuild({ ...spec('velvet'), iced: true })).mistakes).toContain('Iced a hot drink');
  });

  it('counts syrup pumps and toppings', () => {
    const s = spec('ember');
    const b = perfectBuild({ ...s, syrups: { brownSugar: 1 } });
    addSyrup(b, 'vanilla');
    addTopping(b, 'cinnamon');
    const j = judge(s, b);
    expect(j.mistakes).toEqual(expect.arrayContaining(['1 pump short on brown sugar', 'Extra vanilla', 'Extra cinnamon']));
    expect(j.stars).toBeLessThanOrEqual(1);
  });

  it('wrong size alone still earns two stars', () => {
    const s = spec('velvet', 'L');
    const j = judge(s, perfectBuild({ ...s, size: 'M' }));
    expect(j.stars).toBe(2);
    expect(j.mistakes).toEqual(['Wrong size: Medium for Large']);
  });

  it('marks bad shots and overflowing cups as quality problems', () => {
    const s = spec('velvet');
    const b = perfectBuild({ ...s, shots: 0 });
    addShot(b, gradeAt(0.2, 0.65, 0.09, 0.03));
    addShot(b, gradeAt(1, 0.65, 0.09, 0.03));
    pourLiquid(b, 'whole', 0.3);
    const j = judge(s, b);
    expect(j.accuracy).toBe(1);
    expect(j.quality).toBeLessThan(0.3);
    expect(j.mistakes).toEqual(expect.arrayContaining(['Overflowing cup', 'Sour (under-pulled) shot', 'Bitter (over-pulled) shot']));
    expect(j.stars).toBe(0);
  });
});

describe('fill quality', () => {
  it('peaks at the target and stays high inside the band', () => {
    expect(fillQuality(FILL_TARGET)).toBeCloseTo(1);
    expect(fillQuality(FILL_MIN)).toBeCloseTo(0.85);
    expect(fillQuality(FILL_MAX)).toBeCloseTo(0.85);
  });
  it('falls off outside the band and craters on a spill', () => {
    expect(fillQuality(0.6)).toBeLessThan(0.3);
    expect(fillQuality(0.5)).toBe(0);
    expect(fillQuality(1.05)).toBe(0.1);
  });
});

describe('shot grading', () => {
  it('grades the sweet spot, the zone and the misses', () => {
    expect(gradeAt(0.65, 0.65, 0.09, 0.03)).toEqual({ quality: 1, grade: 'perfect' });
    const good = gradeAt(0.72, 0.65, 0.09, 0.03);
    expect(good.grade).toBe('good');
    expect(good.quality).toBeGreaterThan(0.7);
    expect(gradeAt(0.4, 0.65, 0.09, 0.03).grade).toBe('sour');
    expect(gradeAt(0.85, 0.65, 0.09, 0.03).grade).toBe('bitter');
    expect(gradeAt(1, 0.65, 0.09, 0.03)).toEqual({ quality: 0.15, grade: 'bitter' });
  });
});
