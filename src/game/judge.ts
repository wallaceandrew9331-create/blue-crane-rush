import { FILL_MAX, FILL_MIN, FILL_SPILL, FILL_TARGET, totalFill, type Build } from './build.ts';
import { LABELS, SYRUPS, TOPPINGS, type DrinkSpec } from './menu.ts';

/** How well a served drink matched its ticket. */
export interface Judgement {
  /** Did the right things go in the cup? 0..1 */
  accuracy: number;
  /** How well were they made (shot timing, fill level)? 0..1 */
  quality: number;
  /** 0 = rejected, 3 = perfect. */
  stars: 0 | 1 | 2 | 3;
  /** Human-readable problems, most important first. */
  mistakes: string[];
}

const WEIGHTS = { size: 1, shots: 2, liquid: 2, iced: 1.5, syrups: 1.5, toppings: 1.5 };
const WEIGHT_SUM = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

/** 1 at the fill target, ~0.85 at the band edges, falling to 0 a quarter-cup away. */
export function fillQuality(fill: number): number {
  if (fill > FILL_SPILL) return 0.1;
  if (fill >= FILL_MIN && fill <= FILL_MAX) {
    const half = (FILL_MAX - FILL_MIN) / 2;
    return 1 - 0.15 * (Math.abs(fill - FILL_TARGET) / half);
  }
  const d = fill < FILL_MIN ? FILL_MIN - fill : fill - FILL_MAX;
  return Math.max(0, 0.85 - d * 3.4);
}

export function judge(spec: DrinkSpec, b: Build): Judgement {
  const mistakes: string[] = [];
  if (b.size === null) return { accuracy: 0, quality: 0, stars: 0, mistakes: ['No cup'] };

  let score = 0;

  // Size
  if (b.size === spec.size) score += WEIGHTS.size;
  else mistakes.push(`Wrong size: ${LABELS.size[b.size]} for ${LABELS.size[spec.size]}`);

  // Shots: partial credit, one off costs half.
  const shotDiff = Math.abs(b.shots.length - spec.shots);
  score += WEIGHTS.shots * Math.max(0, 1 - shotDiff * 0.5);
  if (shotDiff > 0) mistakes.push(`${b.shots.length} shot${b.shots.length === 1 ? '' : 's'}, wanted ${spec.shots}`);

  // Milk / water
  if (b.liquid === spec.liquid) score += WEIGHTS.liquid;
  else if (b.liquid === null) mistakes.push(`No ${LABELS.liquid[spec.liquid].toLowerCase()}`);
  else if (b.liquid === 'mixed') {
    score += WEIGHTS.liquid * 0.25;
    mistakes.push('Mixed two milks');
  } else mistakes.push(`${LABELS.liquid[b.liquid]}, wanted ${LABELS.liquid[spec.liquid].toLowerCase()}`);

  // Hot / iced
  if (b.iced === spec.iced) score += WEIGHTS.iced;
  else mistakes.push(spec.iced ? 'Forgot the ice' : 'Iced a hot drink');

  // Syrups: each pump off costs half.
  let pumpDiff = 0;
  for (const s of SYRUPS) {
    const want = spec.syrups[s] ?? 0;
    const got = b.syrups[s] ?? 0;
    if (want !== got) {
      pumpDiff += Math.abs(want - got);
      mistakes.push(got < want ? `${want - got} pump${want - got > 1 ? 's' : ''} short on ${LABELS.syrup[s].toLowerCase()}` : `Extra ${LABELS.syrup[s].toLowerCase()}`);
    }
  }
  score += WEIGHTS.syrups * Math.max(0, 1 - pumpDiff * 0.5);

  // Toppings: each missing or extra one costs half.
  let topDiff = 0;
  for (const t of TOPPINGS) {
    const want = spec.toppings.includes(t);
    const got = b.toppings.includes(t);
    if (want !== got) {
      topDiff += 1;
      mistakes.push(want ? `Missing ${LABELS.topping[t].toLowerCase()}` : `Extra ${LABELS.topping[t].toLowerCase()}`);
    }
  }
  score += WEIGHTS.toppings * Math.max(0, 1 - topDiff * 0.5);

  const accuracy = score / WEIGHT_SUM;

  // Craft: shot timing and how full the cup is.
  const fill = totalFill(b);
  const fq = fillQuality(fill);
  if (fill > FILL_SPILL) mistakes.push('Overflowing cup');
  else if (fill < FILL_MIN - 0.04) mistakes.push('Cup underfilled');
  else if (fill > FILL_MAX + 0.04) mistakes.push('Filled too high');
  const sq = b.shots.length > 0 ? b.shots.reduce((sum, s) => sum + s.quality, 0) / b.shots.length : spec.shots === 0 ? 1 : 0;
  const quality = 0.5 * fq + 0.5 * sq;
  if (b.shots.some((s) => s.grade === 'sour')) mistakes.push('Sour (under-pulled) shot');
  if (b.shots.some((s) => s.grade === 'bitter')) mistakes.push('Bitter (over-pulled) shot');

  let stars: Judgement['stars'] = 0;
  if (accuracy >= 0.999 && quality >= 0.85) stars = 3;
  else if (accuracy >= 0.85 && quality >= 0.55) stars = 2;
  else if (accuracy >= 0.7 && quality >= 0.25) stars = 1;
  if (stars === 0 && mistakes.length === 0) mistakes.push('Poorly made');

  return { accuracy, quality, stars, mistakes };
}
