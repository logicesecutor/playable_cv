// MPM 4/5: per node, momentum → velocity, gravity, then the colliders: the desk top (slip, it may
// only push up), the other static geometry (the mask: sticky), the mug, the player and the props
// (slip against their moving surfaces, inflated by half a cell so a wall thinner than a cell still
// stops the flow), the box's top. Stores (velocity, mass) as floats in place (mpm.wgsl is prepended).

@group(0) @binding(2) var<storage, read_write> grid : array<vec4i>;
@group(0) @binding(4) var<storage, read> mask : array<u32>; // 1: inside static geometry

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id : vec3u) {
  if (id.x >= arrayLength(&grid)) { return; }
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

  let onDesk = all(x.xz >= params.desk.xy) && all(x.xz <= params.desk.zw);
  if (onDesk && x.y <= params.fluid.z) {
    v.y = max(v.y, 0.0);
  } else if (mask[id.x] != 0u) {
    v = vec3f(0.0); // shortcut: sticky walls for the clutter (no normal in the mask), slip if it looks wrong
  }
  let dx = params.origin.w;
  let p = toWorld(x);
  for (var i = 0u; i < u32(params.fluid.y); i++) {
    let l = local(i, p);
    if (bodySdf(i, l) < 0.5 * dx) {
      // in cells/s: the body's own velocity is in u/s
      v = slip(v, bodyVelocity(i, p) / dx, bodyNormal(i, l));
    }
  }
  if (n.y >= s.y - 3u) { v.y = min(v.y, 0.0); }
  grid[id.x] = bitcast<vec4i>(vec4f(v, m));
}
