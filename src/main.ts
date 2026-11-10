import './style.css';
import { addIce, addShot, addSyrup, addTopping, canAddShot, emptyBuild, pourLiquid, type Build } from './game/build.ts';
import { LABELS, type Liquid, type Size, type Syrup, type Topping } from './game/menu.ts';
import { gradePull, newPullMeter, pourRate, stepPull, type PullMeter } from './game/meters.ts';
import { comboMultiplier } from './game/scoring.ts';
import { Shift, shiftGrade, type ServeResult, type Ticket } from './game/shift.ts';
import { Sound } from './ui/audio.ts';
import { Hud } from './ui/hud.ts';
import { Stage } from './ui/stage.ts';

type Mode = 'title' | 'playing' | 'paused' | 'over';
type Loop = { stop: () => void };

const sound = new Sound();
const stage = new Stage(document.querySelector<HTMLCanvasElement>('#stage')!);
const hud = new Hud((id) => pickTicket(id));

let mode: Mode = 'title';
let shift = new Shift(Date.now() >>> 0);
let build: Build = emptyBuild();
let activeId: number | null = null;
let pull: PullMeter | null = null;
let pullLoop: Loop | null = null;
let pour: { liquid: Liquid; hold: number; loop: Loop } | null = null;
let clock = 0;
let seen = new Set<string>();

const BEST_KEY = 'bcr-best';
function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}
function saveBest(v: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch {
    /* storage blocked */
  }
}

// ---------- screens ----------
function titleScreen(): void {
  mode = 'title';
  const best = loadBest();
  hud.show(`
    <img class="big-logo" src="./favicon.svg" alt="Blue Crane logo" />
    <h1>Blue Crane <span>Rush</span></h1>
    <p class="sub">蓝鹤咖啡 · a two-minute morning shift</p>
    <div class="how"><ol>
      <li><b>Pick a cup</b> for the selected ticket. <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd></li>
      <li><b>Pull shots:</b> tap to start, tap again in the gold zone. <kbd>Space</kbd></li>
      <li><b>Hold to pour</b> milk or water up to the dashed line. <kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd><kbd>R</kbd></li>
      <li>Add syrup, ice and toppings, then <b>Serve</b>. <kbd>Enter</kbd></li>
    </ol></div>
    <button class="primary" data-go="start">Start shift</button>
    ${best > 0 ? `<div class="best">Best shift: ¥${best.toFixed(1)}</div>` : ''}
    <div class="fine">Fast, perfect drinks earn tips and build a combo. Blue Crane is a fictional café.</div>`);
}

function pauseScreen(): void {
  if (mode !== 'playing') return;
  mode = 'paused';
  stopPour();
  hud.show(`
    <h1>Paused</h1>
    <p class="sub">${Math.ceil(shift.timeLeft)} seconds left on the clock</p>
    <button class="primary" data-go="resume">Resume</button>
    <button class="secondary" data-go="menu">Quit to menu</button>`);
}

function endScreen(): void {
  mode = 'over';
  stopPour();
  pullLoop?.stop();
  pullLoop = null;
  pull = null;
  sound.end();
  const s = shift.stats;
  const grade = shiftGrade(s);
  const best = loadBest();
  const isBest = s.earnings > best;
  if (isBest) saveBest(s.earnings);
  const avg = s.served ? (s.starsTotal / s.served).toFixed(1) : '–';
  hud.show(`
    <div class="grade ${grade}">${grade}</div>
    <h1>Shift over</h1>
    ${isBest && s.earnings > 0 ? '<div class="newbest">New best shift!</div>' : `<p class="sub">Best ¥${Math.max(best, s.earnings).toFixed(1)}</p>`}
    <div class="results">
      <div class="wide"><b>¥${s.earnings.toFixed(1)}</b><span>earned this shift</span></div>
      <div><b>${s.served}</b><span>drinks served</span></div>
      <div><b>${s.perfect}</b><span>three-star drinks</span></div>
      <div><b>${s.bestCombo}</b><span>best combo</span></div>
      <div><b>¥${s.tips.toFixed(1)}</b><span>in tips</span></div>
      <div><b>${s.walkouts}</b><span>walk-outs</span></div>
      <div><b>${avg}★</b><span>average rating</span></div>
    </div>
    <button class="primary" data-go="start">One more shift</button>
    <button class="secondary" data-go="menu">Menu</button>`);
}

function startShift(seed = Date.now() >>> 0): void {
  sound.unlock();
  sound.start();
  shift = new Shift(seed);
  build = emptyBuild();
  activeId = null;
  pull = null;
  pullLoop?.stop();
  pullLoop = null;
  stopPour();
  seen = new Set();
  hud.reset();
  hud.hide();
  stage.newCup();
  mode = 'playing';
  if (loadBest() === 0) hud.toast('First order coming up!<small>Blue dots on the buttons show what the ticket still needs.</small>', 'good', 4200);
}

hud.overlay.addEventListener('click', (e) => {
  const go = (e.target as HTMLElement).closest<HTMLElement>('[data-go]')?.dataset.go;
  if (!go) return;
  sound.unlock();
  if (go === 'start') startShift();
  else if (go === 'resume') {
    hud.hide();
    mode = 'playing';
  } else if (go === 'menu') titleScreen();
});

// ---------- actions ----------
function activeTicket(): Ticket | null {
  return shift.tickets.find((t) => t.id === activeId) ?? null;
}

function pickTicket(id: number): void {
  if (mode !== 'playing') return;
  if (activeId !== id) sound.tap();
  activeId = id;
}

function cycleTicket(dir: number): void {
  const list = shift.tickets;
  if (list.length === 0) return;
  const i = list.findIndex((t) => t.id === activeId);
  pickTicket(list[(i + dir + list.length) % list.length]!.id);
}

function needCup(): boolean {
  if (build.size !== null) return false;
  sound.error();
  stage.jolt(3);
  hud.toast('Pick a cup first: <b>S</b>, <b>M</b> or <b>L</b>');
  return true;
}

function chooseCup(size: Size): void {
  if (build.size === size) return;
  const fresh = build.size === null;
  build.size = size;
  if (fresh) stage.newCup();
  sound.cup();
}

function toggleShot(): void {
  if (pull) {
    finishPull();
    return;
  }
  if (needCup()) return;
  if (!canAddShot(build)) {
    sound.error();
    hud.toast('Three shots is the max');
    return;
  }
  pull = newPullMeter(Math.random, shift.level);
  pullLoop = sound.pullStart();
}

function finishPull(): void {
  if (!pull) return;
  const result = gradePull(pull);
  pull = null;
  pullLoop?.stop();
  pullLoop = null;
  addShot(build, result);
  stage.shotDone();
  sound.shotGrade(result.grade);
  const text = { perfect: 'PERFECT', good: 'GOOD', sour: 'SOUR', bitter: 'BITTER' }[result.grade];
  const color = { perfect: '#e89a00', good: '#1d3fc4', sour: '#5f9a3a', bitter: '#5a2e17' }[result.grade];
  stage.float(text, color, result.grade === 'perfect' ? 24 : 19);
}

function startPour(liquid: Liquid): void {
  if (pour?.liquid === liquid) return;
  stopPour();
  if (needCup()) return;
  pour = { liquid, hold: 0, loop: sound.pourLoop(!build.iced && liquid !== 'water') };
}

function stopPour(liquid?: Liquid): void {
  if (!pour || (liquid && pour.liquid !== liquid)) return;
  pour.loop.stop();
  pour = null;
}

function syrup(s: Syrup): void {
  if (needCup()) return;
  if (addSyrup(build, s)) {
    sound.pump();
    stage.pump(s);
  } else {
    sound.error();
    hud.toast(`Three pumps of ${LABELS.syrup[s].toLowerCase()} is plenty`);
  }
}

function ice(): void {
  if (needCup()) return;
  if (addIce(build)) {
    sound.ice();
    stage.dropIce();
  } else sound.error();
}

function topping(t: Topping): void {
  if (needCup()) return;
  if (addTopping(build, t)) {
    if (t === 'cinnamon' || t === 'coconutFlakes') sound.sprinkle();
    else sound.foam();
    stage.topping(t);
  } else sound.error();
}

function bin(): void {
  if (build.size === null) return;
  stopPour();
  if (pull) {
    pull = null;
    pullLoop?.stop();
    pullLoop = null;
  }
  sound.bin();
  stage.binCup(build);
  build = emptyBuild();
}

function serve(): void {
  if (needCup()) return;
  const t = activeTicket();
  if (!t) {
    sound.error();
    hud.toast('No order selected');
    return;
  }
  if (pull) finishPull();
  stopPour();
  const res = shift.serve(t.id, build);
  if (!res) return;
  showResult(res);
  if (res.payout.rejected) stage.binCup(build);
  else {
    stage.serveCup(build);
    hud.removeTicket(t.id, 'served');
  }
  build = emptyBuild();
}

function showResult(r: ServeResult): void {
  const { judgement: j, payout: p, ticket } = r;
  const stars = '★'.repeat(j.stars) + '☆'.repeat(3 - j.stars);
  if (p.rejected) {
    sound.reject();
    stage.jolt(10);
    stage.float('REMAKE', '#c42617', 26);
    hud.toast(`${ticket.customer} sent it back<small>${j.mistakes.slice(0, 2).join(' · ')}</small>`, 'bad', 2800);
    return;
  }
  sound.serve(j.stars);
  stage.stars(j.stars);
  stage.float(`+¥${p.total.toFixed(1)}`, '#1d3fc4', 28);
  if (p.combo >= 2) stage.float(`COMBO ×${p.multiplier.toFixed(1)}`, '#e89a00', 18, 30);
  const tip = p.tip > 0 ? ` · tip ¥${p.tip.toFixed(1)}` : '';
  const detail = j.mistakes.length ? `<small>${j.mistakes.slice(0, 2).join(' · ')}</small>` : `<small>Perfect drink${tip}</small>`;
  hud.toast(`<span class="stars">${stars}</span> ${ticket.customer} · ¥${p.total.toFixed(1)}${detail}`, j.stars === 3 ? 'good' : 'info', 2400);
}

// ---------- input ----------
type Act = { act: string; v: string };

function press(a: Act): void {
  if (mode !== 'playing') return;
  sound.unlock();
  switch (a.act) {
    case 'size':
      chooseCup(a.v as Size);
      break;
    case 'shot':
      toggleShot();
      break;
    case 'pour':
      startPour(a.v as Liquid);
      break;
    case 'syrup':
      syrup(a.v as Syrup);
      break;
    case 'ice':
      ice();
      break;
    case 'top':
      topping(a.v as Topping);
      break;
    case 'trash':
      bin();
      break;
    case 'serve':
      serve();
      break;
  }
}

function release(a: Act): void {
  if (a.act === 'pour') stopPour(a.v as Liquid);
}

document.querySelectorAll<HTMLButtonElement>('.controls button[data-act]').forEach((btn) => {
  btn.tabIndex = -1;
  const a = (): Act => ({ act: btn.dataset.act!, v: btn.dataset.v ?? '' });
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    btn.setPointerCapture(e.pointerId);
    press(a());
  });
  const up = () => release(a());
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('lostpointercapture', up);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
});

const KEYS: Record<string, Act> = {
  Digit1: { act: 'size', v: 'S' },
  Digit2: { act: 'size', v: 'M' },
  Digit3: { act: 'size', v: 'L' },
  Space: { act: 'shot', v: '' },
  KeyQ: { act: 'pour', v: 'whole' },
  KeyW: { act: 'pour', v: 'oat' },
  KeyE: { act: 'pour', v: 'coconut' },
  KeyR: { act: 'pour', v: 'water' },
  KeyA: { act: 'syrup', v: 'vanilla' },
  KeyS: { act: 'syrup', v: 'caramel' },
  KeyD: { act: 'syrup', v: 'osmanthus' },
  KeyF: { act: 'syrup', v: 'brownSugar' },
  KeyG: { act: 'ice', v: '' },
  KeyZ: { act: 'top', v: 'cheeseFoam' },
  KeyX: { act: 'top', v: 'milkFoam' },
  KeyC: { act: 'top', v: 'cinnamon' },
  KeyV: { act: 'top', v: 'coconutFlakes' },
  Enter: { act: 'serve', v: '' },
  NumpadEnter: { act: 'serve', v: '' },
  Backspace: { act: 'trash', v: '' },
  Delete: { act: 'trash', v: '' },
};

function flash(a: Act): void {
  const sel = `.controls button[data-act="${a.act}"]${a.v ? `[data-v="${a.v}"]` : ''}`;
  const btn = document.querySelector<HTMLElement>(sel);
  if (!btn || a.act === 'pour') return;
  btn.classList.add('pressed');
  setTimeout(() => btn.classList.remove('pressed'), 110);
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'KeyM') {
    toggleMute();
    return;
  }
  if (mode !== 'playing') {
    if ((e.code === 'Enter' || e.code === 'Space') && !e.repeat) {
      e.preventDefault();
      if (mode === 'paused') {
        hud.hide();
        mode = 'playing';
      } else startShift();
    } else if (e.code === 'Escape' && mode === 'paused') {
      hud.hide();
      mode = 'playing';
    }
    return;
  }
  if (e.code === 'Escape' || e.code === 'KeyP') {
    pauseScreen();
    return;
  }
  if (e.code === 'Tab' || e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
    e.preventDefault();
    cycleTicket(e.code === 'ArrowLeft' || (e.code === 'Tab' && e.shiftKey) ? -1 : 1);
    return;
  }
  const a = KEYS[e.code];
  if (!a) return;
  e.preventDefault();
  if (e.repeat) return;
  flash(a);
  press(a);
});

window.addEventListener('keyup', (e) => {
  const a = KEYS[e.code];
  if (a) release(a);
});

window.addEventListener('blur', () => stopPour());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseScreen();
});

function toggleMute(): void {
  sound.unlock();
  const m = sound.toggleMute();
  document.querySelector('#mute')!.textContent = m ? '🔇' : '🔊';
}
document.querySelector('#mute')!.textContent = sound.muted ? '🔇' : '🔊';
document.querySelector('#mute')!.addEventListener('click', toggleMute);
document.querySelector('#pause')!.addEventListener('click', () => {
  sound.unlock();
  if (mode === 'playing') pauseScreen();
});

new ResizeObserver(() => stage.resize()).observe(document.querySelector('#stage-wrap')!);

// ---------- loop ----------
function update(dt: number): void {
  clock += dt;
  if (mode === 'playing') {
    for (const ev of shift.update(dt)) {
      if (ev.type === 'spawn') {
        sound.order();
        if (!seen.has(ev.ticket.recipe.id)) {
          if (seen.size >= 3) hud.toast(`New on the menu: <b>${ev.ticket.recipe.name}</b><small>${ev.ticket.recipe.blurb}</small>`, 'good', 2600);
          seen.add(ev.ticket.recipe.id);
        }
      } else if (ev.type === 'walkout') {
        sound.walkout();
        stage.jolt(5);
        stage.float(`${ev.ticket.customer} left`, '#c42617', 18, -20);
        hud.removeTicket(ev.ticket.id, 'walk');
      } else if (ev.type === 'warning') sound.warn();
      else if (ev.type === 'end') endScreen();
    }
    if (activeId === null || !shift.tickets.some((t) => t.id === activeId)) activeId = shift.tickets[0]?.id ?? null;

    if (pull && stepPull(pull, dt)) finishPull();
    if (pour) {
      pour.hold += dt;
      pourLiquid(build, pour.liquid, pourRate(pour.hold) * dt);
    }
  }

  const t = activeTicket();
  hud.syncTickets(shift.tickets, activeId);
  hud.syncRecipe(t, build);
  hud.syncControls(t, build, !!pull, pour?.liquid ?? null);
  hud.syncTop(shift.timeLeft, shift.stats.earnings, comboMultiplier(shift.stats.combo), shift.stats.combo, dt);
  stage.frame(dt, {
    build: build.size ? build : null,
    pull,
    pouring: pour?.liquid ?? null,
    pourRate: pour ? pourRate(pour.hold) : 0,
    wantsFill: !!t,
    time: clock,
  });
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  update(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
titleScreen();

// Dev-only handle for scripted playtests (the hidden browser pane throttles rAF).
if (import.meta.env.DEV) {
  Object.assign(window, {
    __game: {
      step(seconds: number) {
        const n = Math.round(seconds * 60);
        for (let i = 0; i < n; i++) update(1 / 60);
      },
      start: (seed?: number) => startShift(seed),
      press: (act: string, v = '') => press({ act, v }),
      release: (act: string, v = '') => release({ act, v }),
      get state() {
        return { mode, build, activeId, tickets: shift.tickets, stats: shift.stats, time: shift.time, pull };
      },
      resume() {
        hud.hide();
        mode = 'playing';
      },
    },
  });
}
