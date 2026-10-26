// MPM, once per grid size: which nodes lie inside the office's static geometry (desk clutter:
// keyboard, monitor, tray, pot). Three rays from the node through the office's BVH (root 0, world
// space), inside when at least two first hit a surface from behind (vertex normals facing along the
// ray). trace.wgsl and mpm.wgsl are prepended.

@group(0) @binding(4) var<storage, read_write> mask : array<u32>;
@group(1) @binding(6) var<storage, read> attribs : array<vec4f>; // scene.js: vertex normals per triangle

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id : vec3u) {
  if (id.x >= arrayLength(&mask)) { return; }
  let s = vec3u(params.size.xyz);
  let p = toWorld(vec3f(f32(id.x % s.x), f32((id.x / s.x) % s.y), f32(id.x / (s.x * s.y))));
  var dirs = array<vec3f, 3>(vec3f(0.3, 1.0, 0.2), vec3f(1.0, -0.2, 0.4), vec3f(-0.5, 0.1, -1.0)); // off the axes: no grazing
  var inside = 0u;
  for (var i = 0; i < 3; i++) {
    let d = normalize(dirs[i]);
    var hit : Hit;
    hit.t = MISS;
    hit.steps = 0u;
    traceBlas(0u, p, d, 0u, false, &hit);
    if (hit.t < MISS) {
      let t = 4u * hit.tri;
      if (dot(attribs[t].xyz + attribs[t + 1u].xyz + attribs[t + 2u].xyz, d) > 0.0) { inside++; }
    }
  }
  mask[id.x] = select(0u, 1u, inside >= 2u);
}
