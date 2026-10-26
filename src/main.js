import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color4 } from "@babylonjs/core/Maths/math.color.js";
import "@babylonjs/core/Physics/joinedPhysicsEngineComponent.js";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin.js";
import HavokPhysics from "@babylonjs/havok";
import { loadOffice } from "./scene/office.js";
import { createPlayer } from "./scene/player.js";
import { mugControls } from "./scene/mug.js";
import { createGBuffer } from "./rt/gbuffer.js";
import { createRTScene } from "./rt/scene.js";
import { createView } from "./rt/view.js";
import { createTracer } from "./rt/tracer.js";
import { createDenoiser } from "./rt/denoise.js";
import { PRESETS, chosenQuality, probe, profile, timings as passTimes } from "./quality.js";

const canvas = document.getElementById("view");
const hud = document.getElementById("hud");
const table = document.getElementById("timings");
const HINT = "click to play · WASD move · Shift run · Space jump · C crouch · F shove the mug · R reset · 0–9 views · T timings";
const SPAWN = new Vector3(2, 67.6, -6); // on the desk between the keyboard and the monitor (desk top y 66.6)

async function main() {
  // WebGPU only: the ray tracer runs in compute shaders
  if (!(await WebGPUEngine.IsSupportedAsync)) {
    throw new Error("This needs WebGPU: a recent Chrome or Edge, or Safari 26+, on a machine with a GPU.");
  }
  const url = new URLSearchParams(location.search);
  const engine = new WebGPUEngine(canvas, {
    antialias: false,
    powerPreference: "high-performance",
    setMaximumLimits: true, // the G-buffer needs 36 colour bytes per pixel; WebGPU grants 32 unless asked
    enableAllFeatures: true, // timestamp queries, for the T table and the probe-free profile
  });
  await engine.initAsync();
  // on from the start where supported: Babylon only gives passes created while it is on a GPU timer
  engine.enableGPUTimingMeasurements = !!engine.getCaps().timerQuery;

  const scene = new Scene(engine);
  scene.useRightHandedSystem = true; // glTF's frame: no flip on load, the ray tracer works in it too
  scene.clearColor = new Color4(0.07, 0.07, 0.08, 1);
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, await HavokPhysics()));
  // Babylon steps physics once per frame by the whole frame time; at 10 fps a 0.1 s step lets resting
  // bodies creep. Equal sub-steps of ≤ 1/60 s that add up to the frame time instead: smooth at any
  // frame rate, stable at low ones. The step length is left in getTimeStep() for the player.
  const physics = scene.getPhysicsEngine();
  scene._advancePhysicsEngineStep = (ms) => {
    ms = Math.min(ms, 100); // a hitch is not simulated in full
    const n = Math.max(1, Math.ceil(ms / (1000 / 60)));
    physics.setTimeStep(ms / n / 1000);
    for (let i = 0; i < n; i++) {
      scene.onBeforePhysicsObservable.notifyObservers(scene);
      physics._step(ms / n / 1000);
      scene.onAfterPhysicsObservable.notifyObservers(scene);
    }
  };

  const office = await loadOffice(scene);
  const player = await createPlayer(scene, canvas, SPAWN, office.mug.mesh.position);
  const mug = mugControls(office, player);
  const gbuffer = createGBuffer(scene, player.camera);
  const rt = await createRTScene(scene, office, player, gbuffer);
  // ?denoise=0: the reference, accumulated while still (M6), instead of the denoised image
  const reference = url.get("denoise") === "0";
  // ?sun=elevation,azimuth,irradiance (degrees, degrees, W/m²-like units of the scene's emission)
  const [elevation, azimuth, irradiance] = (url.get("sun") ?? "35,20,30").split(",").map(Number);
  const tracer = createTracer(scene, player.camera, gbuffer, rt, reference, { elevation, azimuth, irradiance });
  const denoiser = reference ? null : createDenoiser(scene, player.camera, gbuffer, tracer);
  const view = createView(scene, player.camera, gbuffer, rt, denoiser ?? tracer);
  // GPU ms per pass, 1 s means
  const timings = () => passTimes(engine, gbuffer, [...tracer.passes, ...(denoiser?.passes ?? [])]);

  const resize = () => {
    engine.resize();
    gbuffer.resize();
    tracer.resize();
    denoiser?.resize();
    view.resize();
  };
  addEventListener("resize", resize);
  let quality = "probing";
  const apply = (name) => {
    const p = PRESETS[name];
    quality = name;
    engine.setHardwareScalingLevel(p.scale);
    resize();
    tracer.bounces = p.bounces;
    if (denoiser) denoiser.steps = p.atrous;
  };

  // ?timing: the table shown from the start; T toggles it
  table.hidden = !url.has("timing");
  addEventListener("keydown", (e) => e.code === "KeyT" && (table.hidden = !table.hidden));
  let hudAt = 0;
  let report = null; // the ?profile result, kept on screen
  engine.runRenderLoop(() => {
    scene.render();
    const now = performance.now();
    if (now >= hudAt) {
      hudAt = now + 500;
      hud.textContent = `${engine.getFps().toFixed(0)} fps · ${quality} · ${view.name} · ${HINT}`;
      if (!table.hidden && !report) {
        const t = timings(), total = Object.values(t).reduce((s, x) => s + x, 0);
        table.textContent = engine.enableGPUTimingMeasurements
          ? `GPU ms, 1 s mean · ${engine.getRenderWidth()}×${engine.getRenderHeight()}\n` +
            Object.entries(t).map(([k, v]) => `${k.padEnd(10)} ${v.toFixed(2).padStart(7)}`).join("\n") +
            `\n${"total".padEnd(10)} ${total.toFixed(2).padStart(7)}  (60 fps: 16.67)`
          : "no GPU timestamps on this browser/GPU";
      }
    }
  });

  // ?profile: every preset in turn, the budget table on screen (and in __game.profiled)
  const profiled = url.has("profile") ? profile(engine, apply, timings) : null;
  window.__game = { scene, office, player, mug, gbuffer, rt, tracer, denoiser, view, timings, profiled, apply }; // for the console and tools/
  if (profiled) {
    table.hidden = false;
    report = await profiled;
    console.log(report);
    table.textContent = `${report}\n\n(select and copy)`;
    table.style.pointerEvents = "auto";
    return;
  }
  const chosen = chosenQuality(url);
  if (chosen) apply(chosen);
  else apply(await probe(scene, apply));
}

main().catch((e) => {
  console.error(e);
  hud.className = "error";
  hud.textContent = e.message;
});
