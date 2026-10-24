// The screen. mode 0: the traced radiance × exposure, tone mapped (toneMap 0 none, 1 AgX, 2 ACES);
// debug views of the G-buffer: 1 albedo, 2 normal, 3 roughness (R) metal (G), 4 emission,
// 5 material id, 6 distance (log), 7 motion (pixels × 0.1: red +x, green −x, blue |y|);
// 8 BVH vs raster (green: same distance and material, red: different, blue: only one of them hit);
// 9 BVH heat map (nodes visited per camera ray, blue 0 → red 200+).

var albedoTex : texture_2d<f32>;
var normalTex : texture_2d<f32>;
var emissionTex : texture_2d<f32>;
var depthTex : texture_2d<f32>;
var motionTex : texture_2d<f32>;
var traceTex : texture_2d<f32>;
var radianceTex : texture_2d<f32>;
uniform mode : f32;
uniform size : vec2f;
uniform exposure : f32;
uniform toneMap : f32;

// AgX, Blender's default view (the minimal fit by B. Wrensch of T. Sobotka's AgX), → linear
fn agx(c : vec3f) -> vec3f {
  let inset = mat3x3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
    0.0784335999999992, 0.878468636469772, 0.0784336,
    0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  let outset = mat3x3f(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
    -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
    -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  let lo = -12.47393;
  let hi = 4.026069;
  let x = (clamp(log2(max(inset * c, vec3f(1e-10))), vec3f(lo), vec3f(hi)) - lo) / (hi - lo);
  let x2 = x * x;
  let x4 = x2 * x2;
  let y = 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
  return pow(max(outset * y, vec3f(0.0)), vec3f(2.2));
}

// ACES filmic (S. Hill's fit of the RRT + ODT), → linear
fn aces(c : vec3f) -> vec3f {
  let inset = mat3x3f(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  let outset = mat3x3f(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  let v = inset * c;
  let a = v * (v + 0.0245786) - 0.000090537;
  let b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return outset * (a / b);
}

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
        let x = textureLoad(radianceTex, p, 0).rgb * uniforms.exposure;
        let tm = i32(uniforms.toneMap);
        c = encode(select(select(x, agx(x), tm == 1), aces(x), tm == 2));
      }
    }
    if (mode == 1 || mode == 4) { c = encode(c); }
  }
  fragmentOutputs.color = vec4f(c, 1.0);
}
