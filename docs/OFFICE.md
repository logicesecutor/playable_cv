# The office

The CV no longer floats in the dark: it lies in a black letter tray on the desk of a giant office
worker, in an open-plan office modelled at real scale. She types, sips her coffee, glances down at
the players, and (on a dev key for now) picks the CV up and feeds it into a paper shredder. Later the
shredding will shrink the playable area; today the office is **environment only**: 3D assets,
baked lighting, her animation and an ambient soundscape. The one gameplay-adjacent change is that
the tray's walls stop bullets.

Built on the local branch `feature/office-environment`, commits O1–O7 (see "History" at the end).

| File | Role |
|---|---|
| `src/world/office.js` | `Office`: loads `office.glb` (or a procedural placeholder), places it around the page, materials, her animation, the shred state, the tray's bullet walls |
| `src/audio/officeAmbience.js` | `OfficeAmbience`: the procedural, positional soundscape |
| `src/main.js` | wiring: `?office=`, `?ambience=`, `?shred=`, the O key, `collision.walls`, `shredFx`, `__cv.office` / `__cv.ambience` |
| `src/config.js` | the `office` block (see "Config reference") |
| `src/world/collision.js` | `CollisionWorld.walls`: bullet-only quads, tested first in `raycast()` |
| `src/player/weapon.js` | a ray that hits a wall gives the result `"wall"` |
| `src/world/destruction.js` | `wallHit(hit)`: sparks off the plastic, no marks |
| `src/world/buildWorld.js` | names the dark plane under the page `desk` so the office can hide it |
| `src/assets/models.js` | `MODEL_FILES.office`, `CHARACTER_MODELS`, per-file `preloadModels(names)` |
| `public/models/office.glb` | the exported office + her + her 7 clips (2.2 MB, committed) |
| `blender_src/scripts/build_office.py`, `bake_office.py`, `build_woman.py`, `anim_woman.py` | the Blender sources (local only, git-ignored) |
| `tools/test-raycast.mjs` | also checks the walls (2,000 extra rays) |

## What the player sees and hears

- **From the page**: the tray's black walls all around (about 52 m tall at the back), the ceiling
  with its fluorescent panels ~1.7 km up, her monitor, the cork board, the pencil cup, a plant, other
  cubicles, and her, a stylized office worker (bun with a pencil through it, rectangular glasses,
  mauve cardigan, red lanyard) towering over the desk. Landmarks in the tray's ~12 mm margin: a pen
  along the right edge, a paperclip front-left, a yellow sticky note on the back wall.
- **Her idle life**: she types (a loop) and every 5–12 s does something else: glances down at the
  CV, uses the mouse, sips from her mug, looks at the wall clock and sighs, stretches.
- **The shred sequence** (dev / demo only): she notices the CV, pinches its front edge, lifts it,
  reads it, shakes her head, swivels to the shredder and feeds it in top edge first. The players
  stay on the page; the whole office swings around them. Once the top edge is in the slot the
  shredder pulls the page in over 45 s: the eaten part disappears behind a clipping plane, paper
  flecks fly from the cut line and the camera rumbles near it.
- **Sound**: room tone (ventilation, mains hum, fluorescent buzz), the wall clock, her keyboard and
  mouse, the mug, her chair, coworkers typing, desk phones, the photocopier, a laser printer,
  footsteps on the carpet, the water cooler, distant indistinct chatter, and the shredder.

## Controls and URL options

| | |
|---|---|
| **O** (after the intro) | she picks the CV up and shreds it; **O** again puts it back in the tray. Toasts "She noticed your CV…" / "CV back in the tray". |
| `?office=0` | no office at all: the old dark backdrop, no tray walls. The game runs exactly the pre-office gameplay path. |
| `?ambience=0` | office on, soundscape off |
| `?shred=N` | start the shred sequence N seconds after the intro ends (`?shred=0`: right away) |
| `__cv.office` | the `Office` (state, `toggleShred()`, `debugTilt(deg, liftCm)`, `shred`, `source`) |
| `__cv.ambience` | the `OfficeAmbience` (`null` with `?ambience=0` or `?office=0`) |

`config.office.enabled = false` turns the office off for every page load.

## Architecture

### Scale and placement

The CV page is the game world: top-left corner at the origin, X = page right, Z = page down, Y = up,
1 PDF point = `config.metersPerPt` (0.3) game metres, so an A4 page is ~179 × 253 m. The office is
modelled in **real metres**, so one real metre is

```
K = metersPerPt / (0.0254 / 72) = 0.3 / 0.000352… ≈ 850.4 game metres     (Office.k)
```

The tray walls end up ~52 m tall, the desk top ~690 m below the paper, the ceiling ~1.7 km above it.

`office.glb` contains an empty **`CV_Anchor`** at the **centre** of the page lying in the top tray,
with the game's axes (X = page right, Y = out of the paper, Z = page down, in three.js terms). The
game never moves the page; it moves the office instead:

```
office.root.matrix = T(pageCenter) · S(K) · inverse(CV_Anchor relative to the office content)
```

(`Office.place()`, every frame from `update()`; `root.matrixAutoUpdate = false`.) When the anchor is
animated (she lifts the CV), the office swings around the players. Collision, raycasts, movement and
networking all live in page space and never notice. `__cv.office.debugTilt(20)` tilts the anchor by
hand to check the maths; `debugTilt(0)` puts it back.

**Axes**: Blender is Z up, three.js is Y up; the glTF exporter (`export_yup`) maps Blender
`(x, y, z)` to three.js `(x, z, -y)`. `officeAmbience.js` uses the same mapping (`P(x, y, z)`) to place
sounds on points read off the Blender layout. In Blender the anchor's axes are X = page right,
Z = out of the paper, -Y = page down, which become X, Y, +Z in three.js.

### Rendering

- One scene, one camera. With the office on, `main.js` sets `camera.far = config.office.far`
  (12,000 m), the background to `config.office.background`, and the fog colour to
  `config.office.fogColor` (same fog distances as before, so visibility over the page is unchanged).
  The old dark plane under the page (`desk` in `buildWorld.js`) is hidden: it would cover the tray floor.
- **Materials** (`officeMaterial()` in `office.js`), one copy per source material:
  - `Baked_*` (the two lightmapped meshes): `MeshBasicMaterial` with the lightmap as `map`, colour ×
    `config.office.brightness`. Unlit, `fog: false`, `toneMapped: false`: the bake already is the
    final look, and it stays right however the office swings relative to the game's sun.
  - emissive (ceiling panels, window panes, screens): their glow colour, unlit.
  - anything else (her, the mug): **`officeLit`**, a `MeshLambertMaterial` (keeps skinning and vertex
    colours) whose output is replaced in `onBeforeCompile` by
    `albedo · (mix(ground, sky, n·up · 0.5 + 0.5) + key · max(n·keyDir, 0) · sky) + rim · fresnel³`.
    `up` and `keyDir` are given in the office's frame and turned into view space every frame
    (`Office.update(dt, camera)`), so she stays lit like the baked room while it swings. Tuned in
    `config.office.shade`.
  - the placeholder (no `office.glb`): self-lit, half the colour as emission.
- Office meshes cast and receive no shadows (the sun's shadow map only covers the page). Skinned
  meshes skip frustum culling (their bounds come from the rest pose).

### Her animation

`setupAnimation()` splits each glTF clip in two: tracks on `CV_Anchor` and tracks on everything else
(her rig, the mug). The body tracks become actions on an `AnimationMixer`; `Type` loops, the others
play once and clamp. The `Shred` clip's anchor tracks are **not** played by the mixer: they are
sampled directly every frame (`cvPath`, `shredT`), because a clamped action stops re-applying its
last pose and the shredder's pull added on top of it would then accumulate.

| Clip | Length | What |
|---|---|---|
| Type | 4 s loop | the base state: fingers tapping, breathing, small head moves |
| Mouse | 4.8 s | right hand to the mouse, a few clicks, back |
| Sip | 6 s | lifts `Prop_Mug`, drinks, puts it back |
| Stretch | 4.6 s | both arms above her head |
| Glance | 3.2 s | a long look down at the CV (at the players) |
| Clock | 3.6 s | looks up at the wall clock, sighs |
| Shred | 13 s | notices the CV, lifts it, reads it at ~30°, shakes her head, swivels and scoots to the shredder, feeds it in at 45° top edge first, swivels back |

**Idle scheduler** (`Office.animate()`): while she plays `Type` (and isn't shredding), a timer counts
down from a random value in `config.office.idleGap` (5–12 s); at zero a one-shot is picked at random
by `config.office.idle` weights (Glance 3, Mouse 3, Sip 2, Clock 1.5, Stretch 1) and cross-faded in
(0.4 s). When a one-shot (or Shred) finishes, the mixer's `finished` event sends her back to `Type`.
`clipState()` returns `{name, time}` of the current clip for the soundscape.

### The shred sequence

```js
office.startShred()   // false if already shredding or office.glb has no Shred clip
office.resetShred()   // CV back in the tray, page whole, back to Type
office.toggleShred()  // returns true if she is now shredding
office.shred          // { active, feeding, progress, cutZ, plane }
office.cvInTray       // false while the shred sequence runs
```

1. `startShred()` plays `Shred` on her body and starts sampling the CV's path from the clip.
2. `insertAt` is the time the CV stops moving in the clip (its top edge is in the slot, ~9.3 s),
   found by `lastChange()` on the anchor's position track. From then on `feeding` and `active` are
   true and `progress` grows by `dt / config.office.shredSeconds` (45 s) up to 1.
3. The pull: after sampling the clip, `anchor.translateZ(-progress · travel)` (page "up" = -Z, top
   edge first; `travel` = page height in real metres + 1.2 cm).
4. `updateShredPlane()` turns the `Shredder_Throat` empty into a game-space `THREE.Plane` (normal out
   of the shredder) and `cutZ`: how far from the top edge the page has been eaten, in page metres,
   measured where the plane crosses the page's middle, clamped to `[0, D]`.
5. `setPageClip(plane)` puts the plane in `clippingPlanes` of every material under `world.root`
   (paper, letters, rules); `main.js` turns on `renderer.localClippingEnabled` with the office.
6. `shredFx` in `main.js`: white paper flecks thrown from the cut line (dust particles, scaled by
   `config.gfx.particles`) and a light camera shake within 40 m of it.

**What it does not do (yet)**: it is **visual only** and **local only**. Collision, raycasts,
destruction and the minimap are untouched, and nothing is sent over the network: each browser runs
its own sequence (the host pressing O does not make guests' woman shred). `office.shred` is the hook
for the shrinking-map mechanic (see "Next: the shrinking map").

### Tray walls (bullets only)

Players could never leave the page: `CollisionWorld.resolve()` clamps them to it, about 10 m inside
the tray walls. So the walls only matter to bullets:

- `Office.trayWalls()` builds the inner faces of the top tray as vertical quads
  `{ax, az, bx, bz, h0, h1}` in game metres (back wall, the sides with their slope down to the corner
  tabs, the two front tabs, the low front lip), from the tray's **real dimensions** (`TRAY` in
  `office.js`), not from the loaded model, so every client has the same walls even if `office.glb`
  failed to load.
- `CollisionWorld.walls` holds them; `raycast()` tests them first and returns `{wall: true, body: null}`
  for a hit. Movement (`resolve()`) ignores them.
- `Weapon` turns a wall hit into the result `"wall"` and calls `Destruction.wallHit(hit)` (sparks,
  the floor-hit sound, no burn mark). On the network it is an ordinary shot of kind 0 (miss) whose
  tracer ends at the wall: no protocol change, `NET_VERSION` unchanged.
- `main.js` sets `collision.walls = office.cvInTray ? trayWalls : []` every frame: no walls while the
  CV is out of the tray. With `?office=0` the list is always empty.

### Model loading

`MODEL_FILES` in `src/assets/models.js` lists `office: "office.glb"` next to the characters and the
gun. `preloadModels(names)` starts one download per file (cached promise per name) and resolves when
*those* files have loaded or failed. `CHARACTER_MODELS = ["player_corporate", "player_engineer", "gun"]`
is what the front page's "Meet the job hunters" preview and the model viewer wait for, so neither
waits on the 2.2 MB office (fix O7: the preview used to wait for every model). The game itself still
calls `preloadModels()` for all files at page load and a map waits at most 8 s for them. If
`office.glb` is missing, fails, or has no `CV_Anchor`, `Office` builds a procedural placeholder with
the same layout and real dimensions (`office.source` says which one is in use).

## The soundscape (`src/audio/officeAmbience.js`)

Everything is synthesised with Web Audio on the game's own context (`sfx.ctx`), like `sfx.js`: no
audio files by default. Created in `main.js` with the office (`?ambience=0` skips it), it starts
itself on the first `update()` after the audio is unlocked (first click), runs after
`office.update()` every frame and is disposed with the game. Its bus goes into `sfx.master` (so
**M** mutes it) with a 0.6 send into the game's reverb.

**Placement.** Sources are office-model points (real metres, three.js axes, `P(x, y, z)` from the
Blender layout) turned into game space through `office.root.matrixWorld` when they fire, or every
frame for moving ones (`livePanner`: the shredder). So panning and distance follow the room when it
swings. Panners use inverse distance with `refDistance` = 0.8 real m × K: her keyboard is loud, the
copier across the room is a murmur. HRTF for near sources, equal-power for far ones (and for all of
them on the low graphics preset).

| Layer | Sounds | When |
|---|---|---|
| Room tone (not positional) | looped noise through a 160 Hz low-pass (ventilation, 0.06 Hz swell) + a 650 Hz band (air), 50 / 100 / 150 Hz mains hum, a faint 4.2 kHz fluorescent buzz; fades in (2 s time constant) | always |
| Wall clock | tick / tock (alternating band-passed clicks) at the clock | every second |
| Her typing | bursts of 3–21 key clicks (noise click + low "thock", sometimes the space bar), pauses | while her clip is `Type` |
| Her clip events (`CLIP_EVENTS`) | Mouse: clicks; Sip: cup up, slurp, cup down clink; Stretch: chair creaks; Clock: a sigh; Shred: the CV crinkling as she grabs it (big, close, not positional: the players stand on it), rustles, the chair rolling | at fixed times into each clip |
| The shredder | motor (72 / 144 / 216 Hz saws, spinning up) + paper crunch (noise band, jumping level), at `Shredder_Throat`, loud (refDistance 1.2 m × K); spins down in 0.7 s | while `office.shred.feeding` and `progress < 1` |
| Coworkers typing | key bursts at one of the other pods | every 2–9 s |
| Desk phones | electronic trill (1480 Hz ± 160 Hz switched 16×/s), 2–5 rings, 30 % hers; nobody answers | every 35–100 s |
| Photocopier | motor, fan, a scan sweep per page, page out + thump, 4–13 pages | every 50–120 s |
| Laser printer | high whine, roller, page clacks | every 70–160 s |
| Footsteps | carpet thud + heel along one of three walks; the walk to the water cooler often ends with a glug | every 30–80 s |
| Chatter | 2–3 voices at a pod taking turns for 12–35 s, the odd laugh, then 8–25 s of quiet | if `audio.chatter` |

**Chatter** is formant babble: each voice is a sawtooth (pitch wobble, falling over a phrase) through
three band-pass formants that jump to a new vowel every syllable (90–220 ms), behind a 1.4 kHz
low-pass and the room's reverb: speech-like but indistinct. `audio.voices` caps the voices (2 on the
low preset).

**Schedulers**: a list of `{at, run}` entries with a 0.3 s look-ahead; `run(at)` schedules the sound
on the audio clock and returns the delay to the next one.

**Recordings hook**: `config.office.audio.samples` maps a sound to a file under `public/`, e.g.
`{ phone: "sounds/phone.ogg" }`. Keys: `roomtone`, `phone`, `copier`, `printer`, `chatter`,
`shredder`, `typing`. A sample that loads replaces the synthesised version of that sound; one that
fails logs a warning and the synthesised version stays. Nothing is fetched while the map is empty
(the default).

**Testing without the game**: `start(ctx, master, reverbSend)` is separate from the constructor so a
second `OfficeAmbience` can be driven on an `OfflineAudioContext` against the running game's office
(step `office.update` + `ambience.update` between `ctx.suspend(t)` points every 0.1 s), rendered and
written to a WAV.

## Assets pipeline (Blender)

All of the office is built by Python scripts in `blender_src/scripts/` (git-ignored, local only, like
the character scripts); the result is `public/models/office.glb` (committed).

| Script | Does |
|---|---|
| `build_office.py` | the geometry in real metres, Z up, flat colours, in four groups: `near` (desk, trays, shredder, clutter, cork board → `Office_Near`), `room` (room shell, cubicles, room props → `Office_Room`), `lights` (ceiling panels, window panes → `Lights`), `screens` (`Screens`); and the empties `CV_Anchor`, `Shredder_Throat`, `Tray_Inner`. Run alone (`__main__`) it only builds the geometry. |
| `bake_office.py` | the full pipeline, `run()`: `build_office.build()` → a light rig that is not exported → Cycles bakes → lightmap finishing → `Baked_*` materials → `build_woman.build_all()` → export `office.glb` → save `blender_src/office.blend` |
| `build_woman.py` | her: one skinned mesh `Woman` on `Woman_Rig` (50 bones), chair included, plus `Prop_Mug`; `run()` rebuilds her into an existing `office.blend` and re-exports without rebaking |
| `anim_woman.py` | her 7 clips (called by `build_woman.build_all()`, no entry point of its own) |
| `common.py` | shared helpers (palette, `collection`, `join`, `save_blend`, paths `BLENDER_SRC` / `MODELS_OUT`) |

### Rebuilding `office.glb`

Blender runs headless with the snap's binary directly (the `blender` snap launcher fails from a
shell), from the repo root:

```bash
# everything: geometry + bake + her + her clips + export (~3 min on the laptop CPU)
/snap/blender/current/blender --background --factory-startup \
    --python blender_src/scripts/bake_office.py

# quick look: 512 px lightmaps at 8 samples, no export (add --export to export anyway)
/snap/blender/current/blender --background --factory-startup \
    --python blender_src/scripts/bake_office.py -- --quick

# only her (and her clips): needs the office.blend the bake saved; no rebake (~1 min)
/snap/blender/current/blender --background blender_src/office.blend \
    --python blender_src/scripts/build_woman.py

# ...the same without the Cycles preview renders of her
/snap/blender/current/blender --background blender_src/office.blend --python-expr \
    "import sys; sys.path.insert(0, 'blender_src/scripts'); import build_woman; build_woman.run(renders=False)"
```

The bake reports progress in `/tmp/pcv-shots/office_bake.json`. In an open Blender with the MCP
add-on: `bake_office.schedule()` (runs from a timer, so the call returns at once), or
`build_office.build()` for geometry only. Then reload the game (the model viewer doesn't show the
office). Commit the new `public/models/office.glb`.

### Bake

1. A light rig, not exported: an area light under every ceiling panel (warm, 35 W), one behind every
   window (cool daylight, 100 W), a grey world (0.12); a white sheet stands in for the CV during the
   bake (bounce light in the tray), not exported.
2. `Office_Near` and `Office_Room` each get a `Lightmap` UV (Smart UV Project) and a Cycles
   **DIFFUSE** bake (direct + indirect + colour) into a float image: near 1024 px × 128 samples, room
   1024 px × 96 samples (`BAKES`). CPU only.
3. Finishing in numpy (bakes get no denoiser): masked Gaussian blur (σ 1.2 px) inside the UV islands,
   **one exposure for both maps** measured on near (97th percentile → 0.86), a soft shoulder, sRGB →
   `blender_src/bake/lm_near.png`, `lm_room.png`.
4. The materials of each group are replaced by one `Baked_Near` / `Baked_Room` material with the
   lightmap as base colour (the game shows `Baked_*` unlit).
5. She and the mug are added after the bake: they move, so they are not baked.

### Export settings (`bake_office.export()`)

glTF binary, Y up, selected objects only (`build_woman.office_objects()`: the office meshes, the
empties, her rig, mesh and mug), modifiers applied, JPEG images (quality 90), the active colour
attribute as vertex colours, skins on, morphs / cameras / lights off, **animations from NLA tracks**
(`export_animation_mode="NLA_TRACKS"`, one glTF animation per track name) sampled every
`anim_woman.STEP` = 2 frames at 30 fps. Options this Blender's exporter doesn't know are dropped and
retried.

### Her rig and clips

- **Rig `Woman_Rig`, 50 bones**: Root (chair swivel / scoot) > Hips > Spine > Chest > Neck > Head;
  Chest > Shoulder.L/R > UpperArm > ForeArm > Hand > Thumb, Index, Middle, Ring, Pinky (3 bones each);
  Hips > Thigh.L/R > Shin > Foot. Rest pose = her typing pose. The body is one smooth mesh (Skin
  modifier + subdivision) with automatic weights; head, hair, glasses, shoes, lanyard, finger segments
  and the chair are rigid parts on one bone each. Colours become a colour attribute: 2 materials
  (`Woman`, double-sided `WomanHair`).
- **Clips** (`anim_woman.py`): FK keys for the body, IK on both hands (targets computed per frame in
  Python, "held" = prop matrix × grip offset so the CV and the mug stay in her hand), props keyed
  directly; then baked to plain local keys every 2 frames, constraints and helpers removed. Each clip
  is an NLA track of the same name on the rig, `CV_Anchor` and the mug.
- The scene is set to **30 fps** before baking (the factory startup is 24 fps, which made the clips
  play 25 % slow).

### Conventions the game relies on

- `TRAY` in `src/world/office.js` must match `TRAY` in `build_office.py`: the game builds the bullet
  walls from it, not from the model.
- Node names: `CV_Anchor` (required; without it the placeholder is used), `Shredder_Throat` (Blender
  local Z = the slot slope's outward normal, three.js local +Y; without it there is no clipping
  plane), `Tray_Inner`, `Prop_Mug`. Clip names as in the table above (`Type` and `Shred` are looked
  up by name).
- Materials named `Baked_*` with a texture are shown unlit; materials with an emissive colour are
  shown as that colour.
- Sound positions in `officeAmbience.js` (`SPOTS`, `PODS`, `WALKS`) and clip event times
  (`CLIP_EVENTS`) are copied from the Blender layout and `anim_woman.py`: move them together.

## Config reference (`config.office`)

| Key | Default | |
|---|---|---|
| `enabled` | `true` | the office at all (`?office=0` turns it off per page load) |
| `far` | `12000` | camera far plane with the office (game metres) |
| `background` | `0xcfc8b6` | scene background, in case a gap shows |
| `fogColor` | `0xb7b0a0` | distant letters fade into the office's beige instead of black (same distances) |
| `brightness` | `1` | multiplies the baked lightmaps |
| `shade` | `{ sky: 0xfff6ea, ground: 0x6c6c74, key: 0.3, keyDir: [0.15, 1, -0.45], rim: 0.12 }` | her lighting (`officeLit`): hemisphere colours, key strength and direction (office frame), rim |
| `idle` | `{ Glance: 3, Mouse: 3, Sip: 2, Clock: 1.5, Stretch: 1 }` | weights of her idle one-shots |
| `idleGap` | `[5, 12]` | seconds of typing between two idle one-shots (random in the range) |
| `shredSeconds` | `45` | seconds the shredder takes to eat the whole page once it is fed in |
| `audio` | `{ volume: 0.55, chatter: true, voices: 3, samples: {} }` | soundscape level, chatter on/off, max voices, optional recordings |

## Validation (step 7)

Results of the validation pass on 2026-10-14 (commits O1–O7).

- **Headless suites all pass**: `npm run sim`, `npm run test:ray` (3,000 rays against brute force,
  plus the new check: 2,000 rays from the page against a ring of walls, 0 errors), `npm run sim:pvp`,
  `npm run sim:match`, `npm run test:interp`, `npm run sim:net`. `vite build` is clean.
- **Gameplay unchanged**: with `?office=0` the game runs the old gameplay path byte for byte. With the
  office on, the only gameplay-adjacent change is the bullet-stopping tray walls.
- **Render cost** (headless Chrome): +7 draw calls (283 → 290), ≈ +27k triangles
  (573k → 600k), +4 textures (~11 MB of GPU memory), `office.update` 0.1–0.3 ms per frame on the CPU.
  `office.glb` is 2.2 MB. **No real-GPU frame rate measured yet**: headless Chrome only has SwiftShader.
- **Two-window multiplayer** (local signal server, `?broker=ws://127.0.0.1:9000`): both peers built the
  same map hash, `office.glb` loaded on both, destruction and kills synced, the host's shots hit tray
  walls (`"wall"` results), and the shred sequence ran on the host only while the guest's woman kept
  typing, as designed.
- **Transient "Connection lost… Contacting the matchmaking server" banners on the guest**, each
  recovering within ~10 s: once in 140 s with the office off, three times with it on. Cause: two
  SwiftShader windows starving one CPU, so the link watchdog (`src/net/room.js`, 10 s of silence) sees
  nothing. It happens without the office too, so it is not a regression, but the office's extra
  render load makes it more frequent in that environment. To confirm on real hardware.
- **Fix found during validation**: the landing page's job hunters preview waited for `office.glb`;
  models now preload per file and the preview waits only for `CHARACTER_MODELS` (commit O7).

## Known issues and to do

- [ ] Frame rate on a real GPU and on a real device (desktop and phone), office on vs `?office=0`.
- [ ] Mobile check: the low graphics preset with the office (lightmaps, her shader, clipping).
- [ ] A human listening pass on the procedural audio, especially the chatter; swap in recordings
      through `config.office.audio.samples` where synthesis falls short.
- [ ] Confirm on real hardware that the guest "connection lost" banners were only the two-SwiftShader
      setup.
- [ ] The shred sequence is not networked: each client runs its own, started by O / `?shred=N`.
- [ ] The shrinking map is not implemented: shredding is visual only.

## Next: the shrinking map

The plan for turning the shred sequence into gameplay, building on `office.shred`:

1. **Clip collision with `cutZ`.** Everything with `z < office.shred.cutZ` is in the shredder:
   `CollisionWorld.resolve()` clamps players to `z >= cutZ` (or kills those caught behind it),
   `raycast()` ignores bodies and floor behind it, the destruction code drops (silently kills)
   letters behind it, and the minimap greys out the eaten strip. The tray walls go off as today
   (`cvInTray`).
2. **Network-sync the shred start time.** The host decides when she shreds (a match timer, a score,
   or the remaining letters) and sends one reliable message with the start time on the shared host
   clock (`net/clock.js`); every client runs the same clip from that time, so `progress` and `cutZ`
   agree everywhere without streaming them. Late joiners get the start time in `welcome.world`.
   Needs a `NET_VERSION` bump. Rematch: `resetShred()` with the round reset.
3. **Make it fair**: spawns and respawns only in the part of the page still in play, a warning before
   the feed starts (her Glance, the rumble), and the match end if the page is gone.
4. **Real-device checklist** before shipping: fps on a mid-range laptop GPU and on an Android phone
   with the office on and off, audio levels against the gunshots, the shred sequence on the low
   preset, a two-network multiplayer match with a shred.

## History

| Step | Commit | |
|---|---|---|
| O1 | `cb3ecb6` | real-scale placeholder office around the CV, inverse-anchor placement, `debugTilt` |
| O2 | `d2d26fc` | Blender blockout, `office.glb` (placeholder kept as the fallback, `office.source`) |
| O2b | `514e099` | the letter tray's walls stop bullets |
| O3 | `010fff6` | furnished office, baked Cycles lighting |
| O4 | `247592d` | the giant woman, modelled and rigged (office rebaked) |
| O5 | `666cc82` | her idle life and the shred sequence (office rebaked) |
| O6 | `1e1ed58` | the soundscape |
| O7 | `9723c85` | per-file model preload: the landing preview never waits on `office.glb` |
| O8 | | this documentation |
