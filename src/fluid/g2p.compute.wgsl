// MPM 5/5: each particle's velocity and C from its nodes, then it moves. Thin walls are enforced on
// the particle too (the grid alone leaks through the mug's 0.36 u wall at 0.4–0.8 u cells): a
// particle in the cup's hollow stays inside the wall and above the bottom until it goes over the
// rim, one outside stays out of the cup, and none sinks into the desk top or the player. Particles
// that leave the box through its sides or bottom are removed and counted (mpm.wgsl is prepended).

@group(0) @binding(2) var<storage, read> grid : array<vec4f>; // velocity (cells/s), mass
@group(0) @binding(3) var<storage, read_write> particles : array<Particle>;
@group(0) @binding(5) var<storage, read_write> removed : array<atomic<u32>>;

const GAP = 0.02; // u, how far off a wall a pushed-back particle sits

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id : vec3u) {
  if (id.x >= u32(params.size.w)) { return; }
  var p = particles[id.x];
  if (p.alive == 0.0) { return; }
  let k = kernel(p.x);
  var v = vec3f(0.0);
  var B = mat3x3f(vec3f(0.0), vec3f(0.0), vec3f(0.0));
  for (var i = 0; i < 27; i++) {
    let o = vec3i(i % 3, (i / 3) % 3, i / 9);
    let n = k.base + o;
    let gv = grid[nodeIndex(n)].xyz * weight(k, o);
    let d = vec3f(n) - p.x;
    v += gv;
    B += mat3x3f(gv * d.x, gv * d.y, gv * d.z);
  }
  let dx = params.origin.w;
  let before = toWorld(p.x);
  var x = before + v * dx * params.step.x; // world
  v *= dx; // u/s while the walls are enforced

  // the mug, in its frame (no scale: distances are world units)
  let m = bodies[0].toLocal;
  let toW = transpose(mat3x3f(m[0].xyz, m[1].xyz, m[2].xyz));
  let cup = bodies[0].shape;
  let inner = cup.x - cup.z;
  let l0 = local(0u, before);
  let l = local(0u, x);
  if (length(l0.xz) < inner && l0.y < cup.y && l0.y > cup.w - 0.5) {
    if (l.y < cup.y) { // still below the rim: inside the wall, above the bottom
      let r = length(l.xz);
      let k = select(1.0, (inner - GAP) / r, r > inner - GAP);
      let c = vec3f(l.x * k, max(l.y, cup.w + GAP), l.z * k);
      let moved = toW * (c - l);
      if (any(moved != vec3f(0.0))) {
        x += moved;
        v = slip(v, bodyVelocity(0u, x), normalize(moved));
      }
    }
  } else {
    let d = cupSdf(l, cup);
    if (d < GAP) {
      let n = bodyNormal(0u, l);
      x += n * (GAP - d);
      v = slip(v, bodyVelocity(0u, x), n);
    }
  }

  // the player's capsule
  let pl = local(1u, x);
  let pd = bodySdf(1u, pl);
  if (pd < GAP) {
    let n = bodyNormal(1u, pl);
    x += n * (GAP - pd);
    v = slip(v, bodyVelocity(1u, x), n);
  }

  // the desk top
  var g = (x - params.origin.xyz) / dx;
  let wasAbove = (before.y - params.origin.y) / dx >= params.fluid.z - 0.25;
  if (wasAbove && all(g.xz >= params.desk.xy) && all(g.xz <= params.desk.zw) && g.y < params.fluid.z + GAP / dx) {
    g.y = params.fluid.z + GAP / dx;
    v.y = max(v.y, 0.0);
  }

  let s = params.size.xyz;
  if (any(g.xz < vec2f(2.0)) || any(g.xz > s.xz - 3.0) || g.y < 2.0) {
    p.alive = 0.0;
    atomicAdd(&removed[0], 1u);
  }
  p.x = vec3f(g.x, min(g.y, s.y - 3.0), g.z);
  p.v = v / dx;
  p.C = B * 4.0;
  particles[id.x] = p;
}
