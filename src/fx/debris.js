// Physical shards: chips from bullet impacts and the fragments a letter breaks into.
// One InstancedMesh, simple rigid-ish physics: gravity, spin, bounce on the paper and on top of
// letters that are still standing, bounce off their sides. Shards that come to rest go to sleep;
// destroying the letter under them wakes them up.
import * as THREE from "three";

export class Debris {
  /**
   * @param {import("../world/collision.js").CollisionWorld} collision
   * @param {number} capacity
   */
  constructor(collision, capacity = 2500) {
    this.col = collision;
    this.cap = capacity;
    this.n = 0;
    this.items = []; // {p:Vector3, v:Vector3, q:Quaternion, w:Vector3, s:Vector3, life, maxLife, sleep}

    // a lumpy little rock: an octahedron with jittered vertices reads as a "chunk" from any side
    const geo = new THREE.OctahedronGeometry(0.5, 0);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, pos.getX(i) * (0.8 + Math.random() * 0.4), pos.getY(i) * (0.6 + Math.random() * 0.5), pos.getZ(i) * (0.8 + Math.random() * 0.4));
    }
    geo.computeVertexNormals();
    this.mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.05, flatShading: true }),
      capacity,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1)); // allocates instanceColor
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.name = "debris";

    this._m = new THREE.Matrix4();
    this._dq = new THREE.Quaternion();
    this._c = new THREE.Color();
  }

  /**
   * @param {number[]} color sRGB [r,g,b] 0..1
   * @param {number} size   metres
   */
  spawn(x, y, z, vx, vy, vz, size, color, life = 10) {
    let it;
    if (this.n < this.cap) {
      it = this.items[this.n];
      if (!it) {
        it = { p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), s: new THREE.Vector3() };
        this.items[this.n] = it;
      }
      it.i = this.n++;
    } else {
      // full: recycle the oldest-looking one
      it = this.items[(Math.random() * this.cap) | 0];
    }
    it.p.set(x, y, z);
    it.v.set(vx, vy, vz);
    it.q.setFromEuler(new THREE.Euler(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3));
    it.w.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18);
    it.s.set(size * (0.7 + Math.random() * 0.6), size * (0.5 + Math.random() * 0.6), size * (0.7 + Math.random() * 0.6));
    it.life = 0;
    it.maxLife = life * (0.8 + Math.random() * 0.4);
    it.sleep = false;
    it.radius = it.s.y * 0.35;
    this._c.setRGB(color[0], color[1], color[2], THREE.SRGBColorSpace);
    this.mesh.setColorAt(it.i, this._c);
    this.mesh.instanceColor.needsUpdate = true;
  }

  /** wake everything resting inside a box (the letter under it just vanished) */
  wake(box) {
    for (let k = 0; k < this.n; k++) {
      const it = this.items[k];
      if (it.sleep && it.p.x > box.minX - 0.3 && it.p.x < box.maxX + 0.3 && it.p.z > box.minZ - 0.3 && it.p.z < box.maxZ + 0.3) {
        it.sleep = false;
        it.v.set((Math.random() - 0.5), 0, (Math.random() - 0.5));
      }
    }
  }

  update(dt) {
    const g = 22;
    for (let k = 0; k < this.n; ) {
      const it = this.items[k];
      it.life += dt;
      if (it.life >= it.maxLife) {
        this.remove(k);
        continue;
      }
      if (!it.sleep) {
        const px = it.p.x, py = it.p.y, pz = it.p.z;
        it.v.y -= g * dt;
        it.p.addScaledVector(it.v, dt);
        // spin
        const wl = it.w.length();
        if (wl > 1e-3) {
          this._dq.setFromAxisAngle(this._tmpAxis(it.w, wl), wl * dt);
          it.q.premultiply(this._dq);
        }
        // ground = paper or the top of whatever letter we're over
        const top = this.col.topAt(it.p.x, it.p.z);
        if (it.p.y - it.radius < top) {
          if (py - it.radius >= top - 0.05) {
            // landed on it: bounce + friction
            it.p.y = top + it.radius;
            if (it.v.y < -1.5) {
              it.v.y *= -0.28;
              it.v.x *= 0.6; it.v.z *= 0.6;
              it.w.multiplyScalar(0.6);
            } else {
              it.v.set(it.v.x * 0.8, 0, it.v.z * 0.8);
              it.w.multiplyScalar(0.8);
              if (it.v.lengthSq() < 0.05) { it.sleep = true; it.v.set(0, 0, 0); }
            }
          } else {
            // hit the side of a letter: back out and reflect horizontally
            it.p.x = px; it.p.z = pz;
            it.v.x *= -0.35; it.v.z *= -0.35;
          }
        }
      }
      // shrink away at the end of its life
      const fade = Math.min(1, (it.maxLife - it.life) / 1.2);
      this._m.compose(it.p, it.q, this._scaled(it.s, fade));
      this.mesh.setMatrixAt(k, this._m);
      k++;
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  remove(k) {
    const last = this.n - 1;
    if (k !== last) {
      // move last into k (swap the objects so slot k keeps a live item)
      const a = this.items[k], b = this.items[last];
      this.items[k] = b; this.items[last] = a;
      b.i = k; a.i = last;
      this.mesh.getColorAt(last, this._c);
      this.mesh.setColorAt(k, this._c);
      this.mesh.instanceColor.needsUpdate = true;
    }
    this.n--;
  }

  _tmpAxis(w, l) {
    return (this.__axis ||= new THREE.Vector3()).copy(w).divideScalar(l);
  }
  _scaled(s, k) {
    return (this.__s ||= new THREE.Vector3()).copy(s).multiplyScalar(Math.max(0.001, k));
  }
}
