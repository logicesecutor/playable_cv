// Quality presets and profiling (M9). A preset sets the render scale (every target is canvas / scale,
// the browser upscales), whether the lighting traces its two bounces, and how many à-trous passes run.
// It also sets the coffee's cell size (M10). The first visit probes: presets best first, the first that holds 30 fps is kept and remembered.

export const PRESETS = {
  high: { scale: 1, bounces: true, atrous: 5, cell: 0.4 },
  medium: { scale: 2, bounces: true, atrous: 5, cell: 0.5 },
  low: { scale: 2, bounces: false, atrous: 2, cell: 0.8 }, // direct light only, ~8× fewer coffee particles
};
const STORE = "rt-office.quality";
const PROBE_MS = 1000 / 30;

/** ?q=high|medium|low, else the preset a probe remembered; null = probe (also ?q=auto). */
export function chosenQuality(url) {
  const q = url.get("q");
  if (PRESETS[q]) return q;
  if (q === "auto") return null;
  try {
    const stored = localStorage.getItem(STORE);
    return PRESETS[stored] ? stored : null;
  } catch {
    return null; // storage blocked: probe every load
  }
}

// shortcut: one remembered preset per browser, not per GPU; ?q=auto re-probes after a GPU change
export async function probe(scene, apply) {
  let name;
  for (name of Object.keys(PRESETS)) {
    apply(name);
    if ((await frameMs(scene)) <= PROBE_MS) break;
  }
  try {
    localStorage.setItem(STORE, name);
  } catch {
    // not remembered: the next load probes again
  }
  return name;
}

// mean frame time over ≥ 2 s and ≥ 5 frames, after 0.5 s for the new targets and the restarted history
function frameMs(scene) {
  return new Promise((resolve) => {
    const start = performance.now();
    let first = 0, n = 0;
    const observer = scene.onAfterRenderObservable.add(() => {
      const now = performance.now();
      if (now - start < 500) return;
      if (!first) first = now;
      else if (++n >= 5 && now - first >= 2000) {
        scene.onAfterRenderObservable.remove(observer);
        resolve((now - first) / n);
      }
    });
  });
}

/** GPU ms per pass, 1 s means from timestamp queries (0 where the GPU has none). */
export function timings(engine, gbuffer, passes) {
  const ms = (c) => +((c?.counter.lastSecAverage ?? 0) / 1e6).toFixed(2);
  return {
    gbuffer: ms(gbuffer.mrt.renderTarget?.gpuTimeInFrame),
    ...Object.fromEntries(passes.map((cs) => [cs.name, ms(cs.gpuTimeInFrame)])),
    view: ms(engine.gpuTimeInFrameForMainPass),
  };
}

/** Every preset for 2 + `seconds` s each (fps over the last `seconds`); the budget table as markdown (passes × presets). */
export async function profile(engine, apply, measure, seconds = 8) {
  const columns = {};
  for (const name of Object.keys(PRESETS)) {
    apply(name);
    await new Promise((r) => setTimeout(r, 2000)); // new targets, restarted history, queued frames
    const t0 = performance.now(), f0 = engine.frameId;
    await new Promise((r) => setTimeout(r, seconds * 1000));
    const t = measure();
    columns[name] = {
      ...t,
      total: +Object.values(t).reduce((s, x) => s + x, 0).toFixed(2),
      fps: +((1000 * (engine.frameId - f0)) / (performance.now() - t0)).toFixed(1),
      size: `${engine.getRenderWidth()}×${engine.getRenderHeight()}`,
    };
  }
  const names = Object.keys(columns);
  const rows = [...new Set(names.flatMap((n) => Object.keys(columns[n])))];
  const gpu = engine.getInfo();
  return [`GPU: ${gpu.vendor} ${gpu.renderer} ${gpu.version}`, "", `| GPU ms | ${names.join(" | ")} |`, `|---|${names.map(() => "---:").join("|")}|`,
    ...rows.map((r) => `| ${r} | ${names.map((n) => columns[n][r] ?? "–").join(" | ")} |`)].join("\n");
}
