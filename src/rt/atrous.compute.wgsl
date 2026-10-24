// Denoiser 2/3, one à-trous pass (SVGF; denoise.wgsl is prepended): a 5×5 B-spline blur with holes
// `step` pixels apart (1, 2, 4, 8, 16 over the 5 passes), diffuse and specular apart. A neighbour
// weighs less when its normal differs, when its distance is off what this pixel's distance gradient
// predicts, and when its luminance differs by more than the variance predicts (blurred 3×3 first).
// The variance is carried through (squared weights). Normal and distance come packed in one texture
// (`geometry`, from the temporal pass): one read per tap. A pixel with a long history needs less
// blur: a step runs only while step ≤ 16 / √(history length) (a fresh pixel gets all 5 passes, one
// with 32 frames steps 1 and 2), or the wide steps wash out small shadows like the figure's contact
// shadow.

@group(0) @binding(1) var diffuseIn : texture_2d<f32>;
@group(0) @binding(2) var specularIn : texture_2d<f32>;
@group(0) @binding(3) var geometry : texture_2d<f32>; // layout in denoise.wgsl
@group(0) @binding(4) var diffuseOut : texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var specularOut : texture_storage_2d<rgba16float, write>;

const KERNEL = array<f32, 3>(0.375, 0.25, 0.0625);

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id : vec3u) {
  let pixel = vec2i(id.xy);
  if (!inside(pixel)) { return; }
  let g = textureLoad(geometry, pixel, 0);
  let t = g.y;
  let d = textureLoad(diffuseIn, pixel, 0);
  let s = textureLoad(specularIn, pixel, 0);
  let step = i32(params.atrous.x);
  if (t <= 0.0 || f32(step * step) * g.z > 256.0) {
    textureStore(diffuseOut, pixel, d);
    textureStore(specularOut, pixel, s);
    return;
  }
  let n = unpackNormal(g.x);
  // the distance's slope per pixel, from the nearer-matching side (none across an edge)
  let tx0 = textureLoad(geometry, clamp(pixel - vec2i(1, 0), vec2i(0), vec2i(params.size.xy) - 1), 0).y;
  let tx1 = textureLoad(geometry, clamp(pixel + vec2i(1, 0), vec2i(0), vec2i(params.size.xy) - 1), 0).y;
  let ty0 = textureLoad(geometry, clamp(pixel - vec2i(0, 1), vec2i(0), vec2i(params.size.xy) - 1), 0).y;
  let ty1 = textureLoad(geometry, clamp(pixel + vec2i(0, 1), vec2i(0), vec2i(params.size.xy) - 1), 0).y;
  let gx = select(tx1 - t, t - tx0, abs(t - tx0) < abs(tx1 - t));
  let gy = select(ty1 - t, t - ty0, abs(t - ty0) < abs(ty1 - t));

  var vd = 0.0;
  var vs = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let q = clamp(pixel + vec2i(x, y), vec2i(0), vec2i(params.size.xy) - 1);
      let w = (2.0 - f32(abs(x))) * (2.0 - f32(abs(y))) / 16.0;
      vd += w * textureLoad(diffuseIn, q, 0).a;
      vs += w * textureLoad(specularIn, q, 0).a;
    }
  }
  let ld = lum(d.rgb);
  let ls = lum(s.rgb);
  let sd = 4.0 * sqrt(vd) + 1e-6;
  let ss = 4.0 * sqrt(vs) + 1e-6;

  var sumD = vec4f(0.0); // rgb, variance
  var sumS = vec4f(0.0);
  var wd = 0.0;
  var ws = 0.0;
  for (var y = -2; y <= 2; y++) {
    for (var x = -2; x <= 2; x++) {
      let q = pixel + vec2i(x, y) * step;
      if (!inside(q)) { continue; }
      let gq = textureLoad(geometry, q, 0);
      if (gq.y <= 0.0) { continue; }
      let off = vec2f(f32(x * step), f32(y * step));
      let slope = dot(vec2f(gx, gy), off);
      let depth = abs(gq.y - t - slope) / (abs(slope) + 2e-3 * t);
      let w = KERNEL[abs(x)] * KERNEL[abs(y)] * pow(max(dot(n, unpackNormal(gq.x)), 0.0), 128.0) * exp(-depth);
      let dq = textureLoad(diffuseIn, q, 0);
      let sq = textureLoad(specularIn, q, 0);
      let a = w * exp(-abs(lum(dq.rgb) - ld) / sd);
      let b = w * exp(-abs(lum(sq.rgb) - ls) / ss);
      sumD += vec4f(a * dq.rgb, a * a * dq.a);
      sumS += vec4f(b * sq.rgb, b * b * sq.a);
      wd += a;
      ws += b;
    }
  }
  // the centre always counts (weight 0.14 at least), so wd, ws > 0
  textureStore(diffuseOut, pixel, vec4f(sumD.rgb / wd, sumD.a / (wd * wd)));
  textureStore(specularOut, pixel, vec4f(sumS.rgb / ws, sumS.a / (ws * ws)));
}
