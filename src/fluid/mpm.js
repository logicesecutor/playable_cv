import { ComputeShader } from "@babylonjs/core/Compute/computeShader.js";
import { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import { StorageBuffer } from "@babylonjs/core/Buffers/storageBuffer.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import "@babylonjs/core/Engines/WebGPU/Extensions/engine.computeShader.js";
import trace from "../rt/trace.wgsl?raw";
import common from "./mpm.wgsl?raw";
import clear from "./clear.compute.wgsl?raw";
import p2g1 from "./p2g1.compute.wgsl?raw";
import p2g2 from "./p2g2.compute.wgsl?raw";
import gridUpdate from "./grid.compute.wgsl?raw";
import g2p from "./g2p.compute.wgsl?raw";
import forcesSource from "./forces.wgsl?raw";
import maskSource from "./mask.compute.wgsl?raw";
import splat from "./splat.compute.wgsl?raw";
import overlay from "./overlay.compute.wgsl?raw";
import { SCALE } from "../scene/office.js";

const BOX = [80, 24, 80]; // u: centred on the mug's start in x and z, from 4 u under the desk top
// ?pool (M11 check): a closed box flooded deep enough to float the empty mug (it draws ~6 u), the
// mug dropped in from just above (standing on the floor, no coffee gets under it to lift it)
const POOL = { box: [16, 14, 16], depth: 7 };
const DENSITY = 1000; // kg/m³ (player metres, like the props' densities in office.js)
const BELOW = 4;
// shortcut: the desk top as PLAN.md measures it (144 × 72 u, top at 66.6); read it from the glb if the desk moves
const DESK = { min: [-72, -36], max: [72, 36], top: 66.6 };
const FILL = 0.8; // of the mug's inside height
const PER_CELL = 8; // particles per cell at rest: 2 × 2 × 2, the rest density
const SOUND = 50; // u/s: pressure waves ~3× faster than the coffee flows, so it stays ~incompressible
const CFL = 0.35; // a sound wave crosses at most this much of a cell per step
const VISCOSITY = 0.1; // × sound speed in cells/s (nialltl's 0.1 at his rest density 4 and time unit)
const MAX_SUBSTEPS = 12; // per frame; beyond, the coffee runs in slow motion
const MAX_BODIES = 16;
const IMPULSE_FIX = 100; // as in mpm.wgsl
// drag (1/s, Havok linear damping) on a body while the coffee pushes it: the impulses land a frame
// or two late, and undamped a floating mug bobs harder each time (added mass); the level it floats
// at is unchanged. Not on rotation: it would hold a full mug up against a shove.
const DRAG = 2;
const BINDINGS = ["params", "bodies", "grid", "particles", "mask", "removed", "view", "depthTex", "image", "out", "forces", "clock"];

/**
 * The coffee (M10): MLS-MPM particles in a fixed box over the desk around the mug (mpm.wgsl). Every
 * frame, after physics: as many substeps of clear → P2G1 → P2G2 → grid → G2P as the frame time
 * needs. Colliders: the desk top, the static clutter (a mask built once from the BVH), the mug
 * (a cup), the player (a capsule), the other loose bodies (boxes), all moving with Havok. The
 * momentum each takes from the coffee is read back and applied in Havok a frame or two later (M11);
 * the player gets a capped push. Particles leaving the box sideways or below are gone, unless
 * `pool` closes it. `overlay` (key P) draws them.
 */
export function createFluid(scene, camera, gbuffer, rt, office, player, { pool = false } = {}) {
  const engine = scene.getEngine();
  const pass = (name, source, prefix = "") =>
    new ComputeShader(`mpm.${name}`, engine, { computeSource: prefix + common + source }, {
      bindingsMapping: { ...Object.fromEntries(BINDINGS.map((b, i) => [b, { group: 0, binding: i }])), ...rt.bindings },
    });
  const passes = {
    clear: pass("clear", clear), p2g1: pass("p2g1", p2g1), p2g2: pass("p2g2", p2g2), grid: pass("grid", forcesSource + gridUpdate),
    g2p: pass("g2p", forcesSource + g2p), mask: pass("mask", maskSource, trace), splat: pass("splat", splat), overlay: pass("overlay", overlay),
  };
  const params = new UniformBuffer(engine, undefined, undefined, "mpm");
  for (const name of ["size", "origin", "step", "fluid", "desk", "walls"]) params.addUniform(name, 4);
  params.create();
  const viewParams = new UniformBuffer(engine, undefined, undefined, "mpm.view");
  viewParams.addUniform("viewProjection", 16);
  viewParams.addUniform("eye", 4);
  viewParams.addUniform("size", 4);
  viewParams.create();
  const bodyData = new Float32Array(32 * MAX_BODIES);
  const bodies = new StorageBuffer(engine, bodyData.byteLength, undefined, "mpm.bodies");
  const removed = new StorageBuffer(engine, 4, undefined, "mpm.removed");
  const zeros = new Int32Array(8 * MAX_BODIES);
  const forces = new StorageBuffer(engine, zeros.byteLength, undefined, "mpm.forces");
  for (const name of ["grid", "g2p"]) passes[name].setStorageBuffer("forces", forces);
  const clock = new StorageBuffer(engine, 4, undefined, "mpm.clock");
  for (const name of ["clear", "grid", "g2p"]) passes[name].setStorageBuffer("clock", clock);
  for (const cs of Object.values(passes)) if (cs !== passes.clear && cs !== passes.overlay) cs.setUniformBuffer("params", params);
  for (const name of ["p2g2", "grid", "g2p"]) passes[name].setStorageBuffer("bodies", bodies);
  passes.g2p.setStorageBuffer("removed", removed);
  passes.splat.setUniformBuffer("view", viewParams);
  rt.bind(passes.mask, ["nodes", "tris", "attribs"]);

  const mug = office.mug;
  const [R, H, wall, bottom] = mug.extras.cup.map((v) => v * SCALE);
  const loose = office.bodies.filter((b) => b !== mug).slice(0, MAX_BODIES - 2);
  const box = pool ? POOL.box : BOX;
  const origin = [mug.pos.x - box[0] / 2, DESK.top - BELOW, mug.pos.z - box[2] / 2];

  let sim; // per cell size: { dx, n, count, dt, grid, mask, particles, maskBuilt }
  const build = (dx) => {
    if (sim?.dx === dx) return;
    if (sim) [sim.grid, sim.mask, sim.particles].forEach((b) => b.dispose());
    const n = box.map((s) => Math.round(s / dx));
    const nodes = n[0] * n[1] * n[2];
    const lattice = shuffle(pool ? poolLattice(dx / 2, n) : cupLattice(dx / 2));
    sim = {
      dx, n, lattice, count: lattice.length / 3, dt: (CFL * dx) / SOUND, maskBuilt: false,
      grid: new StorageBuffer(engine, 16 * nodes, undefined, "mpm.grid"),
      mask: new StorageBuffer(engine, 4 * nodes, undefined, "mpm.mask"),
    };
    sim.particles = new StorageBuffer(engine, 80 * sim.count, undefined, "mpm.particles");
    for (const cs of [passes.clear, passes.p2g1, passes.p2g2, passes.grid, passes.g2p]) cs.setStorageBuffer("grid", sim.grid);
    for (const cs of [passes.p2g1, passes.p2g2, passes.g2p, passes.splat]) cs.setStorageBuffer("particles", sim.particles);
    for (const cs of [passes.p2g2, passes.grid, passes.mask]) cs.setStorageBuffer("mask", sim.mask);
    const c = SOUND / dx; // sound speed in cells/s
    sim.forces = [9.81 / dx, (c * c * PER_CELL) / 5, VISCOSITY * c]; // gravity, stiffness, viscosity
    params.updateFloat4("size", ...n, sim.count);
    params.updateFloat4("origin", ...origin, dx);
    params.updateFloat4("step", sim.dt, ...sim.forces);
    params.updateFloat4("fluid", PER_CELL, 2 + loose.length, (DESK.top - origin[1]) / dx, 0);
    params.updateFloat4("desk", (DESK.min[0] - origin[0]) / dx, (DESK.min[1] - origin[2]) / dx, (DESK.max[0] - origin[0]) / dx,
      (DESK.max[1] - origin[2]) / dx);
    params.updateFloat4("walls", pool ? 1 : 0, 0, 0, 0);
    params.update();
    reset();
  };

  // the coffee at rest in the mug's frame: a lattice `h` apart (2 per cell along each axis) in the
  // hollow, up to the fill level
  function cupLattice(h) {
    const out = [], inner = R - wall - h / 2, level = bottom + FILL * (H - bottom);
    for (let y = bottom + h / 2; y < level; y += h) {
      for (let x = -inner; x <= inner; x += h) {
        for (let z = -inner; z <= inner; z += h) if (x * x + z * z <= inner * inner) out.push([x, y, z]);
      }
    }
    return out;
  }

  // ?pool: the box's inside (2 cells off its walls) from the desk top up to the pool depth, in world space
  function poolLattice(h, n) {
    const out = [], dx = 2 * h;
    for (let y = DESK.top + h / 2; y < DESK.top + POOL.depth; y += h) {
      for (let x = origin[0] + 2 * dx + h / 2; x < origin[0] + (n[0] - 3) * dx; x += h) {
        for (let z = origin[2] + 2 * dx + h / 2; z < origin[2] + (n[2] - 3) * dx; z += h) out.push([x, y, z]);
      }
    }
    return out;
  }

  // neighbours in one wave would add to the same grid nodes, and atomics on one address serialise
  function shuffle(out) {
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out.flat();
  }

  /** Fill the mug where it stands, at its velocity (?pool: flood the box, the empty mug above it); the removed count back to 0. */
  function reset() {
    if (pool) {
      mug.body.disablePreStep = false; // teleported, as office.reset() does
      mug.mesh.position.set(mug.pos.x, DESK.top + POOL.depth + 1, mug.pos.z);
      mug.mesh.rotationQuaternion.copyFrom(mug.rot);
      mug.body.setLinearVelocity(Vector3.ZeroReadOnly);
      mug.body.setAngularVelocity(Vector3.ZeroReadOnly);
      scene.onAfterPhysicsObservable.addOnce(() => (mug.body.disablePreStep = true));
    }
    const data = new Float32Array(20 * sim.count);
    const world = pool ? Matrix.IdentityReadOnly : mug.mesh.computeWorldMatrix(true);
    const centre = mug.body.getObjectCenterWorld(), v = mug.body.getLinearVelocity(), w = mug.body.getAngularVelocity();
    const p = new Vector3();
    for (let i = 0; i < sim.count; i++) {
      Vector3.TransformCoordinatesFromFloatsToRef(sim.lattice[3 * i], sim.lattice[3 * i + 1], sim.lattice[3 * i + 2], world, p);
      const pv = pool ? Vector3.Zero() : v.add(Vector3.Cross(w, p.subtract(centre)));
      data.set([(p.x - origin[0]) / sim.dx, (p.y - origin[1]) / sim.dx, (p.z - origin[2]) / sim.dx, pool ? 1 : 2,
        pv.x / sim.dx, pv.y / sim.dx, pv.z / sim.dx, PER_CELL], 20 * i); // C (the rest) = 0
    }
    sim.particles.update(data);
    removed.update(new Uint32Array(1));
    alive = sim.count;
    epoch++; // impulses still on their way back from before are dropped
  }

  // the colliders, 32 floats each (Body in mpm.wgsl)
  const toLocal = new Matrix(), shift = new Matrix();
  const writeBody = (i, inverse, centre, v, w, shape) => {
    bodyData.set(inverse.m, 32 * i);
    bodyData.set([centre.x, centre.y, centre.z, 0, v.x, v.y, v.z, 0, w.x, w.y, w.z, 0, ...shape], 32 * i + 16);
  };
  const uploadBodies = () => {
    mug.mesh.computeWorldMatrix(true).invertToRef(toLocal); // forced: physics moved it this frame
    writeBody(0, toLocal, mug.body.getObjectCenterWorld(), mug.body.getLinearVelocity(), mug.body.getAngularVelocity(), [R, H, wall, bottom]);
    const pos = player.position, { height, radius } = player.capsule;
    writeBody(1, Matrix.Translation(-pos.x, -pos.y, -pos.z), pos, player.velocity, Vector3.ZeroReadOnly, [radius, height / 2 - radius, 0, 0]);
    loose.forEach((b, k) => {
      const box = b.mesh.getBoundingInfo().boundingBox; // local
      b.mesh.computeWorldMatrix(true).invertToRef(toLocal);
      Matrix.TranslationToRef(-box.center.x, -box.center.y, -box.center.z, shift);
      writeBody(2 + k, toLocal.multiply(shift), b.body.getObjectCenterWorld(), b.body.getLinearVelocity(), b.body.getAngularVelocity(),
        [box.extendSize.x, box.extendSize.y, box.extendSize.z, 0]);
    });
    bodies.update(bodyData);
  };

  // the coffee's push back, as Havok impulses (kg·u/s) at each body's centre of mass; the player
  // takes it as a capped drift (player.js)
  const impulse = new Vector3(), angular = new Vector3();
  let lastForces; // for debug()
  const damping = new Map(); // body → its own linear damping, while the coffee drags it
  const applyForces = (f, kg, seconds) => {
    lastForces = { f, kg, seconds };
    for (let i = 0; i < 2 + loose.length; i++) {
      impulse.set(f[8 * i], f[8 * i + 1], f[8 * i + 2]).scaleInPlace(kg);
      const body = i === 0 ? mug.body : i > 1 ? loose[i - 2].body : null;
      if (body && impulse.lengthSquared() === 0 && damping.has(body)) {
        body.setLinearDamping(damping.get(body));
        damping.delete(body);
      }
      if (impulse.lengthSquared() === 0) continue;
      if (!body) {
        player.push(impulse, seconds);
        continue;
      }
      if (!damping.has(body)) {
        damping.set(body, body.getLinearDamping());
        body.setLinearDamping(DRAG);
      }
      angular.set(f[8 * i + 3], f[8 * i + 4], f[8 * i + 5]).scaleInPlace(kg);
      body.applyImpulse(impulse, body.getObjectCenterWorld());
      body.applyAngularImpulse(angular);
    }
  };

  // the debug view's targets, at the render size
  let image, overlayTexture;
  const targets = () => {
    image?.dispose();
    overlayTexture?.dispose();
    const w = gbuffer.mrt.getRenderWidth(), h = gbuffer.mrt.getRenderHeight();
    image = new StorageBuffer(engine, 4 * w * h, undefined, "mpm.image");
    image.update(new Uint32Array(w * h).fill(0xffffffff));
    overlayTexture = RawTexture.CreateRGBAStorageTexture(null, w, h, scene, false, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE,
      Constants.TEXTURETYPE_UNSIGNED_BYTE);
    passes.splat.setStorageBuffer("image", image);
    passes.overlay.setStorageBuffer("image", image);
    passes.overlay.setStorageTexture("out", overlayTexture);
  };
  targets();

  let alive = 0, readAt = 0, frame = -1, drawn = -1, overlayOn = false, ms = 0, epoch = 0;
  const groups = (count, size) => Math.ceil(count / size);
  scene.onBeforeRenderTargetsRenderObservable.add(() => {
    if (scene.getFrameId() === frame) return; // notified twice per frame
    frame = scene.getFrameId();
    const nodes = sim.n[0] * sim.n[1] * sim.n[2];
    if (!sim.maskBuilt) {
      sim.maskBuilt = passes.mask.dispatch(groups(nodes, 256));
      return;
    }
    // as many substeps as the frame took, each at most dt
    const frameDt = Math.min(engine.getDeltaTime() / 1000, 0.1);
    const steps = Math.min(Math.ceil(frameDt / sim.dt), MAX_SUBSTEPS);
    params.updateFloat4("step", frameDt / steps, ...sim.forces);
    params.updateFloat4("walls", pool ? 1 : 0, steps, 0, 0);
    params.update();
    uploadBodies();
    forces.update(zeros);
    clock.update(zeros.subarray(0, 1));
    for (let s = 0; s < steps; s++) {
      passes.clear.dispatch(groups(nodes, 256));
      passes.p2g1.dispatch(groups(sim.count, 64));
      passes.p2g2.dispatch(groups(sim.count, 64));
      passes.grid.dispatch(groups(nodes, 256));
      passes.g2p.dispatch(groups(sim.count, 64));
    }
    const sent = epoch, kg = (DENSITY * (sim.dx / 2) ** 3) / IMPULSE_FIX; // per particle mass unit
    forces.read(undefined, undefined, undefined, true) // flushed at the end of this frame: a frame sooner
      .then((d) => sent === epoch && applyForces(new Int32Array(d.buffer, d.byteOffset, 8 * MAX_BODIES), kg, frameDt));
    const now = performance.now();
    if (now >= readAt) {
      readAt = now + 500;
      removed.read().then((d) => (alive = sim.count - new Uint32Array(d.buffer, d.byteOffset, 1)[0]));
      ms = [passes.clear, passes.p2g1, passes.p2g2, passes.grid, passes.g2p]
        .reduce((t, cs) => t + (cs.gpuTimeInFrame?.counter.lastSecAverage ?? 0) / 1e6, 0);
    }
  });
  // the debug dots once the G-buffer holds this frame's depth
  scene.onAfterRenderTargetsRenderObservable.add(() => {
    if (!overlayOn || scene.getFrameId() === drawn) return;
    drawn = scene.getFrameId();
    const w = gbuffer.mrt.getRenderWidth(), h = gbuffer.mrt.getRenderHeight(), eye = camera.globalPosition;
    viewParams.updateMatrix("viewProjection", camera.getTransformationMatrix());
    viewParams.updateFloat4("eye", eye.x, eye.y, eye.z, 1);
    viewParams.updateFloat4("size", w, h, (2 * Math.tan(camera.fov / 2)) / h, 0);
    viewParams.update();
    passes.splat.setTexture("depthTex", gbuffer.mrt.textures[3], false);
    passes.splat.dispatch(groups(sim.count, 64));
    passes.overlay.dispatch(groups(w, 8), groups(h, 8));
  });
  addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.code === "KeyP") overlayOn = !overlayOn;
    if (e.code === "KeyR") reset(); // office.reset() puts the mug back first (mugControls)
  });

  build(0.8); // the low preset's grid until a preset is applied
  return {
    debug: () => ({ ...sim, origin, lastForces }), // for the console and tools/
    /** Cell size (u): rebuilds the grid and refills the mug when it changes (quality presets). */
    setCell: build,
    reset,
    get overlay() {
      return overlayOn;
    },
    get overlayTexture() {
      return overlayTexture;
    },
    /** Particles still in the box, of all, and the MPM's GPU ms per frame (1 s mean). */
    get stats() {
      return { alive, count: sim.count, ms, cell: sim.dx };
    },
    passes: [passes.clear, passes.p2g1, passes.p2g2, passes.grid, passes.g2p],
    resize: targets,
  };
}
