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

const canvas = document.getElementById("view");
const hud = document.getElementById("hud");
const HINT = "click to play · WASD move · Shift run · Space jump · C crouch · F shove the mug · R reset · 0–9 views";
const SPAWN = new Vector3(2, 67.6, -6); // on the desk between the keyboard and the monitor (desk top y 66.6)

async function main() {
  // WebGPU only: the ray tracer runs in compute shaders
  if (!(await WebGPUEngine.IsSupportedAsync)) {
    throw new Error("This needs WebGPU: a recent Chrome or Edge, or Safari 26+, on a machine with a GPU.");
  }
  const engine = new WebGPUEngine(canvas, { antialias: false, powerPreference: "high-performance" });
  await engine.initAsync();

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
  const tracer = createTracer(scene, player.camera, gbuffer, rt);
  const view = createView(scene, player.camera, gbuffer, rt, tracer);
  window.__game = { scene, office, player, mug, gbuffer, rt, tracer, view }; // for the console and tools/shot.mjs

  let hudAt = 0;
  engine.runRenderLoop(() => {
    scene.render();
    const now = performance.now();
    if (now >= hudAt) {
      hudAt = now + 500;
      hud.textContent = `${engine.getFps().toFixed(0)} fps · ${view.name} · ${HINT}`;
    }
  });
  addEventListener("resize", () => {
    engine.resize();
    view.resize();
  });
}

main().catch((e) => {
  console.error(e);
  hud.className = "error";
  hud.textContent = e.message;
});
