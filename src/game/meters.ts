import type { PullGrade, ShotPull } from './build.ts';
import type { Rng } from './rng.ts';

/**
 * The espresso meter: a needle sweeps 0 → 1 over `duration` seconds and the
 * player taps to stop it inside a sweet-spot zone. Letting it run out is an
 * over-extracted (bitter) shot.
 */
export interface PullMeter {
  t: number;
  duration: number;
  zoneCenter: number;
  zoneHalf: number;
  perfectHalf: number;
}

export function newPullMeter(rng: Rng, level: number): PullMeter {
  const l = Math.min(1, Math.max(0, level));
  return {
    t: 0,
    duration: 1.7 - 0.45 * l,
    zoneCenter: 0.56 + rng() * 0.24,
    zoneHalf: 0.1 - 0.025 * l,
    perfectHalf: 0.035 - 0.008 * l,
  };
}

export function needle(m: PullMeter): number {
  return Math.min(1, m.t / m.duration);
}

/** Advance; returns true when the needle has hit the end on its own. */
export function stepPull(m: PullMeter, dt: number): boolean {
  m.t += dt;
  return needle(m) >= 1;
}

export function gradePull(m: PullMeter): ShotPull {
  return gradeAt(needle(m), m.zoneCenter, m.zoneHalf, m.perfectHalf);
}

export function gradeAt(p: number, center: number, half: number, perfectHalf: number): ShotPull {
  const d = Math.abs(p - center);
  if (p >= 1) return { quality: 0.15, grade: 'bitter' };
  if (d <= perfectHalf) return { quality: 1, grade: 'perfect' };
  if (d <= half) return { quality: 1 - 0.3 * ((d - perfectHalf) / (half - perfectHalf)), grade: 'good' };
  const grade: PullGrade = p < center ? 'sour' : 'bitter';
  return { quality: Math.max(0.15, 0.6 - (d - half) * 1.8), grade };
}

/**
 * Pouring speeds up the longer the key is held, like a jug tipping further,
 * so short taps are good for topping up and long holds overshoot.
 */
export function pourRate(holdSeconds: number): number {
  return Math.min(0.85, 0.22 + 0.55 * holdSeconds);
}
