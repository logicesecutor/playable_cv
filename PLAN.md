# Playable CV — plan

Upload a CV as a PDF and it turns into a destructible 3D FPS map: every letter, icon and
rule of the page is extruded out of the floor, you drop in first-person with a gun, and the
original page becomes the minimap.

## Decisions so far

| Topic | Choice |
|---|---|
| Letters in 3D | **Smooth extruded glyphs.** The outlines are the PDF's *own* embedded glyphs (pulled out of pdf.js), so the 3D letters match the CV exactly, icons and bullets included. No substitute font. |
| Camera | **First-person.** Gun view-model in hand, the body is an invisible capsule. |
| Scale | **Cover height.** Body text is roughly chest-high (you can look and shoot over it). Bigger fonts (the name) are proportionally taller. All of it is tunable in `src/config.js`. |
| Tooling | **Vite + npm**, three.js for rendering, pdf.js for parsing. Runs fully locally. |
| Multiplayer | Not now, but world state (which letters are alive) is kept as plain data keyed by letter id, so it can be synced over a socket later. |

## How the PDF becomes geometry

1. pdf.js renders the page with `disableFontFace: true`, which makes it draw every glyph as a
   vector path instead of using a browser font.
2. During that render we temporarily swap the global `Path2D` for a recording subclass and
   wrap `ctx.fill` / `ctx.stroke`. Every draw call is captured as
   *path commands + transform matrix + colour*.
3. Fills → extruded shapes (glyphs, icons, filled boxes). Strokes → merged into straight
   segments → thin walls (the section rules of the CV).
4. Identical glyphs share one geometry (`InstancedMesh` per glyph shape), so ~1,700 letters cost
   ~150 draw calls, and each letter can still be hidden/destroyed individually.
5. The same render gives a raster of the page, used as the floor texture (the "ink" stays on
   the floor when a letter is blown up) and as the minimap.

## Milestones

Each milestone ends with something runnable.

- [x] **M1 — Scaffold + upload page.** Vite project, dark landing page, PDF picker with
      drag-and-drop, loading state.
- [x] **M2 — PDF extraction.** Glyph outlines, colours, font sizes, rules, page raster.
      Tested in Node against `example_cv.pdf`.
- [x] **M3 — 3D map + intro.** Paper floor, extruded letters, rules as walls, lighting, fog.
      Intro: camera starts top-down on the flat page, letters rise out of the paper, camera swoops
      down to eye level at the spawn point.
- [x] **M4 — Player controller.** Pointer-lock look, WASD, sprint, crouch (C), jump with coyote
      time and jump buffer, gravity, step-up (0.4 m), noclip debug fly (V). Collision uses the
      **real letter outlines** (circle vs polygon on a spatial grid), so holes in big letters are
      real spaces and you can stand on top of anything you can jump onto. Movement is a pure-JS
      core simulated headlessly by `npm run sim` (bot runs 5 min on the CV, asserts it never
      clips into a letter).
- [x] **M5 — Gun.** Low-poly view-model drawn in its own pass (never clips into letters), automatic
      hitscan fire (~630 rpm), 30-round magazine + reload (R, or auto on empty), spread that grows
      when moving/airborne and shrinks crouched, aim climb + visual punch, sway, bob, muzzle flash
      sprite + light, tracers, hit / kill markers on the crosshair. The ray walks the collision grid
      and hits the real letter sides and tops (`npm run test:ray` checks it against brute force).
- [x] **M6 — Destruction.** Letters have HP by height (body text 2 shots, the name ~7, rules 1).
      Hits: sparks, chips in the letter's colour, a wobble and a hot flash. Kills: the letter bursts
      into shards sampled from its real footprint, with gravity, spin, bounce on the paper and on
      standing letters, a dust cloud, camera shake nearby, and the ink under it is burnt off the
      paper (so the floor and the minimap both show the damage). "CV integrity" counts down.
- [x] **M7 — Audio.** Procedural Web Audio, no files: gunshot (band-passed crack + pitch-dropping
      thump + reverb tail), positional HRTF impacts and crumbles scaled to letter size, footsteps,
      landing thud, reload clicks, dry fire. M mutes.
- [x] **Fixes after first playtest.** Floor turned dark past ~7 m (the paper's depth offset let the
      desk plane win: removed, desk lowered, intro uses a near plane that scales with height
      instead). Touchpad: arrow-key aiming + F to fire, and a hint when the OS pauses the
      touchpad while typing.
- [ ] **M8 — Minimap + HUD.** Mostly done along the way (page minimap with player arrow and burn
      marks, ammo, CV integrity). Left: zoom/rotate minimap option, kill feed, end screen at 0%.
- [ ] **M9 — Polish.** Multi-page CVs (pages laid side by side), settings panel (scale, height,
      mouse sensitivity), performance pass, restart / load another CV.
- [ ] **Later — Multiplayer.** Node + WebSocket server, shared letter state, other players as
      capsules. Separate plan when we get there.

## Open questions for later

- Multi-page PDFs: pages side by side, or one level per page?
- Any win condition / score (e.g. "destroy the whole Skills section"), or pure sandbox?

## Run it

```bash
npm install
npm run dev     # opens http://localhost:5173
```

Node 18+ is needed. Node-only debug tools (Node 22.13+):
`npm run extract -- example_cv.pdf` dumps what the extractor sees;
`npm run sim -- example_cv.pdf` runs the headless movement/collision test.
