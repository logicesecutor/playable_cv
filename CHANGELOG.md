# Changelog

State of the work on the ray-traced office (plan: [PLAN.md](PLAN.md)). Newest first. Each entry:
what was done, files, how it was checked, known issues, and what comes next.

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
