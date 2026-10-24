// G-buffer: 0 rgba8 √albedo + metal, 1 rgba16f world normal + roughness, 2 rgba16f emission +
// material id, 3 r32f distance along the camera ray (0 = nothing), 4 rgba16f motion (last uv − uv)
// + last frame's distance of this surface point from last frame's eye (the denoiser's history check).

varying vPos : vec3f;
varying vNormal : vec3f;
varying vUV : vec2f;
varying vClip : vec4f;
varying vPrevClip : vec4f;
varying vPrevPos : vec3f;

uniform cameraPosition : vec3f;
uniform prevCameraPosition : vec3f;
uniform color : vec3f;
uniform roughness : f32;
uniform metal : f32;
uniform emission : vec3f;
uniform materialId : f32;

#if defined(SET) || defined(ALBEDO_TEX)
var albedoTexSampler : sampler;
var albedoTex : texture_2d<f32>; // sRGB buffer: decoded by the sampler
#endif
#ifdef SET
var normalTexSampler : sampler;
var normalTex : texture_2d<f32>;
var ormTexSampler : sampler;
var ormTex : texture_2d<f32>;
var microTexSampler : sampler;
var microTex : texture_2d<f32>;
uniform microRepeat : f32;
uniform microStrength : f32;
#endif

@fragment
fn main(input : FragmentInputs) -> FragmentOutputs {
  let uv = fragmentInputs.vUV;
  var n = normalize(fragmentInputs.vNormal);
  if (!fragmentInputs.frontFacing) { n = -n; }
  var albedo = uniforms.color;
  var rough = uniforms.roughness;
  var metal = uniforms.metal;
#ifdef ALBEDO_TEX
  albedo *= textureSample(albedoTex, albedoTexSampler, uv).rgb;
#endif
#ifdef SET
  // tangent frame from screen derivatives (the export has no tangents): solve for dp/du and dp/dv
  let dp1 = dpdx(fragmentInputs.vPos);
  let dp2 = dpdy(fragmentInputs.vPos);
  let duv1 = dpdx(uv);
  let duv2 = dpdy(uv);
  let orm = textureSample(ormTex, ormTexSampler, uv);
  let s = microBlend(
    albedo * textureSample(albedoTex, albedoTexSampler, uv).rgb,
    textureSample(normalTex, normalTexSampler, uv).xyz * 2.0 - 1.0,
    rough * orm.g,
    textureSample(microTex, microTexSampler, uv * uniforms.microRepeat),
    uniforms.microStrength);
  albedo = s.albedo;
  rough = s.roughness;
  metal *= orm.b;
  let det = duv1.x * duv2.y - duv1.y * duv2.x;
  if (abs(det) > 1e-20) {
    let t = (duv2.y * dp1 - duv1.y * dp2) * sign(det);
    let b = (duv1.x * dp2 - duv2.x * dp1) * sign(det);
    let T = normalize(t - n * dot(n, t));
    let B = normalize(b - n * dot(n, b));
    n = normalize(T * s.normal.x - B * s.normal.y + n * s.normal.z); // glTF: v grows down the image
  }
#endif
  let ndc = fragmentInputs.vClip.xy / fragmentInputs.vClip.w;
  let prevNdc = fragmentInputs.vPrevClip.xy / fragmentInputs.vPrevClip.w;
  fragmentOutputs.fragData0 = vec4f(sqrt(albedo), metal); // sqrt: fewer bands in dark albedo at 8 bits
  fragmentOutputs.fragData1 = vec4f(n, rough);
  fragmentOutputs.fragData2 = vec4f(uniforms.emission, uniforms.materialId);
  fragmentOutputs.fragData3 = vec4f(distance(fragmentInputs.vPos, uniforms.cameraPosition), 0.0, 0.0, 0.0);
  fragmentOutputs.fragData4 = vec4f((prevNdc - ndc) * vec2f(0.5, -0.5),
    distance(fragmentInputs.vPrevPos, uniforms.prevCameraPosition), 0.0);
}
