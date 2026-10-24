// Direct light from the G-buffer (trace.wgsl and brdf.wgsl are prepended). Per pixel: every
// emissive triangle gets a weight (its unshadowed contribution, estimated at its centre), one is
// picked in proportion (one pass, weighted reservoir), a point on it is sampled uniformly and one
// shadow ray is traced. Emissive surfaces add their emission. The result is summed into `accum`
// (count in w) while nothing moves, and the mean goes to `out`.

struct Params {
  invViewProjection : mat4x4f,
  eye : vec4f,
  size : vec4f, // width, height, frame, reset all (1)
}

struct Light {
  v0 : vec3f,
  area : f32,
  e1 : vec3f,
  radius : f32, // centre to the farthest corner
  e2 : vec3f,
  pad0 : f32,
  normal : vec3f, // the emitting side
  pad1 : f32,
  emission : vec3f,
  pad2 : f32,
}

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var albedoTex : texture_2d<f32>;
@group(0) @binding(2) var normalTex : texture_2d<f32>;
@group(0) @binding(3) var emissionTex : texture_2d<f32>;
@group(0) @binding(4) var depthTex : texture_2d<f32>;
@group(0) @binding(5) var motionTex : texture_2d<f32>;
@group(0) @binding(6) var<storage, read_write> accum : array<vec4f>;
@group(0) @binding(7) var out : texture_storage_2d<rgba16float, write>;
@group(1) @binding(5) var<storage, read> lights : array<Light>;

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

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id : vec3u) {
  if (f32(id.x) >= params.size.x || f32(id.y) >= params.size.y) { return; }
  let pixel = vec2i(id.xy);
  let index = id.y * u32(params.size.x) + id.x;
  rng = index * 9781u + u32(params.size.z) * 6271u + 1u;
  random();

  var radiance = vec3f(0.0);
  let t = textureLoad(depthTex, pixel, 0).r;
  if (t > 0.0) {
    let ndc = (vec2f(id.xy) + 0.5) / params.size.xy * 2.0 - 1.0; // as in bvhview.compute.wgsl
    let far = params.invViewProjection * vec4f(ndc, 1.0, 1.0);
    let d = normalize(far.xyz / far.w - params.eye.xyz);
    let p = params.eye.xyz + d * t;
    let a = textureLoad(albedoTex, pixel, 0);
    let nr = textureLoad(normalTex, pixel, 0);
    let albedo = a.rgb * a.rgb;
    let metal = a.w;
    let n = normalize(nr.xyz);
    let roughness = nr.w;
    let v = -d;
    radiance = textureLoad(emissionTex, pixel, 0).rgb;

    var total = 0.0;
    var picked = 0u;
    var pickedWeight = 0.0;
    let diffuse = (1.0 - metal) * luminance(albedo) / PI + 1e-3;
    let specular = luminance(mix(vec3f(0.04), albedo, metal));
    let a2 = max(roughness * roughness * roughness * roughness, 1e-6);
    for (var k = 0u; k < arrayLength(&lights); k++) {
      let w = weight(lights[k], p, n, v, diffuse, specular, a2);
      if (w > 0.0) {
        total += w;
        if (random() * total < w) { picked = k; pickedWeight = w; }
      }
    }
    if (total > 0.0) {
      let l = lights[picked];
      var u = vec2f(random(), random());
      if (u.x + u.y > 1.0) { u = 1.0 - u; }
      let q = l.v0 + l.e1 * u.x + l.e2 * u.y;
      // off the surface along the shading normal (it stays within 90° of the geometric one); the
      // offset grows with the distance, like the error of p rebuilt from the f32 G-buffer
      let o = p + n * (2e-3 + 1e-5 * t);
      let to = q - o;
      let dist = length(to);
      let wi = to / dist;
      let cl = dot(l.normal, -wi);
      if (cl > 0.0 && dot(n, wi) > 0.0) {
        let shadow = trace(o, wi, dist * (1.0 - 1e-4), true);
        if (shadow.t == MISS) {
          let f = brdf(n, v, wi, albedo, roughness, metal);
          // pdf of the sample: (pickedWeight / total) / area, in area measure
          radiance += f * l.emission * dot(n, wi) * cl / (dist * dist) * l.area * total / pickedWeight;
        }
      }
    }
  }

  let m = textureLoad(motionTex, pixel, 0).xy * params.size.xy;
  var sum = accum[index];
  if (params.size.w > 0.0 || dot(m, m) > 1e-4) { sum = vec4f(0.0); } // restart where anything moved
  sum += vec4f(radiance, 1.0);
  accum[index] = sum;
  textureStore(out, pixel, vec4f(sum.rgb / sum.w, sum.w));
}
