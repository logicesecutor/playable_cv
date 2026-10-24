// The surface model, like Cycles' Principled BSDF with no layers: GGX specular (alpha = roughness²,
// height-correlated Smith, Schlick Fresnel, F0 0.04 for dielectrics) + Lambert diffuse weighted by
// 1 − F for dielectrics. Returns f (no cosine) in two parts for the denoiser, which filters them
// apart: f = diffuse × albedo × (1 − metal) + specular. n, v, l: unit, v and l away from the surface.

const PI = 3.14159265;

struct Brdf {
  diffuse : vec3f, // without the albedo and the metal mask
  specular : vec3f,
}

fn brdf(n : vec3f, v : vec3f, l : vec3f, albedo : vec3f, roughness : f32, metal : f32) -> Brdf {
  let nl = dot(n, l);
  if (nl <= 0.0) { return Brdf(vec3f(0.0), vec3f(0.0)); }
  let nv = max(dot(n, v), 1e-4);
  let h = normalize(v + l);
  let nh = max(dot(n, h), 0.0);
  let a = max(roughness * roughness, 1e-3);
  let a2 = a * a;
  let k = nh * nh * (a2 - 1.0) + 1.0;
  let D = a2 / (PI * k * k);
  let V = 0.5 / (nl * sqrt(nv * nv * (1.0 - a2) + a2) + nv * sqrt(nl * nl * (1.0 - a2) + a2));
  let f0 = mix(vec3f(0.04), albedo, metal);
  let F = f0 + (1.0 - f0) * pow(1.0 - max(dot(v, h), 0.0), 5.0);
  return Brdf((1.0 - F) / PI, D * V * F);
}

fn luminance(c : vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}
