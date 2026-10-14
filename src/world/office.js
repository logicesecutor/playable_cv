// The office around the CV: a real-scale room (metres, as built in Blender) shown around the
// game world. Environment only: it never touches the network or player movement. The one link to
// gameplay is trayWalls(), the letter tray's walls, which main.js hands to the collision world as
// bullet-only walls.
//
// How it is placed
// ----------------
// The CV page is the game world (top-left corner at the origin, X = page right, Z = page down,
// Y = up, 1 PDF point = cfg.metersPerPt game metres). The office is modelled at real size, so one
// real metre is K = cfg.metersPerPt / (0.0254 / 72) ≈ 850 game metres.
//
// The office contains an empty, `CV_Anchor`, at the CENTRE of the CV page, axes like the game's
// (X = page right, Y = out of the paper, Z = page down). The game keeps the page still and moves
// the office instead:
//
//     office.root.matrix = T(page centre) · S(K) · inverse(anchor, relative to the office)
//
// So when the giant hand lifts the CV (the anchor is animated), the players stay put on the page
// and the whole office swings around them. Gameplay never notices.
//
// Her animation (office.glb clips, baked in blender_src/scripts/anim_woman.py): an idle loop
// (Type, with Mouse / Sip / Stretch / Glance / Clock now and then) and the Shred sequence. Shred
// moves CV_Anchor, so the office swings around the players while she lifts, reads and feeds the
// CV into the shredder; once its top edge is in the slot the game pulls the page in over
// cfg.office.shredSeconds and `office.shred` says how far ({active, progress 0..1, cutZ, plane}):
// the hook for the future shrinking-map mechanic. For now the shredding is VISUAL ONLY (a clipping
// plane hides what went in; collision is untouched) and is started from a dev key (O) / ?shred=N.
//
// The model is public/models/office.glb (blender_src/scripts/build_office.py), loaded with the
// other models at page load. If it is missing, a procedural placeholder with the same layout and
// real dimensions is used instead, like the box avatar / box gun fallbacks.
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { getModel } from "../assets/models.js";

/**
 * The game's version of an office.glb material:
 * - Baked_* (bake_office.py): colour + light are in the texture -> unlit, so the office looks
 *   the same however it swings around the page
 * - emissive ones (ceiling panels, windows, screens) -> their glow colour, unlit
 * - anything else (the woman's block-out): self-lit, see buildPlaceholder()
 * Office materials ignore the fog and the tone mapping (the bake already is the final look).
 */
function officeMaterial(m, o, shade) {
  const k = o?.brightness ?? 1;
  if (m.name.startsWith("Baked_") && m.map) {
    return new THREE.MeshBasicMaterial({ name: m.name, map: m.map, color: new THREE.Color(k, k, k), fog: false, toneMapped: false });
  }
  if (m.emissive && m.emissive.getHex() !== 0) {
    const c = m.emissive.clone().multiplyScalar(Math.min(1, m.emissiveIntensity || 1));
    return new THREE.MeshBasicMaterial({ name: m.name, color: c.lerp(new THREE.Color(1, 1, 1), 0.15), fog: false, toneMapped: false });
  }
  return shade ? officeLit(m, shade) : selfLit(m);
}

/** a stand-in look for the placeholder: half the colour as emission */
function selfLit(m) {
  const c = m.clone();
  c.fog = false;
  c.emissive = c.color.clone().multiplyScalar(0.5);
  c.emissiveIntensity = 1;
  return c;
}

/**
 * Lit by the OFFICE, not by the game's lights (those are aimed at the page): a hemisphere light
 * (ceiling above, carpet below) plus a soft key from the panels in front of her, both given in the
 * office's own frame and passed to the shader in view space every frame (Office.update), so she
 * stays lit like the baked room however the office swings. A rim like the players' (models.js).
 * Lambert keeps the skinning; its own lighting is replaced before output.
 */
function officeLit(m, shade) {
  const mat = new THREE.MeshLambertMaterial({ name: m.name, color: m.color.clone(), vertexColors: m.vertexColors, side: m.side, fog: false });
  mat.toneMapped = false; // like the bake: final colours
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shade.uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uUpView, uKeyView, uSky, uGround;\nuniform float uKey, uRim;")
      .replace(
        "#include <opaque_fragment>",
        `{
          vec3 n = normalize(normal);
          vec3 light = mix(uGround, uSky, dot(n, uUpView) * 0.5 + 0.5) + uKey * max(dot(n, uKeyView), 0.0) * uSky;
          float rimF = pow(1.0 - saturate(dot(n, normalize(vViewPosition))), 3.0);
          outgoingLight = diffuseColor.rgb * light + uRim * rimF * vec3(0.95, 0.93, 0.88);
        }
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => "pcv-office-lit";
  return mat;
}

/** the time of a track's last change (its value stays put after it) */
function lastChange(track) {
  const v = track.values, n = track.getValueSize(), last = v.length / n - 1;
  for (let i = last - 1; i >= 0; i--) {
    for (let j = 0; j < n; j++) if (Math.abs(v[i * n + j] - v[last * n + j]) > 1e-4) return track.times[i + 1];
  }
  return 0;
}

/** a random key of `weights` that exists in `actions`, by weight */
function pickWeighted(weights, actions) {
  const keys = Object.keys(weights).filter((k) => actions[k]);
  let r = Math.random() * keys.reduce((s, k) => s + weights[k], 0);
  for (const k of keys) if ((r -= weights[k]) <= 0) return k;
  return keys[0];
}

/** one PDF point in real metres */
export const REAL_M_PER_PT = 0.0254 / 72;

// placeholder layout (real metres, office Y up). The desk is centred on the origin, the woman
// sits on +Z facing -Z (towards her monitor), the letter trays stand on the desk to her right.
const DESK = { w: 1.6, d: 0.8, top: 0.74, thick: 0.03 };
// the letter tray: keep in step with TRAY in blender_src/scripts/build_office.py
// (corner = height of the front corner tabs, lip = the low front lip between them, slope = the
// part of the depth, from the back, where the sides are still full height)
const TRAY = { inW: 0.235, inD: 0.32, h: 0.065, wall: 0.003, frontH: 0.024, corner: 0.03, lip: 0.012, tab: 0.045, slope: 0.42 };
const TRAY_AT = { x: 0.55, z: 0.0 };
const TRAY_FLOOR = DESK.top + TRAY.h + TRAY.wall; // top surface of the upper tray's floor
const PAPER_LIFT = 0.0003; // the page lies on the tray floor (= the old 0.25 m "desk" gap in game units)

export class Office {
  /**
   * @param {{world: {size: {W: number, D: number}, root: THREE.Object3D}, cfg: any}} o
   */
  constructor({ world, cfg }) {
    this.cfg = cfg;
    this.world = world;
    this.k = cfg.metersPerPt / REAL_M_PER_PT; // game metres per real metre (~850)
    this.pageCenter = new THREE.Vector3(world.size.W / 2, 0, world.size.D / 2);

    this.root = new THREE.Group(); // game space; its matrix is set by place()
    this.root.name = "office";
    this.root.matrixAutoUpdate = false;
    this.content = new THREE.Group(); // real-scale office (placeholder or glTF)
    this.content.name = "office-content";
    this.root.add(this.content);

    this.materials = [];
    // office-space lighting for what isn't baked (the woman): see officeLit()
    const s = cfg.office.shade || {};
    this.shade = {
      uniforms: {
        uUpView: { value: new THREE.Vector3(0, 1, 0) },
        uKeyView: { value: new THREE.Vector3(0, 1, 0) },
        uSky: { value: new THREE.Color(s.sky ?? 0xfff6ea) },
        uGround: { value: new THREE.Color(s.ground ?? 0x6c6c74) },
        uKey: { value: s.key ?? 0.3 },
        uRim: { value: s.rim ?? 0.12 },
      },
      key: new THREE.Vector3(...(s.keyDir ?? [0.15, 1, -0.45])).normalize(), // office frame: up, towards her monitor
    };
    this.anchor = this.loadModel() || this.buildPlaceholder();
    this.anchor.updateMatrix();
    this.anchorRest = this.anchor.matrix.clone();
    this.anchorRestPos = this.anchor.position.clone();
    this.anchorRestQuat = this.anchor.quaternion.clone();
    /** shredding state, read by main.js (fx) and, later, by the shrinking-map mechanic */
    this.shred = { active: false, feeding: false, progress: 0, cutZ: 0, plane: new THREE.Plane() };
    /** false while the CV is out of the tray (main.js switches the tray's bullet walls off) */
    this.cvInTray = true;
    this._travel = world.size.D / this.k + 0.012; // real metres the page moves to go fully through

    // the old dark plane around the page would hide the tray floor (it sits 0.25 m below the paper)
    const desk = world.root.getObjectByName("desk");
    if (desk) desk.visible = false;

    this._m = new THREE.Matrix4();
    this._s = new THREE.Matrix4();
    this._n = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this.place();
  }

  /**
   * The inner faces of the top tray's walls as bullet-stopping quads for CollisionWorld.walls,
   * in game metres. The page lies centred in the tray; heights are measured from the paper.
   * Built from the tray's real dimensions (not from the loaded model), so every player gets the
   * same walls even if office.glb failed to load.
   */
  trayWalls() {
    const T = TRAY, k = this.k;
    const lift = T.wall + PAPER_LIFT; // paper above the tray level's base
    const full = (T.h - lift) * k, corner = (T.corner - lift) * k, lip = (T.lip - lift) * k;
    const hx = (T.inW / 2) * k, hz = (T.inD / 2) * k;
    const { x: cx, z: cz } = this.pageCenter;
    const x0 = cx - hx, x1 = cx + hx, zb = cz - hz, zf = cz + hz; // back = page top (-Z), front = page bottom
    const zs = zb + T.slope * 2 * hz; // sides start sloping down here
    const zc = zf - 0.03 * k; // ...and reach the corner height here
    const tab = T.tab * k;
    const walls = [{ ax: x0, az: zb, bx: x1, bz: zb, h0: full, h1: full }]; // back
    for (const x of [x0, x1]) {
      walls.push({ ax: x, az: zb, bx: x, bz: zs, h0: full, h1: full });
      walls.push({ ax: x, az: zs, bx: x, bz: zc, h0: full, h1: corner });
      walls.push({ ax: x, az: zc, bx: x, bz: zf, h0: corner, h1: corner });
    }
    walls.push({ ax: x0, az: zf, bx: x0 + tab, bz: zf, h0: corner, h1: corner }); // front tabs
    walls.push({ ax: x1 - tab, az: zf, bx: x1, bz: zf, h0: corner, h1: corner });
    walls.push({ ax: x0 + tab, az: zf, bx: x1 - tab, bz: zf, h0: lip, h1: lip }); // the lip
    return walls;
  }

  /**
   * Environment time step (animations later); keeps the office locked to the anchor and points
   * the office-space lights for the unbaked parts.
   * @param {number} dt
   * @param {THREE.Camera} [camera]
   */
  update(dt, camera) {
    this.animate(dt);
    this.place();
    if (camera) {
      const u = this.shade.uniforms;
      this.root.updateMatrixWorld();
      const view = camera.matrixWorldInverse;
      u.uUpView.value.set(0, 1, 0).transformDirection(this.root.matrixWorld).transformDirection(view);
      u.uKeyView.value.copy(this.shade.key).transformDirection(this.root.matrixWorld).transformDirection(view);
    }
    this.updateShredPlane();
  }

  // ---------------------------------------------------------------- her animation + the shredding

  /**
   * Clips from office.glb: her body clips on a mixer; the CV's path (Shred) is sampled directly
   * (shredT), so the shredder's pull can be added on top of it without ever accumulating.
   */
  setupAnimation(model, clips) {
    if (!clips?.length) return;
    this.mixer = new THREE.AnimationMixer(model);
    const isAnchor = (t) => t.name.startsWith(`${this.anchor.name}.`);
    this.actions = {};
    for (const c of clips) {
      const name = c.name.split("|").pop();
      const body = c.tracks.filter((t) => !isAnchor(t));
      const cv = c.tracks.filter(isAnchor);
      if (body.length) this.actions[name] = this.mixer.clipAction(new THREE.AnimationClip(name, c.duration, body));
      if (cv.length && name === "Shred") {
        const pos = cv.find((t) => t.name.endsWith(".position"));
        const rot = cv.find((t) => t.name.endsWith(".quaternion"));
        this.cvPath = { pos: pos?.createInterpolant(), rot: rot?.createInterpolant(), duration: c.duration };
        // the feed starts when the CV stops moving in the clip (its top edge is in the slot)
        this.insertAt = pos ? lastChange(pos) : c.duration;
      }
    }
    for (const [name, a] of Object.entries(this.actions)) {
      if (name === "Type") a.setLoop(THREE.LoopRepeat, Infinity);
      else {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
    }
    this.mixer.addEventListener("finished", (e) => {
      if (e.action === this.current) this.play("Type"); // one-shots (and Shred) go back to typing
    });
    this.idleT = 4 + Math.random() * 4;
    this.play("Type", 0);
  }

  /** cross-fade her body to a clip */
  play(name, fade = 0.4) {
    const next = this.actions?.[name];
    if (!next || next === this.current) return;
    next.reset().setEffectiveWeight(1).play();
    if (this.current && fade > 0) next.crossFadeFrom(this.current, fade, false);
    else this.current?.stop();
    this.current = next;
  }

  animate(dt) {
    if (!this.mixer) return;
    const o = this.cfg.office;
    // idle: Type, and every so often something else (never while she's busy with the CV)
    if (this.current === this.actions.Type && !this.shredding) {
      this.idleT -= dt;
      if (this.idleT <= 0) {
        this.play(pickWeighted(o.idle ?? { Glance: 3, Mouse: 3, Sip: 2, Clock: 1.5, Stretch: 1 }, this.actions));
        this.idleT = (o.idleGap?.[0] ?? 5) + Math.random() * ((o.idleGap?.[1] ?? 12) - (o.idleGap?.[0] ?? 5));
      }
    }
    this.mixer.update(dt);
    const s = this.shred;
    if (this.shredding) {
      // the CV along her clip, then the shredder pulls it in (top edge first: page "up" = -Z)
      this.shredT += dt;
      const t = Math.min(this.shredT, this.cvPath.duration);
      if (this.cvPath.pos) this.anchor.position.fromArray(this.cvPath.pos.evaluate(t));
      if (this.cvPath.rot) this.anchor.quaternion.fromArray(this.cvPath.rot.evaluate(t));
      if (this.shredT >= this.insertAt) {
        s.feeding = s.active = true;
        s.progress = Math.min(1, s.progress + dt / (o.shredSeconds ?? 45));
      }
      this.anchor.translateZ(-s.progress * this._travel);
    }
    this.cvInTray = !this.shredding;
  }

  /** what she's doing, for the soundscape (audio/officeAmbience.js): {name, time} of her clip */
  clipState() {
    const a = this.current;
    return a ? { name: a.getClip().name, time: a.time } : null;
  }

  /** dev / demo: she picks the CV up and shreds it (O key, ?shred=N). Visual only. */
  startShred() {
    if (!this.actions?.Shred || !this.cvPath || this.shredding) return false;
    this.shredding = true;
    this.shredT = 0;
    Object.assign(this.shred, { active: false, feeding: false, progress: 0 });
    this.play("Shred", 0.3);
    return true;
  }

  /** back to the start: CV in the tray, page whole */
  resetShred() {
    this.shredding = false;
    this.anchor.position.copy(this.anchorRestPos);
    this.anchor.quaternion.copy(this.anchorRestQuat);
    Object.assign(this.shred, { active: false, feeding: false, progress: 0, cutZ: 0 });
    this.setPageClip(null);
    this.play("Type", 0.3);
  }

  toggleShred() {
    if (this.shredding) this.resetShred();
    else this.startShred();
    return this.shredding;
  }

  /**
   * While the page is being fed: the slot's plane in game space (normal out of the shredder;
   * everything behind it is "in the shredder") and where it cuts the page (cutZ, page metres
   * from the top edge). The page's materials clip against it.
   */
  updateShredPlane() {
    const s = this.shred;
    if (!s.feeding || !this.throat) return;
    this.root.updateMatrixWorld();
    const n = this._n.set(0, 1, 0).transformDirection(this.throat.matrixWorld); // Blender Z = glTF Y
    const p = this._p.setFromMatrixPosition(this.throat.matrixWorld);
    s.plane.setFromNormalAndCoplanarPoint(n, p);
    const { W, D } = this.world.size;
    // the page is y = 0; the cut line along it: n.x * x + n.z * z + c = 0 at the page's middle
    s.cutZ = Math.abs(n.z) > 1e-6 ? THREE.MathUtils.clamp(-(s.plane.constant + n.x * W / 2) / n.z, 0, D) : 0;
    if (!this._clipOn) this.setPageClip(s.plane);
  }

  /** clip the page's own materials (paper, letters, rules) against a plane, or stop (null) */
  setPageClip(plane) {
    this._clipOn = !!plane;
    const planes = plane ? [plane] : null;
    const seen = new Set();
    this.world.root.traverse((o) => {
      if (!o.isMesh || o === this.root) return;
      for (const m of [o.material].flat()) {
        if (seen.has(m)) continue;
        seen.add(m);
        m.clippingPlanes = planes;
        m.needsUpdate = true;
      }
    });
  }

  /** root.matrix = T(page centre) · S(K) · inverse(anchor relative to the office content) */
  place() {
    const m = this._m;
    this.anchor.updateMatrix();
    m.copy(this.anchor.matrix);
    for (let o = this.anchor.parent; o && o !== this.content; o = o.parent) {
      o.updateMatrix();
      m.premultiply(o.matrix);
    }
    m.invert();
    this._s.makeScale(this.k, this.k, this.k).setPosition(this.pageCenter);
    this.root.matrix.multiplyMatrices(this._s, m);
    this.root.matrixWorldNeedsUpdate = true;
  }

  /**
   * Dev check of the placement maths (console: `__cv.office.debugTilt(20)`): tilts the CV in the
   * office around its own X axis; the office should swing around the players. 0 puts it back.
   */
  debugTilt(deg = 0, liftCm = 0) {
    this.anchor.matrix.copy(this.anchorRest);
    this.anchor.matrix.decompose(this.anchor.position, this.anchor.quaternion, this.anchor.scale);
    this.anchor.position.y += liftCm / 100;
    this.anchor.rotateX(THREE.MathUtils.degToRad(deg));
  }

  dispose() {
    this.mixer?.stopAllAction();
    if (this._clipOn) this.setPageClip(null);
    this.root.removeFromParent();
    this.root.traverse((o) => o.geometry?.dispose());
    for (const m of this.materials) m.dispose();
    const desk = this.world.root.getObjectByName("desk");
    if (desk) desk.visible = true;
  }

  // ---------------------------------------------------------------- the Blender office

  /** @returns {THREE.Object3D | null} the CV anchor, or null if office.glb isn't available */
  loadModel() {
    const gltf = getModel("office");
    if (!gltf) return null;
    const model = cloneSkinned(gltf.scene);
    const anchor = model.getObjectByName("CV_Anchor");
    if (!anchor) {
      console.warn("[office] office.glb has no CV_Anchor: using the placeholder");
      return null;
    }
    const own = new Map(); // one copy per source material (the cached glTF stays untouched)
    model.traverse((o) => {
      if (!o.isMesh) return;
      if (o.isSkinnedMesh) o.frustumCulled = false; // her bounds come from the rest pose; she moves
      o.castShadow = false; // the sun's shadow map only covers the page
      o.receiveShadow = false;
      o.material = [o.material].flat().map((m) => {
        let c = own.get(m);
        if (!c) {
          c = officeMaterial(m, this.cfg.office, this.shade);
          own.set(m, c);
          this.materials.push(c);
        }
        return c;
      });
      if (o.material.length === 1) o.material = o.material[0];
    });
    this.content.add(model);
    this.source = "office.glb";
    this.throat = model.getObjectByName("Shredder_Throat");
    this.anchor = anchor; // setupAnimation needs it
    this.setupAnimation(model, gltf.animations);
    return anchor;
  }

  // ---------------------------------------------------------------- placeholder (no office.glb)

  /** @returns {THREE.Object3D} the CV anchor */
  buildPlaceholder() {
    const c = this.content;
    // Self-lit: the game's sun and sky are aimed at the page, not at a room that swings around it,
    // so they leave most of the office black. Half the colour as emission stands in for the room's
    // own lighting until the Blender model brings baked light.
    const mat = (color, extra = {}) => {
      const c = new THREE.Color(color);
      const m = new THREE.MeshStandardMaterial({ color: c, emissive: c.clone().multiplyScalar(0.5), roughness: 0.85, metalness: 0, fog: false, ...extra });
      this.materials.push(m);
      return m;
    };
    const box = (w, h, d, material, x, y, z, parent = c) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      b.position.set(x, y, z);
      parent.add(b);
      return b;
    };

    // room (10 x 12 m, 2.8 m ceiling)
    const R = { w: 10, d: 12, h: 2.8 };
    const carpet = mat(0x6b685d), wall = mat(0xd8d0bb), ceiling = mat(0xe6e2d8);
    box(R.w, 0.02, R.d, carpet, 0, -0.01, 0);
    box(R.w, 0.02, R.d, ceiling, 0, R.h + 0.01, 0);
    box(0.1, R.h, R.d, wall, -R.w / 2, R.h / 2, 0);
    box(0.1, R.h, R.d, wall, R.w / 2, R.h / 2, 0);
    box(R.w, R.h, 0.1, wall, 0, R.h / 2, -R.d / 2);
    box(R.w, R.h, 0.1, wall, 0, R.h / 2, R.d / 2);
    const panel = mat(0xffffff, { emissive: 0xfff6e0, emissiveIntensity: 1.2 });
    for (let x = -3.6; x <= 3.6; x += 2.4) for (let z = -4.8; z <= 4.8; z += 2.4) box(0.6, 0.02, 1.2, panel, x, R.h - 0.005, z);

    // cubicle partitions (Stanley Parable-ish grey-blue fabric)
    const fabric = mat(0x7f8a93);
    for (const [x, z, w, d] of [[0, -1.0, 3.2, 0.05], [-1.6, 0, 0.05, 2.0], [1.65, 0, 0.05, 2.0], [-3.5, -3, 3, 0.05], [3.5, -3, 3, 0.05], [-3.5, 3, 3, 0.05]]) {
      box(w, 1.5, d, fabric, x, 0.75, z);
    }

    // desk
    const wood = mat(0x8b6b4b), metal = mat(0x55585c, { metalness: 0.4, roughness: 0.5 });
    box(DESK.w, DESK.thick, DESK.d, wood, 0, DESK.top - DESK.thick / 2, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.04, DESK.top - DESK.thick, 0.04, metal, sx * (DESK.w / 2 - 0.05), (DESK.top - DESK.thick) / 2, sz * (DESK.d / 2 - 0.05));

    // two stacked letter trays (black plastic, open front facing the woman: +Z)
    const plastic = mat(0x1d1d20, { roughness: 0.6 });
    for (let i = 0; i < 2; i++) this.trayShell(box, plastic, TRAY_AT.x, DESK.top + i * TRAY.h, TRAY_AT.z);

    // monitor, keyboard, phone, mug
    const dark = mat(0x26272b), screen = mat(0x9fb8d8, { emissive: 0x6f8fb8, emissiveIntensity: 0.6 });
    box(0.56, 0.34, 0.03, dark, -0.15, DESK.top + 0.32, -0.25);
    box(0.52, 0.3, 0.005, screen, -0.15, DESK.top + 0.32, -0.233);
    box(0.06, 0.15, 0.06, dark, -0.15, DESK.top + 0.075, -0.27);
    box(0.44, 0.02, 0.14, mat(0xcfcac0), -0.15, DESK.top + 0.01, 0.12);
    box(0.2, 0.06, 0.18, mat(0x3a3b40), -0.6, DESK.top + 0.03, -0.1);
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 20), mat(0xb84a3a));
    mug.position.set(0.25, DESK.top + 0.05, 0.2);
    c.add(mug);

    // the giant woman (blocks): chair, body, head, arm resting on the desk
    const cardigan = mat(0x7b4f5f), skin = mat(0xe2b596), hair = mat(0x4a3024);
    box(0.5, 0.08, 0.48, dark, -0.15, 0.47, 0.75);
    box(0.4, 0.55, 0.24, cardigan, -0.15, 0.82, 0.78);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 16), skin);
    head.position.set(-0.15, 1.27, 0.74);
    c.add(head);
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 16), hair);
    bun.position.set(-0.15, 1.31, 0.78);
    c.add(bun);
    box(0.08, 0.08, 0.38, cardigan, 0.1, DESK.top + 0.05, 0.4);
    box(0.09, 0.03, 0.18, skin, 0.1, DESK.top + 0.02, 0.15);

    // paper shredder on the floor to her right
    const shredder = box(0.38, 0.6, 0.28, mat(0x2b2c2f), 0.98, 0.3, 0.55);
    box(0.25, 0.006, 0.02, mat(0x050505), 0, 0.3, 0, shredder);

    // the anchor: centre of the page, axes like the game's (no rotation in this layout)
    const anchor = new THREE.Object3D();
    anchor.name = "CV_Anchor";
    anchor.position.set(TRAY_AT.x, TRAY_FLOOR + PAPER_LIFT, TRAY_AT.z);
    anchor.updateMatrix();
    c.add(anchor);
    this.source = "placeholder";
    return anchor;
  }

  /** open-front letter tray: floor + back + sides + low front lip */
  trayShell(box, material, cx, y0, cz) {
    const { inW, inD, h, wall, frontH } = TRAY;
    const ow = inW + wall * 2, od = inD + wall * 2;
    const wallH = h - wall; // walls stand on the floor; the level is h tall in all
    box(ow, wall, od, material, cx, y0 + wall / 2, cz); // floor
    box(ow, wallH, wall, material, cx, y0 + wall + wallH / 2, cz - od / 2 + wall / 2); // back
    for (const sx of [-1, 1]) box(wall, wallH, od, material, cx + sx * (ow / 2 - wall / 2), y0 + wall + wallH / 2, cz);
    box(ow, frontH, wall, material, cx, y0 + wall + frontH / 2, cz + od / 2 - wall / 2); // front lip
  }
}
