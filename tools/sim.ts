/**
 * Pacing check: plays whole shifts with simulated baristas of different speed
 * and accuracy and prints the outcome spread. Run: node tools/sim.ts
 */
import { addIce, addShot, addSyrup, addTopping, emptyBuild, FILL_TARGET, pourLiquid, SHOT_FILL } from '../src/game/build.ts';
import { SYRUPS, type DrinkSpec } from '../src/game/menu.ts';
import { makeRng, type Rng } from '../src/game/rng.ts';
import { Shift, shiftGrade, type Ticket } from '../src/game/shift.ts';

interface Barista {
  name: string;
  /** Seconds per build step. */
  step: number;
  /** Seconds per shot including reaction. */
  shot: number;
  /** Chance of a wrong ingredient per drink. */
  slip: number;
  /** Std-dev of shot stop error (in needle units) and fill error. */
  aim: number;
}

const BARISTAS: Barista[] = [
  { name: 'first-timer', step: 1.4, shot: 2.6, slip: 0.25, aim: 0.09 },
  { name: 'casual', step: 0.9, shot: 2.0, slip: 0.12, aim: 0.06 },
  { name: 'good', step: 0.6, shot: 1.6, slip: 0.05, aim: 0.035 },
  { name: 'expert', step: 0.4, shot: 1.35, slip: 0.02, aim: 0.02 },
];

function gauss(rng: Rng): number {
  return Math.sqrt(-2 * Math.log(rng() + 1e-9)) * Math.cos(2 * Math.PI * rng());
}

function buildTime(spec: DrinkSpec, b: Barista): number {
  const pumps = SYRUPS.reduce((n, s) => n + (spec.syrups[s] ?? 0), 0);
  return b.step * (3 + pumps + spec.toppings.length + (spec.iced ? 1 : 0)) + spec.shots * b.shot + 1.4;
}

function make(spec: DrinkSpec, b: Barista, rng: Rng) {
  const out = emptyBuild();
  out.size = spec.size;
  let shots = spec.shots;
  if (rng() < b.slip / 3) shots += rng() < 0.5 ? -1 : 1;
  for (let i = 0; i < Math.max(0, shots); i++) {
    const err = gauss(rng) * b.aim;
    const d = Math.abs(err);
    const grade = d <= 0.03 ? 'perfect' : d <= 0.085 ? 'good' : err < 0 ? 'sour' : 'bitter';
    const quality = grade === 'perfect' ? 1 : grade === 'good' ? 1 - 0.3 * ((d - 0.03) / 0.055) : Math.max(0.15, 0.6 - (d - 0.085) * 1.8);
    addShot(out, { quality, grade });
  }
  if (spec.iced !== rng() < b.slip / 3) addIce(out);
  pourLiquid(out, spec.liquid, FILL_TARGET - out.shots.length * SHOT_FILL + gauss(rng) * b.aim);
  for (const s of SYRUPS) for (let i = 0; i < (spec.syrups[s] ?? 0); i++) addSyrup(out, s);
  for (const t of spec.toppings) if (rng() > b.slip / 3) addTopping(out, t);
  return out;
}

function play(b: Barista, seed: number) {
  const shift = new Shift(seed);
  const rng = makeRng(seed ^ 0x9e3779b9);
  let busy = 0;
  let current: Ticket | null = null;
  const dt = 0.05;
  while (!shift.over) {
    shift.update(dt);
    if (current && !shift.tickets.includes(current)) {
      current = null;
      busy = 0;
    }
    if (!current) {
      // Work on the most impatient ticket.
      current = [...shift.tickets].sort((a, c) => a.patience - c.patience)[0] ?? null;
      if (current) busy = buildTime(current.spec, b) * (0.85 + rng() * 0.3);
    } else {
      busy -= dt;
      if (busy <= 0) {
        const res = shift.serve(current.id, make(current.spec, b, rng));
        if (res?.payout.rejected) busy = buildTime(current.spec, b);
        else current = null;
      }
    }
  }
  return shift.stats;
}

for (const b of BARISTAS) {
  const runs = Array.from({ length: 200 }, (_, i) => play(b, 1000 + i));
  const avg = (f: (s: (typeof runs)[number]) => number) => (runs.reduce((a, s) => a + f(s), 0) / runs.length).toFixed(1);
  const grades: Record<string, number> = {};
  for (const s of runs) grades[shiftGrade(s)] = (grades[shiftGrade(s)] ?? 0) + 1;
  console.log(
    `${b.name.padEnd(12)} earn ¥${avg((s) => s.earnings)}  served ${avg((s) => s.served)}  perfect ${avg((s) => s.perfect)}  walkouts ${avg((s) => s.walkouts)}  bestCombo ${avg((s) => s.bestCombo)}  grades ${JSON.stringify(grades)}`,
  );
}
