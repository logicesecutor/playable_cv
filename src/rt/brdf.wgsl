// The surface model, like Cycles' Principled BSDF with no layers: GGX specular (alpha = roughness²,
// height-correlated Smith, Schlick Fresnel, F0 0.04 for dielectrics) + Lambert diffuse weighted by
// 1 − F for dielectrics. Returns f (no cosine) in two parts for the denoiser, which filters them
// apart: f = diffuse × albedo × (1 − metal) + specular. n, v, l: unit, v and l away from the surface.
// Also the direction sampling of the bounces (M8): cosine, GGX visible normals, a cone.

const PI = 3.14159265;

struct Brdf {
  diffuse : vec3f, // without the albedo and the metal mask
  specular : vec3f,
}

fn fresnel(albedo : vec3f, metal : f32, vh : f32) -> vec3f {
  let f0 = mix(vec3f(0.04), albedo, metal);
  return f0 + (1.0 - f0) * pow(1.0 - max(vh, 0.0), 5.0);
}

// height-correlated Smith G2 / (4 nl nv)
fn smithV(nl : f32, nv : f32, a2 : f32) -> f32 {
  return 0.5 / (nl * sqrt(nv * nv * (1.0 - a2) + a2) + nv * sqrt(nl * nl * (1.0 - a2) + a2));
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
  let F = fresnel(albedo, metal, dot(v, h));
  return Brdf((1.0 - F) / PI, D * smithV(nl, nv, a2) * F);
}

fn luminance(c : vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

// columns: two tangents and n (Duff et al. 2017)
fn basis(n : vec3f) -> mat3x3f {
  let s = select(-1.0, 1.0, n.z >= 0.0);
  let a = -1.0 / (s + n.z);
  let b = n.x * n.y * a;
  return mat3x3f(vec3f(1.0 + s * n.x * n.x * a, s * b, -s * n.x), vec3f(b, s + n.y * n.y * a, -n.y), n);
}

// cosine-weighted around n: pdf cos / π
fn sampleCosine(n : vec3f, u : vec2f) -> vec3f {
  let r = sqrt(u.x);
  let phi = 2.0 * PI * u.y;
  return basis(n) * vec3f(r * cos(phi), r * sin(phi), sqrt(max(1.0 - u.x, 0.0)));
}

// uniform within the cone around d whose half-angle has cosine c
fn sampleCone(d : vec3f, c : f32, u : vec2f) -> vec3f {
  let z = 1.0 - u.x * (1.0 - c);
  let r = sqrt(max(1.0 - z * z, 0.0));
  let phi = 2.0 * PI * u.y;
  return basis(d) * vec3f(r * cos(phi), r * sin(phi), z);
}

struct Glossy {
  l : vec3f,
  weight : vec3f, // f cos / pdf = F G2 / G1(v), 0 below the surface
}

// GGX visible normals, spherical caps (Dupuy & Benyoub 2023), mirrored about the sampled normal
fn sampleGlossy(n : vec3f, v : vec3f, albedo : vec3f, roughness : f32, metal : f32, u : vec2f) -> Glossy {
  let a = max(roughness * roughness, 1e-3);
  let a2 = a * a;
  let frame = basis(n);
  let vl = v * frame; // to local: transpose(frame) × v
  let vh = normalize(vec3f(a * vl.x, a * vl.y, vl.z));
  let phi = 2.0 * PI * u.x;
  let z = (1.0 - u.y) * (1.0 + vh.z) - vh.z;
  let r = sqrt(clamp(1.0 - z * z, 0.0, 1.0));
  let c = vec3f(r * cos(phi), r * sin(phi), z) + vh;
  let h = frame * normalize(vec3f(a * c.x, a * c.y, max(c.z, 1e-6)));
  let l = reflect(-v, h);
  let nl = dot(n, l);
  let nv = max(dot(n, v), 1e-4);
  if (nl <= 0.0) { return Glossy(l, vec3f(0.0)); }
  let g1 = 2.0 * nv / (nv + sqrt(a2 + (1.0 - a2) * nv * nv));
  return Glossy(l, fresnel(albedo, metal, dot(v, h)) * (4.0 * smithV(nl, nv, a2) * nl * nv) / g1);
}
