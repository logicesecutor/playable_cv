// Debug: one camera ray per pixel through the BVHs (trace.wgsl is prepended). Writes
// (hit distance or 0, nodes visited, material id, instance id) for the view pass (keys 8, 9).

struct Params {
  invViewProjection : mat4x4f,
  eye : vec4f,
  size : vec4f,
}

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var out : texture_storage_2d<rgba32float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id : vec3u) {
  if (f32(id.x) >= params.size.x || f32(id.y) >= params.size.y) { return; }
  // pixel centre → a point on the far plane → the ray from the eye, the raster's pixel ray
  // y grows up in NDC like the pixels here: Babylon flips its projection when it renders into a texture
  let ndc = (vec2f(id.xy) + 0.5) / params.size.xy * 2.0 - 1.0;
  let far = params.invViewProjection * vec4f(ndc, 1.0, 1.0);
  let d = normalize(far.xyz / far.w - params.eye.xyz);
  let hit = trace(params.eye.xyz, d, MISS, false);
  var r = vec4f(0.0, f32(hit.steps), 0.0, 0.0);
  if (hit.t < MISS) {
    r = vec4f(hit.t, f32(hit.steps), f32(triMaterial[hit.tri]), f32(instances[hit.inst].id));
  }
  textureStore(out, id.xy, r);
}
