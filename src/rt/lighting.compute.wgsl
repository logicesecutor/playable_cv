// Lighting from the G-buffer (trace.wgsl, brdf.wgsl and camera.wgsl are prepended). Per pixel: the
// direct light at the visible point p, plus one bounce per lobe (M8): a cosine-sampled diffuse ray
// and a GGX glossy ray, each shaded at its hit with the same direct light, its sample capped at 10. Emission at a hit is not
// added: p's own light sampling already counts it. Direct light = one area light picked by RIS (16
// candidates drawn by power from an alias table, weighed by an unshadowed estimate; one shadow ray)
// + the sun, which reaches the room only through the window panes (the first lights): a direction in
// its disc counts if it crosses a pane before anything else (the blinds cast their stripes).
// Denoised (the default): this frame's sample goes to `diffuseOut` (without p's albedo) and
// `specularOut` for denoise.js. Reference (?denoise=0): emission + the light is summed into `accum`
// (count in w) while nothing moves, and the mean goes to `out`.

struct Params {
  invViewProjection : mat4x4f,
  eye : vec4f,
  size : vec4f, // width, height, frame, reset all (1)
  jitter : vec4f, // the raster's sub-pixel offset (pixels), reference mode (1), pixel angle (rad)
  sun : vec4f, // towards the sun, cosine of its angular radius
  sunColor : vec4f, // irradiance on a plane facing the sun, number of window panes
}

struct Light {
  v0 : vec3f,
  area : f32,
  e1 : vec3f,
  radius : f32, // centre to the farthest corner
  e2 : vec3f,
  threshold : f32, // alias table: a draw in this light's bin keeps it below the threshold, else takes `other`
  normal : vec3f, // the emitting side
  other : u32,
  emission : vec3f,
  pdf : f32, // power / total power
}

struct Material {
  color : vec3f,
  roughness : f32,
  metal : f32,
  layer : f32, // in the texture arrays
  pad0 : f32,
  pad1 : f32,
}

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var albedoTex : texture_2d<f32>;
@group(0) @binding(2) var normalTex : texture_2d<f32>;
@group(0) @binding(3) var emissionTex : texture_2d<f32>;
@group(0) @binding(4) var depthTex : texture_2d<f32>;
@group(0) @binding(5) var motionTex : texture_2d<f32>;
@group(0) @binding(6) var<storage, read_write> accum : array<vec4f>;
@group(0) @binding(7) var out : texture_storage_2d<rgba16float, write>;
@group(0) @binding(8) var diffuseOut : texture_storage_2d<rgba16float, write>;
@group(0) @binding(9) var specularOut : texture_storage_2d<rgba16float, write>;
@group(0) @binding(10) var albedoSampler : sampler; // Babylon binds a texture's sampler just before it
@group(0) @binding(11) var albedoArray : texture_2d_array<f32>;
@group(0) @binding(12) var ormSampler : sampler;
@group(0) @binding(13) var ormArray : texture_2d_array<f32>;
@group(1) @binding(5) var<storage, read> lights : array<Light>;
@group(1) @binding(6) var<storage, read> attribs : array<vec4f>; // scene.js writeAttribs
@group(1) @binding(7) var<storage, read> materials : array<Material>;

const CANDIDATES = 16u;
const CLAMP = 10.0;

var<private> rng : u32;

fn random() -> f32 { // PCG
  rng = rng * 747796405u + 2891336453u;
  let w = ((rng >> ((rng >> 28u) + 4u)) ^ rng) * 277803737u;
  return f32((w >> 22u) ^ w) * (1.0 / 4294967296.0);
}

// a light's unshadowed contribution seen from p, estimated at its centre; never 0 while any part of
// it can light p: the cosine at p is widened by the light's angular radius, the specular lobe
// likewise, and there is a small floor. Cheaper than brdf(): no Fresnel, no masking term.
fn weight(l : Light, p : vec3f, n : vec3f, v : vec3f, diffuse : f32, specular : f32, a2 : f32) -> f32 {
  let side = dot(l.normal, p - l.v0);
  if (side <= 0.0) { return 0.0; } // behind the light's plane (exact: a triangle is flat)
  let to = l.v0 + (l.e1 + l.e2) * (1.0 / 3.0) - p;
  let d2 = max(dot(to, to), 1e-8);
  let inv = inverseSqrt(d2);
  let w = to * inv;
  let spread = min(l.radius * inv, 1.0);
  let cs = dot(n, w) + spread;
  if (cs <= 0.0) { return 0.0; }
  let b2 = max(a2, spread * spread); // the lobe at least as wide as the light
  let nh = max(dot(n, normalize(v + w)), 0.0);
  let k = nh * nh * (b2 - 1.0) + 1.0;
  let f = diffuse + specular * b2 / (4.0 * PI * k * k) + 1e-4;
  return luminance(l.emission) * min(l.area * side * inv * inv * inv, 2.0 * PI) * min(cs, 1.0) * f;
}

// distance along o + t d to a light's triangle (either side), MISS if it misses
fn lightHit(l : Light, o : vec3f, d : vec3f) -> f32 {
  let p = cross(d, l.e2);
  let det = dot(l.e1, p);
  if (det == 0.0) { return MISS; }
  let inv = 1.0 / det;
  let s = o - l.v0;
  let u = dot(s, p) * inv;
  if (u < 0.0 || u > 1.0) { return MISS; }
  let q = cross(s, l.e1);
  let w = dot(d, q) * inv;
  if (w < 0.0 || u + w > 1.0) { return MISS; }
  let t = dot(l.e2, q) * inv;
  return select(MISS, t, t > 0.0);
}

// light arriving at p (shadow rays from o, just off the surface) times f and the cosine, in the
// denoiser's two parts
fn direct(p : vec3f, o : vec3f, n : vec3f, v : vec3f, albedo : vec3f, roughness : f32, metal : f32) -> Brdf {
  var result = Brdf(vec3f(0.0), vec3f(0.0));
  let kd = (1.0 - metal) * luminance(albedo) / PI + 1e-3;
  let ks = luminance(mix(vec3f(0.04), albedo, metal));
  let a2 = max(roughness * roughness * roughness * roughness, 1e-6);
  let count = arrayLength(&lights);
  var wsum = 0.0;
  var picked = 0u;
  var pickedWeight = 0.0;
  for (var c = 0u; c < CANDIDATES; c++) {
    let x = random() * f32(count);
    var k = min(u32(x), count - 1u);
    if (fract(x) >= lights[k].threshold) { k = lights[k].other; }
    let w = weight(lights[k], p, n, v, kd, ks, a2);
    if (w > 0.0) {
      let r = w / lights[k].pdf;
      wsum += r;
      if (random() * wsum < r) { picked = k; pickedWeight = w; }
    }
  }
  if (wsum > 0.0) {
    let l = lights[picked];
    var u = vec2f(random(), random());
    if (u.x + u.y > 1.0) { u = 1.0 - u; }
    let to = l.v0 + l.e1 * u.x + l.e2 * u.y - o;
    let dist = length(to);
    let wi = to / dist;
    let cl = dot(l.normal, -wi);
    if (cl > 0.0 && dot(n, wi) > 0.0 && trace(o, wi, dist * (1.0 - 1e-4), true).t == MISS) {
      let f = brdf(n, v, wi, albedo, roughness, metal);
      // RIS: area pdf = (pickedWeight / Σ w/pdf estimated as wsum / CANDIDATES) / area
      let li = l.emission * dot(n, wi) * cl / (dist * dist) * l.area * (wsum / f32(CANDIDATES)) / pickedWeight;
      result = Brdf(f.diffuse * li, f.specular * li);
    }
  }
  let windows = u32(params.sunColor.w);
  if (windows > 0u && any(params.sunColor.rgb > vec3f(0.0))) {
    let l = sampleCone(params.sun.xyz, params.sun.w, vec2f(random(), random()));
    if (dot(n, l) > 0.0) {
      var s = MISS;
      for (var k = 0u; k < windows; k++) { s = min(s, lightHit(lights[k], o, l)); }
      if (s < MISS && trace(o, l, s * (1.0 - 1e-4), true).t == MISS) {
        let f = brdf(n, v, l, albedo, roughness, metal);
        let li = params.sunColor.rgb * dot(n, l); // radiance E / Ω over the disc, pdf 1 / Ω
        result.diffuse += f.diffuse * li;
        result.specular += f.specular * li;
      }
    }
  }
  return result;
}

struct Point {
  p : vec3f,
  n : vec3f,  // shading: the vertex normals (the player: the face's)
  ng : vec3f, // the face's, towards the ray
  albedo : vec3f,
  roughness : f32,
  metal : f32,
}

// the surface a ray hit, its material as the G-buffer would have it without normal and micro maps;
// textures at the LOD of a ray cone `width` wide there (Akenine-Möller et al. 2019)
fn shade(hit : Hit, o : vec3f, d : vec3f, width : f32) -> Point {
  let m = instances[hit.inst].toObject;
  let toWorld = transpose(mat3x3f(m[0].xyz, m[1].xyz, m[2].xyz)); // normals: inverse transpose of object → world
  let i = hit.tri;
  let a0 = attribs[4u * i];
  let a1 = attribs[4u * i + 1u];
  let a2 = attribs[4u * i + 2u];
  let a3 = attribs[4u * i + 3u];
  let b = vec3f(1.0 - hit.uv.x - hit.uv.y, hit.uv.x, hit.uv.y);
  var ng = normalize(toWorld * cross(tris[3u * i + 1u].xyz - tris[3u * i].xyz, tris[3u * i + 2u].xyz - tris[3u * i].xyz));
  if (dot(ng, d) > 0.0) { ng = -ng; }
  var n = ng;
  if (any(a0.xyz != vec3f(0.0))) {
    n = normalize(toWorld * (a0.xyz * b.x + a1.xyz * b.y + a2.xyz * b.z));
    if (dot(n, ng) < 0.0) { n = -n; } // the side the ray hit, as the raster flips back faces
  }
  let uv = vec2f(dot(vec3f(a0.w, a1.w, a2.w), b), dot(a3.xyz, b));
  let lod = a3.w + log2(max(width, 1e-6) / max(abs(dot(ng, d)), 1e-3));
  let mat = materials[triMaterial[i]];
  let layer = i32(mat.layer);
  let albedo = textureSampleLevel(albedoArray, albedoSampler, uv, layer, lod).rgb;
  let orm = textureSampleLevel(ormArray, ormSampler, uv, layer, lod);
  return Point(o + d * hit.t, n, ng, mat.color * albedo, clamp(mat.roughness * orm.g, 0.02, 1.0), mat.metal * orm.b);
}

// a bounce sample's contribution, its largest channel capped at CLAMP (like Cycles' indirect clamp):
// rare glints off near-mirror hits otherwise survive the denoiser as white specks
fn capped(c : vec3f) -> vec3f {
  return c * min(1.0, CLAMP / max(max(c.r, c.g), max(c.b, 1e-6)));
}

// within f16 and not NaN: a near-mirror (ceramic) at a light's peak can exceed f16's 65504, and one
// Inf or NaN becomes a black square once the denoiser spreads it
fn finite(c : vec3f) -> vec3f {
  return select(min(c, vec3f(6e4)), vec3f(0.0), c != c);
}

// direct light leaving a hit point back along the ray; `dist` from the eye, for the offset
fn bounce(q : Point, d : vec3f, dist : f32) -> vec3f {
  let o = q.p + q.ng * (2e-3 + 1e-5 * dist);
  let l = direct(q.p, o, q.n, -d, q.albedo, q.roughness, q.metal);
  return l.diffuse * q.albedo * (1.0 - q.metal) + l.specular;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id : vec3u) {
  if (f32(id.x) >= params.size.x || f32(id.y) >= params.size.y) { return; }
  let pixel = vec2i(id.xy);
  let index = id.y * u32(params.size.x) + id.x;
  rng = index * 9781u + u32(params.size.z) * 6271u + 1u;
  random();

  var emission = vec3f(0.0);
  var diffuse = vec3f(0.0);
  var specular = vec3f(0.0);
  var albedo = vec3f(0.0);
  var metal = 0.0;
  let t = textureLoad(depthTex, pixel, 0).r;
  if (t > 0.0) {
    let d = cameraRay(params.invViewProjection, params.eye.xyz, vec2f(id.xy), params.size.xy, params.jitter.xy);
    let p = params.eye.xyz + d * t;
    let a = textureLoad(albedoTex, pixel, 0);
    let nr = textureLoad(normalTex, pixel, 0);
    albedo = a.rgb * a.rgb;
    metal = a.w;
    let n = normalize(nr.xyz);
    let roughness = nr.w;
    let v = -d;
    emission = textureLoad(emissionTex, pixel, 0).rgb;
    // off the surface along the shading normal (it stays within 90° of the geometric one); the
    // offset grows with the distance, like the error of p rebuilt from the f32 G-buffer
    let o = p + n * (2e-3 + 1e-5 * t);
    let pixelAngle = params.jitter.w;

    let light = direct(p, o, n, v, albedo, roughness, metal);
    diffuse = light.diffuse;
    specular = light.specular;

    // diffuse bounce: f cos / pdf = (1 − F) with the albedo left out; a wide cone (spread ~1 rad)
    let ld = sampleCosine(n, vec2f(random(), random()));
    let hd = trace(o, ld, MISS, false);
    if (hd.t < MISS) {
      let q = shade(hd, o, ld, t * pixelAngle + hd.t * (pixelAngle + 1.0));
      diffuse += capped(brdf(n, v, ld, albedo, roughness, metal).diffuse * PI * bounce(q, ld, t + hd.t));
    }
    // glossy bounce: the cone widens by the lobe's alpha
    let g = sampleGlossy(n, v, albedo, roughness, metal, vec2f(random(), random()));
    if (any(g.weight > vec3f(0.0))) {
      let hg = trace(o, g.l, MISS, false);
      if (hg.t < MISS) {
        let q = shade(hg, o, g.l, t * pixelAngle + hg.t * (pixelAngle + roughness * roughness));
        specular += capped(g.weight * bounce(q, g.l, t + hg.t));
      }
    }
  }

  diffuse = finite(diffuse);
  specular = finite(specular);
  if (params.jitter.z == 0.0) {
    textureStore(diffuseOut, pixel, vec4f(diffuse, 0.0));
    textureStore(specularOut, pixel, vec4f(specular, 0.0));
    return;
  }
  let m = textureLoad(motionTex, pixel, 0).xy * params.size.xy;
  var sum = accum[index];
  if (params.size.w > 0.0 || dot(m, m) > 1e-4) { sum = vec4f(0.0); } // restart where anything moved
  sum += vec4f(emission + diffuse * albedo * (1.0 - metal) + specular, 1.0);
  accum[index] = sum;
  textureStore(out, pixel, vec4f(sum.rgb / sum.w, sum.w));
}
