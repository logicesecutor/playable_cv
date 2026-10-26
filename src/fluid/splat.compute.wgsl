// Debug view of the coffee (key P), 1/2: every live particle as a dot a particle spacing wide on
// screen, hidden behind the G-buffer's surfaces. Per pixel the nearest wins (atomicMin of distance
// in the high 16 bits, speed in the low). mpm.wgsl is prepended.

struct View {
  viewProjection : mat4x4f,
  eye : vec4f,
  size : vec4f, // width, height, pixel angle (rad)
}

@group(0) @binding(3) var<storage, read> particles : array<Particle>;
@group(0) @binding(6) var<uniform> view : View;
@group(0) @binding(7) var depthTex : texture_2d<f32>;
@group(0) @binding(8) var<storage, read_write> image : array<atomic<u32>>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id : vec3u) {
  if (id.x >= u32(params.size.w)) { return; }
  let p = particles[id.x];
  if (p.alive == 0.0) { return; }
  let w = toWorld(p.x);
  let clip = view.viewProjection * vec4f(w, 1.0);
  if (clip.w <= 0.0) { return; }
  let pixel = vec2i(floor((clip.xy / clip.w * 0.5 + 0.5) * view.size.xy)); // render-target NDC: y down the pixels
  let dist = distance(w, view.eye.xyz);
  let spacing = 0.5 * params.origin.w;
  let r = i32(clamp(0.5 * spacing / (dist * view.size.z), 1.0, 6.0));
  let speed = length(p.v) * params.origin.w;
  let key = (u32(clamp(dist / 1000.0, 0.0, 1.0) * 65535.0) << 16u) | u32(clamp(speed / 20.0, 0.0, 1.0) * 65535.0);
  let size = vec2i(view.size.xy);
  for (var y = -r; y <= r; y++) {
    for (var x = -r; x <= r; x++) {
      let q = pixel + vec2i(x, y);
      if (x * x + y * y > r * r || any(q < vec2i(0)) || any(q >= size)) { continue; }
      let t = textureLoad(depthTex, q, 0).r;
      if (t > 0.0 && dist > t + 0.1) { continue; } // 0.1 u: under the mug wall (0.36), over a grazing desk
      atomicMin(&image[u32(q.y * size.x + q.x)], key);
    }
  }
}
