# Ray-traced office — plan

A new game, built from scratch for the web with performance in mind: a **2 cm toy figure on a
giant office desk**, everything lit and shaded by **our own WebGPU ray tracer**, rigid bodies with
**Havok**, and a **coffee mug that spills in real time** (MLS-MPM fluid, meshed and ray traced).
Gameplay comes later; this plan covers the tech up to a playable tech demo.

Branch: `feature/babylon-engine` (from `feature/woman-lookdev`). Local commits only, one per
milestone (or sub-step), never pushed. State of the work: [CHANGELOG.md](CHANGELOG.md).
**This branch is never merged into `main`**: M0 deletes the CV game (and its Pages deploy), so a
merge would take that game offline. The new game moves to its own repository, or replaces `main`
only by an explicit decision.

## Decisions

| Topic | Choice | Asked |
|---|---|---|
| Engine | **Babylon.js 9 (WebGPU) + Havok** (`@babylonjs/core` 9.32, `@babylonjs/havok` 1.3.14, Vite 5.4). Babylon gives the engine loop, glTF loading, the G-buffer raster, the character controller and compute-shader plumbing; the lighting is ours. | 2026-10-24 |
| Ray tracing | **Own WGSL compute ray tracer only**: no Babylon lights, no screen-space tricks. Browsers ship no hardware RT (no acceleration structures in WebGPU as of 2026-10), so BVHs and traversal are ours, in compute shaders. | 2026-10-24 |
| Primary visibility | **Raster G-buffer + RT**: Babylon rasterizes position/normal/material/motion; every light path (shadows, GI, reflections, refraction) is traced from it. The coffee is the exception: its primary hit is traced too (see M12). | 2026-10-24 |
| Target hardware | **Discrete GPU (RTX 3070 class): 60 fps at 1080p.** Fallback preset for integrated GPUs (the dev laptop's UHD 620): the same ray tracer at lower settings (below). | 2026-10-24 |
| Scale | **The player is a ~2 cm toy figure**: world units are the player's metres (figure 1.8 u tall), the office is scaled **×90** around them (desk top 66.6 u up, mug 9 u tall, room 900 × 1080 × 252 u). Physics and fluid run in these units with g = 9.81, so the mug falls and the coffee moves like a 9 m tall mug of liquid: a giant, slow tsunami. | 2026-10-24 |
| Player | **`player_corporate.glb`** (6k triangles, palette texture, 9 clips: Idle, Walk, Run, Jump, Crouch, CrouchWalk, Fire, Reload, Death). **Third-person** camera. | 2026-10-24 |
| Clerk | **Not now**: comes back once the ray tracer handles a 58k-triangle skinned mesh. | 2026-10-24 |
| Office materials | **Tiling PBR texture sets from the start** (wood/laminate, carpet, wall paint, ceiling tile, plastics, metal, ceramic, paper), made in Blender, no baked light. | 2026-10-24 |
| Fluid | **Coffee mug spill on the desk**, **MLS-MPM** solver in WGSL, rendered as a **mesh in a BVH** (GPU marching cubes + GPU LBVH every frame), **two-way coupled** with the rigid bodies and the player (forces read back from the GPU 1 frame late). | 2026-10-24 |
| Spill trigger | **Key press + reset**: `F` shoves the mug (Havok impulse), `R` refills it and stands it up. | 2026-10-24 |
| Cleanup | **The old CV game is deleted on this branch** (code, docs, tools, models except `player_corporate.glb`), the new game lives at the repo root. `main` and git history keep everything. | 2026-10-24 |

## What it looks like (target of the last milestone)

You stand next to the mug, 2 cm tall, on a wood-laminate desk that stretches 144 × 72 u to the
edges; the room is kilometres wide around you, lit by 25 fluorescent ceiling panels and 3 windows.
Every pixel's light is traced: soft area shadows of the panels, light bouncing off the desk onto
the mug, glossy reflections of the panels in the laminate and the ceramic. Press `F`: the mug tips,
~150k particles of coffee pour out as a wave several metres high, flow around the figure, push it
over, float a paper clip, and the brown liquid refracts and reflects the room. `R` resets.

## Architecture

```
index.html, vite.config.js, package.json          one Vite app at the root
src/main.js                 boot: capability check, quality preset, scene, loop
src/core/engine.js          WebGPUEngine + features (timestamp-query), preset (high / low)
src/core/hud.js             fps, per-pass GPU timings, debug-view picker
src/scene/office.js         office.glb at ×90, static colliders, light list (from emissive triangles)
src/scene/player.js         player_corporate, Havok character controller, clips, 3rd-person camera
src/scene/mug.js            the mug rigid body, F / R
src/rt/gbuffer.js           MRT raster: albedo, normal, ORM + material id, depth, motion
src/rt/scene.js             packs triangles, materials, texture arrays and lights for the GPU
src/rt/bvh.js               CPU SAH BVH build (worker) + TLAS of instances; refit for the player
src/rt/tracer.js            the compute passes: direct, GI, reflections, refraction
src/rt/denoise.js           temporal accumulation + à-trous (SVGF-style), TAA, tone map
src/rt/*.wgsl               shaders (imported with ?raw)
src/fluid/mpm.js            MLS-MPM: P2G, grid update, G2P, colliders (*.wgsl)
src/fluid/couple.js         collider forces → async readback → Havok
src/fluid/mesh.js           marching cubes on the GPU (indirect counts)
src/fluid/lbvh.js           GPU BVH: Morton codes, radix sort, Karras tree, bottom-up AABBs
tools/test-bvh.mjs          node: CPU BVH traversal vs brute force
blender_src/scripts/        export_office_rt.py, make_materials.py (local, git-ignored like today)
```

**Frame**: Havok step (CPU) → MPM substeps (GPU) → fluid mesh + LBVH (GPU) → G-buffer (raster)
→ coffee primary hits (RT) → direct light (RT) → GI + reflections + refraction (RT) → denoise
→ TAA + tone map → HUD. All GPU work is in one command stream; the only readback is the
coupling forces (async, never stalls).

**GPU data** (WebGPU has no bindless textures): all tiling PBR maps share one size and go into
three `texture_2d_array`s (albedo, normal, ORM) indexed by material; the mip level is picked by
ray cone width (compute shaders have no derivatives). Triangles: positions in one buffer,
normals/UVs/material in another; BVH nodes 32 B (AABB + child/first-tri + count).

**Lights** are emissive surfaces (panel quads, window panes, later screens), stored as a list for
next-event estimation. Radiance is scale-invariant, so the ×90 scale changes nothing in lighting.

**Precision**: the room is ~1000 u across; f32 gives ~6e-5 u at that range, so ray offsets of
1e-3 u (0.01 mm real) are safe.

## Performance budget (RTX 3070, 1080p, 16.6 ms)

| Pass | ms | Notes |
|---|---|---|
| G-buffer raster | 1.0 | ~25k triangles + player |
| Direct light (1 shadow ray / px) | 2.0 | NEE over ~30 area lights |
| GI 1 bounce + glossy reflection (1 ray each / px) | 4.0 | material + texture fetch at the hit |
| Denoise + TAA + tone map | 2.0 | 4–5 à-trous passes |
| MLS-MPM (≈150k particles, 2 substeps) | 3.0 | |
| Marching cubes + LBVH | 2.0 | grid ~144×24×72 cells around the spill |
| Coffee rays (primary + refraction) | 1.5 | only where the coffee is |
| Slack | 1.1 | |

**Low preset** (integrated GPUs): RT at 50 % resolution + upscale, direct light only (no GI),
mirror-only reflections on the smoothest surfaces, 2 à-trous passes, ~30k particles on a coarser
grid. Picked automatically (adapter info + a 2-second timing probe), overridable with `?q=high|low`.

## Milestones

Each one ends runnable, is checked (test or screenshot), logged in CHANGELOG.md and committed
locally. Questions marked **Ask** are put to you before that milestone starts.

### M0 — Cleanup and scaffold
- Delete `src/`, `tools/`, `docs/`, `viewer.html`, `index.html`, `MOBILE.md`, the old `PLAN.md`,
  `example_cv.pdf`, `.github/` (Pages deploy), `public/example_cv.pdf`, `public/models/` except
  `player_corporate.glb`; old `package.json` / lock / `vite.config.js` replaced. Move `engine/*` to
  the root. README rewritten for the new project.
- `WebGPUEngine` boot with a clear message when WebGPU is missing; HUD with fps; empty scene.
- **Check**: `npm run dev` shows the empty scene; `npm run build` passes.

### M1 — Office export (geometry, lights, mug)
- `export_office_rt.py`: runs `build_office.build()` without the bake, keeps real materials, adds
  a hollow mug (same size as `build_woman.build_mug()`, whose mug is solid) as its own node, keeps
  only the room-facing faces of the light panels and windows, exports `public/models/office.glb`. No CV
  page, no clerk. No separate light list: the game builds it at load from the triangles whose
  material has emission > 0 (panels, windows, later screens), so it can never drift from the mesh.
- Generates UVs for tiling: world-scale box mapping (texture repeats by real size, so the grain
  has the same scale everywhere).
- **Check**: node script prints nodes, materials, triangle count and the emissive meshes (25 panels
  + 3 windows).

### M2 — Tiling PBR texture sets
- `make_materials.py`: procedural Blender materials baked to tiling 1024² maps (albedo, normal,
  ORM): desk laminate, carpet, wall paint, ceiling tile, light plastic, dark plastic, metal, mug
  ceramic, paper, door wood. Texture arrays need one size for all.
- Exported as KTX2 (Basis) if the encoder is available, else JPEG/PNG.
- **Ask**: art direction (realistic office vs slightly stylized, colours of the desk and mug) with
  a contact sheet of the sets before they go in.
- **Check**: contact-sheet render of every set on a sphere and a flat tile.

### M3 — Scene, player and physics (raster preview)
- Office at ×90 with static Havok mesh colliders; the mug as a dynamic body (cylinder + handle
  compound); a few props (paper clip, pen, sticky note).
- Player: `player_corporate` with `PhysicsCharacterController`, walk/run/jump/crouch, clip
  blending, third-person orbit camera with collision. Keys: WASD, Shift, Space, C, F, R.
- Temporary unlit albedo view (the RT replaces it in M6).
- **Ask**: controls and camera feel (distance, shoulder offset, mouse vs pointer lock).
- **Check**: walk the desk, F knocks the mug over, R resets; fps logged.

### M4 — G-buffer
- MRT pass: albedo (rgba8), world normal + roughness (rgba16f), metal + material id + emissive,
  linear depth, motion vectors. Debug views on keys 1–6.
- **Check**: each debug view screenshot looks right; motion vectors are zero when still.

### M5 — BVH and scene upload
- CPU binned-SAH BVH in a worker for every static mesh; one TLAS over instances (office, mug,
  props, player) rebuilt each frame on the CPU (a handful of instances); the player skinned on the
  CPU and its BLAS refitted every frame (6k triangles). The CPU skin uses the same bone matrices as
  the raster, taken after Babylon's animation update in the same frame, so the BVH copy of the body
  lines up with the drawn one (else shadow rays start inside it and speckle the figure).
- WGSL traversal (stack-based, nearest hit + any hit for shadows).
- **Check**: `tools/test-bvh.mjs`: 100k random rays, BVH result = brute force; a GPU debug view
  that shows the BVH hit distance and the traversal heat map; in M6, a running player shows no
  self-shadow speckles.

### M6 — Direct lighting
- From the G-buffer: GGX specular + Lambert diffuse, NEE over the area lights (pick by power and
  distance, sample a point on the quad), one shadow ray per pixel; emissive surfaces shown as
  emission. Accumulates when the camera is still (reference image for later).
- **Ask**: exposure and tone map (AgX vs ACES) on screenshots.
- **Check**: the converged still matches a Cycles render of the same view in Blender (same lights,
  same materials) side by side.

### M7 — Denoiser
- Temporal reprojection with depth/normal rejection, variance estimate, 4–5 à-trous passes
  (separate diffuse and specular), TAA, tone map.
- **Check**: moving camera shows no boiling noise; ghosting test by walking past a dark object.

### M8 — Indirect light and reflections
- 1 diffuse bounce (NEE at the hit), glossy reflections (GGX VNDF sampling), sky/daylight from the
  windows; texture fetch at secondary hits through the texture arrays.
- **Check**: colour bleeding of the laminate onto the mug; the panels reflected in the desk; Cycles
  comparison again.

### M9 — Quality presets and profiling
- GPU timestamp per pass in the HUD, the low preset, auto-detection, `?q=` override.
- **Check**: budget table above measured on the 3070 and on the UHD 620, written to CHANGELOG.

### M10 — Coffee simulation (MLS-MPM)
- WGSL: clear grid, P2G (fixed-point atomics), grid update (gravity, boundaries: desk plane, mug
  interior/exterior as an SDF in the mug's frame, player capsule, props as boxes), G2P; collider
  transforms and velocities uploaded per frame. The coffee starts at rest inside the mug; R
  refills it. Particles that leave the grid box through its sides or bottom are removed (counted in
  the HUD): the coffee falls off the desk instead of piling up against the box edge.
- Debug view: particles as points (raster), coloured by speed.
- **Ask**: fill level and resolution (particle count vs look) on the 3070.
- **Check**: the mug at rest holds its coffee for 60 s without leaking; a tipped mug empties in a
  plausible time; a spill that reaches the desk edge flows over it; particle count and ms in the
  HUD.

### M11 — Two-way coupling
- Grid-to-collider momentum exchange: force and torque per collider summed on the GPU (fixed-point
  atomics), copied to a map-able buffer, read back asynchronously, applied in Havok one frame
  later (the mug gets lighter as it empties, the figure is pushed by the wave, props float).
- **Check**: an empty mug pushed into standing coffee floats; the figure standing in the wave
  is moved; no explosion when a collider is teleported (R).

### M12 — Coffee mesh and its BVH
- Density grid → smoothed → marching cubes on the GPU (vertex/index buffers with indirect
  counts) → GPU LBVH (Morton codes, radix sort, Karras hierarchy, bottom-up AABBs).
- The coffee is traced as a second structure next to the TLAS (nearest of both); its primary
  hits are traced per pixel and, when nearer, are written back into the G-buffer (normal, depth,
  material, motion from camera reprojection) before the lighting passes, so lighting and the
  denoiser treat the coffee like any surface (no ghost trails when the camera moves).
- **Check**: debug view of the mesh normals; LBVH validated against brute force on a GPU readback
  of a few thousand rays.

### M13 — Coffee material
- Dielectric (IOR 1.34), Fresnel reflection + refraction rays, Beer–Lambert absorption (coffee
  brown), shadows of the liquid on the desk; the denoiser gets a refraction channel.
- **Ask**: the coffee's colour/opacity (black coffee vs latte) on screenshots.
- **Check**: tech-demo capture: spill, wave, reset, fps on both presets.

### Later (not planned in detail)
The clerk back (skinned 58k-triangle BLAS refit on the GPU), gameplay, audio, mobile, a deploy
target (the Pages workflow is removed in M0).

## Risks

| Risk | Plan |
|---|---|
| 60 fps with RT + fluid on a 3070 | Per-pass budget measured from M6 on; GI rays at half resolution if needed; MPM substeps adaptive. |
| Texture arrays need one size and format for all sets | Decided in M2: all 1024², same format. |
| GPU LBVH + marching cubes every frame is the hardest part | Its own milestone with a brute-force check; fallback: rebuild the coffee BVH every 2nd frame. |
| No dev GPU here: the laptop is a UHD 620, the 3070 is elsewhere | Develop against the low preset here; each milestone's high-preset numbers measured on the 3070 when available. |
| WebGPU only (no WebGL fallback) | Accepted: the ray tracer needs compute; the boot screen says so. |
| Fluid scale (coffee in player units is ~300 m³ for a full mug) | ~2-unit grid cells; fill level and particle budget tuned in M10. |
