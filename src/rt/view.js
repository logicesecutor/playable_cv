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
import cameraRay from "./camera.wgsl?raw";
import bvhview from "./bvhview.compute.wgsl?raw";

const VIEWS = ["lit", "albedo", "normal", "roughness/metal", "emission", "material id", "distance", "motion",
  "BVH vs raster", "BVH heat map"];
ShaderStore.ShadersStoreWGSL.gbufferViewFragmentShader = view;

const TONE_MAPS = ["none", "agx", "aces"];

/**
 * The screen: a full-screen pass, keys 0–9 (modes in view.fragment.wgsl): 0 the traced image
 * (`image.radiance`: denoise.js, or the reference of tracer.js), the
 * others debug views. Modes 8 and 9 trace one camera ray per pixel through the BVHs
 * (bvhview.compute.wgsl), only while they are on. URL: ?tm=none|agx|aces (tone map), ?ev= (exposure;
 * default +1 EV, chosen on M6 screenshots with direct light only: look again once M8 adds indirect).
 */
export function createView(scene, camera, gbuffer, rt, image) {
  const url = new URLSearchParams(location.search);
  const toneMap = Math.max(0, TONE_MAPS.indexOf(url.get("tm") ?? "agx"));
  const ev = Number(url.get("ev") ?? 1);
  const engine = scene.getEngine();
  let mode = 0;
  const { mrt } = gbuffer;
  const traced = () => RawTexture.CreateRGBAStorageTexture(null, mrt.getRenderWidth(), mrt.getRenderHeight(), scene, false, false,
    Constants.TEXTURE_NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
  let traceTex = traced();

  const cs = new ComputeShader("bvhView", engine, { computeSource: trace + cameraRay + bvhview }, {
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
    params.updateFloat4("size", w, h, gbuffer.jitter.x, gbuffer.jitter.y);
    params.update();
    cs.setStorageTexture("out", traceTex);
    cs.dispatch(Math.ceil(w / 8), Math.ceil(h / 8));
  });

  const pass = new PostProcess("gbufferView", "gbufferView", {
    uniforms: ["mode", "size", "exposure", "toneMap"],
    samplers: ["albedoTex", "normalTex", "emissionTex", "depthTex", "motionTex", "traceTex", "radianceTex"],
    camera,
    shaderLanguage: ShaderLanguage.WGSL,
  });
  pass.onApply = (effect) => {
    ["albedoTex", "normalTex", "emissionTex", "depthTex", "motionTex"].forEach((name, i) => effect.setTexture(name, mrt.textures[i]));
    effect.setTexture("traceTex", traceTex);
    effect.setTexture("radianceTex", image.radiance);
    effect.setFloat("exposure", 2 ** ev);
    effect.setFloat("toneMap", toneMap);
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
      traceTex.dispose();
      traceTex = traced();
    },
  };
}
