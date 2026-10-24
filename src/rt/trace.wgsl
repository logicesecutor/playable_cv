// Ray traversal over the scene of src/rt/scene.js: a top-level BVH (tlas) over instances, each with
// its own bottom-level BVH in `nodes` and triangles in `tris` (3 vec4f each, BVH order). Node layout
// as in bvh.js. Rays are not normalised in object space, so t is the same at both levels.

struct Node {
  lo : vec3f,
  first : u32,
  hi : vec3f,
  count : u32,
}

struct Instance {
  toObject : mat4x4f, // world → object
  root : u32,         // its BLAS root in `nodes`
  id : u32,
  pad0 : u32,
  pad1 : u32,
}

struct Hit {
  t : f32,      // 1e30: missed
  tri : u32,    // index in `tris` / 3
  inst : u32,
  uv : vec2f,   // barycentrics of vertices 1 and 2
  steps : u32,  // nodes visited, for the heat map
}

@group(1) @binding(0) var<storage, read> nodes : array<Node>;
@group(1) @binding(1) var<storage, read> tris : array<vec4f>;
@group(1) @binding(2) var<storage, read> triMaterial : array<u32>;
@group(1) @binding(3) var<storage, read> instances : array<Instance>;
@group(1) @binding(4) var<storage, read> tlas : array<Node>;

const MISS = 1e30;

fn safeInverse(d : vec3f) -> vec3f { // 1/0 is not defined in WGSL
  let s = select(vec3f(1.0), sign(d), d != vec3f(0.0));
  return 1.0 / select(d, s * 1e-12, abs(d) < vec3f(1e-12));
}

// distance to the box along the ray, MISS when it misses or starts beyond tmax
fn boxEntry(lo : vec3f, hi : vec3f, o : vec3f, inv : vec3f, tmax : f32) -> f32 {
  let t0 = (lo - o) * inv;
  let t1 = (hi - o) * inv;
  let tn = max(max(max(min(t0.x, t1.x), min(t0.y, t1.y)), min(t0.z, t1.z)), 0.0);
  let tf = min(min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z)), tmax);
  return select(MISS, tn, tn <= tf);
}

// Möller–Trumbore: (t, u, v), t = MISS when it misses
fn triangleHit(o : vec3f, d : vec3f, i : u32) -> vec3f {
  let a = tris[3u * i].xyz;
  let e1 = tris[3u * i + 1u].xyz - a;
  let e2 = tris[3u * i + 2u].xyz - a;
  let p = cross(d, e2);
  let det = dot(e1, p);
  if (det == 0.0) { return vec3f(MISS); }
  let inv = 1.0 / det;
  let s = o - a;
  let u = dot(s, p) * inv;
  if (u < 0.0 || u > 1.0) { return vec3f(MISS); }
  let q = cross(s, e1);
  let v = dot(d, q) * inv;
  if (v < 0.0 || u + v > 1.0) { return vec3f(MISS); }
  let t = dot(e2, q) * inv;
  return select(vec3f(MISS), vec3f(t, u, v), t > 0.0);
}

// one BLAS; updates `hit` when nearer. anyHit: stop at the first hit (shadow rays)
fn traceBlas(root : u32, o : vec3f, d : vec3f, inst : u32, anyHit : bool, hit : ptr<function, Hit>) {
  let inv = safeInverse(d);
  if (boxEntry(nodes[root].lo, nodes[root].hi, o, inv, (*hit).t) == MISS) { return; }
  var stack : array<u32, 64>;
  var sp = 0u;
  var node = root;
  loop {
    let n = nodes[node];
    (*hit).steps += 1u;
    var pop = true;
    if (n.count > 0u) {
      for (var i = n.first; i < n.first + n.count; i++) {
        let h = triangleHit(o, d, i);
        if (h.x < (*hit).t) {
          (*hit).t = h.x;
          (*hit).uv = h.yz;
          (*hit).tri = i;
          (*hit).inst = inst;
          if (anyHit) { return; }
        }
      }
    } else {
      var near = n.first;
      var far = n.first + 1u;
      var tn = boxEntry(nodes[near].lo, nodes[near].hi, o, inv, (*hit).t);
      var tf = boxEntry(nodes[far].lo, nodes[far].hi, o, inv, (*hit).t);
      if (tf < tn) {
        let s = near; near = far; far = s;
        let t = tn; tn = tf; tf = t;
      }
      if (tn != MISS) {
        if (tf != MISS && sp < 64u) { stack[sp] = far; sp += 1u; }
        node = near;
        pop = false;
      }
    }
    if (pop) {
      if (sp == 0u) { break; }
      sp -= 1u;
      node = stack[sp];
    }
  }
}

// nearest hit (or any hit) along o + t d, t < tmax, over every instance
fn trace(o : vec3f, d : vec3f, tmax : f32, anyHit : bool) -> Hit {
  var hit : Hit;
  hit.t = tmax;
  hit.steps = 0u;
  let inv = safeInverse(d);
  var stack : array<u32, 32>;
  var sp = 0u;
  var node = 0u;
  if (boxEntry(tlas[0].lo, tlas[0].hi, o, inv, tmax) == MISS) { hit.t = MISS; return hit; }
  loop {
    let n = tlas[node];
    var pop = true;
    if (n.count > 0u) {
      for (var k = n.first; k < n.first + n.count; k++) {
        let m = instances[k].toObject;
        traceBlas(instances[k].root, (m * vec4f(o, 1.0)).xyz, (m * vec4f(d, 0.0)).xyz, k, anyHit, &hit);
        if (anyHit && hit.t < tmax) { return hit; }
      }
    } else {
      var near = n.first;
      var far = n.first + 1u;
      var tn = boxEntry(tlas[near].lo, tlas[near].hi, o, inv, hit.t);
      var tf = boxEntry(tlas[far].lo, tlas[far].hi, o, inv, hit.t);
      if (tf < tn) {
        let s = near; near = far; far = s;
        let t = tn; tn = tf; tf = t;
      }
      if (tn != MISS) {
        if (tf != MISS && sp < 32u) { stack[sp] = far; sp += 1u; }
        node = near;
        pop = false;
      }
    }
    if (pop) {
      if (sp == 0u) { break; }
      sp -= 1u;
      node = stack[sp];
    }
  }
  if (hit.t >= tmax) { hit.t = MISS; }
  return hit;
}
