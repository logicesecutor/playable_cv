import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color4 } from "@babylonjs/core/Maths/math.color.js";

const canvas = document.getElementById("view");
const hud = document.getElementById("hud");

async function main() {
  // WebGPU only: the ray tracer runs in compute shaders
  if (!(await WebGPUEngine.IsSupportedAsync)) {
    throw new Error("This needs WebGPU: a recent Chrome or Edge, or Safari 26+, on a machine with a GPU.");
  }
  const engine = new WebGPUEngine(canvas, { antialias: false, powerPreference: "high-performance" });
  await engine.initAsync();

  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.07, 0.07, 0.08, 1);
  new FreeCamera("camera", new Vector3(0, 2, -5), scene).setTarget(Vector3.Zero()); // placeholder until M3

  let hudAt = 0;
  engine.runRenderLoop(() => {
    scene.render();
    const now = performance.now();
    if (now >= hudAt) {
      hudAt = now + 500;
      hud.textContent = `${engine.getFps().toFixed(0)} fps`;
    }
  });
  addEventListener("resize", () => engine.resize());
}

main().catch((e) => {
  console.error(e);
  hud.className = "error";
  hud.textContent = e.message;
});
