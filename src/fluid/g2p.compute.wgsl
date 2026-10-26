// MPM 5/5: each particle's velocity and C from its nodes, then it moves. Thin walls are enforced on
// the particle too (the grid alone leaks through the mug's 0.36 u wall at 0.4–0.8 u cells): a
// particle in the cup stays inside the wall and above the floor until it goes over the rim, one
// outside stays out of the cup's wall and floor, and none sinks into the desk top or the player (the momentum
// those walls take goes to the mug and the player). Particles that leave the box through its sides or
// bottom are removed and counted (mpm.wgsl and forces.wgsl are prepended).

@group(0) @binding(2) var<storage, read> grid : array<vec4f>; // velocity (cells/s), mass
@group(0) @binding(3) var<storage, read_write> particles : array<Particle>;
@group(0) @binding(5) var<storage, read_write> removed : array<atomic<u32>>;

const GAP = 0.02; // u, how far off a wall a pushed-back particle sits

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id : vec3u) {
  if (id.x >= u32(params.size.w)) { return; }
  var p = particles[id.x];
  if (p.alive == 0.0) { return; }
  setBack();
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
  // which side of the mug a particle is on is kept in `alive` (2 in the cup, 1 outside): it only
  // changes over the rim, never through the wall or the floor
  if (p.alive == 1.0 && l0.y >= cup.y && l.y < cup.y && length(l.xz) < inner) { p.alive = 2.0; } // fell in
  if (p.alive == 2.0 && l.y >= cup.y) { p.alive = 1.0; } // went over the rim
  if (p.alive == 2.0) { // inside the wall, above the floor
    let r = length(l.xz);
    let k = select(1.0, (inner - GAP) / r, r > inner - GAP);
    let c = vec3f(l.x * k, max(l.y, cup.w + GAP), l.z * k);
    let moved = toW * (c - l);
    if (any(moved != vec3f(0.0))) {
      x += moved;
      let free = v;
      v = slip(v, bodyVelocity(0u, x), normalize(moved));
      push(0u, x, (free - v) * MASS);
    }
  } else if (cupSdf(l, cup) < GAP) { // out of the wall and the floor the way it came in
    let r = length(l.xz);
    var n : vec3f;
    if (l.y >= cup.y - GAP) { // the rim's top
      n = toW * vec3f(0.0, 1.0, 0.0);
      x += n * (cup.y + GAP - l.y);
    } else if (l0.y < cup.w && length(l0.xz) < cup.x) { // under the floor
      n = toW * vec3f(0.0, -1.0, 0.0);
      x += n * (l.y + GAP);
    } else if (r > 1e-4) { // beside the wall (past its middle the SDF would point into the cup)
      n = toW * vec3f(l.x / r, 0.0, l.z / r);
      x += n * (cup.x + GAP - r);
    }
    let free = v;
    v = slip(v, bodyVelocity(0u, x), n);
    push(0u, x, (free - v) * MASS);
  }

  // the player's capsule
  let pl = local(1u, x);
  let pd = bodySdf(1u, pl);
  if (pd < GAP) {
    let n = bodyNormal(1u, pl);
    x += n * (GAP - pd);
    let free = v;
    v = slip(v, bodyVelocity(1u, x), n);
    push(1u, x, (free - v) * MASS);
  }

  // the desk top
  var g = (x - params.origin.xyz) / dx;
  let wasAbove = (before.y - params.origin.y) / dx >= params.fluid.z - 0.25;
  if (wasAbove && all(g.xz >= params.desk.xy) && all(g.xz <= params.desk.zw) && g.y < params.fluid.z + GAP / dx) {
    g.y = params.fluid.z + GAP / dx;
    v.y = max(v.y, 0.0);
  }

  let s = params.size.xyz;
  if (params.walls.x != 0.0) {
    g = clamp(g, vec3f(2.0), s - 3.0);
  } else if (any(g.xz < vec2f(2.0)) || any(g.xz > s.xz - 3.0) || g.y < 2.0) {
    p.alive = 0.0;
    atomicAdd(&removed[0], 1u);
  }
  p.x = vec3f(g.x, min(g.y, s.y - 3.0), g.z);
  p.v = v / dx;
  p.C = B * 4.0;
  particles[id.x] = p;
}
