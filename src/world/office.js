// The office around the CV: a real-scale room (metres, as built in Blender) shown around the
// game world. Environment only: nothing here touches collision, raycasts or the network.
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
// The model is public/models/office.glb (blender_src/scripts/build_office.py), loaded with the
// other models at page load. If it is missing, a procedural placeholder with the same layout and
// real dimensions is used instead, like the box avatar / box gun fallbacks.
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { getModel } from "../assets/models.js";

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
    this.anchor = this.loadModel() || this.buildPlaceholder();
    this.anchorRest = this.anchor.matrix.clone();

    // the old dark plane around the page would hide the tray floor (it sits 0.25 m below the paper)
    const desk = world.root.getObjectByName("desk");
    if (desk) desk.visible = false;

    this._m = new THREE.Matrix4();
    this._s = new THREE.Matrix4();
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

  /** environment time step (animations later); keeps the office locked to the anchor */
  update(dt) {
    this.place();
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
      o.castShadow = false; // the sun's shadow map only covers the page
      o.receiveShadow = false;
      o.material = [o.material].flat().map((m) => {
        let c = own.get(m);
        if (!c) {
          c = m.clone();
          c.fog = false;
          // self-lit until the lighting is baked (step 3): see buildPlaceholder()
          if (c.emissive && c.emissive.getHex() === 0) c.emissive.copy(c.color).multiplyScalar(0.5);
          c.emissiveIntensity = Math.max(c.emissiveIntensity, 1);
          own.set(m, c);
          this.materials.push(c);
        }
        return c;
      });
      if (o.material.length === 1) o.material = o.material[0];
    });
    this.content.add(model);
    this.source = "office.glb";
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
