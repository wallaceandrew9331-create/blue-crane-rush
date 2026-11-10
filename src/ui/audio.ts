/**
 * Every sound is synthesised with WebAudio: filtered noise for liquids and
 * steam, short sine/triangle blips for UI. No audio files to download.
 */

type Loop = { stop: () => void; set?: (v: number) => void };

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem('bcr-muted') === '1';
    } catch {
      /* storage blocked: default to sound on */
    }
  }

  /** Must be called from a user gesture (browsers block autoplay). */
  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, this.ctx.currentTime, 0.02);
    try {
      localStorage.setItem('bcr-muted', this.muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    return this.muted;
  }

  private get ok(): boolean {
    return !!this.ctx && !!this.master && this.ctx.state === 'running';
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.2, delay = 0, slideTo?: number): void {
    if (!this.ok) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, filter: BiquadFilterType, freq: number, vol = 0.2, q = 1, delay = 0): void {
    if (!this.ok) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private noiseLoop(filter: BiquadFilterType, freq: number, vol: number, q = 1, lfoHz = 0, lfoDepth = 0): Loop {
    if (!this.ok) return { stop: () => {} };
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.setTargetAtTime(vol, ctx.currentTime, 0.03);
    src.connect(f).connect(g).connect(this.master!);
    let lfo: OscillatorNode | null = null;
    if (lfoHz > 0) {
      lfo = ctx.createOscillator();
      lfo.frequency.value = lfoHz;
      const lg = ctx.createGain();
      lg.gain.value = lfoDepth;
      lfo.connect(lg).connect(f.frequency);
      lfo.start();
    }
    src.start(0, Math.random());
    return {
      stop: () => {
        const t = ctx.currentTime;
        g.gain.setTargetAtTime(0.0001, t, 0.04);
        src.stop(t + 0.3);
        lfo?.stop(t + 0.3);
      },
      set: (v: number) => f.frequency.setTargetAtTime(freq * v, ctx.currentTime, 0.05),
    };
  }

  // ---- game sounds ----
  tap(): void { this.tone(900, 0.04, 'triangle', 0.08); }
  cup(): void {
    this.burst(0.06, 'bandpass', 1800, 0.25, 2);
    this.tone(420, 0.09, 'triangle', 0.12, 0.01, 300);
  }
  pullStart(): Loop {
    // The pump thunk, then a low gurgle while the shot runs.
    this.tone(90, 0.15, 'square', 0.08);
    return this.noiseLoop('lowpass', 520, 0.32, 3, 7, 160);
  }
  shotGrade(grade: string): void {
    if (grade === 'perfect') {
      this.tone(1046, 0.12, 'triangle', 0.16);
      this.tone(1568, 0.18, 'triangle', 0.14, 0.07);
    } else if (grade === 'good') this.tone(880, 0.12, 'triangle', 0.13);
    else this.tone(220, 0.18, 'sawtooth', 0.07, 0, 160);
  }
  pourLoop(hot: boolean): Loop {
    return hot ? this.noiseLoop('highpass', 2600, 0.12, 0.7, 11, 900) : this.noiseLoop('bandpass', 700, 0.42, 1.4, 5, 260);
  }
  ice(): void {
    for (let i = 0; i < 4; i++) {
      this.tone(2200 + Math.random() * 1800, 0.12, 'sine', 0.09, i * 0.055 + Math.random() * 0.02);
      this.burst(0.03, 'highpass', 4000, 0.08, 1, i * 0.055);
    }
  }
  pump(): void {
    this.tone(260, 0.12, 'sine', 0.22, 0, 90);
    this.burst(0.08, 'lowpass', 900, 0.12, 1, 0.04);
  }
  foam(): void { this.burst(0.35, 'lowpass', 1300, 0.25, 0.7); }
  sprinkle(): void {
    for (let i = 0; i < 6; i++) this.burst(0.02, 'highpass', 6000, 0.06, 1, i * 0.03 + Math.random() * 0.02);
  }
  serve(stars: number): void {
    const notes = stars >= 3 ? [784, 988, 1175, 1568] : stars === 2 ? [784, 988, 1175] : [659, 784];
    notes.forEach((n, i) => this.tone(n, 0.22, 'triangle', 0.15, i * 0.075));
    this.coin(notes.length * 0.075 + 0.05);
  }
  coin(delay = 0): void {
    this.tone(1319, 0.06, 'square', 0.06, delay);
    this.tone(1976, 0.16, 'square', 0.06, delay + 0.06);
  }
  reject(): void {
    this.tone(196, 0.22, 'sawtooth', 0.1, 0, 140);
    this.tone(147, 0.3, 'sawtooth', 0.1, 0.14, 110);
  }
  order(): void {
    this.tone(1318, 0.1, 'sine', 0.15);
    this.tone(1760, 0.18, 'sine', 0.13, 0.09);
  }
  walkout(): void {
    [523, 440, 349].forEach((n, i) => this.tone(n, 0.2, 'triangle', 0.12, i * 0.1));
  }
  warn(): void { this.tone(1000, 0.05, 'square', 0.05); }
  error(): void { this.tone(160, 0.12, 'square', 0.07); }
  bin(): void {
    this.burst(0.25, 'lowpass', 500, 0.3, 1);
    this.tone(120, 0.15, 'sine', 0.2, 0, 60);
  }
  start(): void {
    [523, 659, 784, 1046].forEach((n, i) => this.tone(n, 0.18, 'triangle', 0.13, i * 0.09));
  }
  end(): void {
    [1046, 784, 880, 1175, 1568].forEach((n, i) => this.tone(n, 0.3, 'triangle', 0.13, i * 0.12));
  }
}
