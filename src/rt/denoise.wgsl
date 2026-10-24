// Shared by the denoiser's passes (denoise.js; camera.wgsl is prepended): their parameters, the
// history reprojection, normal packing, luminance. `geometry` (written by the temporal pass, read by
// all) packs per pixel: x the normal (packNormal), y the distance, z the history length (frames),
// w the fast history's diffuse and specular luminance (2 × f16).

struct Params {
  invViewProjection : mat4x4f,
  eye : vec4f,
  size : vec4f,   // width, height, pixel angle (radians per pixel), no history (1)
  jitter : vec4f, // the raster's sub-pixel offset this frame (pixels)
  atrous : vec4f, // step (pixels)
}

@group(0) @binding(0) var<uniform> params : Params;

fn lum(c : vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

fn inside(q : vec2i) -> bool {
  return all(q >= vec2i(0)) && all(q < vec2i(params.size.xy));
}

// where a pixel's surface point was last frame, in pixels (motion: G-buffer target 4, last uv − uv
// with v up, while pixels grow down)
fn motionPixels(motion : vec2f) -> vec2f {
  return motion * params.size.xy * vec2f(1.0, -1.0);
}

// unit normal ↔ 1 float (octahedral, 2 × 16-bit snorm)
fn packNormal(n : vec3f) -> f32 {
  let p = n.xy / (abs(n.x) + abs(n.y) + abs(n.z));
  let e = select(p, (1.0 - abs(p.yx)) * select(vec2f(-1.0), vec2f(1.0), p >= vec2f(0.0)), n.z < 0.0);
  return bitcast<f32>(pack2x16snorm(e));
}

fn unpackNormal(x : f32) -> vec3f {
  let e = unpack2x16snorm(bitcast<u32>(x));
  var n = vec3f(e, 1.0 - abs(e.x) - abs(e.y));
  let t = max(-n.z, 0.0);
  n.x += select(t, -t, n.x >= 0.0);
  n.y += select(t, -t, n.y >= 0.0);
  return normalize(n);
}
