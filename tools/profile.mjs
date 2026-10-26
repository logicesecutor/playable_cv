// The budget table (M9) headless: loads ?profile (every preset in turn, see src/quality.js) and prints
// the markdown table. Needs the dev server; Linux + Chrome like tools/shot.mjs. Elsewhere open
// http://localhost:5173/?profile in a browser and copy the table off the screen.
//   node tools/profile.mjs [url]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [url = "http://localhost:5173/?profile"] = process.argv.slice(2);
execFileSync("node", [new URL("./shot.mjs", import.meta.url).pathname, url, "/tmp/profile.png", "1000",
  "(async () => { while (!window.__game?.profiled) await new Promise((r) => setTimeout(r, 500)); return await __game.profiled; })()"],
{ stdio: "ignore", env: { ...process.env, EVAL_OUT: "/tmp/profile.json" } });
console.log(JSON.parse(readFileSync("/tmp/profile.json", "utf8")));
