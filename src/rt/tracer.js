import { ComputeShader } from "@babylonjs/core/Compute/computeShader.js";
import { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import { StorageBuffer } from "@babylonjs/core/Buffers/storageBuffer.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Matrix } from "@babylonjs/core/Maths/math.vector.js";
import "@babylonjs/core/Engines/WebGPU/Extensions/engine.computeShader.js";
import trace from "./trace.wgsl?raw";
import brdf from "./brdf.wgsl?raw";
import cameraRay from "./camera.wgsl?raw";
import direct from "./direct.compute.wgsl?raw";

const GBUFFER = ["albedoTex", "normalTex", "emissionTex", "depthTex", "motionTex"];

/**
 * The lighting passes, after the G-buffer every frame. M6: direct light (direct.compute.wgsl).
 * Default: one noisy sample per pixel and frame in `diffuse` (without the albedo) and `specular`,
 * for denoise.js. `reference` (?denoise=0): accumulated while the camera and the loose bodies are
 * still; `radiance` holds the mean so far (linear, count in alpha). The outputs the mode does not
 * use are 1×1 (the shader still binds them).
 */
export function createTracer(scene, camera, gbuffer, rt, reference) {
  const engine = scene.getEngine();
  const { mrt } = gbuffer;
  const cs = new ComputeShader("direct", engine, { computeSource: trace + brdf + cameraRay + direct }, {
    bindingsMapping: {
      params: { group: 0, binding: 0 },
      ...Object.fromEntries(GBUFFER.map((name, i) => [name, { group: 0, binding: 1 + i }])),
      accum: { group: 0, binding: 6 },
      out: { group: 0, binding: 7 },
      diffuseOut: { group: 0, binding: 8 },
      specularOut: { group: 0, binding: 9 },
      ...rt.bindings,
      lights: { group: 1, binding: 5 },
    },
  });
  const params = new UniformBuffer(engine, undefined, undefined, "direct");
  params.addUniform("invViewProjection", 16);
  params.addUniform("eye", 4);
  params.addUniform("size", 4);
  params.addUniform("jitter", 4);
  params.create();
  cs.setUniformBuffer("params", params);
  rt.bind(cs, ["nodes", "tris", "instances", "tlas"]); // no triMaterial: shadow rays need no material
  cs.setStorageBuffer("lights", rt.lights);

  let accum, radiance, diffuse, specular;
  const texture = (w, h) => RawTexture.CreateRGBAStorageTexture(null, w, h, scene, false, false,
    Constants.TEXTURE_NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_HALF_FLOAT);
  const targets = () => {
    [accum, radiance, diffuse, specular].forEach((x) => x?.dispose());
    const w = mrt.getRenderWidth(), h = mrt.getRenderHeight();
    const [rw, rh] = reference ? [w, h] : [1, 1];
    const [dw, dh] = reference ? [1, 1] : [w, h];
    accum = new StorageBuffer(engine, 16 * rw * rh, undefined, "accum");
    radiance = texture(rw, rh);
    diffuse = texture(dw, dh);
    specular = texture(dw, dh);
    cs.setStorageBuffer("accum", accum);
    cs.setStorageTexture("out", radiance);
    cs.setStorageTexture("diffuseOut", diffuse);
    cs.setStorageTexture("specularOut", specular);
    reset = true;
  };
  let reset = true;
  targets();

  const viewProjection = new Matrix();
  const inverse = new Matrix();
  let frame = 0, rendered = -1;
  scene.onAfterRenderTargetsRenderObservable.add(() => {
    if (scene.getFrameId() === rendered) return; // notified twice per frame
    rendered = scene.getFrameId();
    const vp = camera.getTransformationMatrix();
    reset ||= rt.moved || !vp.equals(viewProjection);
    viewProjection.copyFrom(vp);
    const eye = camera.globalPosition;
    params.updateMatrix("invViewProjection", vp.invertToRef(inverse));
    params.updateFloat4("eye", eye.x, eye.y, eye.z, 1);
    params.updateFloat4("size", mrt.getRenderWidth(), mrt.getRenderHeight(), frame++, reset ? 1 : 0);
    params.updateFloat4("jitter", gbuffer.jitter.x, gbuffer.jitter.y, reference ? 1 : 0, 0);
    params.update();
    GBUFFER.forEach((name, i) => cs.setTexture(name, mrt.textures[i], false)); // textures[5] is the depth buffer
    if (cs.dispatch(Math.ceil(mrt.getRenderWidth() / 8), Math.ceil(mrt.getRenderHeight() / 8))) reset = false;
  });

  return {
    get radiance() {
      return radiance;
    },
    get diffuse() {
      return diffuse;
    },
    get specular() {
      return specular;
    },
    passes: [cs],
    resize: targets,
  };
}
