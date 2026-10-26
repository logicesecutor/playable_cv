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

**Linux**: Chrome gives WebGPU no GPU adapter by default (none at all, or SwiftShader, a CPU
fallback that crawls). With the dev server running, `npm run chrome` opens the game in a Chrome
with WebGPU on Vulkan (`--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan`, in its
own profile so the flags apply while your normal Chrome is open). Or set the same in
`chrome://flags`: *Unsafe WebGPU Support*, *Vulkan*, and *Choose ANGLE graphics backend* = Vulkan.

URL options: `?q=high|medium|low|auto` (quality preset; by default probed on the first visit),
`?profile` (GPU ms per pass for every preset), `?denoise=0` (converging reference), `?sun=`,
`?tm=`, `?ev=`. Keys: T per-pass GPU timings, 0–9 debug views.

Stack: Babylon.js 9 (`@babylonjs/core`), Havok (`@babylonjs/havok`), Vite 5.
