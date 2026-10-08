// All sounds are synthesised with Web Audio: no asset files.
//   gunshot  = noise crack (band-passed) + low sine thump with a pitch drop + short distortion,
//              sent into a generated reverb so shots ring across the "page"
//   impact   = short filtered click whose pitch depends on the target size
//   crumble  = a burst of granular noise grains + a low thud, longer for bigger letters
//   steps    = soft paper rustle; landing = thud
// Positional sounds use HRTF panners driven by the camera.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.7;
  }

  /** must be called from a user gesture (click) the first time */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      // gentle bus compression keeps rapid fire from clipping
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.15;
      this.master.connect(comp).connect(ctx.destination);

      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.makeImpulse(1.6, 2.8);
      this.reverbSend = ctx.createGain();
      this.reverbSend.gain.value = 0.35;
      this.reverbSend.connect(this.reverb).connect(this.master);

      this.noise = this.makeNoise(2);
      this.distCurve = this.makeDistortion(18);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  get ready() {
    return !!this.ctx && this.ctx.state === "running";
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.02);
    return this.muted;
  }

  /** @param {import("three").Camera} camera */
  updateListener(camera) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const e = camera.matrixWorld.elements;
    const p = camera.position;
    // forward = -Z column, up = Y column of the camera's world matrix
    const fx = -e[8], fy = -e[9], fz = -e[10], ux = e[4], uy = e[5], uz = e[6];
    if (L.positionX) {
      const t = this.ctx.currentTime;
      L.positionX.setValueAtTime(p.x, t); L.positionY.setValueAtTime(p.y, t); L.positionZ.setValueAtTime(p.z, t);
      L.forwardX.setValueAtTime(fx, t); L.forwardY.setValueAtTime(fy, t); L.forwardZ.setValueAtTime(fz, t);
      L.upX.setValueAtTime(ux, t); L.upY.setValueAtTime(uy, t); L.upZ.setValueAtTime(uz, t);
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  // ------------------------------------------------------------------ sounds

  /**
   * @param {{x:number,y:number,z:number}} [pos]       someone else's shot: positional, duller with distance
   * @param {{x:number,y:number,z:number}} [listener]
   */
  gunshot(pos, listener) {
    if (!this.ready) return;
    const { ctx } = this;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.9;
    if (pos) {
      const dist = listener ? Math.hypot(pos.x - listener.x, pos.y - listener.y, pos.z - listener.z) : 20;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 14000 / (1 + dist / 25); // far shots lose their crack
      const pan = this.panner(pos);
      pan.refDistance = 6;
      out.connect(lp).connect(pan).connect(this.master);
      const send = ctx.createGain();
      send.gain.value = Math.min(1.2, 0.5 + dist / 120); // and are mostly echo
      out.connect(send).connect(this.reverbSend);
    } else {
      out.connect(this.master);
      out.connect(this.reverbSend);
    }
    const pitch = 0.92 + Math.random() * 0.16;

    // crack
    const n = this.noiseSource(t, 0.25);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(2400 * pitch, t);
    bp.frequency.exponentialRampToValueAtTime(700, t + 0.12);
    bp.Q.value = 0.8;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(1.4, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    const shaper = ctx.createWaveShaper();
    shaper.curve = this.distCurve;
    n.connect(bp).connect(ng).connect(shaper).connect(out);

    // thump
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(150 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const og = ctx.createGain();
    og.gain.setValueAtTime(1.0, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 0.22);

    // mechanical click of the action
    const c = this.noiseSource(t + 0.045, 0.03);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 4000;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.25, t + 0.045);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.075);
    if (!pos) c.connect(hp).connect(cg).connect(this.master);
  }

  /** a bullet hitting a player: a dull thud */
  bodyHit(pos, head) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(head ? 900 : 220, t);
    o.frequency.exponentialRampToValueAtTime(head ? 400 : 90, t + 0.08);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(head ? 0.5 : 0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    const pan = this.panner(pos);
    o.connect(g).connect(pan).connect(this.master);
    o.start(t);
    o.stop(t + 0.13);
  }

  /** we took damage: a short low "oof" thump, non-positional */
  hurt(amount) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.18);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.8, 0.25 + amount / 60), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.24);
  }

  dryFire() {
    if (!this.ready) return;
    this.click(this.ctx.currentTime, 3200, 0.25, 0.03);
  }

  reload(duration) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.click(t + 0.1, 1800, 0.3, 0.05); // mag out
    this.click(t + duration * 0.6, 1400, 0.4, 0.06); // mag in
    this.click(t + duration * 0.85, 2600, 0.35, 0.04); // charge
    this.click(t + duration * 0.9, 2000, 0.3, 0.04);
  }

  /** @param {{x:number,y:number,z:number}} pos  @param {number} size metres (letter height) */
  impact(pos, size = 1) {
    if (!this.ready) return;
    const { ctx } = this;
    const t = ctx.currentTime;
    const pan = this.panner(pos);
    const n = this.noiseSource(t, 0.12);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = (1800 / Math.sqrt(Math.max(0.3, size))) * (0.85 + Math.random() * 0.3);
    bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    n.connect(bp).connect(g).connect(pan);
    pan.connect(this.master);
  }

  floorHit(pos) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const pan = this.panner(pos);
    pan.connect(this.master);
    const n = this.noiseSource(t, 0.1);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    n.connect(lp).connect(g).connect(pan);
  }

  /** a letter breaking apart; size ~ its height in metres */
  crumble(pos, size = 1) {
    if (!this.ready) return;
    const { ctx } = this;
    const t = ctx.currentTime;
    const pan = this.panner(pos);
    const bus = ctx.createGain();
    bus.gain.value = Math.min(1.4, 0.55 + size * 0.2);
    bus.connect(pan);
    pan.connect(this.master);
    pan.connect(this.reverbSend);

    // thud
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110 / Math.sqrt(size), t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.35);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.9, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(og).connect(bus);
    o.start(t);
    o.stop(t + 0.45);

    // crack
    const c = this.noiseSource(t, 0.2);
    const cbp = ctx.createBiquadFilter();
    cbp.type = "bandpass";
    cbp.frequency.value = 1200;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(1.2, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    c.connect(cbp).connect(cg).connect(bus);

    // rubble: many small grains spread over time, getting sparser
    const grains = Math.round(14 + size * 10);
    const dur = 0.5 + size * 0.35;
    for (let i = 0; i < grains; i++) {
      const tt = t + 0.03 + Math.pow(Math.random(), 1.8) * dur;
      const len = 0.02 + Math.random() * 0.05;
      const s = this.noiseSource(tt, len + 0.02);
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 500 + Math.random() * 3500;
      f.Q.value = 2 + Math.random() * 4;
      const g = ctx.createGain();
      const amp = 0.5 * (1 - (tt - t) / (dur + 0.1)) + 0.05;
      g.gain.setValueAtTime(amp, tt);
      g.gain.exponentialRampToValueAtTime(0.001, tt + len);
      s.connect(f).connect(g).connect(bus);
    }
  }

  footstep(sprint) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const n = this.noiseSource(t, 0.12);
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900 + Math.random() * 600;
    bp.Q.value = 0.9;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(sprint ? 0.16 : 0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    n.connect(bp).connect(g).connect(this.master);
  }

  /** someone else's footstep, positioned in the world (quieter, and only when close enough) */
  footstepAt(pos, sprint, listener) {
    if (!this.ready) return;
    if (listener && Math.hypot(pos.x - listener.x, pos.z - listener.z) > 45) return;
    const t = this.ctx.currentTime;
    const n = this.noiseSource(t, 0.12);
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 700 + Math.random() * 500;
    bp.Q.value = 0.9;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(sprint ? 0.5 : 0.32, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    n.connect(bp).connect(g).connect(this.panner(pos)).connect(this.master);
  }

  land(impact) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.6, impact * 0.05), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.16);
    this.footstep(true);
  }

  // ------------------------------------------------------------------ building blocks

  click(t, freq, gain, len) {
    const n = this.noiseSource(t, len + 0.02);
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = 6;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    n.connect(bp).connect(g).connect(this.master);
  }

  noiseSource(t, dur) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const off = Math.random() * (this.noise.duration - dur - 0.01);
    s.start(t, Math.max(0, off), dur);
    return s;
  }

  panner(pos) {
    const p = this.ctx.createPanner();
    p.panningModel = "HRTF";
    p.distanceModel = "inverse";
    p.refDistance = 4;
    p.maxDistance = 400;
    p.rolloffFactor = 1.1;
    if (p.positionX) {
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    } else p.setPosition(pos.x, pos.y, pos.z);
    return p;
  }

  makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  makeImpulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  makeDistortion(k) {
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return curve;
  }
}
