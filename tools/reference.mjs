// Capture the game's view for the Cycles comparison (M6, M8): converge the traced image with no tone
// map, export the camera, the posed player and the image, then render the same view in Blender.
//   node tools/reference.mjs [samples] [url]
// Writes /tmp/rtshots/reference.json and reference_game.png; Blender writes reference_cycles.exr /
// .png and the side-by-side blender_src/renders/compare.png.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";

const [samples = "256", url = "http://localhost:5173/?denoise=0&tm=none&ev=0"] = process.argv.slice(2);
const out = "/tmp/rtshots";
mkdirSync(out, { recursive: true });
const js = readFileSync(new URL("./reference-view.js", import.meta.url), "utf8").replace("SAMPLES", samples);
execFileSync("node", [new URL("./shot.mjs", import.meta.url).pathname, url, `${out}/reference_game.png`, "10000", js], {
  env: { ...process.env, EVAL_OUT: `${out}/reference.json` },
  stdio: "inherit",
});
execFileSync("blender", ["--background", "--factory-startup", "--python", "blender_src/scripts/render_reference.py", "--",
  `${out}/reference.json`, `${out}/reference_game.png`, out], { stdio: "inherit" });
