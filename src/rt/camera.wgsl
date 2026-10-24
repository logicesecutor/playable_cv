// The camera ray through a pixel centre, as the G-buffer rasterised it this frame: `jitter` is the
// raster's sub-pixel offset (pixels, gbuffer.js). NDC y grows down the pixels: Babylon flips its
// projection when it renders into a texture.
fn cameraRay(invViewProjection : mat4x4f, eye : vec3f, pixel : vec2f, size : vec2f, jitter : vec2f) -> vec3f {
  let ndc = (pixel + 0.5 - jitter) / size * 2.0 - 1.0;
  let far = invViewProjection * vec4f(ndc, 1.0, 1.0);
  return normalize(far.xyz / far.w - eye);
}
