# Ray-traced office

A ~2 cm toy figure on a giant office desk, rendered in the browser by our own WebGPU ray tracer
(compute shaders on a raster G-buffer), with Havok rigid bodies and a coffee mug that spills in
real time (MLS-MPM fluid, meshed and ray traced). Gameplay comes later.

- Plan, decisions and milestones: [PLAN.md](PLAN.md)
- State of the work: [CHANGELOG.md](CHANGELOG.md)

This branch (`feature/babylon-engine`) replaced the old CV game, which lives on in `main` and the
git history. **Never merge this branch into `main`** (see PLAN.md).

## Run

Needs WebGPU: a recent Chrome or Edge, or Safari 26+. Target: an RTX 3070-class GPU at 1080p.

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # static build in dist/
```

Stack: Babylon.js 9 (`@babylonjs/core`), Havok (`@babylonjs/havok`), Vite 5.
