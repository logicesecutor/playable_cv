// On-screen controls for phones and tablets (touch mode, see input/touchMode.js).
//
//   left half      floating joystick: appears where the thumb lands. Pushed a little = slow walk,
//                  further = walk, all the way roughly forward = sprint.
//   right half     drag to look.
//   fire button    hold to fire; drag the same thumb to aim while firing.
//   jump / crouch  jump on tap, crouch while held (like C on the keyboard).
//   reload         tap.
//   top row        pause, scoreboard (multiplayer, hold), mute.
//
// Every finger is tracked by its pointerId with pointer capture, so moving, looking, firing and
// jumping work at the same time. The controls write into PlayerController.touch / addLook() and
// Weapon.touchTrigger: the same simulation as the keyboard and mouse.
const $ = (id) => document.getElementById(id);

export class TouchControls {
  /**
   * @param {object} o
   * @param {import("../player/playerController.js").PlayerController} o.player
   * @param {import("../player/weapon.js").Weapon} o.weapon
   * @param {typeof import("../config.js").config} o.cfg
   * @param {(open:boolean) => void} [o.onBoard] hold the scoreboard button
   * @param {() => boolean} [o.onMute] toggle sound, returns true when muted
   */
  constructor(o) {
    this.player = o.player;
    this.weapon = o.weapon;
    this.t = o.cfg.touch;
    this.onBoard = o.onBoard;
    this.onMute = o.onMute;
    this.el = {
      root: $("touch"),
      move: $("t-move"),
      look: $("t-look"),
      stick: $("t-stick"),
      knob: $("t-knob"),
      fire: $("t-fire"),
      jump: $("t-jump"),
      crouch: $("t-crouch"),
      reload: $("t-reload"),
      pause: $("t-pause"),
      board: $("t-board"),
      mute: $("t-mute"),
    };
    /** the joystick finger: { id, bx, by } base centre in px */
    this.stick = null;
    /** fingers that aim: pointerId -> last {x, y} (look area and fire button) */
    this.lookers = new Map();
    /** fingers on the fire button / crouch button */
    this.firing = new Set();
    this.crouching = new Set();
    this.visible = false;

    const L = (this._listeners = []);
    const on = (el, ev, fn) => {
      el.addEventListener(ev, fn, { passive: false });
      L.push([el, ev, fn]);
    };
    const ends = ["pointerup", "pointercancel", "lostpointercapture"];

    // ---- joystick
    on(this.el.move, "pointerdown", (e) => {
      e.preventDefault();
      if (this.stick) return; // one stick finger at a time
      capture(e);
      this.stick = { id: e.pointerId, bx: e.clientX, by: e.clientY };
      this.el.stick.classList.add("held");
      this.moveStick(e.clientX, e.clientY);
    });
    on(this.el.move, "pointermove", (e) => {
      if (this.stick?.id === e.pointerId) this.moveStick(e.clientX, e.clientY);
    });
    for (const ev of ends) on(this.el.move, ev, (e) => this.stick?.id === e.pointerId && this.releaseStick());

    // ---- look area
    on(this.el.look, "pointerdown", (e) => {
      e.preventDefault();
      capture(e);
      this.lookers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    on(this.el.look, "pointermove", (e) => this.lookMove(e));
    for (const ev of ends) on(this.el.look, ev, (e) => this.lookers.delete(e.pointerId));

    // ---- fire (+ aim with the same thumb)
    on(this.el.fire, "pointerdown", (e) => {
      e.preventDefault();
      capture(e);
      this.lookers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.firing.add(e.pointerId);
      this.el.fire.classList.add("held");
      if (this.weapon.canShoot()) {
        this.weapon.touchTrigger = true;
        this.weapon.dryFireCheck();
      }
    });
    on(this.el.fire, "pointermove", (e) => this.lookMove(e));
    for (const ev of ends) {
      on(this.el.fire, ev, (e) => {
        this.lookers.delete(e.pointerId);
        this.firing.delete(e.pointerId);
        if (!this.firing.size) {
          this.weapon.touchTrigger = false;
          this.el.fire.classList.remove("held");
        }
      });
    }

    // ---- jump: tap (buffered, so a tap just before landing still jumps)
    on(this.el.jump, "pointerdown", (e) => {
      e.preventDefault();
      flash(this.el.jump);
      if (this.player.active && this.player.enabled) this.player.core.queueJump();
    });

    // ---- crouch: hold
    on(this.el.crouch, "pointerdown", (e) => {
      e.preventDefault();
      capture(e);
      this.crouching.add(e.pointerId);
      this.player.touch.crouch = true;
      this.el.crouch.classList.add("held");
    });
    for (const ev of ends) {
      on(this.el.crouch, ev, (e) => {
        this.crouching.delete(e.pointerId);
        if (!this.crouching.size) {
          this.player.touch.crouch = false;
          this.el.crouch.classList.remove("held");
        }
      });
    }

    // ---- reload
    on(this.el.reload, "pointerdown", (e) => {
      e.preventDefault();
      flash(this.el.reload);
      if (this.player.enabled && !this.weapon.blocked) this.weapon.reload();
    });

    // ---- top row
    on(this.el.pause, "click", (e) => {
      e.stopPropagation();
      this.player.unlock();
    });
    on(this.el.board, "pointerdown", (e) => {
      e.preventDefault();
      capture(e);
      this.el.board.classList.add("held");
      this.onBoard?.(true);
    });
    for (const ev of ends) {
      on(this.el.board, ev, () => {
        this.el.board.classList.remove("held");
        this.onBoard?.(false);
      });
    }
    on(this.el.mute, "click", (e) => {
      e.stopPropagation();
      this.setMuted(!!this.onMute?.());
    });

    // long-press must not open the browser's context menu / text selection
    on(this.el.root, "contextmenu", (e) => e.preventDefault());
  }

  /** shown while the player is in control (after Play, until pause) */
  setVisible(on) {
    if (on === this.visible) return;
    this.visible = on;
    this.el.root.hidden = !on;
    if (!on) this.releaseAll();
  }

  /** the scoreboard button only makes sense with other players */
  setMultiplayer(on) {
    this.el.board.hidden = !on;
  }

  setMuted(muted) {
    this.el.mute.classList.toggle("off", muted);
    this.el.mute.setAttribute("aria-label", muted ? "Sound on" : "Mute");
  }

  // ------------------------------------------------------------------ internals
  moveStick(x, y) {
    const s = this.stick, t = this.t, R = t.stickRadius;
    let dx = x - s.bx, dy = y - s.by;
    let d = Math.hypot(dx, dy);
    // the base trails a finger that slides far past the edge, so turning back responds at once
    const far = R * 1.35;
    if (d > far) {
      const k = (d - far) / d;
      s.bx += dx * k;
      s.by += dy * k;
      dx = x - s.bx;
      dy = y - s.by;
      d = far;
    }
    const mag = Math.min(1, d / R);
    const pt = this.player.touch;
    if (mag < t.stickDeadzone) {
      pt.forward = pt.right = 0;
      pt.sprint = false;
    } else {
      pt.right = dx / d;
      pt.forward = -dy / d;
      const k = Math.min(1, (mag - t.stickDeadzone) / (0.8 - t.stickDeadzone));
      pt.throttle = t.minThrottle + (1 - t.minThrottle) * k;
      pt.sprint = mag >= t.sprintAt && pt.forward > 0.7; // within ~45° of straight ahead
    }
    // draw: base where the thumb landed, knob clamped to the ring
    const kx = (dx / (d || 1)) * Math.min(d, R), ky = (dy / (d || 1)) * Math.min(d, R);
    this.el.stick.style.transform = `translate(${s.bx}px, ${s.by}px)`;
    this.el.knob.style.transform = `translate(${kx}px, ${ky}px)`;
    this.el.stick.classList.toggle("sprint", pt.sprint);
  }

  releaseStick() {
    this.stick = null;
    this.player.releaseTouch();
    if (this.crouching.size) this.player.touch.crouch = true; // still holding crouch
    this.el.stick.classList.remove("held", "sprint");
    this.el.stick.style.transform = "";
    this.el.knob.style.transform = "";
  }

  lookMove(e) {
    const last = this.lookers.get(e.pointerId);
    if (!last) return;
    const dx = e.clientX - last.x, dy = e.clientY - last.y;
    last.x = e.clientX;
    last.y = e.clientY;
    const s = this.t.lookSensitivity;
    this.player.addLook(dx * s, dy * s * this.t.pitchFactor);
  }

  releaseAll() {
    this.releaseStick();
    this.lookers.clear();
    this.firing.clear();
    this.crouching.clear();
    this.weapon.touchTrigger = false;
    this.player.touch.crouch = false;
    for (const b of [this.el.fire, this.el.crouch, this.el.board]) b.classList.remove("held");
    this.onBoard?.(false);
  }

  dispose() {
    this.setVisible(false);
    for (const [el, ev, fn] of this._listeners) el.removeEventListener(ev, fn);
  }
}

function capture(e) {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    // the pointer may already be gone
  }
}

/** short pressed look for tap buttons */
function flash(el) {
  el.classList.add("held");
  setTimeout(() => el.classList.remove("held"), 120);
}
