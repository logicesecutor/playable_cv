// Word shots (claude/CHARACTERS.md, Phase 4): the typewriter blaster "prints" every shot.
//
// - Every shot (ours and other players') flies a small typed paper slip with a rejection word
//   (NO, NOPE, NEXT…) along the shot line at ~120 m/s, sticks at the impact for a moment, then
//   flutters down and fades. Purely visual: hits stay instant hitscan, nothing new on the network.
//   The word is picked from (shooter id, shot sequence number), which every client already has,
//   so everyone sees the same word for the same shot.
// - A letter destroyed: a red rubber stamp REJECTED pops up over it, slams down and stays printed
//   on the paper (so it shows on the floor and the minimap; at most one printed stamp per ~7 m,
//   STAMP_GAP; a rematch clears them: destruction.resetAll() restores the paper, then reset()).
// - A player killed: a big red FIRED! stamp pops up over them (seen through walls) and floats away.
// Wiring (main.js): weapon.onTracer -> ownShot(), remoteShots.words -> shot(),
// destruction.onDestroyed -> rejected(), pvp onDied -> fired(), update(dt) every frame.
import * as THREE from "three";

/** every shot */
export const WORDS = ["NO", "NOPE", "NEXT", "NAH", "PASS", "DENIED", "LATER", "OOF"];
/** now and then (1 in 8) */
export const RARE_WORDS = ["UNFORTUNATELY…", "NOT A FIT", "GHOSTED", "OVERQUALIFIED", "POSITION FILLED", "WE'LL BE IN TOUCH"];

const SPEED = 120; // m/s along the shot line
// slip height in metres (width follows the word): small out of the slot, growing with the distance
// flown so the word stays readable far away
const SLIP_H0 = 0.1, SLIP_GROW = 0.03, SLIP_HMAX = 0.75;
const POOL = 64;
const STAMP_GAP = 7; // m: no new printed stamp this close to another one (keeps them readable)

/** deterministic word for a shot: same on every client */
export function pickWord(shooter, seq) {
  let h = Math.imul((shooter + 1) * 0x9e3779b1 + seq * 0x85ebca6b, 0xc2b2ae35) >>> 0;
  h ^= h >>> 15;
  if (h % 8 === 0) return RARE_WORDS[(h >>> 3) % RARE_WORDS.length];
  return WORDS[(h >>> 3) % WORDS.length];
}

// ------------------------------------------------------------------ textures (canvas, cached)
const FONT = '"Courier New", Courier, "Liberation Mono", monospace';
const slipCache = new Map();

/** a typed paper slip: off-white strip, slightly torn ends, uneven typewriter ink */
function slipTexture(word) {
  let t = slipCache.get(word);
  if (t) return t;
  const H = 64, pad = 22;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  ctx.font = `bold 40px ${FONT}`;
  const W = Math.ceil(ctx.measureText(word).width + pad * 2);
  c.width = W;
  c.height = H;
  // paper with torn (zig-zag) short ends
  ctx.fillStyle = "#fbf8ef";
  ctx.beginPath();
  ctx.moveTo(4, 6);
  for (let x = 4; x < W - 4; x += 8) ctx.lineTo(x, 6 + Math.random() * 1.5);
  ctx.lineTo(W - 4, 6);
  for (let y = 6; y < H - 6; y += 6) ctx.lineTo(W - 4 - Math.random() * 4, y);
  ctx.lineTo(W - 4, H - 6);
  for (let x = W - 4; x > 4; x -= 8) ctx.lineTo(x, H - 6 - Math.random() * 1.5);
  ctx.lineTo(4, H - 6);
  for (let y = H - 6; y > 6; y -= 6) ctx.lineTo(4 + Math.random() * 4, y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(120,110,95,0.35)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // typewriter ink: each character slightly off-line and of uneven darkness
  ctx.font = `bold 40px ${FONT}`;
  ctx.textBaseline = "middle";
  let x = pad;
  for (const ch of word) {
    ctx.fillStyle = `rgba(28,28,34,${0.78 + Math.random() * 0.22})`;
    ctx.fillText(ch, x + (Math.random() - 0.5) * 1.2, H / 2 + 2 + (Math.random() - 0.5) * 2.2);
    x += ctx.measureText(ch).width;
  }
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.userData.aspect = W / H;
  slipCache.set(word, t);
  return t;
}

const stampCache = new Map();
/** a red rubber stamp: double border, bold capitals, speckled ink. Transparent background. */
export function stampCanvas(text) {
  let c = stampCache.get(text);
  if (c) return c;
  const H = 150, padX = 40;
  c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  ctx.font = `900 92px Impact, "Arial Black", "Helvetica Neue", sans-serif`;
  const W = Math.ceil(ctx.measureText(text).width + padX * 2);
  c.width = W;
  c.height = H;
  const red = "rgb(206,32,44)";
  ctx.strokeStyle = red;
  ctx.fillStyle = red;
  ctx.lineJoin = "round";
  ctx.lineWidth = 9;
  roundRect(ctx, 8, 8, W - 16, H - 16, 18);
  ctx.stroke();
  ctx.lineWidth = 3.5;
  roundRect(ctx, 22, 22, W - 44, H - 44, 10);
  ctx.stroke();
  ctx.font = `900 92px Impact, "Arial Black", "Helvetica Neue", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, W / 2, H / 2 + 5);
  // worn stamp: knock speckles out of the ink
  ctx.globalCompositeOperation = "destination-out";
  for (let i = 0; i < (W * H) / 90; i++) {
    ctx.globalAlpha = 0.25 + Math.random() * 0.6;
    ctx.beginPath();
    ctx.arc(Math.random() * W, Math.random() * H, 0.6 + Math.random() * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  stampCache.set(text, c);
  return c;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const stampTexCache = new Map();
function stampTexture(text) {
  let t = stampTexCache.get(text);
  if (!t) {
    const c = stampCanvas(text);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.userData.aspect = c.width / c.height;
    stampTexCache.set(text, t);
  }
  return t;
}

// ------------------------------------------------------------------ the effect
export class WordShots {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera slips and pop-up stamps face it
   * @param {import("../world/destruction.js").Destruction} destruction its paper gets the printed stamps
   * @param {typeof import("../config.js").config} cfg
   */
  constructor(scene, camera, destruction, cfg) {
    this.camera = camera;
    this.destruction = destruction;
    this.cfg = cfg;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.slips = [];
    for (let i = 0; i < POOL; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = 3;
      m.userData = { t: 0, life: 0 };
      scene.add(m);
      this.slips.push(m);
    }
    this.next = 0;
    this.pops = []; // pop-up stamps (REJECTED / FIRED!)
    this.scene = scene;
    this.stamps = []; // printed stamp positions (x, z)
    this.localSeq = 0;
    this.printed = 0; // stamps printed on the paper so far
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
  }

  /**
   * A shot's slip. from / to: world points (muzzle, where it hit); kind 0 miss, 1 floor,
   * 2 letter, 3 player; word: pickWord(shooter, seq).
   */
  shot(from, to, kind, word) {
    const m = this.slips[this.next];
    this.next = (this.next + 1) % this.slips.length;
    const tex = slipTexture(word);
    const d = m.userData;
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len < 0.5) return;
    dir.divideScalar(len);
    d.from = from.clone().addScaledVector(dir, 0.45); // starts just out of the paper slot
    d.dir = dir;
    d.len = Math.max(0, len - 0.45 - (kind === 0 ? 0 : 0.12)); // stops just in front of what it hit
    d.kind = kind;
    d.t = 0;
    d.fly = d.len / SPEED;
    d.life = kind === 0 ? Math.min(d.fly, 0.4) : d.fly + 1.5;
    d.roll = (Math.random() - 0.5) * 0.6;
    d.spin = (Math.random() - 0.5) * 9;
    d.sway = Math.random() * 6.28;
    d.fall = 0;
    d.drift = new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6);
    m.material.map = tex;
    m.material.opacity = 1;
    m.material.needsUpdate = true;
    d.aspect = tex.userData.aspect;
    m.scale.set(SLIP_H0 * d.aspect, SLIP_H0, 1);
    m.position.copy(d.from);
    m.visible = true;
  }

  /** our own shot (the sequence number is the one sync sends, so others pick the same word) */
  ownShot(from, to, kind, selfId, seq) {
    this.shot(from, to, kind, pickWord(selfId ?? 0, seq ?? ++this.localSeq));
  }

  /** a letter was destroyed: REJECTED pops up over it, slams down, and is printed on the paper */
  rejected(e) {
    const b = e.box;
    const x = (b.minX + b.maxX) / 2, z = (b.minZ + b.maxZ) / 2;
    const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
    // one printed stamp per neighbourhood, or the paper turns into red mush
    const print = !this.stamps.some((s) => Math.hypot(s.x - x, s.z - z) < STAMP_GAP);
    if (!print && this.pops.some((p) => p.text === "REJECTED" && p.t < 0.5 && Math.hypot(p.x - x, p.z - z) < STAMP_GAP)) return;
    const size = Math.min(8, Math.max(5, Math.max(w, d) * 1.8)); // stamp width, metres
    if (print) this.stamps.push({ x, z });
    this.pop("REJECTED", x, e.height + 1.2, z, size, { print, rot: (Math.random() - 0.5) * 0.6 });
  }

  /** a player was killed: FIRED! over them */
  fired(x, y, z) {
    this.pop("FIRED!", x, y + 2.4, z, 2.6, { print: false, rot: (Math.random() - 0.5) * 0.3 });
  }

  pop(text, x, y, z, width, { print, rot }) {
    const tex = stampTexture(text);
    // FIRED! shows through walls (you want to see your kill); REJECTED is hidden behind letters
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, depthTest: text !== "FIRED!" });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1 / tex.userData.aspect), mat);
    m.renderOrder = 5;
    m.frustumCulled = false;
    this.scene.add(m);
    this.pops.push({ text, mesh: m, x, y, z, width, t: 0, print, rot, baked: false });
  }

  /** every frame */
  update(dt) {
    const cam = this.camera;
    for (const m of this.slips) {
      if (!m.visible) continue;
      const d = m.userData;
      d.t += dt;
      if (d.t >= d.life) {
        m.visible = false;
        continue;
      }
      if (d.t < d.fly) {
        // in flight: along the shot line, tumbling a little
        m.position.copy(d.from).addScaledVector(d.dir, d.t * SPEED);
        d.roll += d.spin * dt;
      } else if (d.kind !== 0) {
        // stuck at the impact for a moment, then flutters down
        const s = d.t - d.fly;
        m.position.copy(d.from).addScaledVector(d.dir, d.len);
        if (s > 0.25) {
          const f = s - 0.25;
          d.fall = Math.min(1.1, 0.5 * f * 2.2) * f;
          m.position.y = Math.max(0.05, m.position.y - d.fall);
          m.position.x += Math.sin(d.sway + f * 5) * 0.25 + d.drift.x * f;
          m.position.z += Math.cos(d.sway + f * 4) * 0.12 + d.drift.z * f;
          d.roll = Math.sin(d.sway + f * 6) * 0.6;
        }
        m.material.opacity = Math.min(1, (d.life - d.t) / 0.6);
      }
      if (d.kind === 0) m.material.opacity = Math.min(1, (d.life - d.t) / 0.15);
      const h = Math.min(SLIP_HMAX, SLIP_H0 + Math.min(d.t, d.fly) * SPEED * SLIP_GROW);
      m.scale.set(h * d.aspect, h, 1);
      m.quaternion.copy(cam.quaternion);
      m.rotateZ(d.roll);
    }

    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t += dt;
      const m = p.mesh;
      m.quaternion.copy(cam.quaternion);
      m.rotateZ(p.rot);
      let s, y = p.y, alpha = 1, done = false;
      if (p.t < 0.14) s = (p.t / 0.14) * 1.25; // pop
      else if (p.t < 0.26) s = 1.25 - ((p.t - 0.14) / 0.12) * 0.25; // settle
      else s = 1;
      if (p.print) {
        // hold, then slam down onto the paper and print
        if (p.t > 0.55) {
          const k = Math.min(1, (p.t - 0.55) / 0.14);
          y = p.y + (0.05 - p.y) * k * k;
          if (k >= 1 && !p.baked) {
            this.print(p.text, p.x, p.z, p.width, p.rot);
            p.baked = true;
          }
          alpha = k < 1 ? 1 : 0;
          done = k >= 1;
        }
      } else {
        // FIRED!: wobble, float up, fade
        if (p.t > 0.26) m.rotateZ(Math.sin(p.t * 18) * 0.08 * Math.max(0, 1 - (p.t - 0.26) * 2));
        y = p.y + Math.max(0, p.t - 0.5) * 0.6;
        alpha = Math.min(1, (1.6 - p.t) / 0.5);
        done = p.t > 1.6;
      }
      m.position.set(p.x, y, p.z);
      m.scale.setScalar(p.width * s);
      m.material.opacity = Math.max(0, alpha);
      if (done) {
        m.removeFromParent();
        m.geometry.dispose();
        m.material.dispose();
        this.pops.splice(i, 1);
      }
    }
  }

  /** print a stamp onto the paper (floor texture + minimap), like the burns */
  print(text, x, z, width, rot) {
    const D = this.destruction;
    const ctx = D.paperCtx;
    const c = stampCanvas(text);
    const pxPerM = D.pdf.rasterScale / this.cfg.metersPerPt;
    const w = width * pxPerM, h = (w * c.height) / c.width;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(x * pxPerM, z * pxPerM);
    ctx.rotate(-rot); // the pop-up faced the camera; on the page, a slight random tilt
    ctx.globalAlpha = 0.88; // ink on top of the soot (the canvas' speckles let the paper show through)
    ctx.drawImage(c, -w / 2, -h / 2, w, h);
    ctx.restore();
    D.paperDirty = true;
    this.printed++;
  }

  /** a rematch restores the paper: forget where the stamps were */
  reset() {
    this.stamps.length = 0;
    for (const p of this.pops) {
      p.mesh.removeFromParent();
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    }
    this.pops.length = 0;
    for (const m of this.slips) m.visible = false;
  }

  dispose() {
    this.reset();
    for (const m of this.slips) {
      m.removeFromParent();
      m.material.dispose();
    }
    this.slips[0]?.geometry.dispose();
  }
}
