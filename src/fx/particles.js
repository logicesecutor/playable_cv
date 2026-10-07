// Soft round point particles with per-particle colour, size and alpha: sparks (additive) and
// dust / smoke puffs (normal blending). One draw call per system.
import * as THREE from "three";

export class ParticleSystem {
  /**
   * @param {number} capacity
   * @param {{additive?:boolean, gravity?:number, drag?:number}} opts
   */
  constructor(capacity, opts = {}) {
    this.cap = capacity;
    this.gravity = opts.gravity ?? 0;
    this.drag = opts.drag ?? 1;
    this.count = 0;
    // simulation state (struct of arrays)
    this.p = new Float32Array(capacity * 3);
    this.v = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.alpha0 = new Float32Array(capacity);
    this.col = new Float32Array(capacity * 3);

    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", this.aPos);
    geo.setAttribute("aColor", this.aCol);
    geo.setAttribute("aSize", this.aSize);
    geo.setAttribute("aAlpha", this.aAlpha);
    geo.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 500 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        uniform float uScale;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.15, d) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = opts.additive ? 3 : 2;
  }

  /** px size of a 1 m particle at 1 m distance, from the camera's projection */
  setViewport(heightPx, fovDeg) {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  emit(x, y, z, vx, vy, vz, life, size0, size1, r, g, b, alpha = 1) {
    let i = this.count;
    if (i >= this.cap) i = (Math.random() * this.cap) | 0; // full: overwrite a random one
    else this.count++;
    const i3 = i * 3;
    this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z;
    this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
    this.life[i] = 0; this.maxLife[i] = life;
    this.size0[i] = size0; this.size1[i] = size1;
    this.alpha0[i] = alpha;
    this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b;
  }

  update(dt) {
    const damp = Math.exp(-this.drag * dt);
    let n = this.count;
    for (let i = 0; i < n; ) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) {
        // swap-remove
        n--;
        this.copy(n, i);
        continue;
      }
      const i3 = i * 3;
      this.v[i3 + 1] -= this.gravity * dt;
      this.v[i3] *= damp; this.v[i3 + 1] *= damp; this.v[i3 + 2] *= damp;
      this.p[i3] += this.v[i3] * dt;
      this.p[i3 + 1] += this.v[i3 + 1] * dt;
      this.p[i3 + 2] += this.v[i3 + 2] * dt;
      if (this.p[i3 + 1] < 0.02) { this.p[i3 + 1] = 0.02; this.v[i3 + 1] *= -0.3; }
      i++;
    }
    this.count = n;

    const pos = this.aPos.array, col = this.aCol.array, size = this.aSize.array, alpha = this.aAlpha.array;
    for (let i = 0; i < n; i++) {
      const k = this.life[i] / this.maxLife[i];
      const i3 = i * 3;
      pos[i3] = this.p[i3]; pos[i3 + 1] = this.p[i3 + 1]; pos[i3 + 2] = this.p[i3 + 2];
      col[i3] = this.col[i3]; col[i3 + 1] = this.col[i3 + 1]; col[i3 + 2] = this.col[i3 + 2];
      size[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * k;
      alpha[i] = this.alpha0[i] * (1 - k) * (1 - k);
    }
    this.points.geometry.setDrawRange(0, n);
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = this.aAlpha.needsUpdate = true;
  }

  copy(from, to) {
    const f3 = from * 3, t3 = to * 3;
    for (let k = 0; k < 3; k++) {
      this.p[t3 + k] = this.p[f3 + k];
      this.v[t3 + k] = this.v[f3 + k];
      this.col[t3 + k] = this.col[f3 + k];
    }
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.size0[to] = this.size0[from];
    this.size1[to] = this.size1[from];
    this.alpha0[to] = this.alpha0[from];
  }
}
