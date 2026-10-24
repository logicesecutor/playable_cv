import { ComputeShader } from "@babylonjs/core/Compute/computeShader.js";
import { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Matrix } from "@babylonjs/core/Maths/math.vector.js";
import "@babylonjs/core/Engines/WebGPU/Extensions/engine.computeShader.js";
import cameraRay from "./camera.wgsl?raw";
import common from "./denoise.wgsl?raw";
import temporal from "./temporal.compute.wgsl?raw";
import atrous from "./atrous.compute.wgsl?raw";
import resolve from "./resolve.compute.wgsl?raw";

const STEPS = [1, 2, 4, 8, 16];

/**
 * The denoiser (M7), SVGF-style, after the tracer every frame: temporal (history + variance), 5
 * à-trous passes, resolve + TAA. Diffuse and specular are filtered apart. `radiance` is the final
 * linear image for the view pass. Unlike SVGF the history is the temporal pass's own output, not the
 * first à-trous pass's: fed back over 32 frames, that blur compounds and washed out the figure's
 * contact shadow.
 */
export function createDenoiser(scene, camera, gbuffer, tracer) {
  const engine = scene.getEngine();
  const { mrt } = gbuffer;
  const pass = (name, source, bindings) => {
    const cs = new ComputeShader(name, engine, { computeSource: cameraRay + common + source }, {
      bindingsMapping: Object.fromEntries(["params", ...bindings].map((b, i) => [b, { group: 0, binding: i }])),
    });
    const params = new UniformBuffer(engine, undefined, undefined, name);
    params.addUniform("invViewProjection", 16);
    params.addUniform("eye", 4);
    params.addUniform("size", 4);
    params.addUniform("jitter", 4);
    params.addUniform("atrous", 4);
    params.create();
    cs.setUniformBuffer("params", params);
    return { cs, params };
  };
  const temporalPass = pass("temporal", temporal, ["diffuseIn", "specularIn", "normalTex", "depthTex", "motionTex",
    "prevDiffuse", "prevSpecular", "prevMoments", "prevGeometry", "diffuseOut", "specularOut", "momentsOut", "geometryOut"]);
  // one shader per step: a uniform buffer updated twice in a frame would hold the last value for all
  const atrousPasses = STEPS.map((step) => pass(`atrous${step}`, atrous, ["diffuseIn", "specularIn", "geometry", "diffuseOut",
    "specularOut"]));
  const resolvePass = pass("resolve", resolve, ["diffuseTex", "specularTex", "albedoTex", "emissionTex", "depthTex", "motionTex",
    "history", "out"]);

  let t; // the textures; [2] = ping-pong, [frame & 1] written this frame
  const targets = () => {
    if (t) Object.values(t).flat().forEach((x) => x.dispose());
    const w = mrt.getRenderWidth(), h = mrt.getRenderHeight();
    const make = (type) => RawTexture.CreateRGBAStorageTexture(null, w, h, scene, false, false,
      Constants.TEXTURE_NEAREST_SAMPLINGMODE, type);
    const half = () => make(Constants.TEXTURETYPE_HALF_FLOAT);
    const full = () => make(Constants.TEXTURETYPE_FLOAT);
    // the histories are f32: f16 stores truncate on some GPUs (Intel), and a running mean over 32
    // frames turns that into a 1–2 % darker image
    t = {
      diffuse: [full(), full()], // history: the temporal pass's output
      specular: [full(), full()],
      moments: [full(), full()],
      geometry: [full(), full()],
      image: [full(), full()], // TAA
      a: [half(), half()], // diffuse, specular between the à-trous passes
      b: [half(), half()],
    };
    reset = true;
  };
  let reset = true;
  targets();

  const inverse = new Matrix();
  let frame = -1;
  scene.onAfterRenderTargetsRenderObservable.add(() => {
    if (scene.getFrameId() === frame) return; // notified twice per frame
    frame = scene.getFrameId();
    const w = mrt.getRenderWidth(), h = mrt.getRenderHeight();
    const now = frame & 1, last = now ^ 1;
    const vp = camera.getTransformationMatrix().invertToRef(inverse);
    const eye = camera.globalPosition, j = gbuffer.jitter;
    const pixelAngle = (2 * Math.tan(camera.fov / 2)) / h; // fov is vertical (Babylon's default)
    const update = ({ params }, step = 0) => {
      params.updateMatrix("invViewProjection", vp);
      params.updateFloat4("eye", eye.x, eye.y, eye.z, 1);
      params.updateFloat4("size", w, h, pixelAngle, reset ? 1 : 0);
      params.updateFloat4("jitter", j.x, j.y, 0, 0);
      params.updateFloat4("atrous", step, 0, 0, 0);
      params.update();
    };
    const textures = (cs, map) => {
      for (const [name, tex] of Object.entries(map)) {
        if (name.endsWith("Out") || name === "out") cs.setStorageTexture(name, tex);
        else cs.setTexture(name, tex, false);
      }
    };
    const [albedo, normal, emission, depth, motion] = mrt.textures;
    const groups = [Math.ceil(w / 8), Math.ceil(h / 8)];
    let ok = true;

    update(temporalPass);
    textures(temporalPass.cs, {
      diffuseIn: tracer.diffuse, specularIn: tracer.specular, normalTex: normal, depthTex: depth, motionTex: motion,
      prevDiffuse: t.diffuse[last], prevSpecular: t.specular[last], prevMoments: t.moments[last], prevGeometry: t.geometry[last],
      diffuseOut: t.diffuse[now], specularOut: t.specular[now], momentsOut: t.moments[now], geometryOut: t.geometry[now],
    });
    ok &&= temporalPass.cs.dispatch(...groups);

    // history → a → b → a → b → a
    const io = [[[t.diffuse[now], t.specular[now]], t.a], [t.a, t.b], [t.b, t.a], [t.a, t.b], [t.b, t.a]];
    atrousPasses.forEach((p, i) => {
      update(p, STEPS[i]);
      const [[di, si], [dout, sout]] = io[i];
      textures(p.cs, { diffuseIn: di, specularIn: si, geometry: t.geometry[now], diffuseOut: dout, specularOut: sout });
      ok &&= p.cs.dispatch(...groups);
    });

    update(resolvePass);
    textures(resolvePass.cs, {
      diffuseTex: t.a[0], specularTex: t.a[1], albedoTex: albedo, emissionTex: emission, depthTex: depth, motionTex: motion,
      history: t.image[last], out: t.image[now],
    });
    ok &&= resolvePass.cs.dispatch(...groups);

    if (ok) reset = false;
  });

  return {
    get radiance() {
      return t.image[frame & 1];
    },
    /** This frame's normal (octahedral), distance and history length per pixel, for tools. */
    get geometry() {
      return t.geometry[frame & 1];
    },
    passes: [temporalPass, ...atrousPasses, resolvePass].map((p) => p.cs),
    resize: targets,
  };
}
