# Graph Report - playable_cv  (2026-10-26)

## Corpus Check
- 26 files · ~865,958 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 25 file(s) not represented in the graph (top: .wgsl 22, .glb 2, (none) 1)

## Summary
- 196 nodes · 291 edges · 12 communities (9 shown, 3 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.95)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `81f7a134`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- mpm.js
- scene.js
- main
- glb-info.mjs
- test-bvh.mjs
- main.js
- main
- package.json
- Milestones
- CLAUDE.md

## God Nodes (most connected - your core abstractions)
1. `main()` - 18 edges
2. `createRTScene()` - 17 edges
3. `Milestones` - 16 edges
4. `Changelog` - 15 edges
5. `@babylonjs/core` - 12 edges
6. `Ray-traced office — plan` - 8 edges
7. `build()` - 7 edges
8. `scripts` - 5 edges
9. `createFluid()` - 5 edges
10. `probe()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `2026-10-24 — M0: cleanup and scaffold` --references--> `main()`  [INFERRED]
  CHANGELOG.md → src/main.js
- `Decisions` --references--> `main()`  [INFERRED]
  PLAN.md → src/main.js
- `Ray-traced office` --references--> `main()`  [INFERRED]
  README.md → src/main.js
- `2026-10-24 — M3: scene, player and physics (raster preview)` --references--> `reset()`  [INFERRED]
  CHANGELOG.md → src/fluid/mpm.js
- `Ray-traced office — plan` --references--> `main()`  [INFERRED]
  PLAN.md → src/main.js

## Import Cycles
- None detected.

## Communities (12 total, 3 thin omitted)

### Community 0 - "mpm.js"
Cohesion: 0.10
Nodes (11): 2026-10-24 — M3: scene, player and physics (raster preview), @babylonjs/loaders, BINDINGS, BOX, createFluid(), reset(), DESK, cupShape() (+3 more)

### Community 1 - "scene.js"
Cohesion: 0.20
Nodes (18): refit(), corner(), createRTScene(), depth(), emitters(), gather(), NAMES, packedBoxes() (+10 more)

### Community 2 - "main"
Cohesion: 0.12
Nodes (14): 2026-10-24 — M0: cleanup and scaffold, 2026-10-24 — M1: office export (unbaked), 2026-10-24 — M2: tiling PBR texture sets, 2026-10-24 — M4: G-buffer, 2026-10-24 — M6: direct lighting, 2026-10-24 — M7: denoiser, 2026-10-24 — Plan, 2026-10-25 — M8: indirect light and reflections (+6 more)

### Community 3 - "glb-info.mjs"
Cohesion: 0.12
Nodes (9): b, j, perMaterial, [url = "http://localhost:5173/?profile"], js, [samples = "256", url = "http://localhost:5173/?denoise=0&tm=none&ev=0&q=high"], chrome, profile (+1 more)

### Community 4 - "test-bvh.mjs"
Cohesion: 0.16
Nodes (19): 2026-10-24 — M5: BVH and scene upload, area(), build(), grow(), triangleBoxes(), bad, boxEntry(), bvh (+11 more)

### Community 7 - "main.js"
Cohesion: 0.07
Nodes (20): @babylonjs/core, canvas, hud, SPAWN, table, createDenoiser(), STEPS, createGBuffer() (+12 more)

### Community 8 - "main"
Cohesion: 0.21
Nodes (14): 2026-10-26 — M9: quality presets and profiling, Architecture, Decisions, Performance budget (RTX 3070, 1080p, 16.6 ms), Ray-traced office — plan, Risks, What it looks like (target of the last milestone), main() (+6 more)

### Community 14 - "package.json"
Cohesion: 0.11
Nodes (18): dependencies, @babylonjs/core, @babylonjs/havok, @babylonjs/loaders, description, devDependencies, vite, name (+10 more)

### Community 32 - "Milestones"
Cohesion: 0.12
Nodes (16): Later (not planned in detail), M0 — Cleanup and scaffold, M10 — Coffee simulation (MLS-MPM), M11 — Two-way coupling, M12 — Coffee mesh and its BVH, M13 — Coffee material, M1 — Office export (geometry, lights, mug), M2 — Tiling PBR texture sets (+8 more)

## Knowledge Gaps
- **1 isolated node(s):** `vite`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 104 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `main()` connect `main` to `mpm.js`, `scene.js`, `main`, `main.js`?**
  _High betweenness centrality (0.237) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `main()` (e.g. with `2026-10-24 — M0: cleanup and scaffold` and `Decisions`) actually correct?**
  _`main()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `vite` to the rest of the system?**
  _1 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `mpm.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09782608695652174 - nodes in this community are weakly interconnected._
- **Why does `@babylonjs/core` connect `main.js` to `mpm.js`, `scene.js`, `package.json`?**
  _High betweenness centrality (0.173) - this node is a cross-community bridge._
- **Should `main` be split into smaller, more focused modules?**
  _Cohesion score 0.125 - nodes in this community are weakly interconnected._
- **Why does `Ray-traced office — plan` connect `main` to `Milestones`, `main`?**
  _High betweenness centrality (0.172) - this node is a cross-community bridge._