// MPM 4/5: per node, momentum → velocity, gravity, then the colliders: the mug, the player and the
// props (slip against their moving surfaces, inflated by half a cell so a wall thinner than a cell
// still stops the flow), the desk top (slip, it may only push up), the other static geometry (the
// mask: sticky), the box's top. Stores (velocity, mass) as floats in place (mpm.wgsl and forces.wgsl are prepended).
// The momentum a body takes from the coffee goes to it as an impulse and an angular impulse about
// its centre of mass (M11: Havok applies them a frame later).

@group(0) @binding(2) var<storage, read_write> grid : array<vec4i>;
@group(0) @binding(4) var<storage, read> mask : array<u32>; // 1: inside static geometry

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id : vec3u) {
  if (id.x >= arrayLength(&grid)) { return; }
  setBack();
  let g = grid[id.x];
  let m = unfix(g.w);
  if (m <= 0.0) {
    grid[id.x] = vec4i(0);
    return;
  }
  let s = vec3u(params.size.xyz);
  let n = vec3u(id.x % s.x, (id.x / s.x) % s.y, id.x / (s.x * s.y));
  let x = vec3f(n);
  var v = vec3f(unfix(g.x), unfix(g.y), unfix(g.z)) / m;
  v.y -= params.step.x * params.step.y;

  let dx = params.origin.w;
  let p = toWorld(x);
  var owner = -1; // the body this node is in, if any
  for (var i = 0u; i < u32(params.fluid.y); i++) {
    let l = local(i, p);
    if (bodySdf(i, l) < 0.5 * dx) {
      // in cells/s: the body's own velocity is in u/s
      let free = v;
      v = slip(v, bodyVelocity(i, p) / dx, bodyNormal(i, l));
      push(i, p, (free - v) * (m * dx));
      owner = i32(i);
    }
  }
  // the desk and the clutter: what they stop inside a body, the body stops (a node under the mug's
  // floor has the floor's normal pointing down, and the desk would carry the coffee's weight)
  let held = v;
  let onDesk = all(x.xz >= params.desk.xy) && all(x.xz <= params.desk.zw);
  if (onDesk && x.y <= params.fluid.z) {
    v.y = max(v.y, 0.0);
  } else if (mask[id.x] != 0u) {
    v = vec3f(0.0); // shortcut: sticky walls for the clutter (no normal in the mask), slip if it looks wrong
  }
  if (owner >= 0) { push(u32(owner), p, (held - v) * (m * dx)); }
  if (params.walls.x != 0.0) { // ?pool: the coffee stays in the box
    if (n.x < 2u) { v.x = max(v.x, 0.0); }
    if (n.x > s.x - 3u) { v.x = min(v.x, 0.0); }
    if (n.z < 2u) { v.z = max(v.z, 0.0); }
    if (n.z > s.z - 3u) { v.z = min(v.z, 0.0); }
    if (n.y < 2u) { v.y = max(v.y, 0.0); }
  }
  if (n.y >= s.y - 3u) { v.y = min(v.y, 0.0); }
  grid[id.x] = bitcast<vec4i>(vec4f(v, m));
}
