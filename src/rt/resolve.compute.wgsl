// Denoiser 3/3, resolve + TAA (denoise.wgsl is prepended): the filtered diffuse × albedo ×
// (1 − metal) + specular + emission, blended 1:9 into last frame's image reprojected by the motion
// vector of the nearest surface in the 3×3 around (sharp edges on moving objects). The history is
// first clamped to the colour range of that 3×3 (mean ± 1.25 σ, YCoCg) so stale colours cannot
// trail. All in a compressed space (c / (1 + luminance)) so one bright sample does not flicker.
// Output: linear radiance, for the view pass to expose and tone map.

@group(0) @binding(1) var diffuseTex : texture_2d<f32>;
@group(0) @binding(2) var specularTex : texture_2d<f32>;
@group(0) @binding(3) var albedoTex : texture_2d<f32>;
@group(0) @binding(4) var emissionTex : texture_2d<f32>;
@group(0) @binding(5) var depthTex : texture_2d<f32>;
@group(0) @binding(6) var motionTex : texture_2d<f32>;
@group(0) @binding(7) var history : texture_2d<f32>;
@group(0) @binding(8) var out : texture_storage_2d<rgba32float, write>; // f32: see denoise.js

const BLEND = 0.1;

fn shade(q : vec2i) -> vec3f {
  let a = textureLoad(albedoTex, q, 0);
  return textureLoad(diffuseTex, q, 0).rgb * a.rgb * a.rgb * (1.0 - a.w) + textureLoad(specularTex, q, 0).rgb
    + textureLoad(emissionTex, q, 0).rgb;
}

fn squash(c : vec3f) -> vec3f { // → YCoCg of c / (1 + luminance)
  let x = c / (1.0 + lum(c));
  return vec3f(0.25 * (x.r + 2.0 * x.g + x.b), 0.5 * (x.r - x.b), 0.25 * (-x.r + 2.0 * x.g - x.b));
}

fn unsquash(y : vec3f) -> vec3f {
  let x = max(vec3f(y.x + y.y - y.z, y.x + y.z, y.x - y.y - y.z), vec3f(0.0));
  return x / max(1.0 - lum(x), 1e-4);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id : vec3u) {
  let pixel = vec2i(id.xy);
  if (!inside(pixel)) { return; }
  let current = squash(shade(pixel));
  var m1 = vec3f(0.0);
  var m2 = vec3f(0.0);
  var nearest = 1e30;
  var motion = vec2f(0.0);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let q = clamp(pixel + vec2i(x, y), vec2i(0), vec2i(params.size.xy) - 1);
      let c = squash(shade(q));
      m1 += c;
      m2 += c * c;
      let t = textureLoad(depthTex, q, 0).r;
      if (t > 0.0 && t < nearest) {
        nearest = t;
        motion = textureLoad(motionTex, q, 0).xy;
      }
    }
  }

  var result = current;
  let pos = vec2f(pixel) + motionPixels(motion);
  let base = floor(pos);
  let f = pos - base;
  let q = vec2i(base);
  if (params.size.w == 0.0 && inside(q) && inside(q + 1)) {
    let h = mix(mix(textureLoad(history, q, 0).rgb, textureLoad(history, q + vec2i(1, 0), 0).rgb, f.x),
      mix(textureLoad(history, q + vec2i(0, 1), 0).rgb, textureLoad(history, q + 1, 0).rgb, f.x), f.y);
    let mean = m1 / 9.0;
    let sigma = sqrt(max(m2 / 9.0 - mean * mean, vec3f(0.0)));
    let clamped = clamp(squash(h), mean - 1.25 * sigma, mean + 1.25 * sigma);
    result = mix(clamped, current, BLEND);
  }
  textureStore(out, pixel, vec4f(unsquash(result), 1.0));
}
