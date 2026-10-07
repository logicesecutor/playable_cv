# Playable CV

Drop a PDF CV into the page and it becomes a 3D map: every letter, icon and rule is extruded
out of the paper. You land in first person among the letters with a gun, and every letter can be
shot to pieces. See [PLAN.md](PLAN.md) for the roadmap.

## Controls

| Key | |
|---|---|
| Click | capture the mouse / resume |
| WASD + mouse | move / look |
| Left mouse / touchpad click (hold) | fire |
| Arrow keys | aim with the keyboard |
| F (hold) | fire with the keyboard |
| R | reload |
| Shift | sprint |
| Space | jump (enough to climb onto body text, not onto the name) |
| C | crouch (eyes drop below body-text height: cover) |
| V | noclip fly, Q/E down/up (debug) |
| M | mute |
| I | replay the intro |
| Esc | pause |

### Playing on a laptop touchpad (Linux)

Ubuntu / GNOME switch the touchpad off while a key is held ("disable while typing"), so you can't
aim while holding W. A web page can't override that. Either aim with the arrow keys + F, or turn it
off (the game also shows a hint when it notices this):

```bash
gsettings set org.gnome.desktop.peripherals.touchpad disable-while-typing false
# undo: gsettings set org.gnome.desktop.peripherals.touchpad disable-while-typing true
```

## Run

```bash
npm install
npm run dev
```

Vite opens http://localhost:5173. Pick `example_cv.pdf` (or any text-based PDF).

- Node 18+ runs the site. Node 22.13+ is needed only for the Node debug tools (`npm run extract`, `npm run sim`)
  (pdf.js 6 requirement); on older Node, `npm install` may print an engine warning you can ignore.
- `window.__cv` in the devtools console exposes `scene`, `camera`, `world`, `config`, `player`, `collision`, `weapon`, `destruction`.

## Debug the PDF extraction (Node)

```bash
npm run extract -- example_cv.pdf
```

Writes `debug/example_cv.raster.png` (pdf.js render) and `debug/example_cv.rebuilt.png` (the page
redrawn only from the extracted outlines, with rules in red). If they match, the 3D map matches.

## Test movement headlessly (Node)

```bash
npm run sim -- example_cv.pdf
```

A bot runs, turns and jumps around the CV for 5 simulated minutes; the script fails if it ever clips
into a letter or leaves the page. Use `SEED=7 npm run sim` for a different run.

`npm run test:ray` fires 3,000 random rays and checks the grid raycast against a brute-force test of
every letter.

## Layout

```
src/
  main.js               upload screen -> loading -> game loop
  config.js             all tunables (scale, heights, speeds, intro timings)
  pdf/extract.js        pdf.js render with a recording Path2D -> glyph outlines, colours, rules, raster
  pdf/outlines.js       path commands -> polygons with holes (pure, no three.js)
  pdf/loadPdf.js        browser wiring for pdf.js + worker
  world/buildWorld.js   instanced extruded letters, rule walls, paper floor, lights, spawn point
  world/intro.js        top view -> letters rise -> camera swoop
  world/collision.js    spatial grid + circle-vs-letter-outline collision (pure JS)
  world/layout.js       letter heights, spawn point (pure JS)
  player/playerCore.js  movement simulation: accel, jump, gravity, step-up (pure JS)
  player/playerController.js  pointer lock + keys -> PlayerCore -> camera (head bob, landing dip)
  player/weapon.js      view-model, firing, spread, recoil, reload, tracers, muzzle flash
  world/destruction.js  letter HP, hit wobble, shattering, burning the ink off the paper
  fx/debris.js          instanced shards with gravity, spin, bounce on paper and letters
  fx/particles.js       sparks and dust (soft points, one draw call each)
  audio/sfx.js          procedural Web Audio: gun, impacts, crumble, steps, reload
  ui/hud.js             crosshair hit markers, ammo, CV integrity, toasts
  ui/minimap.js         page raster + player arrow
tools/extract-debug.mjs
tools/sim-player.mjs
tools/test-raycast.mjs
tools/bodies.mjs        shared Node helper: collision bodies from a PDF
```
