// MPM 1/5: an empty grid, and one more substep on the clock (mpm.wgsl is prepended).

@group(0) @binding(2) var<storage, read_write> grid : array<vec4i>;
@group(0) @binding(11) var<storage, read_write> clock : array<atomic<u32>>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id : vec3u) {
  if (id.x < arrayLength(&grid)) { grid[id.x] = vec4i(0); }
  if (id.x == 0u) { atomicAdd(&clock[0], 1u); }
}
