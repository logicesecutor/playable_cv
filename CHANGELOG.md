# Changelog

State of the work on the ray-traced office (plan: [PLAN.md](PLAN.md)). Newest first. Each entry:
what was done, files, how it was checked, known issues, and what comes next.

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
