// Shows the G-buffer on screen until the ray tracer does (M6). mode 0: albedo × a fake sun and sky
// from the normal + emission; 1 albedo, 2 normal, 3 roughness (R) metal (G), 4 emission,
// 5 material id, 6 distance (log), 7 motion (pixels × 0.1: red +x, green −x, blue |y|);
// 8 BVH vs raster (green: same distance and material, red: different, blue: only one of them hit);
// 9 BVH heat map (nodes visited per camera ray, blue 0 → red 200+).

var albedoTex : texture_2d<f32>;
var normalTex : texture_2d<f32>;
var emissionTex : texture_2d<f32>;
var depthTex : texture_2d<f32>;
var motionTex : texture_2d<f32>;
var traceTex : texture_2d<f32>;
uniform mode : f32;
uniform size : vec2f;

fn encode(c : vec3f) -> vec3f { // linear → sRGB, the canvas is not an sRGB target
  let x = clamp(c, vec3f(0.0), vec3f(1.0));
  return select(1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, x * 12.92, x <= vec3f(0.0031308));
}

@fragment
fn main(input : FragmentInputs) -> FragmentOutputs {
  let p = vec2i(fragmentInputs.position.xy);
  let a = textureLoad(albedoTex, p, 0);
  let n = textureLoad(normalTex, p, 0);
  let e = textureLoad(emissionTex, p, 0);
  let t = textureLoad(depthTex, p, 0).r;
  let m = textureLoad(motionTex, p, 0).xy;
  let albedo = a.rgb * a.rgb;
  let mode = i32(uniforms.mode);
  var c = vec3f(0.07, 0.07, 0.08); // nothing hit
  if (mode == 7) {
    let px = m * uniforms.size * 0.1;
    c = vec3f(max(px.x, 0.0), max(-px.x, 0.0), abs(px.y));
  } else if (mode == 8) {
    let r = textureLoad(traceTex, p, 0);
    let shade = 0.4 + 0.6 * max(n.y * 0.5 + 0.5, 0.0);
    if ((t > 0.0) != (r.x > 0.0)) {
      c = vec3f(0.1, 0.3, 1.0);
    } else if (t > 0.0) {
      let same = abs(r.x - t) <= 1e-3 * t && r.z == e.w;
      c = select(vec3f(1.0, 0.1, 0.1), vec3f(0.2, 0.9, 0.3), same) * shade;
    }
  } else if (mode == 9) {
    let h = clamp(textureLoad(traceTex, p, 0).y / 200.0, 0.0, 1.0);
    c = clamp(vec3f(2.0 * h - 0.5, 1.5 - abs(4.0 * h - 2.0), 1.5 - 2.0 * h), vec3f(0.0), vec3f(1.0));
  } else if (t > 0.0) {
    switch mode {
      case 1: { c = albedo; }
      case 2: { c = n.xyz * 0.5 + 0.5; }
      case 3: { c = vec3f(n.w, a.w, 0.0); }
      case 4: { c = e.rgb; }
      case 5: { // a stable colour per id
        let h = fract(sin(vec3f(e.w) * vec3f(12.9898, 78.233, 37.719)) * 43758.5453);
        c = h * 0.8 + 0.2;
      }
      case 6: { c = vec3f(log2(1.0 + t) / log2(1.0 + 3000.0)); }
      default: {
        let sun = normalize(vec3f(0.4, 1.0, 0.3));
        let light = 0.35 * (0.6 + 0.4 * n.y) + 0.8 * max(dot(n.xyz, sun), 0.0);
        c = encode(albedo * light + e.rgb);
      }
    }
    if (mode == 1 || mode == 4) { c = encode(c); }
  }
  fragmentOutputs.color = vec4f(c, 1.0);
}
