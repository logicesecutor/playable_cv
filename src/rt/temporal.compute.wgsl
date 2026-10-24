// Denoiser 1/3, temporal (SVGF, Schied et al. 2017; denoise.wgsl is prepended): this frame's noisy
// diffuse and specular blended into their history, reprojected by the motion vectors over the 4
// nearest last-frame pixels. A tap counts only when it saw the same surface: normals within ~25°
// and last frame's distance as the G-buffer predicts it (motion.z). The blend is 1 / history length,
// capped at 32 frames. Anti-lag (as in ReLAX): a fast history (blend ≥ 1/4, luminance only) is kept
// too, and the slow history's luminance is clamped to the fast one's range around it (3×3, mean ±
// 2σ, σ at least the fast mean's own noise: a 3×3 often misses the rare bright samples, and the
// clamp then darkened still images by 1 %) before the blend, so a moved shadow or light catches up
// in a few frames instead of 32.
// Luminance moments give each signal's variance for the à-trous passes; for the first 4 frames of a
// history it comes from the 7×7 neighbourhood instead. Writes this frame's geometry (denoise.wgsl)
// for the next frame.

@group(0) @binding(1) var diffuseIn : texture_2d<f32>;
@group(0) @binding(2) var specularIn : texture_2d<f32>;
@group(0) @binding(3) var normalTex : texture_2d<f32>;
@group(0) @binding(4) var depthTex : texture_2d<f32>;
@group(0) @binding(5) var motionTex : texture_2d<f32>;
@group(0) @binding(6) var prevDiffuse : texture_2d<f32>;
@group(0) @binding(7) var prevSpecular : texture_2d<f32>;
@group(0) @binding(8) var prevMoments : texture_2d<f32>;
@group(0) @binding(9) var prevGeometry : texture_2d<f32>;
@group(0) @binding(10) var diffuseOut : texture_storage_2d<rgba32float, write>; // the history: f32, see denoise.js
@group(0) @binding(11) var specularOut : texture_storage_2d<rgba32float, write>;
@group(0) @binding(12) var momentsOut : texture_storage_2d<rgba32float, write>;
@group(0) @binding(13) var geometryOut : texture_storage_2d<rgba32float, write>;

const MAX_HISTORY = 32.0;
const FAST = 0.25;
const CLAMP = 2.0;

// last frame's pixel saw this surface: normals within ~25°, distance as the G-buffer predicts it
fn sameSurface(g : vec4f, n : vec3f, expected : f32, tol : f32) -> bool {
  return g.y > 0.0 && dot(unpackNormal(g.x), n) >= 0.9 && abs(g.y - expected) <= tol;
}

// scale c so its luminance is within lo..hi (grey if it was black)
fn clampLuminance(c : vec3f, lo : f32, hi : f32) -> vec3f {
  let l = lum(c);
  let k = clamp(l, lo, hi);
  return select(c * (k / l), vec3f(k), l < 1e-6);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id : vec3u) {
  let pixel = vec2i(id.xy);
  if (!inside(pixel)) { return; }
  let t = textureLoad(depthTex, pixel, 0).r;
  if (t <= 0.0) {
    textureStore(diffuseOut, pixel, vec4f(0.0));
    textureStore(specularOut, pixel, vec4f(0.0));
    textureStore(momentsOut, pixel, vec4f(0.0));
    textureStore(geometryOut, pixel, vec4f(0.0));
    return;
  }
  let n = normalize(textureLoad(normalTex, pixel, 0).xyz);
  let m = textureLoad(motionTex, pixel, 0).xyz;
  let d = textureLoad(diffuseIn, pixel, 0).rgb;
  let s = textureLoad(specularIn, pixel, 0).rgb;
  let v = -cameraRay(params.invViewProjection, params.eye.xyz, vec2f(pixel), params.size.xy, params.jitter.xy);
  // how much the distance may differ on the same surface: a pixel's step at this viewing angle
  let tol = 0.01 * t + 2.0 * t * params.size.z / max(abs(dot(n, v)), 0.05);

  var hd = vec3f(0.0);
  var hs = vec3f(0.0);
  var hm = vec4f(0.0);
  var hf = vec2f(0.0); // fast history: diffuse, specular luminance
  var hl = 0.0;
  var wsum = 0.0;
  var f1 = vec2f(0.0); // the fast history around: sum, sum of squares, count
  var f2 = vec2f(0.0);
  var nf = 0.0;
  if (params.size.w == 0.0) {
    // no jitter in it: a still pixel keeps reading itself, and its history becomes its mean over the
    // jitter offsets (supersampled, like the reference). Shifting by the jitter resampled the history
    // every frame, and 32 frames of that blurred away the figure's contact shadow.
    let pos = vec2f(pixel) + motionPixels(m.xy);
    let base = floor(pos);
    let f = pos - base;
    for (var k = 0; k < 4; k++) {
      let o = vec2i(k & 1, k >> 1);
      let q = vec2i(base) + o;
      if (!inside(q)) { continue; }
      let g = textureLoad(prevGeometry, q, 0);
      if (!sameSurface(g, n, m.z, tol)) { continue; }
      let w = select(1.0 - f.x, f.x, o.x == 1) * select(1.0 - f.y, f.y, o.y == 1);
      hd += w * textureLoad(prevDiffuse, q, 0).rgb;
      hs += w * textureLoad(prevSpecular, q, 0).rgb;
      hm += w * textureLoad(prevMoments, q, 0);
      hf += w * unpack2x16float(bitcast<u32>(g.w));
      hl += w * g.z;
      wsum += w;
    }
    let centre = vec2i(floor(pos + 0.5));
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let q = centre + vec2i(x, y);
        if (!inside(q)) { continue; }
        let g = textureLoad(prevGeometry, q, 0);
        if (!sameSurface(g, n, m.z, tol * f32(abs(x) + abs(y) + 1))) { continue; }
        let l = unpack2x16float(bitcast<u32>(g.w));
        f1 += l;
        f2 += l * l;
        nf += 1.0;
      }
    }
  }

  var len = 1.0;
  var cd = d;
  var cs = s;
  var moments = vec4f(lum(d), lum(d) * lum(d), lum(s), lum(s) * lum(s));
  var fast = vec2f(lum(d), lum(s));
  if (wsum > 1e-3) {
    len = min(hl / wsum + 1.0, MAX_HISTORY);
    let a = 1.0 / len;
    var pd = hd / wsum;
    var ps = hs / wsum;
    if (nf > 0.0) {
      let mean = f1 / nf;
      // one sample's variance from the moments; the fast mean has FAST / (2 − FAST) of it
      let pm = hm / wsum;
      let noise = max(vec2f(pm.y - pm.x * pm.x, pm.w - pm.z * pm.z), vec2f(0.0)) * (FAST / (2.0 - FAST));
      let sigma = sqrt(max(max(f2 / nf - mean * mean, vec2f(0.0)), noise));
      pd = clampLuminance(pd, mean.x - CLAMP * sigma.x, mean.x + CLAMP * sigma.x);
      ps = clampLuminance(ps, mean.y - CLAMP * sigma.y, mean.y + CLAMP * sigma.y);
    }
    cd = mix(pd, d, a);
    cs = mix(ps, s, a);
    moments = mix(hm / wsum, moments, a);
    fast = mix(hf / wsum, fast, max(a, FAST));
  }
  var variance = max(vec2f(moments.y - moments.x * moments.x, moments.w - moments.z * moments.z), vec2f(0.0));
  if (len < 4.0) {
    // too few frames for the moments: those of the same surface around it, boosted while so young
    var sm = vec4f(0.0);
    var sw = 0.0;
    for (var y = -3; y <= 3; y++) {
      for (var x = -3; x <= 3; x++) {
        let q = pixel + vec2i(x, y);
        if (!inside(q)) { continue; }
        let tq = textureLoad(depthTex, q, 0).r;
        if (tq <= 0.0 || abs(tq - t) > tol * f32(abs(x) + abs(y) + 1)) { continue; }
        let w = pow(max(dot(n, textureLoad(normalTex, q, 0).xyz), 0.0), 128.0);
        let ld = lum(textureLoad(diffuseIn, q, 0).rgb);
        let ls = lum(textureLoad(specularIn, q, 0).rgb);
        sm += w * vec4f(ld, ld * ld, ls, ls * ls);
        sw += w;
      }
    }
    sm /= max(sw, 1e-6);
    variance = max(vec2f(sm.y - sm.x * sm.x, sm.w - sm.z * sm.z), vec2f(0.0)) * (4.0 / len);
  }

  textureStore(diffuseOut, pixel, vec4f(cd, variance.x));
  textureStore(specularOut, pixel, vec4f(cs, variance.y));
  textureStore(momentsOut, pixel, moments);
  textureStore(geometryOut, pixel, vec4f(packNormal(n), t, len, bitcast<f32>(pack2x16float(fast))));
}
