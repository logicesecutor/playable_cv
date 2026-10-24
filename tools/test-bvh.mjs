// The BVH (src/rt/bvh.js) against brute force: random triangle soups, random rays, nearest hit.
// Also checks a refit after moving every triangle. Traversal mirrors src/rt/trace.wgsl.
//   node tools/test-bvh.mjs [triangles] [rays]
import { build, refit, triangleBoxes } from "../src/rt/bvh.js";

const [T = 5000, R = 100000] = process.argv.slice(2).map(Number);
let seed = 1;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

function soup(n) {
  // clusters of small triangles plus a few big ones, like an office: walls and desk clutter
  const tris = new Float32Array(9 * n);
  for (let t = 0; t < n; t++) {
    const big = t % 50 === 0, s = big ? 40 : 0.5 + rnd() * 2;
    const cx = (rnd() - 0.5) * 100, cy = (rnd() - 0.5) * 100, cz = (rnd() - 0.5) * 100;
    for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) tris[t * 9 + v * 3 + k] = [cx, cy, cz][k] + (rnd() - 0.5) * s;
  }
  return tris;
}

function hitTri(tris, t, o, d) { // Möller–Trumbore, as in trace.wgsl
  const a = t * 9;
  const e1 = [tris[a + 3] - tris[a], tris[a + 4] - tris[a + 1], tris[a + 5] - tris[a + 2]];
  const e2 = [tris[a + 6] - tris[a], tris[a + 7] - tris[a + 1], tris[a + 8] - tris[a + 2]];
  const p = cross(d, e2), det = dot(e1, p);
  if (det === 0) return Infinity;
  const inv = 1 / det, s = [o[0] - tris[a], o[1] - tris[a + 1], o[2] - tris[a + 2]];
  const u = dot(s, p) * inv;
  if (u < 0 || u > 1) return Infinity;
  const q = cross(s, e1), v = dot(d, q) * inv;
  if (v < 0 || u + v > 1) return Infinity;
  const h = dot(e2, q) * inv;
  return h > 0 ? h : Infinity;
}

function boxEntry(nodes, i, o, inv, tmax) {
  let tn = 0, tf = tmax;
  for (let k = 0; k < 3; k++) {
    const t0 = (nodes[i * 8 + k] - o[k]) * inv[k], t1 = (nodes[i * 8 + 4 + k] - o[k]) * inv[k];
    tn = Math.max(tn, Math.min(t0, t1));
    tf = Math.min(tf, Math.max(t0, t1));
  }
  return tn <= tf ? tn : Infinity;
}

function traverse({ nodes, order }, tris, o, d) {
  const u = new Uint32Array(nodes.buffer, nodes.byteOffset, nodes.length);
  const inv = d.map((x) => 1 / (Math.abs(x) < 1e-12 ? Math.sign(x || 1) * 1e-12 : x));
  let best = Infinity, node = 0;
  const stack = [];
  if (boxEntry(nodes, 0, o, inv, best) === Infinity) return best;
  for (;;) {
    const first = u[node * 8 + 3], n = u[node * 8 + 7];
    if (n) {
      for (let i = first; i < first + n; i++) best = Math.min(best, hitTri(tris, order[i], o, d));
    } else {
      let near = first, far = first + 1;
      let tn = boxEntry(nodes, near, o, inv, best), tf = boxEntry(nodes, far, o, inv, best);
      if (tf < tn) [near, far, tn, tf] = [far, near, tf, tn];
      if (tn < Infinity) {
        if (tf < Infinity) stack.push(far);
        node = near;
        continue;
      }
    }
    node = stack.pop();
    if (node === undefined) return best;
  }
}

function check(bvh, tris, rays, label) {
  let bad = 0, hits = 0;
  const t0 = performance.now();
  for (let r = 0; r < rays; r++) {
    const o = [(rnd() - 0.5) * 140, (rnd() - 0.5) * 140, (rnd() - 0.5) * 140];
    const d = norm([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]);
    if (r % 97 === 0) d[r % 3] = 0; // axis-parallel rays: exercise the 1/0 guard
    const a = traverse(bvh, tris, o, d);
    let b = Infinity;
    for (let t = 0; t < tris.length / 9; t++) b = Math.min(b, hitTri(tris, t, o, d));
    if (a !== b) bad++;
    if (b < Infinity) hits++;
  }
  console.log(`${label}: ${rays} rays, ${hits} hits, ${bad} mismatches (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  return bad;
}

const tris = soup(T);
let t0 = performance.now();
const bvh = build(triangleBoxes(tris));
console.log(`build: ${T} triangles → ${bvh.nodes.length / 8} nodes in ${(performance.now() - t0).toFixed(1)} ms`);
let bad = check(bvh, tris, R, "built");

// move every triangle a little (like a skinned body between frames), refit, check again
for (let i = 0; i < tris.length; i++) tris[i] += Math.sin(i * 0.37) * 1.5;
t0 = performance.now();
refit(bvh.nodes, triangleBoxes(tris), bvh.order);
console.log(`refit: ${(performance.now() - t0).toFixed(1)} ms`);
bad += check(bvh, tris, R / 10, "refitted");
if (bad) {
  console.error("FAIL");
  process.exit(1);
}
console.log("OK");

function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm(a) { const l = Math.hypot(...a); return a.map((x) => x / l); }
