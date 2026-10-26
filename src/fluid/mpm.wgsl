// MLS-MPM coffee (M10), shared by the passes of src/fluid/mpm.js. Grid units: a cell is 1 long and
// the box's corner is 0, time in seconds. The fluid is the incremental MLS-MPM of nialltl ("MLS-MPM
// fluid") in 3D: P2G1 scatters mass and APIC momentum, P2G2 gathers each particle's density, turns
// it into a pressure (Tait-like, power 5) plus viscosity and scatters the force, the grid adds
// gravity and the colliders, G2P gathers velocity and the affine matrix C and moves the particle.
// The grid's sums are fixed-point (WebGPU has no float atomics).

struct Params {
  size : vec4f,   // nx, ny, nz, particle count
  origin : vec4f, // world position of grid node (0, 0, 0), cell size (u)
  step : vec4f,   // dt (s), gravity (cells/s², down), stiffness, dynamic viscosity
  fluid : vec4f,  // rest density, bodies, desk top (grid y), 0
  desk : vec4f,   // desk top rectangle in grid x, z: min x, min z, max x, max z
  walls : vec4f,  // x: 1 = the box's sides and bottom are walls (?pool), 0 = the coffee leaves through them, y: substeps this frame
}

struct Particle {
  x : vec3f,     // grid units
  alive : f32,   // 0: left the box, 1: outside the mug, 2: in it (g2p)
  v : vec3f,     // cells/s
  density : f32,
  C : mat3x3f,   // APIC affine velocity
}

// a rigid body: 0 the mug (a cup), 1 the player (a capsule), the rest boxes
struct Body {
  toLocal : mat4x4f, // world → body, no scale
  centre : vec4f,    // world centre of mass
  v : vec4f,         // linear velocity (u/s)
  w : vec4f,         // angular velocity (rad/s)
  shape : vec4f,     // cup: outer radius, height, wall, bottom. capsule: radius, half height. box: half sizes
}

const FIX = 1e4; // fixed point of the grid sums
const IMPULSE_FIX = 100.0; // fixed point of the impulses on the bodies (particle mass · u/s)
const MASS = 1.0; // per particle, so the rest density = particles per cell

fn fix(x : f32) -> i32 { return i32(round(clamp(x, -2e5, 2e5) * FIX)); }
fn unfix(x : i32) -> f32 { return f32(x) / FIX; }

fn nodeIndex(n : vec3i) -> u32 {
  let s = vec3i(params.size.xyz);
  return u32((n.z * s.y + n.y) * s.x + n.x);
}

// quadratic B-spline weights of the 3 nodes around x on each axis, from node `base`
struct Kernel {
  base : vec3i,
  w0 : vec3f,
  w1 : vec3f,
  w2 : vec3f,
}

fn kernel(x : vec3f) -> Kernel {
  let base = vec3i(floor(x - 0.5));
  let f = x - vec3f(base);
  return Kernel(base, 0.5 * (1.5 - f) * (1.5 - f), 0.75 - (f - 1.0) * (f - 1.0), 0.5 * (f - 0.5) * (f - 0.5));
}

fn weight(k : Kernel, o : vec3i) -> f32 {
  let wx = select(select(k.w2.x, k.w1.x, o.x == 1), k.w0.x, o.x == 0);
  let wy = select(select(k.w2.y, k.w1.y, o.y == 1), k.w0.y, o.y == 0);
  let wz = select(select(k.w2.z, k.w1.z, o.z == 1), k.w0.z, o.z == 0);
  return wx * wy * wz;
}

fn toWorld(x : vec3f) -> vec3f { return params.origin.xyz + x * params.origin.w; }

// signed distance (u) to a body's solid, in its own frame
fn cupSdf(p : vec3f, s : vec4f) -> f32 {
  let r = length(p.xz);
  let outer = max(r - s.x, max(-p.y, p.y - s.y));
  let hollow = max(r - (s.x - s.z), max(s.w - p.y, p.y - s.y - 1.0)); // open past the rim
  return max(outer, -hollow);
}

fn bodySdf(i : u32, p : vec3f) -> f32 {
  let s = bodies[i].shape;
  if (i == 0u) { return cupSdf(p, s); }
  if (i == 1u) { return length(vec3f(p.x, p.y - clamp(p.y, -s.y, s.y), p.z)) - s.x; }
  let q = abs(p) - s.xyz;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// The bodies are uploaded at their pose after this frame's physics, the substeps cover the frame
// before it: a substep `back` seconds before the frame's end sees each body moved back along its
// velocity (first order), not jumping a frame's motion at once (grid and G2P set it, forces.wgsl).
var<private> back = 0.0;

// world point → the body's frame at this substep
fn local(i : u32, p : vec3f) -> vec3f {
  let b = bodies[i];
  let u = p - b.centre.xyz + b.v.xyz * back;
  return (b.toLocal * vec4f(b.centre.xyz + u + cross(b.w.xyz * back, u), 1.0)).xyz;
}

// outward normal in world space, from central differences in the body's frame
fn bodyNormal(i : u32, l : vec3f) -> vec3f {
  let e = vec2f(0.02, 0.0);
  let n = vec3f(bodySdf(i, l + e.xyy) - bodySdf(i, l - e.xyy), bodySdf(i, l + e.yxy) - bodySdf(i, l - e.yxy),
    bodySdf(i, l + e.yyx) - bodySdf(i, l - e.yyx));
  let m = bodies[i].toLocal;
  return normalize(transpose(mat3x3f(m[0].xyz, m[1].xyz, m[2].xyz)) * n);
}

fn bodyVelocity(i : u32, p : vec3f) -> vec3f {
  return bodies[i].v.xyz + cross(bodies[i].w.xyz, p - bodies[i].centre.xyz + bodies[i].v.xyz * back);
}

// v against a surface moving at vb with outward normal n: no flow into it, free along it
fn slip(v : vec3f, vb : vec3f, n : vec3f) -> vec3f {
  let rel = v - vb;
  return vb + rel - min(dot(rel, n), 0.0) * n;
}

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage, read> bodies : array<Body>;
