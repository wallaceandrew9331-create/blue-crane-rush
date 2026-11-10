import { FILL_MAX, FILL_MIN, FILL_SPILL, SHOT_FILL, type Build } from '../game/build.ts';
import type { Liquid, Size, Syrup, Topping } from '../game/menu.ts';
import { needle, type PullMeter } from '../game/meters.ts';

/** What the controller tells the stage each frame. */
export interface StageView {
  build: Build | null;
  pull: PullMeter | null;
  pouring: Liquid | null;
  pourRate: number;
  /** Should the fill band be shown on the cup? */
  wantsFill: boolean;
  time: number;
}

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; size: number;
  color: string; kind: 'drop' | 'steam' | 'spark' | 'flake' | 'star';
  rot?: number; vr?: number;
}

interface Floater { text: string; x: number; y: number; vy: number; life: number; max: number; color: string; size: number; }

interface Cube { rx: number; y: number; vy: number; rot: number; landed: boolean; delay: number; }

interface LeavingCup { build: Build; t: number; kind: 'serve' | 'bin'; x: number; }

const COLORS = {
  espresso: '#3a1f12',
  crema: '#b0703c',
  liquid: { whole: '#fbf6ec', oat: '#f0e0c0', coconut: '#fdfaf2', water: '#d9ecff' } as Record<Liquid, string>,
  syrup: { vanilla: '#f3dc8c', caramel: '#c47a22', osmanthus: '#f4a923', brownSugar: '#5d3218' } as Record<Syrup, string>,
  blue: '#1d3fc4',
  blue2: '#3a63ff',
};

const SIZE_SCALE: Record<Size, number> = { S: 0.74, M: 0.87, L: 1 };

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (p: number, s: number) => (p >> s) & 255;
  const m = (s: number) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t);
  return `rgb(${m(16)},${m(8)},${m(0)})`;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Stage {
  private ctx: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  private cubes: Cube[] = [];
  private leaving: LeavingCup[] = [];
  private dispShots = 0;
  private dispPour = 0;
  private wobble = 0;
  private cupIn = 1;
  private cupSquash = 0;
  private shake = 0;
  private toppingGrow: Partial<Record<Topping, number>> = {};
  private syrupDrip: { color: string; t: number } | null = null;
  private lastBuild: Build | null = null;
  private steamAcc = 0;
  private pitcherTilt = 0;
  private lastPour: Liquid = 'whole';

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2.5, window.devicePixelRatio || 1);
    this.W = Math.max(1, r.width);
    this.H = Math.max(1, r.height);
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
  }

  // ---------- layout ----------
  private layout(size: Size | null) {
    const { W, H } = this;
    const floorY = H - Math.max(16, H * 0.07);
    const maxCupH = Math.max(80, Math.min(H * 0.5, 240, W * 0.48));
    const h = maxCupH * (size ? SIZE_SCALE[size] : SIZE_SCALE.M);
    const cx = W > 640 ? W * 0.56 : W * 0.6;
    const headY = Math.max(44, floorY - maxCupH - 46);
    const topW = h * 0.74;
    const gaugeX = Math.min(W - 22, cx + maxCupH * 0.37 + 34);
    return { floorY, maxCupH, h, cx, headY, topW, botW: topW * 0.7, gaugeX };
  }

  // ---------- events from the controller ----------
  newCup(): void {
    this.cupIn = 0;
    this.dispShots = 0;
    this.dispPour = 0;
    this.cubes = [];
    this.toppingGrow = {};
    this.wobble = 0;
  }

  serveCup(build: Build): void {
    const L = this.layout(build.size);
    this.leaving.push({ build: structuredClone(build), t: 0, kind: 'serve', x: L.cx });
    this.lastBuild = null;
  }

  binCup(build: Build): void {
    const L = this.layout(build.size);
    this.leaving.push({ build: structuredClone(build), t: 0, kind: 'bin', x: L.cx });
    this.lastBuild = null;
  }

  dropIce(): void {
    this.cubes = Array.from({ length: 5 }, (_, i) => ({
      rx: [-0.22, 0.2, -0.05, 0.27, -0.28][i]!,
      y: -rand(60, 140) - i * 26,
      vy: 0,
      rot: rand(-0.5, 0.5),
      landed: false,
      delay: i * 0.04,
    }));
  }

  pump(syrup: Syrup): void {
    this.syrupDrip = { color: COLORS.syrup[syrup], t: 0 };
    this.wobble = Math.max(this.wobble, 2);
  }

  topping(t: Topping): void {
    this.toppingGrow[t] = 0;
    const L = this.layout(this.lastBuild?.size ?? 'M');
    const top = L.floorY - L.h;
    if (t === 'cinnamon' || t === 'coconutFlakes') {
      for (let i = 0; i < 26; i++) {
        this.particles.push({
          x: L.cx + rand(-L.topW * 0.3, L.topW * 0.3), y: top - rand(30, 90), vx: rand(-10, 10), vy: rand(20, 80),
          life: 0, max: rand(0.35, 0.6), size: t === 'cinnamon' ? rand(1.2, 2.2) : rand(2, 4),
          color: t === 'cinnamon' ? '#8a4a20' : Math.random() < 0.5 ? '#ffffff' : '#dcc39a', kind: 'flake', rot: rand(0, 6), vr: rand(-8, 8),
        });
      }
    }
  }

  shotDone(): void {
    this.wobble = Math.max(this.wobble, 3);
  }

  float(text: string, color = COLORS.blue, size = 22, dy = 0): void {
    const L = this.layout(this.lastBuild?.size ?? 'M');
    this.floaters.push({ text, x: L.cx, y: L.floorY - L.h - 24 + dy, vy: -36, life: 0, max: 1.3, color, size });
  }

  stars(n: number): void {
    const L = this.layout('M');
    for (let i = 0; i < 18 + n * 10; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(90, 260);
      this.particles.push({
        x: L.cx + 40, y: L.floorY - L.h * 0.6, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80,
        life: 0, max: rand(0.5, 0.9), size: rand(3, 6), color: i % 3 === 0 ? COLORS.blue2 : '#ffbf1f', kind: i % 2 ? 'star' : 'spark',
        rot: rand(0, 6), vr: rand(-6, 6),
      });
    }
  }

  jolt(amount = 8): void {
    this.shake = Math.max(this.shake, amount);
  }

  // ---------- frame ----------
  frame(dt: number, v: StageView): void {
    const { ctx } = this;
    const b = v.build;
    if (b && b !== this.lastBuild) this.lastBuild = b;
    this.step(dt, v);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    if (this.shake > 0.1) ctx.translate(rand(-1, 1) * this.shake, rand(-1, 1) * this.shake);

    const L = this.layout(b?.size ?? null);
    this.drawBackdrop(L);
    this.drawMachine(L, v);

    for (const lc of this.leaving) this.drawLeaving(lc);

    if (b && b.size) {
      const slide = 1 - this.easeOutBack(this.cupIn);
      const x = L.cx - slide * (L.cx + L.topW);
      this.drawStreams(L, v, x);
      this.drawCup(b, x, L.floorY, L.h, { lid: 0, alpha: 1, squash: this.cupSquash, live: true, wantsFill: v.wantsFill, time: v.time });
    } else if (this.leaving.length === 0) {
      this.drawGhostCup(L);
    }

    this.drawPitcher(L, v);
    this.drawGauge(L, v);
    this.drawParticles();
    this.drawFloaters();
  }

  private easeOutBack(t: number): number {
    const c1 = 1.5;
    const c3 = c1 + 1;
    const x = Math.min(1, Math.max(0, t));
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  }

  private step(dt: number, v: StageView): void {
    const b = v.build;
    const L = this.layout(b?.size ?? null);
    if (this.cupIn < 1) {
      const before = this.cupIn;
      this.cupIn = Math.min(1, this.cupIn + dt * 3.2);
      if (before < 0.75 && this.cupIn >= 0.75) this.cupSquash = 1;
    }
    this.cupSquash = Math.max(0, this.cupSquash - dt * 4);
    this.shake = Math.max(0, this.shake - dt * 40);
    this.wobble = Math.max(0, this.wobble - dt * 3);

    if (b) {
      const ts = b.shots.length;
      this.dispShots += (ts - this.dispShots) * Math.min(1, dt * 5);
      this.dispPour += (b.pour - this.dispPour) * Math.min(1, dt * 12);
      if (v.pull) {
        // Espresso visibly rises while the needle runs.
        this.dispShots = Math.max(this.dispShots, ts + Math.min(0.9, needle(v.pull)));
      }
    }
    for (const t of Object.keys(this.toppingGrow) as Topping[]) this.toppingGrow[t] = Math.min(1, (this.toppingGrow[t] ?? 0) + dt * 3);
    if (this.syrupDrip) {
      this.syrupDrip.t += dt;
      if (this.syrupDrip.t > 0.6) this.syrupDrip = null;
    }

    // Ice falls under gravity and bounces once into place.
    for (const c of this.cubes) {
      if (c.delay > 0) {
        c.delay -= dt;
        continue;
      }
      if (c.landed) continue;
      c.vy += 1800 * dt;
      c.y += c.vy * dt;
      if (c.y >= 0) {
        if (c.vy > 300) {
          c.vy *= -0.3;
          c.y = 0;
          this.wobble = Math.max(this.wobble, 4);
          for (let i = 0; i < 3; i++) this.splash(L.cx + c.rx * L.topW, L.floorY - L.h * 0.5, '#d9ecff');
        } else {
          c.y = 0;
          c.vy = 0;
          c.landed = true;
        }
      }
    }

    // Leaving cups animate out then disappear.
    for (const lc of this.leaving) lc.t += dt;
    this.leaving = this.leaving.filter((lc) => lc.t < 1.1);

    const tilt = v.pouring ? 0.45 + v.pourRate * 0.6 : 0;
    this.pitcherTilt += (tilt - this.pitcherTilt) * Math.min(1, dt * 10);
    if (v.pouring) this.lastPour = v.pouring;

    // Steam off hot drinks and the wand.
    if (b && b.size && !b.iced) {
      const fill = b.shots.length * SHOT_FILL + b.pour;
      const rate = (v.pouring && v.pouring !== 'water' ? 14 : 0) + (fill > 0.25 ? 3.5 : 0);
      this.steamAcc += rate * dt;
      while (this.steamAcc > 1) {
        this.steamAcc -= 1;
        this.particles.push({
          x: L.cx + rand(-L.topW * 0.25, L.topW * 0.25), y: L.floorY - L.h - 6, vx: rand(-5, 5), vy: rand(-34, -18),
          life: 0, max: rand(1.2, 2), size: rand(5, 9), color: '#ffffff', kind: 'steam',
        });
      }
    }

    // Overflowing cups dribble.
    if (b && b.size && b.shots.length * SHOT_FILL + b.pour > FILL_SPILL && Math.random() < dt * 14) {
      const side = Math.random() < 0.5 ? -1 : 1;
      this.particles.push({
        x: L.cx + side * L.topW * 0.5, y: L.floorY - L.h, vx: side * rand(10, 30), vy: rand(0, 40),
        life: 0, max: 0.8, size: rand(2, 3.5), color: b.liquid === 'water' ? '#6b4128' : '#f3e7d2', kind: 'drop',
      });
    }

    for (const p of this.particles) {
      p.life += dt;
      if (p.kind === 'steam') {
        p.vx += Math.sin((p.life + p.x) * 3) * 10 * dt;
        p.size += dt * 10;
      } else if (p.kind === 'drop' || p.kind === 'flake') {
        p.vy += (p.kind === 'flake' ? 500 : 900) * dt;
      } else {
        p.vy += 400 * dt;
        p.vx *= 1 - dt * 2;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.rot !== undefined) p.rot += (p.vr ?? 0) * dt;
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
    if (this.particles.length > 600) this.particles.splice(0, this.particles.length - 600);

    for (const f of this.floaters) {
      f.life += dt;
      f.y += f.vy * dt;
      f.vy *= 1 - dt * 1.5;
    }
    this.floaters = this.floaters.filter((f) => f.life < f.max);
  }

  private splash(x: number, y: number, color: string): void {
    this.particles.push({ x, y, vx: rand(-60, 60), vy: rand(-160, -60), life: 0, max: rand(0.3, 0.5), size: rand(1.5, 3), color, kind: 'drop' });
  }

  // ---------- drawing ----------
  private drawBackdrop(L: ReturnType<Stage['layout']>): void {
    const { ctx, W, H } = this;
    // Faint wall tiles.
    ctx.strokeStyle = 'rgba(29,63,196,0.05)';
    ctx.lineWidth = 1;
    const tile = 28;
    ctx.beginPath();
    for (let y = tile; y < L.floorY; y += tile) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(W, y + 0.5);
    }
    for (let x = (W % tile) / 2; x < W; x += tile) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, L.floorY);
    }
    ctx.stroke();

    // Counter.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, L.floorY, W, H - L.floorY);
    ctx.fillStyle = COLORS.blue;
    ctx.fillRect(0, L.floorY, W, 3);
    // Drip tray.
    const tw = L.maxCupH * 0.95;
    ctx.fillStyle = '#2a3045';
    this.roundRect(L.cx - tw / 2, L.floorY - 6, tw, 10, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    for (let x = L.cx - tw / 2 + 8; x < L.cx + tw / 2 - 4; x += 7) {
      ctx.moveTo(x, L.floorY - 4);
      ctx.lineTo(x, L.floorY + 2);
    }
    ctx.stroke();
  }

  private drawMachine(L: ReturnType<Stage['layout']>, v: StageView): void {
    const { ctx } = this;
    const bw = Math.min(this.W * 0.92, L.maxCupH * 1.9);
    const bodyBottom = L.headY - 16;
    const x0 = L.cx - bw / 2;
    // Body.
    const g = ctx.createLinearGradient(0, 0, 0, bodyBottom);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#e9edf7');
    ctx.fillStyle = g;
    this.roundRect(x0, -20, bw, bodyBottom + 20, 18);
    ctx.fill();
    ctx.strokeStyle = '#dde3f0';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Blue stripe and wordmark.
    ctx.fillStyle = COLORS.blue;
    ctx.fillRect(x0, bodyBottom - 16, bw, 6);
    ctx.fillStyle = 'rgba(29,63,196,0.75)';
    ctx.font = `800 ${Math.max(9, Math.min(12, bw * 0.04))}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    if (bodyBottom > 40) ctx.fillText('B L U E   C R A N E', L.cx, bodyBottom - 24);
    // Chrome side trims.
    const trim = ctx.createLinearGradient(x0, 0, x0 + 14, 0);
    trim.addColorStop(0, '#c9d1e3');
    trim.addColorStop(1, 'rgba(201,209,227,0)');
    ctx.fillStyle = trim;
    ctx.fillRect(x0 + 1, 0, 14, bodyBottom - 18);
    const trimR = ctx.createLinearGradient(x0 + bw - 14, 0, x0 + bw, 0);
    trimR.addColorStop(0, 'rgba(201,209,227,0)');
    trimR.addColorStop(1, '#c9d1e3');
    ctx.fillStyle = trimR;
    ctx.fillRect(x0 + bw - 15, 0, 14, bodyBottom - 18);
    // Shot-timer display and buttons, like a real group head panel.
    if (bodyBottom > 76) {
      const dy = bodyBottom - 66;
      ctx.fillStyle = '#13286f';
      this.roundRect(L.cx - 34, dy, 68, 24, 6);
      ctx.fill();
      ctx.fillStyle = v.pull ? '#9fd0ff' : '#6f8fe8';
      ctx.font = `700 13px ui-monospace, Consolas, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(v.pull ? `${(v.pull.t * 16).toFixed(0).padStart(2, '0')}s` : '93°C', L.cx, dy + 12.5);
      ctx.textBaseline = 'alphabetic';
      for (const side of [-1, 1]) {
        const bx = L.cx + side * 52;
        ctx.fillStyle = v.pull && side === 1 ? COLORS.blue2 : '#ffffff';
        ctx.strokeStyle = '#c9d1e6';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(bx, dy + 12, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    // Pressure gauge.
    if (bodyBottom > 60) {
      const gx = x0 + bw * 0.14;
      const gy = bodyBottom - 54;
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#c9d1e6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(gx, gy, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      const a = -Math.PI * 0.8 + (v.pull ? 1.2 + Math.sin(v.time * 30) * 0.05 : 0.3);
      ctx.strokeStyle = '#ff4d3d';
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + Math.cos(a) * 8, gy + Math.sin(a) * 8);
      ctx.stroke();
    }
    // Group head + portafilter.
    ctx.fillStyle = '#c5ccdc';
    this.roundRect(L.cx - 28, bodyBottom - 2, 56, 14, 4);
    ctx.fill();
    ctx.fillStyle = '#23283a';
    this.roundRect(L.cx - 24, bodyBottom + 10, 48, 12, 5);
    ctx.fill();
    ctx.strokeStyle = '#23283a';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(L.cx - 22, bodyBottom + 16);
    ctx.lineTo(L.cx - 62, bodyBottom + 24);
    ctx.stroke();
    ctx.fillStyle = '#23283a';
    ctx.fillRect(L.cx - 9, bodyBottom + 20, 5, 6);
    ctx.fillRect(L.cx + 4, bodyBottom + 20, 5, 6);
    // Status LED.
    ctx.fillStyle = v.pull ? COLORS.blue2 : '#9aa3bb';
    ctx.beginPath();
    ctx.arc(L.cx + 34, bodyBottom + 4, 3.5, 0, Math.PI * 2);
    ctx.fill();
    if (v.pull) {
      ctx.fillStyle = 'rgba(58,99,255,0.25)';
      ctx.beginPath();
      ctx.arc(L.cx + 34, bodyBottom + 4, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private spoutY(L: ReturnType<Stage['layout']>): number {
    return L.headY - 16 + 26;
  }

  private surfaceY(baseY: number, h: number, fill: number): number {
    return baseY - h * Math.min(1, Math.max(0, fill)) * 0.96 - 3;
  }

  private drawStreams(L: ReturnType<Stage['layout']>, v: StageView, x: number): void {
    const { ctx } = this;
    const b = v.build!;
    const fill = this.dispShots * SHOT_FILL + this.dispPour;
    const surf = this.surfaceY(L.floorY, L.h, fill);
    if (v.pull) {
      const sy = this.spoutY(L);
      const p = needle(v.pull);
      // Thin at first, fullest mid-shot, blonding (lighter) at the end.
      const w = 1.5 + Math.sin(Math.min(1, p) * Math.PI) * 2;
      const col = p > v.pull.zoneCenter + v.pull.zoneHalf ? '#b07a4a' : p < v.pull.zoneCenter - v.pull.zoneHalf ? '#5a2e17' : '#7a4220';
      for (const dx of [-6.5, 6.5]) {
        const wob = Math.sin(v.time * 40 + dx) * 0.6;
        ctx.strokeStyle = col;
        ctx.lineWidth = w;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(L.cx + dx, sy);
        ctx.quadraticCurveTo(L.cx + dx * 0.6 + wob, (sy + surf) / 2, L.cx + dx * 0.3, surf);
        ctx.stroke();
      }
      if (Math.random() < 0.5) this.splash(x + rand(-6, 6), surf, '#6b3a1c');
      this.wobble = Math.max(this.wobble, 1.2);
    }
    if (v.pouring) {
      const lip = this.pitcherLip(L);
      const w = 3 + v.pourRate * 7;
      const col = v.pouring === 'water' ? 'rgba(170,205,240,0.85)' : COLORS.liquid[v.pouring];
      ctx.strokeStyle = v.pouring === 'water' ? 'rgba(110,150,200,0.6)' : 'rgba(160,135,100,0.55)';
      ctx.lineWidth = w + 2;
      ctx.lineCap = 'round';
      const endX = x + L.topW * 0.08;
      ctx.beginPath();
      ctx.moveTo(lip.x, lip.y);
      ctx.quadraticCurveTo(lip.x - 4, lip.y + 20, endX, surf);
      ctx.stroke();
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.stroke();
      if (Math.random() < 0.7) this.splash(endX + rand(-4, 4), surf, v.pouring === 'water' ? '#cfe6ff' : '#fffaf0');
      this.wobble = Math.max(this.wobble, 2 + v.pourRate * 3);
    }
    if (this.syrupDrip) {
      const t = this.syrupDrip.t;
      const sy = this.spoutY(L) + 6;
      const len = Math.min(1, t * 4) * (surf - sy);
      const tail = Math.max(0, (t - 0.25) * 4) * (surf - sy);
      ctx.strokeStyle = this.syrupDrip.color;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - L.topW * 0.15, sy + tail);
      ctx.lineTo(x - L.topW * 0.15, sy + len);
      ctx.stroke();
    }
    void b;
  }

  private pitcherLip(L: ReturnType<Stage['layout']>) {
    const px = L.cx + L.topW * 0.5 + 8;
    const py = L.floorY - L.maxCupH - 4;
    const a = -this.pitcherTilt;
    return { x: px + Math.cos(a + Math.PI) * 18 - Math.sin(a) * -12, y: py + Math.sin(a + Math.PI) * 18 + Math.cos(a) * -12 };
  }

  private drawPitcher(L: ReturnType<Stage['layout']>, v: StageView): void {
    if (this.pitcherTilt < 0.03 && !v.pouring) return;
    const { ctx } = this;
    const px = L.cx + L.topW * 0.5 + 8;
    const py = L.floorY - L.maxCupH - 4;
    const show = Math.min(1, this.pitcherTilt / 0.4);
    ctx.save();
    ctx.globalAlpha = show;
    ctx.translate(px, py);
    ctx.rotate(-this.pitcherTilt);
    const water = this.lastPour === 'water';
    const g = ctx.createLinearGradient(-16, 0, 20, 0);
    if (water) {
      g.addColorStop(0, 'rgba(205,230,255,0.9)');
      g.addColorStop(1, 'rgba(160,200,240,0.9)');
    } else {
      g.addColorStop(0, '#eef1f7');
      g.addColorStop(0.5, '#b9c1d3');
      g.addColorStop(1, '#8e98ad');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-18, -12);
    ctx.lineTo(18, -12);
    ctx.lineTo(22, 30);
    ctx.lineTo(-20, 30);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = water ? 'rgba(120,160,210,0.9)' : '#7d879c';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Spout and handle.
    ctx.beginPath();
    ctx.moveTo(-18, -12);
    ctx.lineTo(-25, -16);
    ctx.lineTo(-16, -6);
    ctx.fillStyle = water ? 'rgba(160,200,240,0.9)' : '#b9c1d3';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(20, -4);
    ctx.quadraticCurveTo(34, 4, 21, 20);
    ctx.stroke();
    if (this.lastPour !== 'water') {
      ctx.fillStyle = COLORS.blue;
      ctx.fillRect(-19, 8, 40, 4);
    }
    ctx.restore();
  }

  private drawGhostCup(L: ReturnType<Stage['layout']>): void {
    const { ctx } = this;
    const h = L.maxCupH * SIZE_SCALE.M;
    const topW = h * 0.74;
    const botW = topW * 0.7;
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(29,63,196,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(L.cx - topW / 2, L.floorY - h);
    ctx.lineTo(L.cx + topW / 2, L.floorY - h);
    ctx.lineTo(L.cx + botW / 2, L.floorY - 6);
    ctx.lineTo(L.cx - botW / 2, L.floorY - 6);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(29,63,196,0.55)';
    ctx.font = `700 13px ${getComputedStyle(document.body).fontFamily}`;
    ctx.textAlign = 'center';
    ctx.fillText('Pick a cup', L.cx, L.floorY - h / 2);
    ctx.font = `500 11px ${getComputedStyle(document.body).fontFamily}`;
    ctx.fillStyle = 'rgba(29,63,196,0.4)';
    ctx.fillText('S · M · L', L.cx, L.floorY - h / 2 + 16);
  }

  private drawLeaving(lc: LeavingCup): void {
    const L = this.layout(lc.build.size);
    if (lc.kind === 'serve') {
      const lid = Math.min(1, lc.t / 0.22);
      const go = Math.max(0, (lc.t - 0.35) / 0.65);
      const e = go * go;
      this.ctx.save();
      this.ctx.globalAlpha = 1 - e;
      this.drawCup(lc.build, lc.x + e * (this.W * 0.6), L.floorY - e * 40, L.h, { lid, alpha: 1, squash: 0, live: false, wantsFill: false, time: 0 });
      this.ctx.restore();
    } else {
      const e = Math.min(1, lc.t / 0.7);
      this.ctx.save();
      this.ctx.globalAlpha = 1 - e;
      this.ctx.translate(lc.x, L.floorY);
      this.ctx.rotate(e * 0.9);
      this.ctx.translate(-lc.x, -L.floorY + e * e * -80 * -1);
      this.drawCup(lc.build, lc.x - e * 30, L.floorY + e * e * 120, L.h, { lid: 0, alpha: 1, squash: 0, live: false, wantsFill: false, time: 0 });
      this.ctx.restore();
    }
  }

  private cupPath(x: number, baseY: number, h: number, inset = 0): void {
    const topW = h * 0.74;
    const botW = topW * 0.7;
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x - topW / 2 + inset, baseY - h);
    ctx.lineTo(x + topW / 2 - inset, baseY - h);
    ctx.lineTo(x + botW / 2 - inset, baseY - inset);
    ctx.lineTo(x - botW / 2 + inset, baseY - inset);
    ctx.closePath();
  }

  private widthAt(h: number, frac: number): number {
    const topW = h * 0.74;
    const botW = topW * 0.7;
    return botW + (topW - botW) * frac;
  }

  private drawCup(
    b: Build,
    x: number,
    baseY: number,
    h: number,
    o: { lid: number; alpha: number; squash: number; live: boolean; wantsFill: boolean; time: number },
  ): void {
    const { ctx } = this;
    ctx.save();
    if (o.squash > 0) {
      const s = Math.sin(o.squash * Math.PI) * 0.08;
      ctx.translate(x, baseY);
      ctx.scale(1 + s, 1 - s);
      ctx.translate(-x, -baseY);
    }
    const topW = h * 0.74;
    const top = baseY - h;
    const iced = b.iced;

    // Cup body (clear plastic or glass).
    this.cupPath(x, baseY, h);
    ctx.fillStyle = iced ? 'rgba(225,236,252,0.55)' : 'rgba(240,244,252,0.7)';
    ctx.fill();

    // Contents, clipped to the inside of the cup.
    ctx.save();
    this.cupPath(x, baseY, h, 3);
    ctx.clip();
    const shotsF = (o.live ? this.dispShots : b.shots.length) * SHOT_FILL;
    const pourF = o.live ? this.dispPour : b.pour;
    const fill = shotsF + pourF;
    const surf = this.surfaceY(baseY, h, fill);
    const innerBottom = baseY - 3;
    const pumps = (Object.entries(b.syrups) as [Syrup, number][]).filter(([, n]) => n > 0);
    const wob = o.live ? this.wobble : 0;
    const surfacePath = () => {
      ctx.beginPath();
      ctx.moveTo(x - topW, innerBottom + 2);
      const t = o.time;
      for (let i = 0; i <= 20; i++) {
        const px = x - topW / 2 + (topW * i) / 20;
        ctx.lineTo(px, surf + Math.sin(px * 0.09 + t * 9) * wob);
      }
      ctx.lineTo(x + topW, innerBottom + 2);
      ctx.closePath();
    };

    if (fill > 0.002) {
      const liquid = b.liquid;
      const espressoRatio = fill > 0 ? shotsF / fill : 0;
      if (liquid === null || pourF < 0.005) {
        ctx.fillStyle = COLORS.espresso;
        surfacePath();
        ctx.fill();
      } else if (liquid === 'water') {
        const c = mix('#2f190e', '#7a4a2a', Math.min(1, (1 - espressoRatio) * 0.7));
        ctx.fillStyle = iced ? c.replace('rgb', 'rgba').replace(')', ',0.88)') : c;
        surfacePath();
        ctx.fill();
      } else {
        const milk = liquid === 'mixed' ? '#f2e7d4' : COLORS.liquid[liquid];
        if (!iced) {
          ctx.fillStyle = mix(milk, '#6a3a1e', Math.min(0.8, espressoRatio * 2.6));
          surfacePath();
          ctx.fill();
        } else {
          // Iced lattes layer: milk below, espresso floating on top.
          const g = ctx.createLinearGradient(0, surf, 0, innerBottom);
          const split = Math.min(0.95, Math.max(0.05, espressoRatio));
          g.addColorStop(0, '#4a2716');
          g.addColorStop(Math.max(0, split - 0.05), '#6b3d22');
          g.addColorStop(Math.min(1, split + 0.12), mix(milk, '#c8a07a', 0.25));
          g.addColorStop(1, milk);
          ctx.fillStyle = g;
          surfacePath();
          ctx.fill();
        }
      }
      // Crema / microfoam line.
      ctx.fillStyle = !iced && b.liquid && b.liquid !== 'water' ? 'rgba(255,250,240,0.85)' : 'rgba(176,112,60,0.75)';
      ctx.fillRect(x - topW / 2, surf - 1 - Math.sin(x * 0.09 + o.time * 9) * wob * 0.3, topW, 4);

      // Syrup at the bottom; brown sugar paints tiger stripes up the walls.
      if (iced && pumps.length) {
        for (const [s, n] of pumps) {
          if (s === 'brownSugar') {
            ctx.strokeStyle = 'rgba(80,40,18,0.75)';
            ctx.lineWidth = 3;
            for (let k = 0; k < 3 + n * 2; k++) {
              const side = k % 2 ? 1 : -1;
              const frac = 0.1 + ((k * 37) % 50) / 100;
              const wx = x + (side * this.widthAt(h, frac)) / 2 - side * 4;
              ctx.beginPath();
              ctx.moveTo(wx, innerBottom);
              for (let yy = 0; yy < h * Math.min(0.9, fill) * 0.85; yy += 8) ctx.lineTo(wx - side * (2 + Math.sin(yy * 0.12 + k) * 3), innerBottom - yy);
              ctx.stroke();
            }
          }
        }
        const total = pumps.reduce((a, [, n]) => a + n, 0);
        const sh = Math.min(fill * h * 0.9, 3 + total * 3);
        const g = ctx.createLinearGradient(0, innerBottom - sh, 0, innerBottom);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(0.6, COLORS.syrup[pumps[0]![0]]);
        g.addColorStop(1, COLORS.syrup[pumps[pumps.length - 1]![0]]);
        ctx.fillStyle = g;
        ctx.fillRect(x - topW / 2, innerBottom - sh, topW, sh);
      }
    }
    ctx.restore();

    // Ice cubes (drawn outside the clip so they can fall in from above).
    if (iced) {
      const cubes = o.live ? this.cubes : this.defaultCubes();
      const cs = topW * 0.2;
      cubes.forEach((c, i) => {
        if (c.delay > 0) return;
        const floatTop = fill > 0.3;
        const restFrac = floatTop ? Math.min(0.92, fill) - 0.08 - (i % 2) * 0.13 : 0.1 + (i % 3) * 0.14;
        const ry = baseY - h * restFrac - cs / 2;
        const cxp = x + c.rx * this.widthAt(h, restFrac) * 0.9;
        ctx.save();
        ctx.translate(cxp, ry + c.y);
        ctx.rotate(c.rot + (floatTop ? Math.sin(o.time * 2 + i) * 0.05 : 0));
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.strokeStyle = 'rgba(150,190,235,0.95)';
        ctx.lineWidth = 1.5;
        this.roundRect(-cs / 2, -cs / 2, cs, cs, cs * 0.22);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        this.roundRect(-cs * 0.32, -cs * 0.32, cs * 0.28, cs * 0.14, 2);
        ctx.fill();
        ctx.restore();
      });
    }

    // Toppings sit on the surface (or bottom), foam can dome over the rim.
    const surfTop = fill > 0.002 ? surf : innerBottom;
    let foamTop = surfTop;
    const grow = (t: Topping) => (o.live ? this.toppingGrow[t] ?? 1 : 1);
    for (const t of ['cheeseFoam', 'milkFoam'] as const) {
      if (!b.toppings.includes(t)) continue;
      const gx = this.easeOutBack(grow(t));
      const fh = h * (t === 'cheeseFoam' ? 0.13 : 0.1) * gx;
      const frac = Math.min(1, (baseY - foamTop) / h);
      const w = Math.min(topW, this.widthAt(h, frac)) - 6;
      ctx.fillStyle = t === 'cheeseFoam' ? '#fff2cf' : '#ffffff';
      ctx.strokeStyle = t === 'cheeseFoam' ? '#efd9a0' : '#e6e9f2';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x - w / 2, foamTop + 2);
      const bumps = 5;
      for (let i = 0; i < bumps; i++) {
        const x1 = x - w / 2 + (w * i) / bumps;
        const x2 = x - w / 2 + (w * (i + 1)) / bumps;
        ctx.quadraticCurveTo((x1 + x2) / 2, foamTop - fh - (i % 2 ? 3 : 0) * gx, x2, foamTop - fh * 0.55);
      }
      ctx.lineTo(x + w / 2, foamTop + 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (t === 'cheeseFoam') {
        ctx.fillStyle = 'rgba(200,170,110,0.6)';
        for (let i = 0; i < 9; i++) ctx.fillRect(x - w * 0.4 + ((i * 53) % 100) / 100 * w * 0.8, foamTop - fh * 0.5 + ((i * 29) % 10) / 10 * fh * 0.3, 1.5, 1.5);
      }
      foamTop -= fh * 0.85;
    }
    if (b.toppings.includes('cinnamon')) {
      ctx.fillStyle = '#8a4a20';
      const n = Math.round(30 * grow('cinnamon'));
      for (let i = 0; i < n; i++) {
        const px = x + (((i * 61) % 100) / 100 - 0.5) * topW * 0.75;
        ctx.fillRect(px, foamTop - 2 + ((i * 17) % 5) - 2, 1.8, 1.8);
      }
    }
    if (b.toppings.includes('coconutFlakes')) {
      const n = Math.round(14 * grow('coconutFlakes'));
      for (let i = 0; i < n; i++) {
        const px = x + (((i * 43) % 100) / 100 - 0.5) * topW * 0.75;
        ctx.save();
        ctx.translate(px, foamTop - 2 + ((i * 7) % 4) - 2);
        ctx.rotate(i * 1.3);
        ctx.fillStyle = i % 2 ? '#ffffff' : '#e2c79c';
        ctx.fillRect(-3.5, -1.2, 7, 2.4);
        ctx.restore();
      }
    }

    // Cup outline, rim and glare.
    this.cupPath(x, baseY, h);
    ctx.strokeStyle = iced ? 'rgba(130,160,210,0.9)' : 'rgba(150,165,200,0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.moveTo(x - topW / 2 + 8, top + 6);
    ctx.lineTo(x - topW / 2 + 15, top + 6);
    ctx.lineTo(x - topW * 0.35 / 1.0 + 10, baseY - 10);
    ctx.lineTo(x - topW * 0.35 + 5, baseY - 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = iced ? 'rgba(130,160,210,0.9)' : '#ffffff';
    this.roundRect(x - topW / 2 - 3, top - 3, topW + 6, 5, 2.5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,165,200,0.9)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (!iced) {
      // Blue cardboard sleeve with the crane mark.
      const s0 = 0.16;
      const s1 = 0.42;
      const w0 = this.widthAt(h, s0);
      const w1 = this.widthAt(h, s1);
      const y0 = baseY - h * s0;
      const y1 = baseY - h * s1;
      ctx.fillStyle = COLORS.blue;
      ctx.beginPath();
      ctx.moveTo(x - w1 / 2 - 1, y1);
      ctx.lineTo(x + w1 / 2 + 1, y1);
      ctx.lineTo(x + w0 / 2 + 1, y0);
      ctx.lineTo(x - w0 / 2 - 1, y0);
      ctx.closePath();
      ctx.fill();
      this.drawMark(x, (y0 + y1) / 2, (y0 - y1) * 0.36, '#ffffff', COLORS.blue);
    } else {
      this.drawMark(x, baseY - h * 0.3, h * 0.07, COLORS.blue, '#ffffff');
      // Condensation.
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      for (let i = 0; i < 9; i++) {
        const fy = 0.15 + ((i * 37) % 70) / 100;
        const wx = this.widthAt(h, fy);
        ctx.beginPath();
        ctx.arc(x + (((i * 71) % 100) / 100 - 0.5) * wx * 0.8, baseY - h * fy, 1.4 + (i % 3) * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Fill guide: two ticks on the cup wall.
    if (o.wantsFill && o.live) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(58,99,255,0.7)';
      ctx.lineWidth = 1.5;
      for (const f of [FILL_MIN, FILL_MAX]) {
        const yy = this.surfaceY(baseY, h, f);
        const ww = this.widthAt(h, (baseY - yy) / h);
        ctx.beginPath();
        ctx.moveTo(x - ww / 2 + 2, yy);
        ctx.lineTo(x + ww / 2 - 2, yy);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Lid on serve.
    if (o.lid > 0) {
      const ly = top - 3 - (1 - this.easeOutBack(o.lid)) * 50;
      ctx.globalAlpha *= Math.min(1, o.lid * 2);
      if (iced) {
        ctx.fillStyle = 'rgba(225,236,252,0.85)';
        ctx.strokeStyle = 'rgba(130,160,210,0.95)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(x, ly, topW / 2 + 4, topW * 0.2, 0, Math.PI, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = COLORS.blue;
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x + topW * 0.08, ly - topW * 0.12);
        ctx.lineTo(x + topW * 0.2, ly - topW * 0.62);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#cfd6e6';
        ctx.lineWidth = 1.5;
        this.roundRect(x - topW / 2 - 5, ly - 6, topW + 10, 9, 4);
        ctx.fill();
        ctx.stroke();
        this.roundRect(x - topW / 2 + 4, ly - 14, topW - 8, 9, 4);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private defaultCubes(): Cube[] {
    return [-0.22, 0.2, -0.05, 0.27, -0.28].map((rx, i) => ({ rx, y: 0, vy: 0, rot: (i - 2) * 0.2, landed: true, delay: 0 }));
  }

  /** The brand mark: a disc with a white crane neck and a red crown. */
  private drawMark(x: number, y: number, r: number, disc: string, line: string): void {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    const k = r / 31;
    ctx.translate(x - 32 * k, y - 32 * k);
    ctx.scale(k, k);
    ctx.strokeStyle = line;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(20, 50);
    ctx.bezierCurveTo(22, 36, 40, 36, 36, 24);
    ctx.bezierCurveTo(34, 18, 28, 18, 27, 22);
    ctx.stroke();
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(27, 22);
    ctx.lineTo(16, 27);
    ctx.stroke();
    ctx.fillStyle = '#ff4d3d';
    ctx.beginPath();
    ctx.arc(30.5, 17.5, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawGauge(L: ReturnType<Stage['layout']>, v: StageView): void {
    const { ctx } = this;
    const x = L.gaugeX;
    const y0 = L.floorY - L.maxCupH * 0.95;
    const y1 = L.floorY - 14;
    const hgt = y1 - y0;
    const w = 14;
    const active = !!v.pull || !!v.pouring;
    ctx.save();
    ctx.globalAlpha = active ? 1 : v.build?.size ? 0.55 : 0.25;
    ctx.fillStyle = '#e3e8f4';
    this.roundRect(x - w / 2, y0, w, hgt, 7);
    ctx.fill();
    const font = getComputedStyle(document.body).fontFamily;
    ctx.font = `800 9px ${font}`;
    ctx.textAlign = 'center';
    if (v.pull) {
      const m = v.pull;
      const zy = (f: number) => y1 - f * hgt;
      ctx.fillStyle = 'rgba(58,99,255,0.35)';
      ctx.fillRect(x - w / 2, zy(m.zoneCenter + m.zoneHalf), w, m.zoneHalf * 2 * hgt);
      ctx.fillStyle = '#ffbf1f';
      ctx.fillRect(x - w / 2, zy(m.zoneCenter + m.perfectHalf), w, m.perfectHalf * 2 * hgt);
      const ny = zy(needle(m));
      ctx.fillStyle = '#3a1f12';
      this.roundRect(x - w / 2, ny, w, y1 - ny, Math.min(7, (y1 - ny) / 2));
      ctx.globalAlpha = 0.5;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#101831';
      ctx.beginPath();
      ctx.moveTo(x - w / 2 - 8, ny - 5);
      ctx.lineTo(x - w / 2 - 1, ny);
      ctx.lineTo(x - w / 2 - 8, ny + 5);
      ctx.fill();
      ctx.fillRect(x - w / 2 - 1, ny - 1.5, w + 2, 3);
      ctx.fillStyle = COLORS.blue;
      ctx.fillText('PULL', x, y0 - 6);
    } else {
      const b = v.build;
      const f = b ? b.shots.length * SHOT_FILL + this.dispPour : 0;
      const scale = 1.1;
      const zy = (ff: number) => y1 - (ff / scale) * hgt;
      ctx.fillStyle = 'rgba(58,99,255,0.3)';
      ctx.fillRect(x - w / 2, zy(FILL_MAX), w, zy(FILL_MIN) - zy(FILL_MAX));
      const fy = zy(Math.min(scale, f));
      const inBand = f >= FILL_MIN && f <= FILL_MAX;
      ctx.fillStyle = f > FILL_SPILL ? '#ff4d3d' : inBand ? COLORS.blue2 : '#9aa3bb';
      this.roundRect(x - w / 2 + 2, fy, w - 4, Math.max(0, y1 - fy - 2), 5);
      ctx.fill();
      ctx.fillStyle = COLORS.blue;
      ctx.fillText('FILL', x, y0 - 6);
    }
    ctx.restore();
  }

  private drawParticles(): void {
    const { ctx } = this;
    for (const p of this.particles) {
      const a = 1 - p.life / p.max;
      if (p.kind === 'steam') {
        // Soft grey-white puffs: visible against the pale wall without outlines.
        const al = 0.22 * a * Math.min(1, p.life * 3);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        g.addColorStop(0, `rgba(170,182,210,${al})`);
        g.addColorStop(1, 'rgba(170,182,210,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.globalAlpha = Math.min(1, a * 1.5);
      ctx.fillStyle = p.color;
      if (p.kind === 'star') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot ?? 0);
        this.starPath(p.size * 1.6);
        ctx.fill();
        ctx.restore();
      } else if (p.kind === 'flake') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot ?? 0);
        ctx.fillRect(-p.size, -p.size * 0.35, p.size * 2, p.size * 0.7);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  private starPath(r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? r * 0.45 : r;
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
  }

  private drawFloaters(): void {
    const { ctx } = this;
    const font = getComputedStyle(document.body).fontFamily;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of this.floaters) {
      const a = f.life < 0.15 ? f.life / 0.15 : Math.max(0, 1 - (f.life - 0.8) / (f.max - 0.8));
      const pop = f.life < 0.15 ? 0.6 + (f.life / 0.15) * 0.5 : 1.1 - Math.min(0.1, (f.life - 0.15) * 0.5);
      ctx.save();
      ctx.globalAlpha = Math.min(1, a);
      ctx.translate(f.x, f.y);
      ctx.scale(pop, pop);
      ctx.font = `900 ${f.size}px ${font}`;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineJoin = 'round';
      ctx.strokeText(f.text, 0, 0);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, 0, 0);
      ctx.restore();
    }
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.roundRect(x, y, w, Math.max(0, h), Math.max(0, Math.min(r, w / 2, Math.abs(h) / 2)));
  }
}
