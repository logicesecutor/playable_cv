// MPM 3/5: each particle's density from the grid's mass (solid nodes count as fluid at rest, or a
// wall would read as a free surface and the fluid squeeze against it), its stress (pressure from a Tait-like
// equation of state, power 5, a little tension allowed, plus viscosity), and the force −V·4·σ·dt·w·d onto
// its nodes as momentum (mpm.wgsl is prepended).

@group(0) @binding(2) var<storage, read_write> grid : array<atomic<i32>>;
@group(0) @binding(3) var<storage, read_write> particles : array<Particle>;
@group(0) @binding(4) var<storage, read> mask : array<u32>;

// how much of node n's cell is solid: the static clutter, the desk slab, the mug
// shortcut: not the player or the props, add them if the coffee squeezes against them
fn solid(n : vec3i) -> f32 {
  if (mask[nodeIndex(n)] != 0u) { return 1.0; }
  let x = vec3f(n);
  var f = 0.0;
  if (all(x.xz >= params.desk.xy) && all(x.xz <= params.desk.zw)) { f = clamp(0.5 + params.fluid.z - x.y, 0.0, 1.0); }
  return max(f, clamp(0.5 - cupSdf(local(0u, toWorld(x)), bodies[0].shape) / params.origin.w, 0.0, 1.0));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id : vec3u) {
  if (id.x >= u32(params.size.w)) { return; }
  let p = particles[id.x];
  if (p.alive == 0.0) { return; }
  let k = kernel(p.x);
  var density = 0.0;
  for (var i = 0; i < 27; i++) {
    let o = vec3i(i % 3, (i / 3) % 3, i / 9);
    let n = k.base + o;
    density += weight(k, o) * (unfix(atomicLoad(&grid[4u * nodeIndex(n) + 3u])) + params.fluid.x * solid(n));
  }
  particles[id.x].density = density;
  let volume = MASS / max(density, 1e-3);
  let stiffness = params.step.z;
  let ratio = density / params.fluid.x;
  let pressure = max(stiffness * (ratio * ratio * ratio * ratio * ratio - 1.0), -0.1 * stiffness);
  let strain = p.C + transpose(p.C);
  let stress = mat3x3f(vec3f(-pressure, 0.0, 0.0), vec3f(0.0, -pressure, 0.0), vec3f(0.0, 0.0, -pressure)) + params.step.w * strain;
  let term = stress * (-volume * 4.0 * params.step.x);
  for (var i = 0; i < 27; i++) {
    let o = vec3i(i % 3, (i / 3) % 3, i / 9);
    let n = k.base + o;
    let momentum = term * (weight(k, o) * (vec3f(n) - p.x));
    let g = 4u * nodeIndex(n);
    atomicAdd(&grid[g], fix(momentum.x));
    atomicAdd(&grid[g + 1u], fix(momentum.y));
    atomicAdd(&grid[g + 2u], fix(momentum.z));
  }
}
