# Changelog

State of the work on the ray-traced office (plan: [PLAN.md](PLAN.md)). Newest first. Each entry:
what was done, files, how it was checked, known issues, and what comes next.

## 2026-10-26 — M9: quality presets and profiling

- **Decisions (asked)**: three presets, high (full resolution, full lighting) / medium (half
  resolution, full lighting) / low (half resolution, direct light only, 2 à-trous passes); chosen by
  a timing probe on the first visit and remembered; per-pass GPU timings toggled with T; the 3070
  budget table measured with a profile command.
- `src/quality.js`: `PRESETS`, `chosenQuality` (`?q=high|medium|low` → that preset, `?q=auto` →
  probe, else the stored one), `probe` (presets best first, mean frame time over ≥ 2 s and ≥ 5
  frames after 0.5 s; keeps the first ≤ 33.3 ms, else low; stored in localStorage), `timings`
  (G-buffer, each compute pass, view: 1 s GPU means), `profile` (every preset for 2 + 8 s, markdown
  table with the GPU name). Replaces yesterday's Intel heuristic.
- `main.js`: timestamp queries on whenever the GPU has them (Babylon only times passes created while
  they are on); `apply(preset)` sets the render scale, resizes everything, `tracer.bounces`,
  `denoiser.steps`. T shows the per-pass table (also `?timing`). `?profile` runs the presets and
  leaves the table on screen to copy, in any browser. `tools/profile.mjs` does it headless here.
- `lighting.compute.wgsl`: `options.x` switches the two bounces (a uniform: presets change at
  runtime); `denoise.js`: `steps` à-trous passes run, resolve reads the last one's output.
- **Checked** (UHD 620, headless 1280×577 window), `tools/profile.mjs`:

  | GPU ms | high | medium | low |
  |---|---:|---:|---:|
  | gbuffer | 3.13 | 1.00 | 1.00 |
  | lighting | 394.19 | 100.01 | 21.08 |
  | temporal | 7.85 | 2.11 | 2.00 |
  | à-trous 1/2/4/8/16 | 13.3/13.4/12.8/1.6/1.6 | 3.2/3.2/0.5/0.5/0.5 | 3.3/3.1/–/–/– |
  | resolve | 4.05 | 1.01 | 1.01 |
  | view | 1.70 | 0.41 | 0.42 |
  | **total** | **453.6** | **112.4** | **31.9** |
  | fps | 2.1 | 8.6 | 30.1 |
  | size | 1280×577 | 640×288 | 640×288 |

  The probe picks low on this laptop (31 fps) and stores it; `chosenQuality` checked with a fake
  localStorage (override, stored, auto, bogus value, blocked storage); the T table matches.
- Known: **RTX 3070 numbers still to measure** (open `http://localhost:5173/?profile` there,
  fullscreen at 1080p, paste the table). Medium is no longer automatic here (it misses 30 fps):
  `?q=medium` for the full lighting at ~9 fps. The probe costs a few seconds of slow frames on the
  first visit of a weak GPU; the stored preset is per browser, not per GPU (`?q=auto` re-probes).

## 2026-10-26 — Dev preview on integrated GPUs (part of M9)

- **Decisions (asked)**: on this laptop render at **half resolution with the full lighting** (~9 fps
  instead of 2.5), chosen **automatically on weak GPUs**, `?q=low|high` to override.
- `src/main.js`: the WebGPU adapter's info decides: Intel except Arc (architecture `*-hpg`) → `low`
  = `engine.setHardwareScalingLevel(2)` (every target at half the canvas, the browser upscales).
  The HUD shows the quality.
- **Checked** (UHD 620, 1280×577 window): auto picks `low` (640×288, 8–9 fps: lighting 101 ms,
  denoiser 11 ms); `?q=high` gives 1280×577 at 2.5 fps. Measured for the choice: third resolution
  15 fps, half resolution with direct light only 32 fps.
- Known: the GPU test is a vendor heuristic; M9 replaces it with measured presets.

## 2026-10-25 — M8: indirect light and reflections

- **Decisions (asked)**: RIS with 16 candidates for every light sample (replaces the all-lights
  loop); two bounce rays per pixel (cosine diffuse + GGX VNDF glossy); a sun through the windows,
  default 35° up, 20° azimuth, irradiance 30 (`?sun=elevation,azimuth,irradiance`); hit shading
  with albedo + roughness/metal textures. Asked on screenshots: exposure **0 EV** (was +1 with direct
  light only), bounce samples **capped at 10** (like Cycles' indirect clamp: no white specks).
- `lighting.compute.wgsl` (was `direct.compute.wgsl`): direct light = RIS (16 lights drawn by power
  from an alias table, weighed by the M6 estimate, one picked, one shadow ray) + the sun: a
  direction in its disc (0.53°) counts if it crosses a window pane (the first 6 lights, the
  portals) and nothing before it, so the blinds stripe it. Then one diffuse and one glossy bounce,
  each shaded at its hit with the same direct light (no emission at hits: p's light sampling
  counts it). Diffuse bounces go to the diffuse signal, glossy to the specular one: the denoiser
  is unchanged. Output clamped to finite f16 (a near-mirror at a light's peak overflowed f16 once:
  Inf → NaN → a black 8×8 square after the à-trous).
- `brdf.wgsl`: Fresnel and Smith split out; `basis`, `sampleCosine`, `sampleCone`, `sampleGlossy`
  (GGX visible normals, spherical caps, weight F·G2/G1).
- `scene.js`: per-triangle attributes in BVH order (vertex normals, UVs, a ray-cone LOD constant;
  the skinned player uses face normals), a material table (colour, roughness, metal, texture
  layer per G-buffer material id), the lights with the windows first and Vose's alias table in
  their padding. `textures.js`: albedo (linear 8-bit) and ORM texture arrays, 512², 12 layers (10
  macro sets, the player's 2 palettes, white), mips; sampled at the ray cone's LOD. The lighting
  pass binds 9 storage buffers (WebGPU's default is 8; the engine asks for the adapter's maximum).
- `?sun=`, `__game.tracer.sun`; `tools/reference.mjs` exports the sun and the local Blender script
  renders one bounce with a sun lamp, the wall behind the panes cut away (boolean) and the panes
  casting no shadow; side-by-side in `blender_src/renders/compare.png`.
- **Checked** (headless, UHD 620, 1280×577):
  - Hit shading vs the raster (primary rays shaded like secondary hits, one frame): albedo within
    ±19 % on 99.6 % of pixels (micro maps make up the rest), shading normals agree (mean dot 0.996),
    roughness within 0.2 on 99.9 %. Palette UVs and layer order right.
  - Cycles, 1 bounce + sun, indirect clamped at 10 in both, 256 vs 512 samples: mean luminance
    ×1.053 (M6 direct only: ×1.05), 8×8 blocks 77 % within 10 %, 97.9 % within 25 %. By region:
    the lit bands between the blind shadows ×1.003, the mug ×1.021, the shadowed desk and keyboard
    ×1.06, the far wall ×0.91.
  - Denoised still (12 s) vs the 256-sample `?denoise=0` reference: mean ×0.996, blocks 94 % within
    5 %, 99.1 % within 10 % (M7: 96 / 99).
  - Colour bleeding: the light arriving at the mug's foot is warmer than at its top (blue/red 0.90
    vs 0.95) with the diffuse bounce, both bluish without it (0.81 / 0.78, the sky panes).
  - The diffuse bounce adds ~8 % on the desk and doubles the light on the mug (it faces the room,
    not the panels). Reflections: on the desk just below the mug the glossy bounce adds 76 % to the
    specular signal, red 3× green (the mug in the laminate); the panels' highlights were already
    there through light sampling.
- Known: **cost on the UHD 620: lighting ~400 ms** (was 104; denoiser unchanged): each ray costs 35–65 ms here (37 ms
  for the primary shadow ray, ~64 per bounce ray, ~100 per hit's light sampling) and a pixel traces
  6–8. 2 fps; M9's low preset must cut rays (half-rate or half-resolution bounces). Desk and
  keyboard ~6 % brighter than Cycles in shadow (the M6 offset of the panels' light), the far wall
  9 % darker (not traced down). No MIS: reflections of the panels in the near-mirror ceramic rely on
  light sampling alone (noisy), and the sun only lights what sees a pane, as intended.

## 2026-10-24 — M7: denoiser

- **Decisions (asked)**: diffuse and specular denoised apart; TAA with a jittered G-buffer; history
  capped at 32 frames. The M6 accumulation stays as the reference: `?denoise=0`.
- Frame: G-buffer (jittered) → direct (one noisy sample) → temporal → 5 à-trous → resolve + TAA →
  view (exposure, AgX). Files: `src/rt/denoise.js` (textures, ping-pong, 7 dispatches),
  `denoise.wgsl` (shared params, packing), `temporal.compute.wgsl`, `atrous.compute.wgsl`,
  `resolve.compute.wgsl`, `camera.wgsl` (the jittered camera ray, now shared by direct, the BVH
  view and the denoiser).
- G-buffer: the raster is shifted every frame by a Halton (2, 3) sub-pixel offset (16 points,
  `gbuffer.jitter`, in the vertex shader; motion vectors stay unjittered). The motion target is
  rgba16f now, z = last frame's distance of the surface point from last frame's eye (the history
  check works on moving and skinned surfaces too). That is 36 colour bytes per pixel: the engine
  asks for the adapter's maximum limits (`setMaximumLimits`; WebGPU grants 32 by default).
- `direct.compute.wgsl` / `brdf.wgsl`: `brdf()` returns diffuse (without albedo and metal) and
  specular apart; the pass writes this frame's sample to `tracer.diffuse` / `tracer.specular`, or
  accumulates emission + light as in M6 with `?denoise=0` (unused outputs are 1×1).
- Temporal: reprojected over the 4 nearest last-frame pixels, a tap kept when its normal is within
  ~25° and its distance is what the motion target predicts; blend 1 / history length, capped at 32;
  luminance moments → variance (7×7 spatial estimate for the first 4 frames); anti-lag as in ReLAX:
  a fast history (blend ≥ 1/4, luminance) and the slow history's luminance clamped to the fast one's
  3×3 range (mean ± 2σ, σ at least the fast mean's own noise). Geometry packed in one rgba32f
  (octahedral normal in 2 × snorm16, distance, history length, fast luminances in 2 × f16): Intel
  allows only 4 storage textures per shader.
- À-trous: 5×5 B-spline, steps 1–16; weights from normal (cos¹²⁸), distance vs the centre's
  gradient, luminance vs 4σ (variance blurred 3×3); a step runs only while step ≤ 16 / √(history
  length), so converged pixels get steps 1 and 2. Resolve: diffuse × albedo × (1 − metal) +
  specular + emission; TAA 1:9 with the motion of the nearest surface in the 3×3, history clamped to
  the 3×3 range (mean ± 1.25σ, YCoCg), all in c / (1 + luminance).
- Measuring against the reference changed four things from plain SVGF:
  - f16 stores truncate on the Intel GPU (not round); in a 32-frame running mean that made the image
    2.3 % darker → every history (temporal output, moments, geometry, TAA) is f32.
  - Reprojecting the history by the jitter offsets resampled it every frame → blur that ate the
    figure's contact shadow (16 % too light) → no jitter in the lookup: a still pixel reads itself
    and its history is its supersampled mean, like the reference.
  - SVGF feeds the first à-trous output back as history; over 32 frames that blur compounds → the
    history is the unfiltered temporal output.
  - The anti-lag clamp first darkened still images by 1 % (a 3×3 window misses rare bright samples)
    → σ floored at the fast mean's noise from the moments.
- `?timing`: timestamp queries per compute pass, `__game.timings()` (ms, 1 s average).
  `tools/reference.mjs` loads `?denoise=0`.
- **Checked** (headless, UHD 620, 1280×577): still, 12 s after freezing, vs the 256-sample
  reference: mean luminance 0.998, 8×8 blocks 96 % within 5 %, 99 % within 10 %, the contact shadow
  under the feet within 0.3 %. Camera pans: 96–99 % of pixels keep ≥ 4 frames of history (the wrong
  motion sign would keep 65 %); three consecutive mid-pan frames clean, no boiling. Ghosting: strafe
  past the mug and stop: 1 % of pixels off by > 0.05 (tone mapped) after 0.5 s, 0.3 % after 1 s,
  0.15 % after 2 s (without anti-lag 0.8 % / 0.5 % at 1 / 2 s, a visible ghost of the contact
  shadow); no trail while moving. Jitter sign: BVH vs raster 99.6 % with the jitter ×6 (40 % with
  the sign flipped). Resize rebuilds everything; `test-bvh` passes.
- Known: **cost on the UHD 620**: direct ~104 ms, temporal 6–8, à-trous 12–14 per pass (≈ 1.7 for
  the skipped wide ones on converged pixels), resolve 4: 6–7 fps, about 40 ms of denoiser still and
  70 ms moving. The passes did not get faster with fewer texture reads or less arithmetic in tests
  (run-to-run noise ±20 %); the low preset (M9) has to cut resolution and passes. The anti-lag leaves
  a faint mark for ~1 s on this laptop (32 frames is 4.5 s at 7 fps, 0.5 s at 60). The loose bodies
  settle for up to ~30 s after load (pens in the cups), and `?denoise=0` restarts until then.
- Next: M8, indirect light and reflections.

## 2026-10-24 — M6: direct lighting

- **Decisions (asked)**: light pick weighs **all 176 emissive triangles** every sample (no light
  tree, no cut-off); the Cycles check is the **full scene** (posed figure, micro blend rebuilt in
  nodes); tone map **AgX at +1 EV** (chosen on a none/AgX/ACES × EV 0/1/2 grid,
  `blender_src/renders/m6_tonemap.png`). `?tm=none|agx|aces` and `?ev=` override.
- `src/rt/scene.js`: `lights` buffer (group 1, binding 5): every emissive triangle of the static
  office, world space, 20 floats (v0 + area, e1 + radius, e2, normal, emission), turned to face
  where its vertex normals face (one-sided). `moved`: a loose body is more than 1e-3 (u or rad,
  per matrix entry) from its pose at the last restart (resting jitter does not restart the image,
  slow creep does). `pose()`: the player's skinned triangles. `bind(cs, names)` binds only the
  buffers a shader uses (WGSL's automatic layout drops the others and binding them fails).
- `src/rt/brdf.wgsl`: GGX (α = r²) with the height-correlated Smith V and Schlick F (F0 =
  mix(0.04, albedo, metal)) + Lambert × (1 − metal)(1 − F).
- `src/rt/direct.compute.wgsl` (`src/rt/tracer.js` runs it after the G-buffer, 8×8 tiles): position
  from the ray distance; emission as is; one light by weighted reservoir over all lights (weight =
  unshadowed estimate: emission luminance × solid angle (capped at 2π) × receiver cosine widened by
  the light's angular radius × BRDF with the lobe widened to that radius, + a floor so no light is
  ever 0 where it can contribute); a uniform point on it; one any-hit shadow ray from p + n·(2e-3 +
  1e-5·t); f·Le·cos·cos′/d²·A / p(pick). Running mean in a storage buffer (sum + count per pixel),
  written as RGBA16F `radiance` (count in alpha). Restarts per pixel where the motion vector is
  > 0.01 px, everywhere on a camera move or `rt.moved`.
- `src/rt/view.js` / `view.fragment.wgsl`: mode 0 ("lit") = radiance × 2^ev, tone mapped (AgX,
  Wrensch's minimal fit; ACES, Hill's fit; none) and sRGB-encoded.
- `src/main.js`: physics in equal sub-steps of ≤ 1/60 s per frame (frame time capped at 100 ms)
  instead of Babylon's one step of the whole frame: at 10 fps the 0.1 s steps made resting bodies
  creep, which restarted the image every frame. `player.js` moves by `physics.getTimeStep()`.
- Tools: `tools/reference.mjs [samples] [url]` converges the game's view (animations frozen,
  `tools/reference-view.js` exports camera, posed figure, 8×8 block means of the linear image) and
  runs `blender_src/scripts/render_reference.py` (local): `office.glb` with every material rebuilt
  in Cycles nodes (macro set × factor, the micro blend of `surface.wgsl`, one-sided emission), the
  figure posed from the export, GGX, max bounces 0, 512 samples, Standard view; writes
  `blender_src/renders/m6_compare.png` (game | Cycles | log ratio) and block statistics.
  `tools/shot.mjs`: `EVAL_OUT` writes the eval result to a file; the Chrome profile (~200 MB) is
  deleted at the end (they filled /tmp once).
- **Checked**: Cycles vs game, 256 game samples, 1280×577: mean luminance game 0.129, Cycles 0.122
  (+5.6 %); 8×8 block ratio median 1.035, 78 % of blocks within 10 %, 98 % within 25 %; desk +5 %,
  figure +7 %, the near-black background −7 %. The remaining edges in the ratio image are
  silhouettes (sub-pixel offsets). The +5 % on lit surfaces fits the shading models: Cycles'
  Principled BSDF takes the specular layer's whole albedo out of the diffuse, ours (1 − F) per
  light, which differs most at grazing view (the camera is 2 cm above the desk). Soft figure
  shadow; 35 % of shadow rays blocked by real geometry (partitions, monitor). Walking speed checked
  in simulated time.
- Known: **9–10 fps on the UHD 620** (60 before M6): the shadow rays through the BVH are the cost
  (stack size made no difference; corrected in M8: the 176-light weighing loop was ~80 ms of the
  104, the shadow ray ~25); M9 presets. Any camera move restarts the image, so while moving it
  is 1 sample per pixel: the denoiser is M7. Babylon's frame delta under-reports time at low fps, so
  the game runs slow in wall time there. Tone map/exposure chosen without indirect light (M8).
- Next: M7, denoiser.

## 2026-10-24 — M5: BVH and scene upload

- **Decisions (asked)**: as planned: a top-level BVH over the instances rebuilt every frame (not a
  flat instance list), the static builds in a Web Worker (not on the main thread).
- `src/rt/bvh.js`: `build(boxes, leafSize = 4)` binary BVH, binned SAH (12 bins, 3 axes, leaf when
  splitting costs more and ≤ 16 primitives, median split when all centres coincide), iterative;
  `refit(nodes, boxes, order?)` bottom-up (children always come after their parent);
  `triangleBoxes`. Node = 32 B: min, first, max, count (count 0 = children at first, first + 1).
  Plain JS: runs in the page, the worker (`bvh.worker.js`) and Node.
- `src/rt/scene.js` (`createRTScene(scene, office, player, gbuffer)` → `{ stats, blases, bind(cs),
  bindings }`): 15 instances: the static office in world space (14,420 − props), the 13 loose bodies
  each in its own space, the player (2 meshes, 6,072 triangles) in world space. 20,492 triangles,
  13,583 nodes; built in the worker in ~380 ms; the traversal stack (64) is checked against the
  depth of every BLAS. Packed into 5 `StorageBuffer`s (bindings in `trace.wgsl`, group 1):
  `nodes` (links made global), `tris` (3 vec4f per triangle, BVH order), `triMaterial` (the
  G-buffer's ids), `instances` (world → object matrix, root, id; 80 B) and `tlas`.
  Every frame, before the render targets: the player skinned on the CPU (same bones and formula as
  the raster: p × Σ w·bone × world), its triangles rewritten and the BLAS refitted, both uploaded;
  instance boxes from each BLAS root box × world; the TLAS rebuilt (`build(boxes, 1)`) with the
  instances written in its order. Cost on the laptop CPU, smoothed (`rt.stats.ms`): 2.9 ms (skin 1.0,
  triangles + refit 1.25, upload 0.4, instances + TLAS 0.3).
- `src/rt/trace.wgsl`: `trace(o, d, tmax, anyHit) → Hit {t, tri, inst, uv, steps}`: the TLAS loop
  calls `traceBlas` per instance leaf with the ray in object space (not renormalised, so t is the
  same); near child first, slab test with a guarded 1/d, Möller–Trumbore.
- `src/rt/view.js` takes over the view pass from `gbuffer.js` and adds keys 8 (BVH vs raster:
  green = same distance (±0.1 %) and material, red = different, blue = only one hit) and 9 (heat
  map, nodes per ray), from `bvhview.compute.wgsl`: one camera ray per pixel, run only while those
  views are on. New side-effect import: `Engines/WebGPU/Extensions/engine.computeShader.js`.
- Bugs met:
  - Rays were flipped vertically: Babylon flips its projection when rendering into a texture, so
    NDC y grows down the pixels there (`ndc = (pixel + 0.5) / size × 2 − 1`).
  - Moving objects lagged one frame in the BVH: before the render targets, `getWorldMatrix()` is
    still last frame's (the render id only advances inside the render targets): forced
    `computeWorldMatrix(true)`. And `skeleton.prepare()` skipped the first call of a frame (it had
    seen that render id at the end of the previous frame, where the observable fires again), so the
    bones were a frame old for the raster too: `prepare(true)` in `gbuffer.js`.
  - The per-frame update was 5 ms: allocation-free skin and refit, triangle corners pre-sorted.
- **Checked**: `node tools/test-bvh.mjs`: 5,000 triangles, 100k rays: 0 mismatches against brute
  force, and 10k rays after moving every triangle + refit: 0. In the page (headless, UHD 620):
  BVH vs raster read back from the GPU: 99.6–99.8 % of pixels with the same distance and material,
  still, walking and with the mug falling (figure 99.8–99.9 %); of the rest, 2,955 of 2,962 are
  silhouette or material-border pixels, 7 are inside the figure, a few mm off. Heat map: mean 40,
  max ~120 nodes per camera ray; 51 fps with the debug trace on, 60 without. `npm run build` and
  the built page (`vite preview`) work, worker included. The walk bounce from M4 is still there
  with fresh bones (figure top moves between rows 57 and 70): it is the Walk clip.
- Known: binary BVH and a CPU-skinned player are the simple versions (a wide BVH or GPU skinning +
  refit if the 3070 profile asks for it in M9); `Hit.uv` is unused until M8.
- Next: M6, direct lighting. **Ask** first: exposure and tone map.

## 2026-10-24 — M4: G-buffer

- **Decisions (asked)**: our own WGSL material shader (not Babylon's GeometryBufferRenderer, not a
  visibility buffer); until M6 the screen shows albedo × a fake sun and sky.
- `src/rt/gbuffer.js` (`createGBuffer(scene, camera)` → `{ mrt, materials, view, resize }`):
  - One `MultiRenderTarget` (`generateDepthBuffer`, nearest, no mips, cleared to 0) with every mesh
    that has vertices in its `renderList`; it renders as a scene custom render target. The camera's
    own pass draws nothing (`camera.layerMask = 0`), so skinned meshes are not prepared by the scene:
    `skeleton.prepare()` is called before the render targets.
  - Layout, 32 B/px (WebGPU's default `maxColorAttachmentBytesPerSample`): 0 rgba8 √albedo
    (fewer bands in dark albedo) + metal; 1 rgba16f world normal + roughness; 2 rgba16f emission
    (factor × strength, e.g. panels 4) + material id; 3 r32f distance from the camera along the
    ray (0 = nothing hit); 4 rg16f motion = last uv − uv. No geometric normal: M6 offsets rays along
    the shading normal.
  - One `ShaderMaterial` per source material (MultiMaterials of the merged props mapped sub by sub),
    put on the meshes with `setMaterialForRendering` (the PBR materials stay, as the source for the
    M5 material table). Material id = 1 + index in `materials`. Office sets: albedo (sRGB buffer,
    hardware decode), normal, ORM, micro textures loaded once with `invertY: false` (glTF UVs),
    anisotropy 8; the player's palette texture comes from the glTF loader (already an sRGB buffer).
  - Motion: per mesh last frame's world matrix (set in `onBind`), last frame's view-projection, and
    for skinned meshes last frame's bones (`mPreviousBones`; bones moved from a texture to a
    uniform array, `useTextureToStoreBoneMatrices = false`; the array is bones + 1 long).
  - View pass: a WGSL `PostProcess` on the camera reads the targets with `textureLoad`; keys 0–7:
    shaded, albedo, normal, roughness/metal, emission, material id, distance, motion. The HUD shows
    the view name.
- `src/rt/gbuffer.vertex.wgsl`, `gbuffer.fragment.wgsl`: Babylon's WGSL bone includes; tangent
  frame from screen derivatives (the export has no tangents), solved exactly for dp/du, dp/dv;
  tangent-space +Y = −v (glTF images start at the top). `src/rt/surface.wgsl`: `microBlend()`, the
  M2 macro + micro blend (same formulas as `make_materials.closeup`), shared with the ray tracer.
  `src/rt/view.fragment.wgsl`: the view pass.
- `office.js` loses `previewMaterials` and `player.js` its unlit line (the G-buffer replaces both).
  New side-effect import needed: `Engines/WebGPU/Extensions/engine.multiRender.js`.
- **Checked** (headless Chrome, UHD 620 laptop): 60 fps (vsync cap); `npm run build` passes; each
  view screenshot looks right (desk normal +Y, glazed mug roughness near 0, distinct ids, distance
  gradient, emission only on the ceiling panels and the monitor); motion read back from the GPU:
  still camera → static world max 0.0002 px, the idling figure 0.15 px; walking → the world
  expands from the centre (up to 5.6 px/frame at the corners). The figure's centroid really moves
  3–16 px between frames while walking (the Walk clip bounces the body; the camera and the model
  root are steady to 1 mm), and its motion vectors follow it. Resize keeps the targets in step.
- Known / not checked: normal-map handedness is derived, not measured (the M6 Cycles comparison
  will show it); the shaded view is a stand-in; the figure's walk bounce makes the over-the-shoulder
  view bob (M3 behaviour, worth a look when you play it); no GPU timing yet (M9).
- Next: M5, the BVH and scene upload.

## 2026-10-24 — M3: scene, player and physics (raster preview)

- **Decisions (asked)**: pointer lock (click the canvas), over-the-shoulder camera, the figure
  turns to where it walks; loose props: pen, sticky notes pad, paper clips, pencil cup + its pens.
- `src/main.js`: WebGPU engine (no MSAA), right-handed scene (glTF's frame: no flip on load),
  Havok (`@babylonjs/havok`, excluded from Vite's pre-bundle in `vite.config.js` so its .wasm
  loads next to it), office, player, mug keys; HUD fps every 0.5 s; errors shown in the HUD.
  `window.__game` exposes `{scene, office, player, mug}` for the console and `tools/shot.mjs`.
  New dependency `@babylonjs/loaders` 9.32 (glTF + `ExtrasAsMetadata`: node/material extras land in
  `metadata.gltf.extras`).
- `src/scene/office.js` (`SCALE` = 90, `loadOffice`):
  - Static: every mesh but `Lights*` / `Screens*` is unparented, its transform baked, and gets a
    Havok MESH collider (mass 0).
  - Loose: nodes with extras `dynamic` → one mesh each (primitives merged), origin at the node,
    `PhysicsBody` DYNAMIC with a convex hull, or for extras `cup` = [r, h, wall, bottom, base y]
    (real m) a container: a cylinder for the bottom + 16 boxes for the wall, so pens can stand in
    the pencil cup and coffee can sit in the mug later. Mass and inertia from `shape.density` =
    the real kg/m³ in player metres (the mug is ~240 t, so the character strength is capped).
  - `reset()`: re-enables pre-step for one physics step to teleport every loose body back, at rest.
  - Preview materials until M6: unlit, macro albedo only.
- `src/scene/player.js`: `player_corporate` scaled to 1.8 u; `PhysicsCharacterController`
  (capsule 1.8 × r 0.3, mass 70, strength 700 N, step 0.35); WASD relative to the camera, Shift run
  4.5, walk 1.6, C crouch 0.8, Space jump 0.9 u; gravity added by hand in the air (`integrate()`
  only applies it to contacts); clips (Idle, Walk, Run, Jump, Crouch, CrouchWalk) cross-faded by
  weight; camera 0.6 right / 1.6 up from the feet, wheel zoom 2–10 u, pulled in by a Havok raycast.
- `src/scene/mug.js`: F = impulse of mass × `SHOVE` (7 u/s) near the rim, away from the player;
  R = `office.reset()`. Swept 5 / 7 / 9 / 12: 5 rocks back, 7+ lays the mug on its side.
- `public/models/office.glb` re-exported (14,420 tris): office split into Office_Near, Office_Room,
  Lights, Screens, Mug and 12 `Prop_*` nodes with extras `{dynamic, density[, cup]}`; the pencil
  cup is now a hollow lathe (`build_office.lathe_cup`, asserts manifold). Local scripts changed:
  `build_office.py` (props named `Prop_*`, joined per base name, origin at the bbox centre),
  `export_office_rt.py` (`DENSITY` table, cup extras).
- `tools/shot.mjs`: optional 4th argument, JS evaluated after the wait (promises awaited); page
  exceptions and console errors/warnings are printed.
- Bugs met:
  - Baked meshes kept stale bounding boxes → culled (6 of 47 meshes drawn): `refreshBoundingInfo()`.
  - Node origins came from a world matrix cached before the ×90 → container colliders inside the
    desk, bodies shot off at ~36 u/s: `computeWorldMatrix(true)`.
  - `setMassProperties({mass})` left the inertia of a unit density: replaced by `shape.density`.
- **Checked** (headless Chrome, the Intel UHD 620 laptop): 60 fps (vsync cap); all 13 loose bodies settle where
  exported (pens rest inside the cup); W for 1.5 s walks 1.9 u on the desk; F → mug up-axis 0.02
  (on its side), R → 1.0 at the export position, F again → tips again.
- Known: flat unlit look (by design until M6); the mug handle has no collider (`shortcut:` in
  `office.js`); controls feel not yet tried by hand with a mouse.
- Next: M4, the G-buffer.

## 2026-10-24 — M2: tiling PBR texture sets

- **Decision (asked)**: macro + micro layers. At 2 cm a 1080p screen shows ~26 mm of desk, so a
  crisp image needs ~70 texels per real mm; one 1024² set over a realistic 0.5 m tile gives 2/mm
  (~35× magnified), over 3 cm it repeats visibly across the desk.
- `blender_src/scripts/make_materials.py` (local, git-ignored):
  `blender --background --factory-startup --python blender_src/scripts/make_materials.py
  [-- --no-sheet]` (~20 s for the maps, ~1.5 min with the contact sheets on the laptop CPU).
  - All maps are numpy arrays (Blender's Python ships numpy 2.3): `noise()` = white noise filtered
    in the frequency domain (gaussian low-pass, optional stretch for grain / brushing, octaves),
    `strokes()` / `dots()` drawn with indices mod N then blurred periodically, sines with whole
    periods. So every map tiles by construction, and `save()` **asserts** it: the wrap-around step
    must be ≤ 2× the mean step inside the image (all 35 pass).
  - **Macro sets** (`MACRO`: tile size in real m, micro set, micro strength): laminate 0.6, wood
    0.6, carpet 0.3, fabric 0.2, paint 0.5, ceiling 0.6, plastic 0.2, metal 0.2, ceramic 0.1,
    paper 0.2. Files `public/textures/<set>_albedo.jpg` (sRGB, q92), `<set>_normal.png` (glTF
    convention: +X right, +Y up the image), `<set>_orm.png` (R 1: the ray tracer does occlusion;
    G roughness, absolute; B metal).
  - Albedo is normalised to a mean of `ALBEDO_MEAN` = 0.9 (linear) per channel: colour comes from
    the material factor = office colour / 0.9 (clamped to 1), so one set serves many colours
    (e.g. plastic for 15 materials, light and dark).
  - **Micro sets** (`MICRO`, all 0.03 m): scratches, pores, fibres, stipple, glaze, one
    `public/textures/micro_<name>.png` each in Babylon's detail-map layout: R albedo, G normal Y,
    B roughness, A normal X, 0.5 = no change. Blend (also used for the close-up sheet, and to be
    copied by the ray tracer): albedo × (1 + 2s(R−0.5)), normal xy += 2s(micro xy) (whiteout-style),
    roughness × (1 + 2s(B−0.5)), s = micro strength.
  - Contact sheets in `blender_src/renders/`: `m2_materials.png` (each macro set on a tile and a
    sphere, tinted with its office colour, a ceiling-like area light) and `m2_closeups.png` (3 cm
    of each macro set magnified + its micro set, grazing light: what the 2 cm player sees).
- **Review (asked)**: the user took my 3 notes: laminate warmer/darker with stronger grain
  (`build_office.COLORS["Laminate"]` `#cfc8b8` → `#c2b08f`, grain weight 0.55 → 0.7, darker grain
  colour), carpet softer (tuft albedo 0.10 → 0.05, normal strength 1.2 → 0.3, tufts 2.5 → 3 px),
  paint gentler (orange peel 7 → 3 px, strength 0.25 → 0.12). Checked on new sheets.
- `export_office_rt.py` now textures the office: `SETS` maps 32 of the 41 materials to a set (the
  rest stay flat: lights, screens, plant, soil, water, cork, pot, shredder slot); `textured()` sets
  base colour = colour / 0.9, roughness 1 (the map holds it), metallic = office value for metal
  else 0, and glTF **extras** `set`, `micro`, `microRepeat` (micro tiles per macro tile, e.g. 20
  on the laminate), `microStrength`; `box_uvs()` divides by the set's tile (1 UV unit = 1 tile;
  flat materials 1 m). Textures are not embedded: the game loads `public/textures/` once for both
  the raster and the ray tracer's texture arrays.
- `tools/glb-info.mjs` prints each material's set from its extras.
- **Checked**: 35 textures, every one passes the tiling assert; `glb-info`: same 14,240 tris,
  32 materials with sets and repeats as above, factors as expected (e.g. Laminate `#cbb996`,
  roughness 1).
- Known: `public/textures/` is 24 MB (normals 12.5 MB and micro 7.7 MB as PNG; albedo 1 MB,
  ORM 1.9 MB) and goes into git; GPU memory for all as rgba8 with mips ≈ 35 × 5.6 MB ≈ 195 MB.
  Unused ORM R channel. Sphere poles on the contact sheet show UV-sphere rings (sheet only). The
  close-up sheet uses grazing light, which exaggerates relief.
- Next: M3 (scene, player, physics). **Ask** first: controls and camera feel.

## 2026-10-24 — M1: office export (unbaked)

- `blender_src/scripts/export_office_rt.py` (local, git-ignored like all Blender sources):
  `blender --background --factory-startup --python blender_src/scripts/export_office_rt.py`
  (~5 s). Steps: clear the factory scene → `build_office.build()` → drop its empties
  (`CV_Anchor`, `Tray_Inner`, `Shredder_Throat`) → `trim_lights()` → hollow mug → `box_uvs()` on
  every object → `common.export_glb()` → `public/models/office.glb`.
- **Materials** are `build_office.COLORS` as they are: glTF PBR factors (colour, roughness, metal),
  emission as `emissiveFactor × KHR_materials_emissive_strength` (LightPanel 4.0, Daylight 2.87,
  Screen 0.88: colour × strength, so the max channel is below the Blender strength). No textures
  yet (M2).
- **Lights** = emissive triangles. `trim_lights()` keeps only the faces that face the room
  (LightPanel: normal −Z, Daylight: normal −X): as closed boxes, their hidden backs would take half
  the ray tracer's light samples. Result: 25 panel quads (50 tris), 3 window quads (6 tris). The
  10 monitor screens (120 tris, emission 0.88) stay boxes for now.
- **Mug** (`Mug` node, origin at the bottom centre, at (0.12, 0.74, 0.02) m in glTF Y-up):
  `build_woman.build_mug()` is a solid cylinder with a coffee disc, useless for pouring, so the
  script lathes a hollow one at the same size: r 0.04 m, h 0.1 m, wall 4 mm, bottom 6 mm,
  48 segments, plus the same torus handle; smooth with sharp edges over 40°; 768 tris. The wall is
  asserted watertight (the M10 coffee collider needs a closed shell). No coffee in it: the fluid
  is the coffee.
- **UVs**: world-scale box mapping, 1 UV unit = 1 real metre (each face uses the two world axes
  across its dominant normal), so M2's tiling textures have one scale everywhere.
- Units: real metres, glTF Y-up; the game scales ×90 in M3.
- `tools/glb-info.mjs`: `node tools/glb-info.mjs <file.glb>` prints nodes (tris, position),
  materials (colour, roughness, metal, emission, tris), primitives without UVs.
- **Checked** with `tools/glb-info.mjs`: 5 nodes (Office_Near 4,632 tris, Office_Room 8,664,
  Lights 56, Screens 120, Mug 768) = 14,240 tris, 41 materials, every primitive has UVs,
  emissive: LightPanel 50 tris, Daylight 6, Screen 120. File 1.0 MB.
- Known: 41 materials = ~55 primitives (draw calls) for the G-buffer, fine at this size; the
  plant is 2,840 tris (a fifth of the room). Not looked at in a renderer yet (M3 loads it).
- Next: M2 (tiling PBR texture sets). **Ask** first: art direction.

## 2026-10-24 — M0: cleanup and scaffold

- **Deleted** (git history and `main` keep them): `src/`, `tools/`, `docs/`, `.github/` (Pages
  deploy), `index.html`, `viewer.html`, `MOBILE.md`, the old `PLAN.md` / `README.md` /
  `package.json` / lock / `vite.config.js`, `example_cv.pdf`, `public/example_cv.pdf`,
  `public/models/{gun,office,player_engineer}.glb`. Kept: `public/models/player_corporate.glb`.
  `blender_src/` (local, git-ignored) is untouched; `office.glb` comes back unbaked in M1.
- **Moved** `engine/*` to the root: `PLAN.md`, `CHANGELOG.md`, `package.json` (renamed `rt-office`
  0.1.0), `package-lock.json`. One Vite app, no `vite.config.js` (defaults are enough so far; Havok
  will need `optimizeDeps.exclude` in M3).
- `index.html`: full-window canvas `#view`, `#hud` (fps; becomes a centred message on error).
- `src/main.js`: WebGPU check (`WebGPUEngine.IsSupportedAsync`, message if missing),
  `WebGPUEngine` (`antialias: false`: the ray tracer will do TAA; `powerPreference:
  "high-performance"`), empty scene with a placeholder `FreeCamera` (M3 replaces it), fps in the
  HUD every 0.5 s, resize. Deep imports (`@babylonjs/core/Engines/webgpuEngine.js` etc.) so only
  what is used gets bundled. `core/engine.js` / `core/hud.js` from the plan get split out of
  `main.js` when they have more than a few lines.
- Babylon's WebGPU engine only downloads glslang/twgsl (from its CDN) when a GLSL shader must be
  converted; everything we write is WGSL, so no runtime network dependency.
- `tools/shot.mjs`: `node tools/shot.mjs [url] [out.png] [waitMs]` loads a page in headless Chrome
  with WebGPU (Vulkan) over the DevTools protocol (Node's WebSocket, no dependency), prints the GPU
  adapter and the HUD text, saves a screenshot. Used for every milestone's check.
- **Checked**: `npm run build` passes (873 kB JS, 212 kB gzip: Babylon's scene core; Vite warns
  about the 500 kB chunk, fine for now). `tools/shot.mjs` on `vite preview`: adapter
  "intel gen-9", HUD "60 fps", screenshot shows the cleared canvas. With WebGPU disabled the page
  shows "This needs WebGPU: …".
- Known: `graphify-out/` (code graph, refreshed with `graphify update .`) and the root `CLAUDE.md` /
  `.claude/` are untracked and not part of this commit.
- Next: M1 (office export from Blender, unbaked).

## 2026-10-24 — Plan

- Branch `feature/babylon-engine` created from `feature/woman-lookdev`.
- `engine/` scaffold: `package.json` with `@babylonjs/core` 9.32.0, `@babylonjs/havok` 1.3.14,
  `vite` 5.4 (installed, nothing else written yet).
- All design decisions taken with the user (PLAN.md "Decisions"): Babylon + Havok, own WGSL ray
  tracer only on a raster G-buffer, RTX 3070 target with a low preset, 2 cm player at ×90 office
  scale, `player_corporate` in third person, clerk later, tiling PBR from the start, MLS-MPM coffee
  rendered as a mesh in a BVH, two-way coupling, F / R to spill / reset, old game deleted.
- Findings that shaped the plan:
  - No WebGPU hardware ray tracing in any browser (2026-10): BVH + traversal are ours.
  - `public/models/office.glb` has its light baked into `Baked_Near` / `Baked_Room` base colour
    and holds the clerk (58.6k of its 72.7k triangles): the office itself is ~14k triangles, built
    procedurally by `blender_src/scripts/build_office.py` (flat PBR materials, 25 ceiling panels
    0.58 × 1.18 m, 3 windows 1.4 × 1.3 m, room 10 × 12 × 2.8 m, desk top 0.74 m).
  - The mug is `build_woman.build_mug()` (`Prop_Mug`): r 0.04 m, h 0.1 m, coffee r 0.036 m.
  - Blender 5.2.2 is installed here (`/snap/bin/blender`), so exports run headless.
  - Babylon 9 pieces checked: `ComputeShader` (bind groups come from the WGSL auto layout: bind
    exactly what each pass uses), `StorageBuffer` with `BUFFER_CREATIONFLAG_VERTEX`, storage
    textures, `GeometryBufferRenderer`, `PhysicsCharacterController`.
- Next: M0 (cleanup + scaffold).
