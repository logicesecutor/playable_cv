// MPM 2/5: each particle's mass and APIC momentum m (v + C d) onto its 27 nodes (mpm.wgsl is prepended).

@group(0) @binding(2) var<storage, read_write> grid : array<atomic<i32>>; // momentum xyz, mass
@group(0) @binding(3) var<storage, read> particles : array<Particle>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id : vec3u) {
  if (id.x >= u32(params.size.w)) { return; }
  let p = particles[id.x];
  if (p.alive == 0.0) { return; }
  let k = kernel(p.x);
  for (var i = 0; i < 27; i++) {
    let o = vec3i(i % 3, (i / 3) % 3, i / 9);
    let n = k.base + o;
    let m = weight(k, o) * MASS;
    let momentum = m * (p.v + p.C * (vec3f(n) - p.x));
    let g = 4u * nodeIndex(n);
    atomicAdd(&grid[g], fix(momentum.x));
    atomicAdd(&grid[g + 1u], fix(momentum.y));
    atomicAdd(&grid[g + 2u], fix(momentum.z));
    atomicAdd(&grid[g + 3u], fix(m));
  }
}
