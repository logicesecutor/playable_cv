// The office's soundscape: everything synthesised with Web Audio (like sfx.js, no files), placed
// on the office's objects and moving with the office when it swings around the page.
//
//   room tone   ventilation rumble with a slow swell, mains hum, a faint fluorescent buzz, the
//               wall clock ticking
//   her         typing while she types, mouse clicks, the mug, a creaking chair, a sigh, and in the
//               Shred sequence: the CV crinkling as she grabs it, rustling, the chair rolling, the
//               shredder (motor + paper crunch) while it eats the page
//   the office  coworkers typing in other cubicles, phones ringing (hers and others'), the
//               photocopier, the laser printer, footsteps on the carpet, the water cooler, distant
//               indistinct chatter (formant "babble": a buzzy voice source through vowel filters)
//
// Positions are given in the office model's space (real metres, three.js axes) and turned into game
// space through office.root every frame, so panning and distance follow the room as it moves.
// Distances use the real scale: refDistance = 0.8 real metres, so her keyboard is loud and the
// copier across the room is a murmur.
//
// Optional recordings: config.office.audio.samples = { phone: "sounds/phone.ogg", ... } (paths under
// public/) replace the synthesised version of that sound (keys: roomtone, phone, copier, printer,
// chatter, shredder, typing). Nothing is loaded when it's empty.
import * as THREE from "three";

// office-space points (Blender x, y, z -> three.js x, z, -y)
const P = (x, y, z) => new THREE.Vector3(x, z, -y);
const SPOTS = {
  keyboard: P(-0.15, -0.12, 0.76),
  mouse: P(0.2, -0.17, 0.77),
  mug: P(0.12, -0.02, 0.8),
  chair: P(-0.15, -0.6, 0.45),
  mouth: P(-0.15, -0.52, 1.16),
  herPhone: P(-0.62, 0.12, 0.8),
  copier: P(3.4, 5.55, 0.9),
  printer: P(-4.2, 5.6, 1.0),
  cooler: P(4.4, -5.6, 1.0),
  clock: P(0, 5.98, 2.25),
  door: P(-2.5, -5.8, 0.05),
  vents: P(0, 0, 2.7),
  panel: P(0, 0, 2.77), // the ceiling panel above her desk that stutters (office.lights.flicker)
};
const PODS = [-3.6, -1.0, 1.6, 4.2].flatMap((x) => [P(x, 2.6, 0.8), P(x, -3.4, 0.8)]).concat([P(-3.6, 0.2, 0.8)]);
const WALKS = [
  [P(-2.5, -5.6, 0.05), P(0.5, -4.4, 0.05), P(4.2, -5.2, 0.05)], // door -> water cooler
  [P(4.6, -2.0, 0.05), P(3.0, 4.6, 0.05)], // across to the copier
  [P(-4.6, 4.4, 0.05), P(-1.0, 4.8, 0.05), P(2.8, 4.8, 0.05)], // along the far wall
];
const VOWELS = [[800, 1200, 2500], [500, 1800, 2500], [320, 2200, 2900], [520, 900, 2400], [360, 750, 2300], [650, 1500, 2600]];

// her clip events (seconds into the clip): see blender_src/scripts/anim_woman.py
const CLIP_EVENTS = {
  Mouse: [[1.6, "mouseClick"], [2.7, "mouseClick"]],
  Sip: [[1.15, "cupUp"], [2.15, "slurp"], [4.1, "cupDown"]],
  Stretch: [[0.9, "creak"], [3.7, "creak"]],
  Clock: [[2.4, "sigh"]],
  Shred: [[2.95, "paperGrab"], [3.6, "rustle"], [4.5, "rustle"], [5.1, "rustle"], [7.0, "chairRoll"], [8.6, "rustle"], [9.25, "rustle"], [10.6, "chairRoll"]],
};

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

export class OfficeAmbience {
  /**
   * @param {{ctx: AudioContext|null, master: AudioNode, reverbSend: AudioNode, ready: boolean}} sfx
   * @param {import("../world/office.js").Office} office
   * @param {any} cfg the game config (cfg.office.audio)
   */
  constructor(sfx, office, cfg) {
    this.sfx = sfx;
    this.office = office;
    this.o = { volume: 0.55, chatter: true, voices: 3, ...(cfg.office.audio || {}) };
    this.low = cfg.gfx?.name === "low";
    this.started = false;
    this._v = new THREE.Vector3();
    this._throat = new THREE.Vector3();
  }

  /** call every frame after office.update(); starts itself once the audio is unlocked */
  update(dt) {
    if (!this.started) {
      if (!this.sfx.ready) return;
      this.start(this.sfx.ctx, this.sfx.master, this.sfx.reverbSend);
    }
    const now = this.ctx.currentTime;
    // moving sources follow the office
    for (const l of this.live) this.place(l.panner, l.spot(), l.game);
    // her clips
    const clip = this.office.clipState?.();
    if (clip && (clip.name !== this.clip?.name || clip.time + 0.05 < this.clip.time)) this.onClip(clip, now);
    this.clip = clip;
    this.typing = clip?.name === "Type";
    // schedulers (look 0.3 s ahead)
    for (const s of this.schedulers) {
      while (s.at < now + 0.3) s.at = Math.max(s.at, now) + s.run(Math.max(s.at, now));
    }
    this.updateShredder(dt, now);
    // the stuttering ceiling panel: a tick and a short mains buzz at every flick
    const fl = this.office.lights?.flicker;
    if (fl && fl.toggles !== this.flickerToggles) {
      if (this.flickerToggles !== undefined) this.panelFlick(now, fl.on);
      this.flickerToggles = fl.toggles;
    }
  }

  /** a fluorescent tube catching (on) or dropping out (off): starter tick + a burst of 100/120 Hz buzz */
  panelFlick(t, on) {
    const p = this.panner(SPOTS.panel, false);
    this.burst(p, t, { freq: on ? 5200 : 3600, q: 5, gain: on ? 0.35 : 0.2, decay: 0.01 });
    this.tone(p, t, { type: "sawtooth", freq: 120, freq2: 118, gain: on ? 0.3 : 0.14, attack: 0.003, decay: on ? 0.14 : 0.06 });
    this.tone(p, t, { freq: 240, freq2: 236, gain: on ? 0.18 : 0.08, attack: 0.003, decay: on ? 0.1 : 0.04 });
  }

  /** separate from the constructor so a test can drive it with an OfflineAudioContext */
  start(ctx, master, reverbSend) {
    this.started = true;
    this.ctx = ctx;
    this.bus = ctx.createGain();
    this.bus.gain.value = this.o.volume;
    this.bus.connect(master);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.6;
    this.bus.connect(this.wet).connect(reverbSend);
    this.noise = this.makeNoise(4);
    this.live = [];
    this.buffers = {};
    this.loadSamples();
    const t = ctx.currentTime;
    this.roomTone();
    this.schedulers = [
      { at: t + 0.5, run: (at) => this.typingTick(at) },
      { at: t + rnd(3, 10), run: (at) => (this.coworkerTyping(at), rnd(2, 9)) },
      { at: t + rnd(15, 40), run: (at) => (this.phone(at), rnd(35, 100)) },
      { at: t + rnd(20, 50), run: (at) => (this.copier(at), rnd(50, 120)) },
      { at: t + rnd(40, 80), run: (at) => (this.printer(at), rnd(70, 160)) },
      { at: t + rnd(8, 30), run: (at) => (this.footsteps(at), rnd(30, 80)) },
      { at: t + 0.2, run: (at) => (this.tick(at), 1) },
    ];
    if (this.o.chatter) this.schedulers.push({ at: t + rnd(4, 12), run: (at) => this.conversation(at) });
  }

  dispose() {
    for (const n of this.longNodes || []) {
      try { n.stop(); } catch { /* already stopped */ }
    }
    this.bus?.disconnect();
    this.wet?.disconnect();
    this.started = false;
  }

  // ---------------------------------------------------------------- placement

  /** office-space point -> game space */
  toGame(p, out = this._v) {
    return out.copy(p).applyMatrix4(this.office.root.matrixWorld);
  }

  /** a panner at an office-space point (game = true: the point is already in game space) */
  panner(spot, far = false, game = false) {
    const p = this.ctx.createPanner();
    p.panningModel = this.low || far ? "equalpower" : "HRTF";
    p.distanceModel = "inverse";
    p.refDistance = 0.8 * this.office.k;
    p.rolloffFactor = 1;
    p.maxDistance = 1e7;
    this.place(p, spot, game);
    p.connect(this.bus);
    return p;
  }

  place(p, spot, game = false) {
    const g = game ? spot : this.toGame(spot);
    if (p.positionX) {
      const t = this.ctx.currentTime;
      p.positionX.setValueAtTime(g.x, t);
      p.positionY.setValueAtTime(g.y, t);
      p.positionZ.setValueAtTime(g.z, t);
    } else p.setPosition(g.x, g.y, g.z);
  }

  /** a panner that keeps following a point (a function; game = it returns game-space points) */
  livePanner(spotFn, far, game = false) {
    const p = this.panner(spotFn(), far, game);
    this.live.push({ panner: p, spot: spotFn, game });
    return p;
  }

  // ---------------------------------------------------------------- building blocks

  makeNoise(seconds) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; // white noise loops seamlessly
    return buf;
  }

  noiseSrc(t, dur, loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    if (loop || dur > this.noise.duration - 0.1) {
      s.loop = true;
      s.start(t, Math.random() * 3);
      if (!loop) s.stop(t + dur);
    } else s.start(t, Math.random() * (this.noise.duration - dur - 0.01), dur);
    return s;
  }

  filter(type, freq, q = 1) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  env(t, peak, attack, decay) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  /** filtered noise burst */
  burst(dest, t, { type = "bandpass", freq = 2000, q = 1, gain = 0.3, attack = 0.002, decay = 0.05 }) {
    const n = this.noiseSrc(t, attack + decay + 0.02);
    n.connect(this.filter(type, freq, q)).connect(this.env(t, gain, attack, decay)).connect(dest);
  }

  /** oscillator blip */
  tone(dest, t, { type = "sine", freq = 440, freq2, gain = 0.2, attack = 0.005, decay = 0.1 }) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freq2) o.frequency.exponentialRampToValueAtTime(freq2, t + attack + decay);
    o.connect(this.env(t, gain, attack, decay)).connect(dest);
    o.start(t);
    o.stop(t + attack + decay + 0.02);
  }

  loadSamples() {
    const list = this.o.samples || {};
    const base = (typeof import.meta !== "undefined" && import.meta.env?.BASE_URL) || "/";
    for (const [name, url] of Object.entries(list)) {
      fetch(base + url)
        .then((r) => r.arrayBuffer())
        .then((a) => this.ctx.decodeAudioData(a))
        .then((b) => (this.buffers[name] = b))
        .catch((e) => console.warn(`[ambience] sample ${name} (${url}) not loaded: synthesised instead`, e));
    }
  }

  /** a recording in place of a synthesised sound (config.office.audio.samples) */
  sample(name, dest, t, { gain = 1, rate = 1, loop = false, dur } = {}) {
    const b = this.buffers[name];
    if (!b) return null;
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.loop = loop;
    s.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    s.connect(g).connect(dest);
    s.start(t);
    if (dur) s.stop(t + dur);
    return s;
  }

  // ---------------------------------------------------------------- room tone + clock

  roomTone() {
    const ctx = this.ctx, t = ctx.currentTime;
    this.longNodes = [];
    const tone = ctx.createGain();
    tone.gain.value = 0.0001;
    tone.gain.setTargetAtTime(1, t, 2); // fade in
    tone.connect(this.bus); // everywhere: not positional
    this.toneGain = tone;
    if (this.sample("roomtone", tone, t, { loop: true, gain: 0.5 })) return;
    // ventilation: low rumble + an airy band, slowly swelling
    const n = this.noiseSrc(t, 0, true);
    const rumble = this.filter("lowpass", 160, 0.7);
    const air = this.filter("bandpass", 650, 0.5);
    const rg = ctx.createGain(), ag = ctx.createGain();
    rg.gain.value = 0.22;
    ag.gain.value = 0.035;
    n.connect(rumble).connect(rg).connect(tone);
    n.connect(air).connect(ag).connect(tone);
    const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
    lfo.frequency.value = 0.06;
    lfoG.gain.value = 0.06;
    lfo.connect(lfoG).connect(rg.gain);
    lfo.start(t);
    // mains hum (50 Hz, Europe) and the fluorescent tubes' buzz
    for (const [f, g] of [[50, 0.012], [100, 0.008], [150, 0.003]]) {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.frequency.value = f;
      og.gain.value = g;
      o.connect(og).connect(tone);
      o.start(t);
      this.longNodes.push(o);
    }
    const buzz = this.noiseSrc(t, 0, true), bg = ctx.createGain();
    bg.gain.value = 0.004;
    buzz.connect(this.filter("bandpass", 4200, 8)).connect(bg).connect(tone);
    this.longNodes.push(n, lfo, buzz);
  }

  /** the wall clock: tick / tock, barely there */
  tick(t) {
    this.tickOdd = !this.tickOdd;
    const p = this.panner(SPOTS.clock, true);
    this.burst(p, t, { freq: this.tickOdd ? 3200 : 2700, q: 6, gain: 0.25, decay: 0.012 });
  }

  // ---------------------------------------------------------------- her

  /** typing on her keyboard while she plays Type: bursts of keys, pauses */
  typingTick(t) {
    if (!this.typing) return 0.25;
    const p = this.panner(SPOTS.keyboard);
    const keys = (rnd(3, 22)) | 0;
    let dt = 0;
    for (let i = 0; i < keys; i++) {
      this.key(p, t + dt, Math.random() < 0.12);
      dt += rnd(0.07, 0.17);
    }
    return dt + rnd(0.2, 1.8);
  }

  key(dest, t, space = false) {
    if (this.sample("typing", dest, t, { gain: 0.6, rate: rnd(0.9, 1.1), dur: 0.12 })) return;
    this.burst(dest, t, { freq: space ? 1500 : rnd(2600, 4200), q: 2, gain: space ? 1.0 : 0.8, decay: 0.018 });
    this.tone(dest, t, { freq: space ? 120 : rnd(170, 230), freq2: 90, gain: space ? 0.8 : 0.4, attack: 0.002, decay: 0.03 });
  }

  onClip(clip, now) {
    for (const [at, ev] of CLIP_EVENTS[clip.name] || []) {
      const when = now + at - clip.time;
      if (when >= now - 0.02) this[ev](Math.max(now, when));
    }
  }

  mouseClick(t) {
    const p = this.panner(SPOTS.mouse);
    this.burst(p, t, { freq: 4500, q: 3, gain: 0.25, decay: 0.008 });
    this.burst(p, t + 0.07, { freq: 3800, q: 3, gain: 0.15, decay: 0.008 });
  }

  cupUp(t) {
    const p = this.panner(SPOTS.mug);
    this.burst(p, t, { freq: 900, q: 1, gain: 0.12, decay: 0.04 });
  }

  cupDown(t) {
    const p = this.panner(SPOTS.mug);
    this.tone(p, t, { freq: 2150, gain: 0.08, decay: 0.25 });
    this.tone(p, t, { freq: 3320, gain: 0.05, decay: 0.18 });
    this.tone(p, t, { freq: 160, freq2: 80, gain: 0.25, attack: 0.002, decay: 0.06 });
  }

  slurp(t) {
    const p = this.panner(SPOTS.mouth);
    const n = this.noiseSrc(t, 0.7);
    const f = this.filter("bandpass", 900, 4);
    f.frequency.setValueAtTime(700, t);
    f.frequency.linearRampToValueAtTime(1800, t + 0.5);
    n.connect(f).connect(this.env(t, 0.18, 0.08, 0.5)).connect(p);
  }

  creak(t) {
    const p = this.panner(SPOTS.chair);
    const o = this.ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(rnd(380, 460), t);
    o.frequency.linearRampToValueAtTime(rnd(520, 640), t + 0.35);
    o.connect(this.filter("bandpass", 900, 6)).connect(this.env(t, 0.08, 0.05, 0.35)).connect(p);
    o.start(t);
    o.stop(t + 0.45);
  }

  sigh(t) {
    const p = this.panner(SPOTS.mouth);
    const n = this.noiseSrc(t, 1.2);
    const f = this.filter("lowpass", 1100, 0.7);
    f.frequency.setValueAtTime(1300, t);
    f.frequency.linearRampToValueAtTime(500, t + 1.0);
    n.connect(f).connect(this.env(t, 0.2, 0.25, 0.85)).connect(p);
  }

  /** the CV crinkles under the players' feet as she pinches it: big, close, everywhere */
  paperGrab(t) {
    const out = this.ctx.createGain();
    out.gain.value = 1;
    out.connect(this.bus);
    this.tone(out, t, { freq: 70, freq2: 35, gain: 0.5, attack: 0.01, decay: 0.5 });
    for (let i = 0; i < 40; i++) {
      const tt = t + Math.pow(Math.random(), 1.5) * 0.7;
      this.burst(out, tt, { freq: rnd(400, 5000), q: rnd(1, 4), gain: rnd(0.08, 0.35), decay: rnd(0.01, 0.05) });
    }
  }

  rustle(t) {
    const out = this.ctx.createGain();
    out.gain.value = 0.6;
    out.connect(this.bus);
    for (let i = 0; i < 16; i++) {
      this.burst(out, t + Math.random() * 0.45, { freq: rnd(1200, 6000), q: 2, gain: rnd(0.04, 0.15), decay: rnd(0.01, 0.04) });
    }
  }

  chairRoll(t) {
    const p = this.panner(SPOTS.chair);
    const n = this.noiseSrc(t, 1.6);
    const f = this.filter("lowpass", 220, 1);
    const trem = this.ctx.createGain();
    const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
    lfo.frequency.value = 11;
    lg.gain.value = 0.4;
    lfo.connect(lg).connect(trem.gain);
    lfo.start(t);
    lfo.stop(t + 1.6);
    n.connect(f).connect(trem).connect(this.env(t, 0.35, 0.2, 1.2)).connect(p);
    this.creak(t + 0.2);
  }

  // ---------------------------------------------------------------- the shredder

  updateShredder(dt, now) {
    const s = this.office.shred;
    const on = s?.feeding && s.progress < 1;
    if (on && !this.shredder) this.startShredder(now);
    else if (!on && this.shredder) this.stopShredder(now);
    if (this.shredder) {
      // the paper crunch: random hits on a fast grain
      const g = this.shredder.crunch.gain;
      g.setTargetAtTime(0.12 + Math.random() * 0.35, now, 0.01);
    }
  }

  startShredder(t) {
    const ctx = this.ctx;
    const p = this.office.throat
      ? this.livePanner(() => this.office.throat.getWorldPosition(this._throat), false, true)
      : this.livePanner(() => SPOTS.mug, false);
    p.refDistance = 1.2 * this.office.k; // loud: the page goes into it
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(2.2, t + 0.35);
    out.connect(p);
    const nodes = [];
    const recorded = this.sample("shredder", out, t, { loop: true });
    if (recorded) nodes.push(recorded);
    else {
      for (const [f, g] of [[72, 0.25], [144, 0.12], [216, 0.05]]) {
        const o = ctx.createOscillator(), og = ctx.createGain();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(f * 0.5, t);
        o.frequency.exponentialRampToValueAtTime(f, t + 0.3);
        og.gain.value = g;
        o.connect(this.filter("lowpass", 900, 0.7)).connect(og).connect(out);
        o.start(t);
        nodes.push(o);
      }
    }
    const crunch = ctx.createGain();
    crunch.gain.value = 0.2;
    const n = this.noiseSrc(t, 0, true);
    n.connect(this.filter("bandpass", 1600, 0.8)).connect(crunch).connect(out);
    nodes.push(n);
    this.shredder = { out, nodes, crunch, panner: p };
  }

  stopShredder(t) {
    const { out, nodes, panner } = this.shredder;
    out.gain.cancelScheduledValues(t);
    out.gain.setValueAtTime(out.gain.value || 1, t);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    for (const n of nodes) {
      if (n.frequency) n.frequency.exponentialRampToValueAtTime(30, t + 0.7);
      n.stop(t + 0.75);
    }
    this.live = this.live.filter((l) => l.panner !== panner);
    this.shredder = null;
  }

  // ---------------------------------------------------------------- the rest of the office

  coworkerTyping(t) {
    const p = this.panner(pick(PODS), true);
    const g = this.ctx.createGain();
    g.gain.value = 0.6;
    g.connect(p);
    let dt = 0;
    for (let i = 0, n = rnd(6, 30) | 0; i < n; i++) {
      this.key(g, t + dt, Math.random() < 0.1);
      dt += rnd(0.08, 0.2);
    }
  }

  /** a desk phone: an electronic trill, 2-5 rings; nobody picks up hers */
  phone(t) {
    const spot = Math.random() < 0.3 ? SPOTS.herPhone : pick(PODS);
    const p = this.panner(spot, spot !== SPOTS.herPhone);
    const rings = rnd(2, 6) | 0;
    for (let r = 0; r < rings; r++) {
      const tr = t + r * 3.2;
      if (this.sample("phone", p, tr, { gain: 0.7, dur: 2.9 })) continue;
      // an electronic trill: one tone switching between 1320 and 1640 Hz 16 times a second
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, tr);
      g.gain.exponentialRampToValueAtTime(0.6, tr + 0.02);
      g.gain.setValueAtTime(0.6, tr + 1.6);
      g.gain.exponentialRampToValueAtTime(0.0001, tr + 1.7);
      g.connect(p);
      const o = this.ctx.createOscillator(), sq = this.ctx.createOscillator(), depth = this.ctx.createGain();
      o.type = "triangle";
      o.frequency.value = 1480;
      sq.type = "square";
      sq.frequency.value = 16;
      depth.gain.value = 160;
      sq.connect(depth).connect(o.frequency);
      o.connect(g);
      for (const x of [o, sq]) {
        x.start(tr);
        x.stop(tr + 1.75);
      }
    }
  }

  /** the photocopier: motor, a scanning light that sweeps, pages thumping out */
  copier(t) {
    const p = this.panner(SPOTS.copier, true);
    const pages = rnd(4, 14) | 0;
    const dur = 1.2 + pages * 1.6;
    if (this.sample("copier", p, t, { gain: 0.8, dur })) return;
    const motor = this.ctx.createOscillator();
    motor.type = "sawtooth";
    motor.frequency.value = 96;
    motor.connect(this.filter("lowpass", 500, 0.7)).connect(this.envHold(t, 0.4, 0.5, dur, 0.6)).connect(p);
    motor.start(t);
    motor.stop(t + dur + 0.7);
    const fan = this.noiseSrc(t, dur + 0.8);
    fan.connect(this.filter("bandpass", 1100, 0.6)).connect(this.envHold(t, 0.18, 0.4, dur, 0.6)).connect(p);
    for (let i = 0; i < pages; i++) {
      const tp = t + 0.8 + i * 1.6;
      const sweep = this.noiseSrc(tp, 1.0);
      const f = this.filter("bandpass", 400, 3);
      f.frequency.setValueAtTime(350, tp);
      f.frequency.exponentialRampToValueAtTime(2200, tp + 0.9);
      sweep.connect(f).connect(this.env(tp, 0.25, 0.1, 0.8)).connect(p);
      this.burst(p, tp + 1.2, { freq: 1800, q: 1, gain: 0.4, attack: 0.01, decay: 0.12 }); // page out
      this.tone(p, tp + 1.32, { freq: 110, freq2: 60, gain: 0.45, attack: 0.003, decay: 0.08 }); // thump
    }
  }

  /** the laser printer: a high whine and quick page clacks */
  printer(t) {
    const p = this.panner(SPOTS.printer, true);
    const pages = rnd(2, 8) | 0;
    const dur = 2 + pages * 0.9;
    if (this.sample("printer", p, t, { gain: 0.8, dur })) return;
    const whine = this.ctx.createOscillator();
    whine.frequency.value = 1750;
    whine.connect(this.envHold(t, 0.05, 0.8, dur, 0.5)).connect(p);
    whine.start(t);
    whine.stop(t + dur + 0.6);
    const roll = this.noiseSrc(t, dur + 0.6);
    roll.connect(this.filter("bandpass", 700, 1)).connect(this.envHold(t, 0.18, 0.5, dur, 0.5)).connect(p);
    for (let i = 0; i < pages; i++) {
      const tp = t + 1.6 + i * 0.9;
      this.burst(p, tp, { freq: 2500, q: 2, gain: 0.4, decay: 0.03 });
      this.burst(p, tp + 0.35, { freq: 1300, q: 1, gain: 0.35, attack: 0.01, decay: 0.1 });
    }
  }

  envHold(t, peak, attack, hold, release) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    return g;
  }

  /** somebody walking across the carpet (and sometimes a drink at the water cooler) */
  footsteps(t) {
    const path = pick(WALKS);
    const reverse = Math.random() < 0.5;
    const pts = reverse ? [...path].reverse() : path;
    const seg = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = pts[i].distanceTo(pts[i - 1]);
      seg.push(d);
      total += d;
    }
    const step = 0.72, pace = 0.55; // metres per step, seconds per step
    const n = Math.floor(total / step);
    for (let i = 0; i < n; i++) {
      let s = i * step, k = 0;
      while (k < seg.length - 1 && s > seg[k]) s -= seg[k++];
      const at = pts[k].clone().lerp(pts[k + 1], Math.min(1, s / seg[k]));
      const p = this.panner(at, true);
      const tt = t + i * pace + rnd(-0.03, 0.03);
      this.burst(p, tt, { type: "lowpass", freq: 450, q: 0.7, gain: 4, attack: 0.005, decay: 0.09 });
      this.burst(p, tt + 0.02, { freq: 1000, q: 1, gain: 0.8, decay: 0.05 });
    }
    if (pts[pts.length - 1].distanceTo(SPOTS.cooler) < 1 && Math.random() < 0.7) this.glug(t + n * pace + 1.2);
  }

  glug(t) {
    const p = this.panner(SPOTS.cooler, true);
    for (let i = 0; i < 5; i++) {
      const tt = t + i * rnd(0.18, 0.3);
      this.tone(p, tt, { freq: rnd(180, 260), freq2: rnd(420, 600), gain: 0.5, attack: 0.01, decay: 0.12 });
    }
  }

  // ---------------------------------------------------------------- chatter

  /**
   * Distant, indistinct conversation: 2-3 voices take turns. Each voice is a buzzy source (a
   * sawtooth with a little pitch wobble) through three vowel formant filters that jump to a new
   * vowel every syllable, behind a low-pass and plenty of room echo. Returns the next start.
   */
  conversation(t) {
    const n = Math.min(this.o.voices, this.low ? 2 : 3);
    const where = pick(PODS);
    const voices = [];
    for (let i = 0; i < n; i++) {
      const spot = where.clone().add(new THREE.Vector3(rnd(-0.8, 0.8), 0.45, rnd(-0.6, 0.6)));
      voices.push(this.voice(spot, i % 2 ? rnd(95, 130) : rnd(170, 230), t));
    }
    let tt = t + 0.3;
    const end = t + rnd(12, 35);
    let who = 0;
    while (tt < end) {
      const v = voices[who];
      tt = this.phrase(v, tt) + rnd(0.15, 0.9);
      who = (who + (Math.random() < 0.8 ? 1 : 0)) % voices.length;
      if (Math.random() < 0.08) tt = this.laugh(voices[(who + 1) % voices.length], tt);
    }
    for (const v of voices) v.stop(tt + 0.5);
    return tt - t + rnd(8, 25);
  }

  voice(spot, f0, t) {
    const ctx = this.ctx;
    const p = this.panner(spot, true);
    const lp = this.filter("lowpass", 1400, 0.7);
    const level = ctx.createGain();
    level.gain.value = 3;
    lp.connect(level).connect(p);
    const amp = ctx.createGain();
    amp.gain.value = 0.0001;
    amp.connect(lp);
    const src = ctx.createOscillator();
    src.type = "sawtooth";
    src.frequency.value = f0;
    const formants = [0.9, 0.5, 0.25].map((g) => {
      const f = this.filter("bandpass", 600, 8);
      const fg = ctx.createGain();
      fg.gain.value = g;
      src.connect(f).connect(fg).connect(amp);
      return f;
    });
    src.start(t);
    const rec = this.buffers.chatter ? this.sample("chatter", p, t, { loop: true, gain: 0.5, rate: f0 > 150 ? 1.05 : 0.95 }) : null;
    return {
      f0, src, amp, formants, rec,
      stop: (at) => {
        src.stop(at);
        rec?.stop(at);
      },
    };
  }

  /** one phrase: 3-12 syllables, pitch falling towards the end */
  phrase(v, t) {
    if (v.rec) return t + rnd(1, 3);
    const syll = rnd(3, 13) | 0;
    let tt = t;
    for (let i = 0; i < syll; i++) {
      const len = rnd(0.09, 0.22);
      const vw = pick(VOWELS);
      v.formants.forEach((f, k) => f.frequency.setTargetAtTime(vw[k] * rnd(0.92, 1.08), tt, 0.015));
      const pitch = v.f0 * (1.12 - 0.22 * (i / syll)) * rnd(0.95, 1.06);
      v.src.frequency.setTargetAtTime(pitch, tt, 0.03);
      const peak = rnd(0.25, 0.6);
      v.amp.gain.setTargetAtTime(peak, tt, 0.012);
      v.amp.gain.setTargetAtTime(peak * 0.15, tt + len * 0.7, 0.02);
      tt += len;
    }
    v.amp.gain.setTargetAtTime(0.0001, tt, 0.03);
    return tt;
  }

  laugh(v, t) {
    if (v.rec) return t;
    let tt = t;
    for (let i = 0; i < 5; i++) {
      v.formants.forEach((f, k) => f.frequency.setTargetAtTime([800, 1250, 2600][k], tt, 0.01));
      v.src.frequency.setTargetAtTime(v.f0 * (1.5 - i * 0.06), tt, 0.01);
      v.amp.gain.setTargetAtTime(0.5, tt, 0.008);
      v.amp.gain.setTargetAtTime(0.02, tt + 0.08, 0.015);
      tt += 0.16;
    }
    return tt + 0.3;
  }
}
