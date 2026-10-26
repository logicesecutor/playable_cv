// Debug view of the coffee, 2/2: the splatted dots to a texture for view.js, coloured by speed
// (blue still → red 20 u/s), and the buffer reset for the next frame.

@group(0) @binding(8) var<storage, read_write> image : array<u32>;
@group(0) @binding(9) var out : texture_storage_2d<rgba8unorm, write>;

const EMPTY = 0xffffffffu;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id : vec3u) {
  let size = textureDimensions(out);
  if (any(id.xy >= size)) { return; }
  let i = id.y * size.x + id.x;
  let k = image[i];
  image[i] = EMPTY;
  if (k == EMPTY) {
    textureStore(out, id.xy, vec4f(0.0));
    return;
  }
  let s = f32(k & 0xffffu) / 65535.0;
  let c = vec3f(smoothstep(0.35, 0.75, s), sin(s * 3.14159), 1.0 - smoothstep(0.25, 0.6, s));
  textureStore(out, id.xy, vec4f(c, 1.0));
}
