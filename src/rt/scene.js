import { Matrix } from "@babylonjs/core/Maths/math.vector.js";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial.js";
import { StorageBuffer } from "@babylonjs/core/Buffers/storageBuffer.js";
import { build, refit } from "./bvh.js";
import { loadTextureArrays, SIZE } from "./textures.js";

const STACK = 64; // traceBlas's stack in trace.wgsl
const NAMES = ["nodes", "tris", "triMaterial", "instances", "tlas"];
const SHADING = ["lights", "attribs", "materials"]; // group 1 after NAMES, declared in lighting.compute.wgsl

/**
 * The ray tracer's copy of the scene on the GPU (bindings in trace.wgsl). One bottom-level BVH per
 * instance: the static office in world space, each loose body in its own space, the player skinned
 * on the CPU every frame in world space and refitted; a top-level BVH over the instances rebuilt
 * every frame. The bottom-level BVHs are built once, in a worker. Material ids are the G-buffer's.
 * For hit shading (M8): per-triangle vertex normals and UVs, a material table and texture arrays.
 */
export async function createRTScene(scene, office, player, gbuffer) {
  const engine = scene.getEngine();
  const loose = office.bodies.map((b) => b.mesh);
  const body = player.model.getChildMeshes().filter((m) => m.getTotalVertices() > 0);
  const statics = gbuffer.mrt.renderList.filter((m) => !loose.includes(m) && !body.includes(m));
  const blases = [
    { name: "office", ...gather(statics, gbuffer, true) },
    ...loose.map((m) => ({ name: m.name, mesh: m, ...gather([m], gbuffer, false) })),
    { name: "player", skin: skinner(body), ...gather(body, gbuffer, false, false) },
  ];
  const textures = loadTextureArrays(scene, gbuffer.materials);
  const skinned = blases.at(-1);
  skinned.skin(skinned.verts); // the build needs the posed body

  const t0 = performance.now();
  const worker = new Worker(new URL("./bvh.worker.js", import.meta.url), { type: "module" });
  const built = await new Promise((resolve, reject) => {
    worker.onmessage = (e) => resolve(e.data);
    worker.onerror = reject;
    worker.postMessage(blases.map((b) => soup(b)));
  });
  worker.terminate();
  const buildMs = performance.now() - t0;

  // pack every BLAS into shared arrays, triangles in BVH order, node links made global
  const triangles = blases.reduce((n, b) => n + b.mats.length, 0);
  const nodeCount = built.reduce((n, b) => n + b.nodes.length / 8, 0);
  const tris = new Float32Array(12 * triangles);
  const attribs = new Float32Array(16 * triangles);
  const mats = new Uint32Array(triangles);
  const nodes = new Float32Array(8 * nodeCount);
  let triBase = 0, nodeBase = 0;
  blases.forEach((b, i) => {
    Object.assign(b, built[i], { triBase, nodeBase });
    if (depth(b.nodes) > STACK) throw new Error(`BVH of ${b.name} is deeper than the traversal stack`);
    b.order.forEach((t, s) => (mats[triBase + s] = b.mats[t]));
    writeTris(b, tris);
    writeAttribs(b, attribs);
    writeNodes(b, nodes);
    triBase += b.mats.length;
    nodeBase += b.nodes.length / 8;
  });

  const buffer = (bytes, label) => new StorageBuffer(engine, bytes, undefined, label);
  const gpu = {
    nodes: buffer(nodes.byteLength, "nodes"),
    tris: buffer(tris.byteLength, "tris"),
    triMaterial: buffer(mats.byteLength, "triMaterial"),
    instances: buffer(80 * blases.length, "instances"),
    tlas: buffer(32 * (2 * blases.length - 1), "tlas"),
    attribs: buffer(attribs.byteLength, "attribs"),
  };
  gpu.nodes.update(nodes);
  gpu.tris.update(tris);
  gpu.triMaterial.update(mats);
  gpu.attribs.update(attribs);
  const { lights, windows } = emitters(statics);
  if (!lights.length) throw new Error("no emissive triangles: nothing would be lit");
  gpu.lights = buffer(lights.byteLength, "lights");
  gpu.lights.update(lights);
  const arrays = await textures;
  // per material id (0 = nothing): colour, roughness, metal, texture layer, as the G-buffer has them
  const table = new Float32Array(8 * (gbuffer.materials.length + 1));
  gbuffer.materials.forEach((m, i) => {
    const c = m.albedoColor;
    table.set([c.r, c.g, c.b, m.roughness ?? 1, m.metallic ?? 0, arrays.layer(m)], 8 * (i + 1));
  });
  gpu.materials = buffer(table.byteLength, "materials");
  gpu.materials.update(table);

  // every frame: skin + refit the player, place the instances, rebuild the TLAS
  const instances = new Float32Array(20 * blases.length);
  const instanceU = new Uint32Array(instances.buffer);
  const boxes = new Float32Array(6 * blases.length);
  const toObject = new Matrix();
  const playerBoxes = new Float32Array(6 * skinned.mats.length);
  // ms per frame, smoothed: total, skin, triangles + refit, player upload, instances + TLAS
  const stats = { triangles, nodes: nodeCount, lights: lights.length / 20, windows, buildMs, ms: [0, 0, 0, 0, 0] };
  let frame = -1;
  let moved = true;
  scene.onBeforeRenderTargetsRenderObservable.add(() => {
    if (scene.getFrameId() === frame) return; // notified twice per frame
    frame = scene.getFrameId();
    const t = performance.now();
    const p = skinned;
    p.skin(p.verts);
    const t1 = performance.now();
    writeTris(p, tris);
    refit(p.nodes, packedBoxes(tris, p.triBase, p.mats.length, playerBoxes));
    writeNodes(p, nodes);
    const t2 = performance.now();
    upload(gpu.tris, tris, 12 * p.triBase, 12 * (p.triBase + p.mats.length));
    upload(gpu.nodes, nodes, 8 * p.nodeBase, 8 * (p.nodeBase + p.nodes.length / 8));
    const t3 = performance.now();

    moved = false;
    blases.forEach((b, i) => {
      // forced: before the render targets the cached matrix is still last frame's (physics moved the body since)
      const world = b.mesh ? b.mesh.computeWorldMatrix(true) : Matrix.IdentityReadOnly;
      // moved: more than 1e-3 (u, or rad) from where it was when the image last restarted, so a body
      // creeping a little every frame still restarts it, but resting jitter does not
      moved ||= !b.rest || world.m.some((x, k) => Math.abs(x - b.rest[k]) > 1e-3);
      b.toObject = world.invertToRef(toObject).m.slice();
      worldBox(b.nodes, world.m, boxes, i);
    });
    const tlas = build(boxes, 1);
    tlas.order.forEach((i, k) => {
      instances.set(blases[i].toObject, 20 * k);
      instanceU[20 * k + 16] = blases[i].nodeBase;
      instanceU[20 * k + 17] = i;
    });
    if (moved) blases.forEach((b) => (b.rest = (b.mesh ? b.mesh.getWorldMatrix() : Matrix.IdentityReadOnly).m.slice()));
    upload(gpu.instances, instances, 0, instances.length);
    upload(gpu.tlas, tlas.nodes, 0, tlas.nodes.length);
    const t4 = performance.now();
    [t4 - t, t1 - t, t2 - t1, t3 - t2, t4 - t3].forEach((ms, i) => (stats.ms[i] = stats.ms[i] * 0.95 + ms * 0.05));
  });

  return {
    stats,
    blases: blases.map((b) => b.name),
    /** Did a loose body move this frame (the player's own motion is not counted)? */
    get moved() {
      return moved;
    },
    /** How many of the lights come first as the window panes (the sun's portals). */
    windows,
    /** Texture arrays for hit shading: `albedo` (linear) and `orm`, layers as in the material table. */
    textures: arrays,
    /** The player's posed triangles, world space: vertices (3 floats each), corners (3 per triangle), material ids. */
    pose: () => ({ verts: skinned.verts, corners: skinned.corners, mats: skinned.mats }),
    /** Bind the scene buffers to a compute shader whose source includes trace.wgsl: only those it
     * uses (WGSL's automatic layout drops the others, and binding them fails). */
    bind(cs, names = NAMES) {
      for (const name of names) cs.setStorageBuffer(name, gpu[name]);
    },
    bindings: Object.fromEntries([...NAMES, ...SHADING].map((name, i) => [name, { group: 1, binding: i }])),
  };
}

// every emissive triangle of the meshes, world space, facing where its vertex normals face; 20
// floats each: v0, area, e1, radius (centroid to the farthest corner), e2, alias threshold, normal,
// alias (u32), emission, pdf. The window panes (material "Daylight") come first. pdf ∝ power
// (luminance × area), sampled in O(1) with Vose's alias table.
function emitters(meshes) {
  const out = [], windowTris = [];
  const sub = (a, b) => a.map((x, k) => x - b[k]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (const m of meshes) {
    const p = m.getVerticesData("position");
    const nrm = m.getVerticesData("normal");
    const idx = m.getIndices();
    const w = m.computeWorldMatrix(true).m;
    for (const sm of m.subMeshes) {
      const material = m.material instanceof MultiMaterial ? m.material.subMaterials[sm.materialIndex] : m.material;
      const e = material.emissiveColor.scale(material.emissiveIntensity);
      if (!(e.r + e.g + e.b > 0)) continue;
      for (let i = sm.indexStart; i < sm.indexStart + sm.indexCount; i += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => transform(w, p[3 * idx[i + k]], p[3 * idx[i + k] + 1], p[3 * idx[i + k] + 2]));
        let e1 = sub(b, a), e2 = sub(c, a);
        let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const len = Math.hypot(...n);
        if (!len) continue;
        n = n.map((x) => x / len);
        const vn = [0, 1, 2].map((k) => idx[i + k]).reduce((s, v) => s.map((x, j) => x + nrm[3 * v] * w[j] + nrm[3 * v + 1] * w[4 + j] + nrm[3 * v + 2] * w[8 + j]), [0, 0, 0]);
        if (dot(n, vn) < 0) [e1, e2, n] = [e2, e1, n.map((x) => -x)];
        const centre = a.map((x, k) => x + (e1[k] + e2[k]) / 3);
        const radius = Math.max(...[a, b, c].map((v) => Math.hypot(...sub(v, centre))));
        (material.name === "Daylight" ? windowTris : out).push([...a, len / 2, ...e1, radius, ...e2, 0, ...n, 0, e.r, e.g, e.b, 0]);
      }
    }
  }
  const lights = Float32Array.from([...windowTris, ...out].flat());
  const bits = new Uint32Array(lights.buffer);
  const n = lights.length / 20;
  const power = Array.from({ length: n }, (_, i) => (0.2126 * lights[20 * i + 16] + 0.7152 * lights[20 * i + 17] + 0.0722 * lights[20 * i + 18]) * lights[20 * i + 3]);
  const total = power.reduce((s, x) => s + x, 0);
  const scaled = power.map((x) => (x * n) / total);
  const small = [], large = [];
  scaled.forEach((x, i) => (x < 1 ? small : large).push(i));
  for (let i = 0; i < n; i++) (lights[20 * i + 11] = 1), (bits[20 * i + 15] = i), (lights[20 * i + 19] = power[i] / total);
  while (small.length && large.length) {
    const s = small.pop(), l = large.pop();
    lights[20 * s + 11] = scaled[s];
    bits[20 * s + 15] = l;
    scaled[l] += scaled[s] - 1;
    (scaled[l] < 1 ? small : large).push(l);
  }
  return { lights, windows: windowTris.length };
}

// triangles of some meshes: their vertices concatenated (world space or each mesh's own), with
// normals (same space; 0 when `normals` is false: the skinned player shades with face normals) and
// UVs, the 3 corner indices, the G-buffer material id of each triangle and its texture LOD constant
// (ray cones: 0.5 log2 of texels per world area, from the world-space triangle)
function gather(meshes, gbuffer, world, normals = true) {
  const verts = [], norms = [], uvs = [], corners = [], mats = [], lods = [];
  let base = 0;
  for (const m of meshes) {
    const p = m.getVerticesData("position");
    const nrm = m.getVerticesData("normal");
    const uv = m.getVerticesData("uv") ?? new Float32Array((2 * p.length) / 3);
    const idx = m.getIndices();
    const w = m.computeWorldMatrix(true).m;
    const wp = [];
    for (let i = 0; i < p.length; i += 3) {
      wp.push(transform(w, p[i], p[i + 1], p[i + 2]));
      if (world) verts.push(...wp.at(-1));
      else verts.push(p[i], p[i + 1], p[i + 2]);
      // shortcut: the world matrix's own 3×3 for normals, exact for the office's uniform scales
      const n = !normals ? [0, 0, 0] : world ? transform(w, nrm[i], nrm[i + 1], nrm[i + 2]).map((x, k) => x - w[12 + k]) : [nrm[i], nrm[i + 1], nrm[i + 2]];
      const len = Math.hypot(...n) || 1;
      norms.push(...n.map((x) => x / len));
    }
    uvs.push(...uv);
    for (const sm of m.subMeshes) {
      const material = m.material instanceof MultiMaterial ? m.material.subMaterials[sm.materialIndex] : m.material;
      const id = gbuffer.materials.indexOf(material) + 1;
      for (let i = sm.indexStart; i < sm.indexStart + sm.indexCount; i += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => idx[i + k]);
        corners.push(base + a, base + b, base + c);
        mats.push(id);
        const e1 = wp[b].map((x, k) => x - wp[a][k]), e2 = wp[c].map((x, k) => x - wp[a][k]);
        const area = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
        const uvArea = Math.abs((uv[2 * b] - uv[2 * a]) * (uv[2 * c + 1] - uv[2 * a + 1]) - (uv[2 * c] - uv[2 * a]) * (uv[2 * b + 1] - uv[2 * a + 1]));
        lods.push(area > 0 && uvArea > 0 ? 0.5 * Math.log2((uvArea * SIZE * SIZE) / area) : 0);
      }
    }
    base += p.length / 3;
  }
  return {
    verts: Float32Array.from(verts), norms: Float32Array.from(norms), uvs: Float32Array.from(uvs),
    corners: Uint32Array.from(corners), mats: Uint32Array.from(mats), lods: Float32Array.from(lods),
  };
}

// the meshes' vertices skinned like the raster does (finalWorld = world × Σ w·bone), world space
function skinner(meshes) {
  const data = meshes.map((m) => {
    const d = {
      mesh: m,
      pos: m.getVerticesData("position"),
      idx: m.getVerticesData("matricesIndices"),
      w: m.getVerticesData("matricesWeights"),
    };
    if (d.idx.length !== (d.pos.length / 3) * 4) throw new Error(`${m.name}: expected 4 bone influences per vertex`);
    return d;
  });
  const M = new Float32Array(16);
  return (out) => {
    let o = 0;
    for (const { mesh, pos, idx, w } of data) {
      const bones = mesh.skeleton.getTransformMatrices(mesh);
      const world = mesh.computeWorldMatrix(true).m; // forced, as for the instances
      for (let v = 0; v < pos.length / 3; v++) {
        M.fill(0);
        for (let k = 0; k < 4; k++) {
          const weight = w[4 * v + k], b = 16 * idx[4 * v + k];
          if (weight) for (let j = 0; j < 16; j++) M[j] += weight * bones[b + j];
        }
        const px = pos[3 * v], py = pos[3 * v + 1], pz = pos[3 * v + 2]; // p × M × world, unrolled: no garbage
        const x = px * M[0] + py * M[4] + pz * M[8] + M[12];
        const y = px * M[1] + py * M[5] + pz * M[9] + M[13];
        const z = px * M[2] + py * M[6] + pz * M[10] + M[14];
        out[o++] = x * world[0] + y * world[4] + z * world[8] + world[12];
        out[o++] = x * world[1] + y * world[5] + z * world[9] + world[13];
        out[o++] = x * world[2] + y * world[6] + z * world[10] + world[14];
      }
    }
  };
}

// Babylon matrices act on row vectors: p' = p × m
function transform(m, x, y, z) {
  return [
    x * m[0] + y * m[4] + z * m[8] + m[12],
    x * m[1] + y * m[5] + z * m[9] + m[13],
    x * m[2] + y * m[6] + z * m[10] + m[14],
  ];
}

// triangle t's 9 floats from a BLAS's vertices
function corner(b, t, out, o) {
  for (let c = 0; c < 3; c++) {
    const v = b.corners[3 * t + c];
    out[o + 4 * c] = b.verts[3 * v];
    out[o + 4 * c + 1] = b.verts[3 * v + 1];
    out[o + 4 * c + 2] = b.verts[3 * v + 2];
  }
}

function soup(b) {
  const out = new Float32Array(9 * b.mats.length);
  const tmp = new Float32Array(12);
  for (let t = 0; t < b.mats.length; t++) {
    corner(b, t, tmp, 0);
    out.set([tmp[0], tmp[1], tmp[2], tmp[4], tmp[5], tmp[6], tmp[8], tmp[9], tmp[10]], 9 * t);
  }
  return out;
}

// a BLAS's triangles into the shared array, in its BVH order (3 vec4f each)
function writeTris(b, tris) {
  if (!b.slots) { // corner vertex indices in BVH order, once
    b.slots = new Uint32Array(b.corners.length);
    b.order.forEach((t, s) => b.slots.set(b.corners.subarray(3 * t, 3 * t + 3), 3 * s));
  }
  const { slots, verts } = b;
  for (let i = 0, o = 12 * b.triBase; i < slots.length; i++, o += 4) {
    const v = 3 * slots[i];
    tris[o] = verts[v];
    tris[o + 1] = verts[v + 1];
    tris[o + 2] = verts[v + 2];
  }
}

// a BLAS's shading attributes into the shared array, BVH order, 4 vec4f per triangle: (normal,
// u) of each corner, then (v of each corner, LOD constant)
function writeAttribs(b, attribs) {
  b.order.forEach((t, s) => {
    const o = 16 * (b.triBase + s);
    for (let c = 0; c < 3; c++) {
      const v = b.corners[3 * t + c];
      attribs.set(b.norms.subarray(3 * v, 3 * v + 3), o + 4 * c);
      attribs[o + 4 * c + 3] = b.uvs[2 * v];
      attribs[o + 12 + c] = b.uvs[2 * v + 1];
    }
    attribs[o + 15] = b.lods[t];
  });
}

// a BLAS's nodes into the shared array, child and triangle links made global
function writeNodes(b, nodes) {
  const src = new Uint32Array(b.nodes.buffer, b.nodes.byteOffset, b.nodes.length);
  const dst = new Uint32Array(nodes.buffer);
  nodes.set(b.nodes, 8 * b.nodeBase);
  for (let i = 0; i < b.nodes.length / 8; i++) {
    dst[8 * (b.nodeBase + i) + 3] = src[8 * i + 3] + (src[8 * i + 7] ? b.triBase : b.nodeBase);
  }
}

// boxes of n packed triangles (3 vec4f each) from triangle `from`
function packedBoxes(tris, from, n, out) {
  for (let s = 0; s < n; s++) {
    const o = 12 * (from + s);
    for (let k = 0; k < 3; k++) {
      out[6 * s + k] = Math.min(tris[o + k], tris[o + 4 + k], tris[o + 8 + k]);
      out[6 * s + 3 + k] = Math.max(tris[o + k], tris[o + 4 + k], tris[o + 8 + k]);
    }
  }
  return out;
}

function upload(buffer, array, from, to) {
  buffer.update(array.subarray(from, to), 4 * from, 4 * (to - from));
}

function depth(nodes) {
  const u = new Uint32Array(nodes.buffer, nodes.byteOffset, nodes.length);
  const d = new Uint32Array(nodes.length / 8).fill(1);
  let max = 1;
  for (let i = 0; i < d.length; i++) {
    if (u[8 * i + 7]) continue;
    d[u[8 * i + 3]] = d[u[8 * i + 3] + 1] = d[i] + 1;
    max = Math.max(max, d[i] + 1);
  }
  return max;
}

// world box of a BLAS root box under `world`, as entry i of `boxes`
function worldBox(nodes, world, boxes, i) {
  boxes.fill(Infinity, 6 * i, 6 * i + 3).fill(-Infinity, 6 * i + 3, 6 * i + 6);
  for (let c = 0; c < 8; c++) {
    const p = transform(world, nodes[c & 1 ? 4 : 0], nodes[c & 2 ? 5 : 1], nodes[c & 4 ? 6 : 2]);
    for (let k = 0; k < 3; k++) {
      boxes[6 * i + k] = Math.min(boxes[6 * i + k], p[k]);
      boxes[6 * i + 3 + k] = Math.max(boxes[6 * i + 3 + k], p[k]);
    }
  }
}
