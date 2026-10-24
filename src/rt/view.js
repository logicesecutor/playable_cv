import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess.js";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage.js";
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore.js";
import { ComputeShader } from "@babylonjs/core/Compute/computeShader.js";
import { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Matrix } from "@babylonjs/core/Maths/math.vector.js";
import "@babylonjs/core/ShadersWGSL/postprocess.vertex.js";
import "@babylonjs/core/Engines/WebGPU/Extensions/engine.computeShader.js";
import view from "./view.fragment.wgsl?raw";
import trace from "./trace.wgsl?raw";
import bvhview from "./bvhview.compute.wgsl?raw";

const VIEWS = ["shaded", "albedo", "normal", "roughness/metal", "emission", "material id", "distance", "motion",
  "BVH vs raster", "BVH heat map"];
ShaderStore.ShadersStoreWGSL.gbufferViewFragmentShader = view;

/**
 * What the screen shows until the ray tracer lights it (M6): a full-screen pass over the G-buffer,
 * keys 0–9 (modes in view.fragment.wgsl). Modes 8 and 9 trace one camera ray per pixel through the
 * BVHs (bvhview.compute.wgsl), only while they are on.
 */
export function createView(scene, camera, gbuffer, rt) {
  const engine = scene.getEngine();
  let mode = 0;
  const { mrt } = gbuffer;
  const traced = () => RawTexture.CreateRGBAStorageTexture(null, mrt.getRenderWidth(), mrt.getRenderHeight(), scene, false, false,
    Constants.TEXTURE_NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
  let traceTex = traced();

  const cs = new ComputeShader("bvhView", engine, { computeSource: trace + bvhview }, {
    bindingsMapping: { params: { group: 0, binding: 0 }, out: { group: 0, binding: 1 }, ...rt.bindings },
  });
  const params = new UniformBuffer(engine, undefined, undefined, "bvhView");
  params.addUniform("invViewProjection", 16);
  params.addUniform("eye", 4);
  params.addUniform("size", 4);
  params.create();
  rt.bind(cs);
  cs.setUniformBuffer("params", params);
  const inverse = new Matrix();
  let frame = -1;
  scene.onAfterRenderTargetsRenderObservable.add(() => {
    if (mode < 8 || scene.getFrameId() === frame) return; // notified twice per frame
    frame = scene.getFrameId();
    const w = mrt.getRenderWidth(), h = mrt.getRenderHeight(), eye = camera.globalPosition;
    params.updateMatrix("invViewProjection", camera.getTransformationMatrix().invertToRef(inverse));
    params.updateFloat4("eye", eye.x, eye.y, eye.z, 1);
    params.updateFloat4("size", w, h, 0, 0);
    params.update();
    cs.setStorageTexture("out", traceTex);
    cs.dispatch(Math.ceil(w / 8), Math.ceil(h / 8));
  });

  const pass = new PostProcess("gbufferView", "gbufferView", {
    uniforms: ["mode", "size"],
    samplers: ["albedoTex", "normalTex", "emissionTex", "depthTex", "motionTex", "traceTex"],
    camera,
    shaderLanguage: ShaderLanguage.WGSL,
  });
  pass.onApply = (effect) => {
    mrt.textures.forEach((t, i) => effect.setTexture(["albedoTex", "normalTex", "emissionTex", "depthTex", "motionTex"][i], t));
    effect.setTexture("traceTex", traceTex);
    effect.setFloat("mode", mode);
    effect.setFloat2("size", mrt.getRenderWidth(), mrt.getRenderHeight());
  };
  addEventListener("keydown", (e) => {
    const k = /^Digit([0-9])$/.exec(e.code);
    if (k) mode = Number(k[1]);
  });

  return {
    get name() {
      return VIEWS[mode];
    },
    get traceTex() {
      return traceTex;
    },
    resize() {
      gbuffer.resize();
      traceTex.dispose();
      traceTex = traced();
    },
  };
}
