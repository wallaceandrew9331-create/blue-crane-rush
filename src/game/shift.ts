import type { Build } from './build.ts';
import { judge, type Judgement } from './judge.ts';
import type { DrinkSpec, Recipe } from './menu.ts';
import { generateOrder, knobsFor, type Mod } from './orders.ts';
import { pick, makeRng, type Rng } from './rng.ts';
import { payout, type Payout } from './scoring.ts';

export const SHIFT_SECONDS = 120;

const NAMES = [
  'Mei', 'Jun', 'Ava', 'Leo', 'Yan', 'Noor', 'Kai', 'Lin', 'Sora', 'Theo', 'Hana', 'Ravi', 'Zoe', 'Bo', 'Ines', 'Wen',
  'Omar', 'Lu', 'Ezra', 'Yuki', 'Tao', 'Mila', 'Sam', 'Xin', 'Ari', 'Pia', 'Hao', 'Nia', 'Felix', 'Qi',
];

export interface Ticket {
  id: number;
  /** Pickup code shown on the ticket, e.g. "A017". */
  code: string;
  customer: string;
  recipe: Recipe;
  spec: DrinkSpec;
  mods: Mod[];
  price: number;
  patience: number;
  patienceMax: number;
}

export interface ServeResult {
  ticket: Ticket;
  judgement: Judgement;
  payout: Payout;
  patienceLeft: number;
}

export type ShiftEvent =
  | { type: 'spawn'; ticket: Ticket }
  | { type: 'walkout'; ticket: Ticket }
  | { type: 'warning'; secondsLeft: number }
  | { type: 'end' };

export interface ShiftStats {
  earnings: number;
  tips: number;
  served: number;
  perfect: number;
  walkouts: number;
  remakes: number;
  combo: number;
  bestCombo: number;
  starsTotal: number;
}

/** Difficulty knobs as a function of shift progress (0..1). */
export function pacing(level: number) {
  const l = Math.min(1, Math.max(0, level));
  return {
    spawnInterval: 10 - 5.5 * l,
    maxTickets: l < 0.15 ? 2 : l < 0.45 ? 3 : l < 0.75 ? 4 : 5,
    patience: 50 - 20 * l,
  };
}

/** Rough build effort, used to give fiddly tickets a little more patience. */
export function complexity(spec: DrinkSpec, mods: readonly Mod[]): number {
  const pumps = Object.values(spec.syrups).reduce((a, b) => a + (b ?? 0), 0);
  return spec.shots + pumps + spec.toppings.length + (spec.iced ? 1 : 0) + mods.length;
}

export class Shift {
  readonly duration: number;
  time = 0;
  tickets: Ticket[] = [];
  stats: ShiftStats = { earnings: 0, tips: 0, served: 0, perfect: 0, walkouts: 0, remakes: 0, combo: 0, bestCombo: 0, starsTotal: 0 };
  over = false;
  private nextSpawn = 0;
  private nextId = 1;
  private recent: string[] = [];
  private lastWarn = Infinity;
  readonly rng: Rng;

  constructor(seed: number, duration = SHIFT_SECONDS) {
    this.rng = makeRng(seed);
    this.duration = duration;
    this.nextId = 1 + Math.floor(this.rng() * 40);
  }

  get level(): number {
    return Math.min(1, this.time / this.duration);
  }

  get timeLeft(): number {
    return Math.max(0, this.duration - this.time);
  }

  update(dt: number): ShiftEvent[] {
    const events: ShiftEvent[] = [];
    if (this.over) return events;
    this.time += dt;

    for (const t of [...this.tickets]) {
      t.patience -= dt;
      if (t.patience <= 0) {
        this.tickets = this.tickets.filter((x) => x !== t);
        this.stats.walkouts += 1;
        this.stats.combo = 0;
        events.push({ type: 'walkout', ticket: t });
      }
    }

    const p = pacing(this.level);
    this.nextSpawn -= dt;
    // An empty counter gets a customer quickly; nobody should stand around idle.
    if (this.tickets.length === 0 && this.nextSpawn > 1.2) this.nextSpawn = 1.2;
    if (this.nextSpawn <= 0 && this.tickets.length < p.maxTickets && this.timeLeft > 6) {
      const ticket = this.spawn();
      events.push({ type: 'spawn', ticket });
      this.nextSpawn = p.spawnInterval * (0.8 + this.rng() * 0.4);
    }

    const left = Math.ceil(this.timeLeft);
    if (left <= 10 && left < this.lastWarn && left > 0) {
      this.lastWarn = left;
      events.push({ type: 'warning', secondsLeft: left });
    }

    if (this.timeLeft <= 0) {
      this.over = true;
      events.push({ type: 'end' });
    }
    return events;
  }

  spawn(): Ticket {
    const draft = generateOrder(this.rng, knobsFor(this.level), this.recent);
    this.recent = [draft.recipe.id, ...this.recent].slice(0, 2);
    const p = pacing(this.level);
    const patienceMax = p.patience + 2 * complexity(draft.spec, draft.mods);
    const id = this.nextId++;
    const ticket: Ticket = {
      id,
      code: `A${String(id).padStart(3, '0')}`,
      customer: pick(this.rng, NAMES),
      recipe: draft.recipe,
      spec: draft.spec,
      mods: draft.mods,
      price: draft.price,
      patience: patienceMax,
      patienceMax,
    };
    this.tickets.push(ticket);
    return ticket;
  }

  /** Hand a drink to a ticket's customer. A remake (0 stars) keeps them waiting. */
  serve(ticketId: number, build: Build): ServeResult | null {
    const ticket = this.tickets.find((t) => t.id === ticketId);
    if (!ticket || this.over) return null;
    const judgement = judge(ticket.spec, build);
    const patienceLeft = ticket.patience / ticket.patienceMax;
    const pay = payout(ticket.price, judgement, patienceLeft, this.stats.combo);
    this.stats.combo = pay.combo;
    this.stats.bestCombo = Math.max(this.stats.bestCombo, pay.combo);
    if (pay.rejected) {
      this.stats.remakes += 1;
      // A bad drink costs the customer's goodwill.
      ticket.patience = Math.max(0.5, ticket.patience - 6);
    } else {
      this.tickets = this.tickets.filter((t) => t !== ticket);
      this.stats.served += 1;
      this.stats.earnings = Math.round((this.stats.earnings + pay.total) * 10) / 10;
      this.stats.tips = Math.round((this.stats.tips + pay.tip) * 10) / 10;
      this.stats.starsTotal += judgement.stars;
      if (judgement.stars === 3) this.stats.perfect += 1;
    }
    return { ticket, judgement, payout: pay, patienceLeft };
  }
}

/** Letter grade for a finished shift. */
export function shiftGrade(stats: ShiftStats): 'S' | 'A' | 'B' | 'C' | 'D' {
  const e = stats.earnings - stats.walkouts * 8;
  if (e >= 420) return 'S';
  if (e >= 290) return 'A';
  if (e >= 180) return 'B';
  if (e >= 90) return 'C';
  return 'D';
}
