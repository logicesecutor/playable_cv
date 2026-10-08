// Damage + destruction of letters.
//   hit:      sparks, chips in the letter's colour, a wobble + hot flash, an impact sound
//   destroy:  the instance disappears, the collision body dies, the letter bursts into shards
//             sampled from its real footprint, a dust cloud rises, and the ink on the paper
//             under it is burnt away (which also shows on the minimap, since it draws the same canvas)
import * as THREE from "three";

const HOT = new THREE.Color(1.0, 0.45, 0.15);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class Destruction {
  /**
   * @param {object} o
   * @param {ReturnType<typeof import("./buildWorld.js").buildWorld>} o.world
   * @param {import("./collision.js").CollisionWorld} o.collision
   * @param {import("../fx/debris.js").Debris} o.debris
   * @param {import("../fx/particles.js").ParticleSystem} o.sparks
   * @param {import("../fx/particles.js").ParticleSystem} o.dust
   * @param {import("../audio/sfx.js").Sfx} o.sfx
   * @param {any} o.pdf extracted PDF (paths + raster canvas)
   * @param {typeof import("../config.js").config} o.cfg
   */
  constructor(o) {
    Object.assign(this, o);
    this.wobbling = new Map(); // entity -> time since hit
    this.destroyed = 0;
    this.total = o.world.entities.length;
    this.onDestroyed = null; // (entity, point) => void
    /** multiplayer: our own bullet hit a letter (already applied locally): (entity, hit, dir) => void */
    this.onLocalHit = null;
    this.paperCtx = o.pdf.raster.getContext("2d");
    // MP5: a clean copy of the page, so a rematch can restore the paper (burns, soot, scorches).
    // Kept on the pdf object: a guest that reconnects rebuilds the map from the same pdf, and its
    // paper must start clean again.
    if (!o.pdf.rasterClean) {
      const c = document.createElement("canvas");
      c.width = o.pdf.raster.width;
      c.height = o.pdf.raster.height;
      c.getContext("2d").drawImage(o.pdf.raster, 0, 0);
      o.pdf.rasterClean = c;
    } else {
      this.paperCtx.save();
      this.paperCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.paperCtx.globalCompositeOperation = "copy";
      this.paperCtx.drawImage(o.pdf.rasterClean, 0, 0);
      this.paperCtx.restore();
    }
    this.paperClean = o.pdf.rasterClean;
    this.paperDirty = false;
    this.paperTimer = 0;
    this._m = new THREE.Matrix4();
    this._t = new THREE.Matrix4();
    this._c = new THREE.Color();
    this.pathCache = new Map();
  }

  get integrity() {
    return 1 - this.destroyed / Math.max(1, this.total);
  }

  /**
   * A bullet hit something.
   * @param {{body:any, x:number, y:number, z:number, nx:number, ny:number, nz:number}} hit
   * @param {{x:number,y:number,z:number}} dir bullet direction
   * @returns {"floor"|"hit"|"kill"}
   */
  bullet(hit, dir) {
    if (!hit.body) {
      this.floorHit(hit);
      return "floor";
    }
    const e = hit.body;
    this.hitFx(e, hit);
    e.hp -= 1;
    let result = "hit";
    if (e.hp <= 0) {
      this.destroy(e, hit, dir);
      result = "kill";
    } else this.wobbling.set(e, 0);
    this.onLocalHit?.(e, hit, dir);
    return result;
  }

  /** someone else's bullet hit a letter: same effects, no HP change (the network sets it) */
  remoteHit(e, hit) {
    if (!e.alive) return;
    this.hitFx(e, hit);
    this.wobbling.set(e, 0);
  }

  /** sparks, chips, dust and the impact sound at a bullet hit on letter `e` */
  hitFx(e, hit) {
    const col = e.color;
    // sparks bounce off along the surface normal
    for (let i = 0; i < 10; i++) {
      const sp = 4 + Math.random() * 9;
      this.sparks.emit(
        hit.x, hit.y, hit.z,
        (hit.nx + (Math.random() - 0.5) * 1.4) * sp,
        (hit.ny + Math.random() * 0.9) * sp,
        (hit.nz + (Math.random() - 0.5) * 1.4) * sp,
        0.18 + Math.random() * 0.25, 0.09, 0.02, 4.0, 2.2, 0.9,
      );
    }
    // chips of the letter
    for (let i = 0; i < 3; i++) {
      this.debris.spawn(
        hit.x + hit.nx * 0.05, hit.y, hit.z + hit.nz * 0.05,
        hit.nx * (2 + Math.random() * 4) + (Math.random() - 0.5) * 2,
        2 + Math.random() * 4,
        hit.nz * (2 + Math.random() * 4) + (Math.random() - 0.5) * 2,
        0.06 + Math.random() * 0.08, col, 4,
      );
    }
    // a little puff of "paper dust"
    for (let i = 0; i < 4; i++) {
      this.dust.emit(hit.x, hit.y, hit.z, hit.nx * 1.2 + (Math.random() - 0.5), 0.4 + Math.random() * 0.6, hit.nz * 1.2 + (Math.random() - 0.5), 0.7 + Math.random() * 0.5, 0.25, 0.9, 0.82, 0.8, 0.78, 0.5);
    }
    this.sfx.impact(hit, e.height);
  }

  floorHit(hit) {
    for (let i = 0; i < 6; i++) {
      const sp = 3 + Math.random() * 5;
      this.sparks.emit(hit.x, 0.03, hit.z, (Math.random() - 0.5) * sp, Math.random() * sp, (Math.random() - 0.5) * sp, 0.15 + Math.random() * 0.2, 0.07, 0.02, 4.0, 2.2, 0.9);
    }
    for (let i = 0; i < 3; i++) {
      this.dust.emit(hit.x, 0.05, hit.z, (Math.random() - 0.5) * 0.8, 0.5 + Math.random() * 0.8, (Math.random() - 0.5) * 0.8, 0.8, 0.2, 0.8, 0.85, 0.83, 0.8, 0.45);
    }
    this.sfx.floorHit(hit);
    // a small burn on the paper
    const k = this.pdf.rasterScale / this.cfg.metersPerPt; // px per metre
    const ctx = this.paperCtx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const r = 0.3 * k;
    const g = ctx.createRadialGradient(hit.x * k, hit.z * k, 0, hit.x * k, hit.z * k, r);
    g.addColorStop(0, "rgba(30,24,20,0.85)");
    g.addColorStop(0.35, "rgba(60,48,40,0.35)");
    g.addColorStop(1, "rgba(60,48,40,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(hit.x * k, hit.z * k, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    this.paperDirty = true;
  }

  destroy(e, hit, dir) {
    if (!e.alive) return;
    this.wobbling.delete(e);
    this.collision.kill(e);
    e.mesh.setMatrixAt(e.index, ZERO);
    e.mesh.instanceMatrix.needsUpdate = true;
    this.destroyed++;

    // ---- shards sampled inside the real footprint, at random heights
    const b = e.box;
    const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
    const area = Math.max(0.05, w * d);
    const count = Math.round(Math.min(70, Math.max(8, area * 5 * Math.sqrt(e.height))));
    const size = Math.min(0.9, Math.max(0.12, Math.sqrt((area * 0.6) / count) * 1.1));
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 12; tries++) {
      const x = b.minX + Math.random() * w, z = b.minZ + Math.random() * d;
      if (!this.collision.solidAt(e, x, z)) continue;
      placed++;
      const y = Math.random() * e.height;
      // blast away from the impact point, carried a bit along the bullet
      let ax = x - hit.x, az = z - hit.z;
      const al = Math.hypot(ax, az) || 1;
      ax /= al; az /= al;
      const power = 2 + Math.random() * 5;
      this.debris.spawn(
        x, y + size * 0.3, z,
        ax * power + dir.x * 3 + (Math.random() - 0.5) * 2,
        2 + Math.random() * 6 + y * 0.5,
        az * power + dir.z * 3 + (Math.random() - 0.5) * 2,
        size, e.color, 9 + Math.random() * 6,
      );
    }
    // ---- dust cloud
    const puffs = Math.min(60, 10 + area * 3);
    for (let i = 0; i < puffs; i++) {
      const x = b.minX + Math.random() * w, z = b.minZ + Math.random() * d;
      this.dust.emit(
        x, Math.random() * e.height * 0.8, z,
        (x - cx) * 0.6 + (Math.random() - 0.5), 0.6 + Math.random() * 1.2, (z - cz) * 0.6 + (Math.random() - 0.5),
        1.4 + Math.random() * 1.2, 0.6 + size, 2.2 + size * 3, 0.78, 0.76, 0.73, 0.55,
      );
    }
    for (let i = 0; i < 16; i++) {
      const sp = 5 + Math.random() * 8;
      this.sparks.emit(hit.x, hit.y, hit.z, (Math.random() - 0.5) * sp, Math.random() * sp, (Math.random() - 0.5) * sp, 0.3 + Math.random() * 0.3, 0.12, 0.02, 4.0, 1.8, 0.7);
    }
    this.debris.wake(b);
    this.burnPaper(e);
    this.sfx.crumble({ x: cx, y: e.height / 2, z: cz }, e.height);
    this.onDestroyed?.(e, hit);
  }

  /** gone without a show: letters already destroyed before we joined */
  silentKill(e) {
    if (!e.alive) return;
    this.wobbling.delete(e);
    this.collision.kill(e);
    e.mesh.setMatrixAt(e.index, ZERO);
    e.mesh.instanceMatrix.needsUpdate = true;
    e.hp = 0;
    this.destroyed++;
    this.burnPaper(e);
  }

  /** undo a kill we predicted but the host refused (the soot on the paper stays) */
  revive(e) {
    if (e.alive) return;
    e.alive = true;
    e.mesh.setMatrixAt(e.index, e.matrix);
    e.mesh.instanceMatrix.needsUpdate = true;
    this.setColor(e, 0);
    this.destroyed = Math.max(0, this.destroyed - 1);
  }

  /** MP5 rematch: every letter back at full HP, clean paper, no debris */
  resetAll() {
    this.wobbling.clear();
    const meshes = new Set();
    for (const e of this.world.entities) {
      e.alive = true;
      e.hp = e.maxHp;
      e.mesh.setMatrixAt(e.index, e.matrix);
      this.setColor(e, 0);
      meshes.add(e.mesh);
    }
    for (const m of meshes) m.instanceMatrix.needsUpdate = true;
    this.destroyed = 0;
    const ctx = this.paperCtx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "copy";
    ctx.drawImage(this.paperClean, 0, 0);
    ctx.restore();
    this.world.pageTexture.needsUpdate = true;
    this.paperDirty = false;
    this.debris.clear?.();
  }

  /** erase the letter's ink from the paper and leave a soot mark */
  burnPaper(e) {
    const ctx = this.paperCtx;
    const rs = this.pdf.rasterScale;
    ctx.save();
    if (e.piece) {
      const p = e.piece;
      const [a, b, c, d, ee, f] = p.m;
      ctx.setTransform(a * rs, b * rs, c * rs, d * rs, ee * rs, f * rs);
      const path = this.path2D(p.pathId);
      ctx.fillStyle = "#fbfaf7";
      ctx.strokeStyle = "#fbfaf7";
      ctx.lineWidth = 2 / Math.max(1, Math.sqrt(Math.abs(a * d - b * c)) * rs); // ~2 px: kills the anti-aliased fringe
      ctx.fill(path);
      ctx.stroke(path);
    } else if (e.pageBox) {
      ctx.setTransform(rs, 0, 0, rs, 0, 0);
      ctx.fillStyle = "#fbfaf7";
      const [x0, y0, x1, y1] = e.pageBox;
      ctx.fillRect(x0 - 0.3, y0 - 0.3, x1 - x0 + 0.6, y1 - y0 + 0.6);
    }
    // soot
    ctx.setTransform(rs, 0, 0, rs, 0, 0);
    const [x0, y0, x1, y1] = e.pageBox;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const r = Math.max(x1 - x0, y1 - y0) * 0.8 + 1.5;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, "rgba(45,38,32,0.42)");
    g.addColorStop(0.6, "rgba(70,60,50,0.18)");
    g.addColorStop(1, "rgba(70,60,50,0)");
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    this.paperDirty = true;
  }

  path2D(pathId) {
    let p = this.pathCache.get(pathId);
    if (p) return p;
    p = new Path2D();
    const cmds = this.pdf.paths[pathId];
    for (let i = 0; i < cmds.length; ) {
      const op = cmds[i++];
      if (op === 0) p.moveTo(cmds[i++], cmds[i++]);
      else if (op === 1) p.lineTo(cmds[i++], cmds[i++]);
      else if (op === 2) p.bezierCurveTo(cmds[i++], cmds[i++], cmds[i++], cmds[i++], cmds[i++], cmds[i++]);
      else if (op === 3) p.quadraticCurveTo(cmds[i++], cmds[i++], cmds[i++], cmds[i++]);
      else if (op === 4) p.closePath();
    }
    this.pathCache.set(pathId, p);
    return p;
  }

  update(dt) {
    // wobble + hot flash on letters that were just hit
    for (const [e, t0] of this.wobbling) {
      const t = t0 + dt;
      if (t > 0.45 || !e.alive) {
        this.wobbling.delete(e);
        if (e.alive) {
          e.mesh.setMatrixAt(e.index, e.matrix);
          this.setColor(e, 0);
        }
      } else {
        this.wobbling.set(e, t);
        const w = Math.exp(-t * 9) * Math.cos(t * 38);
        const b = e.box;
        const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
        // scale around the footprint centre, squash vertically
        this._t.makeTranslation(cx, 0, cz);
        this._m.makeScale(1 + 0.05 * w, 1 - 0.07 * w, 1 + 0.05 * w);
        this._t.multiply(this._m);
        this._m.makeTranslation(-cx, 0, -cz);
        this._t.multiply(this._m).multiply(e.matrix);
        e.mesh.setMatrixAt(e.index, this._t);
        this.setColor(e, Math.exp(-t * 7) * (1 - (e.hp / e.maxHp)) * 0.6 + Math.exp(-t * 12) * 0.5);
      }
      e.mesh.instanceMatrix.needsUpdate = true;
    }

    // re-upload the paper texture at most a few times per second
    this.paperTimer -= dt;
    if (this.paperDirty && this.paperTimer <= 0) {
      this.world.pageTexture.needsUpdate = true;
      this.paperDirty = false;
      this.paperTimer = 0.25;
    }
  }

  setColor(e, heat) {
    const k = this.cfg.inkLift;
    const c = e.color;
    this._c.setRGB(c[0] + (1 - c[0]) * k, c[1] + (1 - c[1]) * k, c[2] + (1 - c[2]) * k, THREE.SRGBColorSpace);
    if (heat > 0) this._c.lerp(HOT, Math.min(1, heat));
    e.mesh.setColorAt(e.index, this._c);
    e.mesh.instanceColor.needsUpdate = true;
  }
}
