// First-person player: pointer-lock look, WASD, sprint, crouch, jump, gravity, collisions with the
// real letter shapes (CollisionWorld). Owns the player's feet position and drives the camera.
//
// The movement itself lives in PlayerCore (plain math, simulated in Node by tools/sim-player.mjs).
import * as THREE from "three";
import { PlayerCore } from "./playerCore.js";

const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);

export class PlayerController {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} dom element that captures the pointer
   * @param {import("../world/collision.js").CollisionWorld} collision
   * @param {typeof import("../config.js").config} cfg
   */
  constructor(camera, dom, collision, cfg) {
    this.camera = camera;
    this.dom = dom;
    this.cfg = cfg;
    this.enabled = false;
    this.locked = false;
    this.core = new PlayerCore(collision, cfg.player);
    this.keys = new Set();
    this.euler = new THREE.Euler(0, 0, 0, "YXZ");
    /** called on pointer lock changes: (locked:boolean) => void */
    this.onLockChanged = null;
    /** hooks for later milestones (footstep sounds, landing thud) */
    this.onFootstep = null;
    this.onLand = null;

    this.camY = 0; // smoothed eye height (absorbs step-ups)
    this.punch = 0; // visual recoil pitch (rad), decays
    this.shake = 0; // camera shake amplitude (m), decays
    this._look = { dx: 0, dy: 0 };
    this.bobPhase = 0;
    this.landDip = 0;
    this.keyLookRamp = 0; // arrow-key look accelerates from 35% to full speed
    /** fired (once) when it looks like the OS paused the touchpad while keys are held */
    this.onTouchpadPaused = null;
    this._lastMouseMove = 0;
    this._moveKeysSince = 0; // when the current run of held movement keys started
    this._mouseWasActive = false; // the pointer was moving right before that
    this._suspicions = 0;
    this._hintShown = false;

    this._listeners = [
      [document, "mousemove", (e) => {
        if (!this.locked || !this.enabled) return;
        if (e.movementX || e.movementY) this._lastMouseMove = performance.now();
        // some browsers report a huge jump on the first event after locking
        const mx = Math.max(-300, Math.min(300, e.movementX));
        const my = Math.max(-300, Math.min(300, e.movementY));
        this._look.dx += mx;
        this._look.dy += my;
        this.core.yaw -= mx * cfg.mouseSensitivity;
        this.core.pitch -= my * cfg.mouseSensitivity;
        this.core.pitch = Math.max(-1.55, Math.min(1.55, this.core.pitch));
      }],
      [document, "keydown", (e) => {
        if (!this.enabled) return;
        // keep arrows / space from scrolling or clicking focused buttons while playing
        if (this.locked && (e.code.startsWith("Arrow") || e.code === "Space")) e.preventDefault();
        if (e.repeat) return;
        if (MOVE_KEYS.has(e.code) && !this.anyMoveKey()) {
          const now = performance.now();
          this._moveKeysSince = now;
          this._mouseWasActive = now - this._lastMouseMove < 400;
        }
        this.keys.add(e.code);
        if (e.code === "Space") this.core.queueJump();
        if (e.code === "KeyV") this.core.fly = !this.core.fly;
      }],
      [document, "keyup", (e) => this.keys.delete(e.code)],
      [window, "blur", () => this.keys.clear()],
      [document, "pointerlockchange", () => {
        this.locked = document.pointerLockElement === this.dom;
        if (!this.locked) this.keys.clear();
        this.onLockChanged?.(this.locked);
      }],
      [dom, "click", () => this.lock()],
    ];
    for (const [t, ev, fn] of this._listeners) t.addEventListener(ev, fn);
  }

  lock() {
    if (!this.enabled || this.locked) return;
    // Chrome refuses a re-lock for ~1 s after Esc; the next click will work
    const p = this.dom.requestPointerLock?.();
    p?.catch?.(() => {});
  }

  /** place the player (feet) and face direction; yaw 0 looks up the page (-Z) */
  spawn(x, z, yaw = 0) {
    this.core.reset(x, z, yaw);
    this.camY = this.core.y + this.cfg.player.eyeHeight;
    this.syncCamera(0);
  }

  update(dt) {
    if (!this.enabled) return;
    const k = this.keys;

    // arrow keys aim: a full keyboard alternative to the mouse / touchpad
    const lx = (k.has("ArrowRight") ? 1 : 0) - (k.has("ArrowLeft") ? 1 : 0);
    const ly = (k.has("ArrowUp") ? 1 : 0) - (k.has("ArrowDown") ? 1 : 0);
    if ((lx || ly) && this.locked) {
      this.keyLookRamp = Math.min(1, this.keyLookRamp + dt * 3);
      const sp = this.cfg.keyLookSpeed * (0.35 + 0.65 * this.keyLookRamp) * dt;
      this.core.yaw -= lx * sp;
      this.core.pitch = Math.max(-1.55, Math.min(1.55, this.core.pitch + ly * sp * 0.7));
      this._look.dx += (lx * sp) / this.cfg.mouseSensitivity; // so the gun sways the same way
      this._look.dy -= (ly * sp * 0.7) / this.cfg.mouseSensitivity;
    } else this.keyLookRamp = 0;

    this.detectTouchpadPause();

    const input = {
      forward: (k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0),
      right: (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0),
      sprint: k.has("ShiftLeft") || k.has("ShiftRight"),
      crouch: k.has("KeyC"), // not Ctrl: Ctrl+W would close the tab
      up: k.has("KeyE") || k.has("Space"),
      down: k.has("KeyQ"),
    };
    if (!this.locked) { input.forward = input.right = 0; }

    const ev = this.core.step(dt, input);
    if (ev.landed) {
      this.landDip = Math.min(0.35, ev.impact * 0.025);
      this.onLand?.(ev.impact);
    }
    if (ev.footstep) this.onFootstep?.(this.core);
    this.syncCamera(dt);
  }

  syncCamera(dt) {
    const c = this.core, p = this.cfg.player;
    const eye = c.y + c.eye;
    // follow step-ups smoothly, but never lag when falling
    if (dt === 0 || eye < this.camY || c.fly) this.camY = eye;
    else this.camY += (eye - this.camY) * Math.min(1, dt * 14);

    const speed = Math.hypot(c.vx, c.vz);
    if (c.grounded && speed > 0.5) this.bobPhase += dt * speed * 1.7;
    const bobAmt = c.grounded ? Math.min(1, speed / p.sprintSpeed) * p.headBob : 0;
    this.landDip *= Math.exp(-dt * 9);
    this.punch *= Math.exp(-dt * 16);
    this.shake *= Math.exp(-dt * 7);
    const sh = this.shake;

    this.camera.position.set(
      c.x + Math.cos(this.bobPhase * 0.5) * bobAmt * 0.5 * Math.cos(c.yaw) + (Math.random() - 0.5) * sh,
      this.camY + Math.abs(Math.sin(this.bobPhase)) * bobAmt - this.landDip + (Math.random() - 0.5) * sh,
      c.z - Math.cos(this.bobPhase * 0.5) * bobAmt * 0.5 * Math.sin(c.yaw) + (Math.random() - 0.5) * sh,
    );
    this.euler.set(Math.min(1.55, c.pitch + this.punch), c.yaw, (Math.random() - 0.5) * sh * 0.05, "YXZ");
    this.camera.quaternion.setFromEuler(this.euler);
  }

  anyMoveKey() {
    for (const c of MOVE_KEYS) if (this.keys.has(c)) return true;
    return false;
  }

  // Linux (libinput) and some laptops ignore the touchpad while a key is held ("disable while
  // typing"). The page can't override that, but it can notice it: you were moving the pointer,
  // pressed a movement key, and the pointer went completely silent for over a second.
  // Seen twice -> tell the player about arrow-key aiming and the system setting.
  detectTouchpadPause() {
    if (this._hintShown || !this.locked || !this.anyMoveKey() || !this._mouseWasActive) return;
    const now = performance.now();
    if (this._lastMouseMove < this._moveKeysSince && now - this._moveKeysSince > 1200) {
      this._mouseWasActive = false; // count this run only once
      if (++this._suspicions >= 2) {
        this._hintShown = true;
        this.onTouchpadPaused?.();
      }
    }
  }

  /** mouse movement since the last call (for weapon sway) */
  consumeLook() {
    const l = { dx: this._look.dx, dy: this._look.dy };
    this._look.dx = this._look.dy = 0;
    return l;
  }

  addShake(amount) {
    this.shake = Math.min(0.35, this.shake + amount);
  }

  get position() {
    return { x: this.core.x, y: this.core.y, z: this.core.z };
  }

  dispose() {
    for (const [t, ev, fn] of this._listeners) t.removeEventListener(ev, fn);
  }
}
