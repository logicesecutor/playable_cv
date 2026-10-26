// MPM 1/5: an empty grid (mpm.wgsl is prepended).

@group(0) @binding(2) var<storage, read_write> grid : array<vec4i>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id : vec3u) {
  if (id.x < arrayLength(&grid)) { grid[id.x] = vec4i(0); }
}
