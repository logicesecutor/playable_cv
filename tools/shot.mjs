// Load a page in headless Chrome with WebGPU, wait, print the HUD text and save a screenshot.
//   node tools/shot.mjs [url] [out.png] [waitMs]
// Chrome is driven over the DevTools protocol (Node's built-in WebSocket, no dependency).
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url = "http://localhost:5173/", out = "shot.png", wait = "5000"] = process.argv.slice(2);
const port = 9333;
const chrome = spawn("google-chrome", [
  "--headless=new", "--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=vulkan",
  "--ignore-gpu-blocklist", "--no-first-run", `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "shot-"))}`, "--window-size=1280,720", "about:blank",
], { stdio: "ignore" });

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await new Promise((r) => setTimeout(r, 200));
    target = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).then((l) => l.find((t) => t.type === "page"), () => null);
  }
  if (!target) throw new Error("Chrome did not start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); pending.delete(d.id); };
  const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;

  await send("Page.navigate", { url });
  await new Promise((r) => setTimeout(r, Number(wait)));
  console.log("gpu:", await evaluate(`navigator.gpu?.requestAdapter().then(a => a ? (a.info?.vendor + " " + a.info?.architecture) : "no adapter") ?? "no navigator.gpu"`));
  console.log("hud:", await evaluate(`document.getElementById("hud")?.textContent`));
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(out, Buffer.from(shot.result.data, "base64"));
  console.log("saved", out);
  ws.close();
} finally {
  chrome.kill();
}
