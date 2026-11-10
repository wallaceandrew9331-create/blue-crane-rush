import { FILL_MAX, FILL_MIN, FILL_SPILL, totalFill, type Build } from '../game/build.ts';
import { LABELS, SYRUPS, TOPPINGS, type DrinkSpec } from '../game/menu.ts';
import type { Ticket } from '../game/shift.ts';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** One line of the "now making" checklist. */
interface Line {
  text: string;
  state: 'todo' | 'done' | 'bad';
  modded?: boolean;
  pips?: string;
}

export function checklist(spec: DrinkSpec, base: Omit<DrinkSpec, 'size'>, b: Build): Line[] {
  const lines: Line[] = [];
  const hasCup = b.size !== null;
  lines.push({
    text: `${LABELS.size[spec.size]} cup`,
    state: b.size === spec.size ? 'done' : hasCup ? 'bad' : 'todo',
    modded: spec.size !== 'M',
  });
  const pips =
    Array.from({ length: Math.max(spec.shots, b.shots.length) }, (_, i) => `<i class="pip ${b.shots[i]?.grade ?? ''}"></i>`).join('');
  lines.push({
    text: `${spec.shots} shot${spec.shots > 1 ? 's' : ''}`,
    state: b.shots.length === spec.shots ? 'done' : b.shots.length > spec.shots ? 'bad' : 'todo',
    modded: spec.shots !== base.shots,
    pips,
  });
  if (spec.iced) lines.push({ text: 'Ice', state: b.iced ? 'done' : 'todo', modded: !base.iced });
  else if (b.iced) lines.push({ text: 'No ice (hot)', state: 'bad', modded: base.iced });
  else if (base.iced) lines.push({ text: 'Hot, no ice', state: 'done', modded: true });

  const fill = totalFill(b);
  const rightLiquid = b.liquid === spec.liquid;
  const wrongLiquid = b.liquid !== null && !rightLiquid;
  lines.push({
    text: `${LABELS.liquid[spec.liquid]} to the line`,
    state: wrongLiquid || fill > FILL_SPILL ? 'bad' : rightLiquid && fill >= FILL_MIN && fill <= FILL_MAX + 0.04 ? 'done' : 'todo',
    modded: spec.liquid !== base.liquid,
  });
  for (const s of SYRUPS) {
    const want = spec.syrups[s] ?? 0;
    const got = b.syrups[s] ?? 0;
    const was = base.syrups[s] ?? 0;
    if (want > 0) lines.push({ text: `${LABELS.syrup[s]} ×${want}`, state: got === want ? 'done' : got > want ? 'bad' : 'todo', modded: want !== was });
    else if (got > 0) lines.push({ text: `No ${LABELS.syrup[s].toLowerCase()}`, state: 'bad', modded: was > 0 });
  }
  if (Object.keys(base.syrups).length > 0 && Object.keys(spec.syrups).length === 0 && !SYRUPS.some((s) => (b.syrups[s] ?? 0) > 0)) {
    lines.push({ text: 'No syrup', state: 'done', modded: true });
  }
  for (const t of TOPPINGS) {
    const want = spec.toppings.includes(t);
    const got = b.toppings.includes(t);
    if (want) lines.push({ text: LABELS.topping[t], state: got ? 'done' : 'todo', modded: !base.toppings.includes(t) });
    else if (got) lines.push({ text: `No ${LABELS.topping[t].toLowerCase()}`, state: 'bad' });
  }
  return lines;
}

export class Hud {
  private tickets = $<HTMLElement>('#tickets');
  private recipe = $<HTMLElement>('#recipe');
  private money = $<HTMLElement>('#money');
  private timer = $<HTMLElement>('#timer');
  private timerVal = $<HTMLElement>('#timer-val');
  private combo = $<HTMLElement>('#combo');
  private comboVal = $<HTMLElement>('#combo-val');
  private cards = new Map<number, HTMLElement>();
  private shownMoney = 0;
  private lastRecipeKey = '';
  private lastCombo = 0;
  readonly overlay = $<HTMLElement>('#overlay');
  private toastEl: HTMLElement;
  private toastTimer = 0;

  constructor(private onPickTicket: (id: number) => void) {
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast hidden';
    $<HTMLElement>('#stage-wrap').appendChild(this.toastEl);
  }

  reset(): void {
    this.cards.forEach((el) => el.remove());
    this.cards.clear();
    this.shownMoney = 0;
    this.money.textContent = '0';
    this.lastRecipeKey = '';
    this.lastCombo = 0;
  }

  toast(html: string, kind: 'info' | 'good' | 'bad' = 'info', ms = 2200): void {
    this.toastEl.innerHTML = html;
    this.toastEl.className = `toast ${kind}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.add('hidden'), ms);
  }

  removeTicket(id: number, how: 'served' | 'walk'): void {
    const el = this.cards.get(id);
    if (!el) return;
    this.cards.delete(id);
    el.classList.add(how === 'walk' ? 'walk' : 'leaving');
    setTimeout(() => el.remove(), 450);
  }

  syncTickets(list: Ticket[], activeId: number | null): void {
    for (const t of list) {
      let el = this.cards.get(t.id);
      if (!el) {
        el = this.ticketEl(t);
        this.cards.set(t.id, el);
        this.tickets.appendChild(el);
      }
      el.classList.toggle('active', t.id === activeId);
      const frac = Math.max(0, t.patience / t.patienceMax);
      const bar = el.querySelector<HTMLElement>('.patience')!;
      bar.style.width = `${frac * 100}%`;
      bar.style.background = frac > 0.5 ? 'var(--green)' : frac > 0.25 ? 'var(--amber)' : 'var(--red)';
      el.classList.toggle('urgent', frac < 0.2);
    }
    let empty = this.tickets.querySelector('.empty');
    if (list.length === 0 && this.cards.size === 0) {
      if (!empty) {
        empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'Waiting for mobile orders…';
        this.tickets.appendChild(empty);
      }
    } else empty?.remove();
  }

  private ticketEl(t: Ticket): HTMLElement {
    const el = document.createElement('button');
    el.className = 'ticket';
    el.tabIndex = -1;
    const chips: string[] = [];
    if (t.spec.size !== 'M') chips.push(`<span class="chip size">${LABELS.size[t.spec.size]}</span>`);
    chips.push(t.spec.iced ? '<span class="chip temp-ice">Iced</span>' : '<span class="chip temp-hot">Hot</span>');
    for (const m of t.mods) if (m.id !== 'makeIced' && m.id !== 'makeHot') chips.push(`<span class="chip mod">${esc(m.label)}</span>`);
    el.innerHTML = `
      <div class="t-head"><span class="code">${t.code}</span><span>${esc(t.customer)}</span></div>
      <div class="name">${esc(t.recipe.name)}</div>
      <div class="cn">${t.recipe.cn}</div>
      <div class="chips">${chips.join('')}</div>
      <div class="patience"></div>`;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.onPickTicket(t.id);
    });
    return el;
  }

  syncRecipe(t: Ticket | null, b: Build): void {
    const key = t ? JSON.stringify([t.id, b, Math.round(totalFill(b) * 50)]) : 'none';
    if (key === this.lastRecipeKey) return;
    this.lastRecipeKey = key;
    if (!t) {
      this.recipe.innerHTML = '<h4>Now making</h4><div class="none">No order selected</div>';
      return;
    }
    const lines = checklist(t.spec, t.recipe.base, b);
    this.recipe.innerHTML = `<h4><b>${t.code}</b> · ${esc(t.customer)} · ¥${t.price}</h4><ul>${lines
      .map(
        (l) =>
          `<li class="${l.state}${l.modded ? ' modded' : ''}"><span class="ck">${l.state === 'done' ? '✓' : l.state === 'bad' ? '✕' : ''}</span><span class="t">${esc(l.text)}</span>${l.pips ? `<span class="pips">${l.pips}</span>` : ''}</li>`,
      )
      .join('')}</ul>`;
  }

  /** Light up the buttons for what the active ticket still needs. */
  syncControls(t: Ticket | null, b: Build, pulling: boolean, pouring: string | null): void {
    const fill = totalFill(b);
    const spec = t?.spec;
    let allDone = !!spec && b.size !== null;
    document.querySelectorAll<HTMLButtonElement>('.controls button[data-act]').forEach((btn) => {
      const act = btn.dataset.act!;
      const v = btn.dataset.v ?? '';
      let lit = false;
      let need = false;
      let count = 0;
      switch (act) {
        case 'size':
          lit = b.size === v;
          need = !!spec && spec.size === v && b.size !== v;
          break;
        case 'shot':
          need = !!spec && b.size !== null && b.shots.length < spec.shots;
          btn.classList.toggle('pulling', pulling);
          btn.querySelector('.lbl')!.textContent = pulling ? 'Stop!' : 'Pull shot';
          break;
        case 'pour':
          lit = b.liquid === v || pouring === v;
          need = !!spec && b.size !== null && spec.liquid === v && fill < FILL_MIN;
          btn.classList.toggle('pressed', pouring === v);
          break;
        case 'syrup': {
          count = b.syrups[v as keyof Build['syrups']] ?? 0;
          lit = count > 0;
          need = !!spec && b.size !== null && count < (spec.syrups[v as keyof DrinkSpec['syrups']] ?? 0);
          break;
        }
        case 'ice':
          lit = b.iced;
          need = !!spec && b.size !== null && spec.iced && !b.iced;
          break;
        case 'top':
          lit = b.toppings.includes(v as never);
          need = !!spec && b.size !== null && spec.toppings.includes(v as never) && !lit;
          break;
      }
      if (need) allDone = false;
      btn.classList.toggle('lit', lit);
      btn.classList.toggle('need', need);
      let cnt = btn.querySelector<HTMLElement>('.cnt');
      if (count > 0) {
        if (!cnt) {
          cnt = document.createElement('i');
          cnt.className = 'cnt';
          btn.appendChild(cnt);
        }
        cnt.textContent = `×${count}`;
      } else cnt?.remove();
    });
    if (spec && (b.shots.length < spec.shots || fill < FILL_MIN)) allDone = false;
    document.querySelector('.controls .serve')!.classList.toggle('ready', allDone);
  }

  syncTop(timeLeft: number, earnings: number, multiplier: number, combo: number, dt: number): void {
    const s = Math.ceil(timeLeft);
    this.timerVal.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.timer.classList.toggle('low', timeLeft <= 15 && timeLeft > 0);
    this.shownMoney += (earnings - this.shownMoney) * Math.min(1, dt * 8);
    if (Math.abs(earnings - this.shownMoney) < 0.05) this.shownMoney = earnings;
    this.money.textContent = this.shownMoney.toFixed(earnings % 1 === 0 && this.shownMoney === earnings ? 0 : 1);
    this.comboVal.textContent = multiplier.toFixed(1);
    this.combo.style.opacity = combo > 0 ? '1' : '0.45';
    this.combo.classList.toggle('hot', combo >= 3);
    if (combo > this.lastCombo) {
      this.combo.classList.remove('bump');
      void this.combo.offsetWidth;
      this.combo.classList.add('bump');
      setTimeout(() => this.combo.classList.remove('bump'), 160);
    }
    this.lastCombo = combo;
  }

  show(html: string): void {
    this.overlay.innerHTML = `<div class="card">${html}</div>`;
    this.overlay.classList.remove('hidden');
  }

  hide(): void {
    this.overlay.classList.add('hidden');
    this.overlay.innerHTML = '';
  }
}
