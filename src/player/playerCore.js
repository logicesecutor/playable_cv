// Movement simulation for the player: no three.js, no DOM.

/** The movement simulation, independent of three.js and the DOM. */
export class PlayerCore {
  /**
   * @param {import("../world/collision.js").CollisionWorld} collision
   * @param {typeof import("../config.js").config.player} p
   */
  constructor(collision, p) {
    this.col = collision;
    this.p = p;
    this.reset(0, 0, 0);
  }

  reset(x, z, yaw = 0) {
    this.x = x; this.z = z;
    this.y = this.col.supportHeight(x, z, this.p.radius, 99, 0); // feet
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = yaw; this.pitch = 0;
    this.grounded = true;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.eye = this.p.eyeHeight;
    this.crouching = false;
    this.fly = false;
    this.stepDist = 0;
  }

  queueJump() {
    this.jumpBuffer = this.p.jumpBuffer;
  }

  /**
   * @param {number} dt
   * @param {{forward:number,right:number,sprint:boolean,crouch:boolean,up?:boolean,down?:boolean}} input
   * @returns {{landed:boolean, impact:number, footstep:boolean}}
   */
  step(dt, input) {
    const p = this.p;
    const ev = { landed: false, impact: 0, footstep: false };

    // ---- wish direction from yaw (yaw 0 = -Z)
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let wx = -sin * input.forward + cos * input.right;
    let wz = -cos * input.forward - sin * input.right;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }

    this.crouching = input.crouch && !this.fly;
    const targetEye = this.crouching ? p.crouchEyeHeight : p.eyeHeight;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 12);

    let speed = this.crouching ? p.crouchSpeed : input.sprint ? p.sprintSpeed : p.walkSpeed;

    if (this.fly) {
      // noclip debug camera
      speed *= 2;
      this.x += wx * speed * dt;
      this.z += wz * speed * dt;
      this.y += ((input.up ? 1 : 0) - (input.down ? 1 : 0)) * speed * dt;
      this.y = Math.max(0, this.y);
      this.vx = wx * speed; this.vz = wz * speed; this.vy = 0;
      this.grounded = false;
      return ev;
    }

    // ---- horizontal velocity: snappy on the ground, limited in the air
    const accel = this.grounded ? p.groundAccel : p.airAccel;
    const tx = wx * speed, tz = wz * speed;
    const k = 1 - Math.exp(-accel * dt);
    if (this.grounded || wl > 0) {
      this.vx += (tx - this.vx) * k;
      this.vz += (tz - this.vz) * k;
    }

    // ---- jump (buffered + coyote time)
    this.jumpBuffer -= dt;
    this.coyote = this.grounded ? p.coyoteTime : this.coyote - dt;
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.vy = p.jumpSpeed;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
    }

    // ---- gravity
    if (!this.grounded) this.vy -= p.gravity * dt;
    else this.vy = Math.min(this.vy, 0);

    // ---- integrate in sub-steps so thin walls can't be tunnelled
    const dx = this.vx * dt, dz = this.vz * dt, dy = this.vy * dt;
    const n = Math.max(1, Math.ceil(Math.max(Math.hypot(dx, dz), Math.abs(dy)) / (p.radius * 0.5)));
    const wasGrounded = this.grounded;
    const prevX = this.x, prevZ = this.z;
    let landedThisStep = false;
    for (let i = 0; i < n; i++) {
      // horizontal
      const r = this.col.resolve(this.x + dx / n, this.z + dz / n, p.radius, this.y, p.stepHeight);
      this.x = r.x; this.z = r.z;
      // vertical
      this.y += dy / n;
      const support = this.col.supportHeight(this.x, this.z, p.radius, this.y, p.stepHeight);
      if (this.vy <= 0 && this.y <= support + 1e-4) {
        if (!this.grounded && !wasGrounded && !landedThisStep) {
          landedThisStep = true;
          ev.impact = -this.vy;
        }
        this.vy = 0;
        this.y = support;
        this.grounded = true;
      } else if (this.grounded && this.y - support <= p.stepHeight && this.vy <= 0) {
        this.y = support; // walk down small steps instead of hopping off them
      } else if (this.y > support + 1e-4) {
        this.grounded = false;
      }
      // falling past the edge of a letter can bring its side back into play
      const r2 = this.col.resolve(this.x, this.z, p.radius, this.y, p.stepHeight);
      this.x = r2.x; this.z = r2.z;
    }

    // velocity follows what actually happened (sliding along walls)
    if (dt > 0) {
      this.vx = (this.x - prevX) / dt;
      this.vz = (this.z - prevZ) / dt;
    }

    ev.landed = landedThisStep;

    if (this.grounded) {
      this.stepDist += Math.hypot(this.x - prevX, this.z - prevZ);
      const stride = input.sprint ? 2.6 : 2.0;
      if (this.stepDist > stride) { this.stepDist = 0; ev.footstep = true; }
    }
    return ev;
  }
}
