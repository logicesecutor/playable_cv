# The office

The CV no longer floats in the dark: it lies in a black letter tray on the desk of a giant office
worker, in an open-plan office modelled at real scale. She types, sips her coffee, glances down at
the players, and 1:30 into every multiplayer match picks the CV up and feeds it into a paper
shredder: **the map shrinks** from the top edge down, anyone the cut reaches is pulled into the slot
and dies in the cutters, and when the page is used up the leader wins (see "The shredder in a match"). Everything else about the office
is environment: 3D assets, baked lighting, her animation and an ambient soundscape, plus tray walls
that stop bullets. In single player the shredding is still a visual-only demo (O key, `?shred=N`).

Built on the local branches `feature/office-environment` (commits O1–O8) and `feature/shred-trigger`
(S1–S7, branched from it); see "History" at the end.

| File | Role |
|---|---|
| `src/world/office.js` | `Office`: loads `office.glb` (or a procedural placeholder), places it around the page, materials, her animation, the shred state, the tray's bullet walls, the cutters inside the slot (`buildCutters()`, S7) |
| `src/audio/officeAmbience.js` | `OfficeAmbience`: the procedural, positional soundscape |
| `src/main.js` | wiring: `?office=`, `?ambience=`, `?shred=`, `?shredAfter=` / `?shredSeconds=`, the O key, `collision.walls`, `shredFx`, `office.syncShred()` from the match clock, `applyCut()` (letters, collision, minimap, fallback clip plane), late-join spawn below the cut, `__cv.office` / `__cv.ambience`; S7: `?shredCatch=`, the `ShredDeath` wiring (slot `plane` and `depth` getters), `__cv.shredDeath` |
| `src/config.js` | the `office` block and the `shredder` block (see "Config reference") |
| `src/game/shredder.js` | the shredder's timetable (pure JS): `shredState()`, `cutAt()`, `gameMetres()`, `PageEater`, `spawnClear()` / `SPAWN_LEAD`, `CATCH_SECONDS` / `CATCH_REACH` (S7) |
| `src/net/match.js` | the match clock (`startAt`, `go()`, `elapsed()`), the host's shredder timings (`sh`), `finish(rows, why)` |
| `src/game/pvp.js` | the shredder in a match: `pvp.shred`, the host catching players at the cut (dead `catch` s later, S7), spawns below the cut, the "page used up" end, countdown and notices, the `shredDeath` hooks and the shredder killcam |
| `src/net/combat.js` | `environmentKill(v, cause)`: a death nobody scores (host only); S7: `catch(v, cause, x, z, ms)`, `isCaught(id)`, the `caught` message |
| `src/fx/shredDeath.js` | `ShredDeath` (S7): the death sequence: own camera down into the cutters, torn-paper overlay, other players' bodies dragged into the slot and clipped, confetti in the victim's colour, scream and crunch |
| `src/world/collision.js` | `CollisionWorld.walls`: bullet-only quads, tested first in `raycast()`; `cutZ`: no floor above the shredder's cut |
| `src/ui/matchHud.js`, `src/ui/combatHud.js`, `src/ui/minimap.js`, `src/audio/sfx.js`, `index.html` (`#shred-warn`, `#shred-tear`), `src/style.css` | countdown / notices / "shredder NN%" / end card reason, kill feed and killcam for shredder deaths (on a dark card since S7), the minimap's greyed-out top, countdown blips, the scream and the cutters' crunch (S7) |
| `src/player/weapon.js` | a ray that hits a wall gives the result `"wall"` |
| `src/world/destruction.js` | `wallHit(hit)`: sparks off the plastic, no marks |
| `src/world/buildWorld.js` | names the dark plane under the page `desk` so the office can hide it |
| `src/assets/models.js` | `MODEL_FILES.office`, `CHARACTER_MODELS`, per-file `preloadModels(names)` |
| `public/models/office.glb` | the exported office + her + her 7 clips (2.2 MB, committed) |
| `blender_src/scripts/build_office.py`, `bake_office.py`, `build_woman.py`, `anim_woman.py` | the Blender sources (local only, git-ignored) |
| `tools/test-raycast.mjs` | also checks the walls (2,000 extra rays) |
| `tools/sim-shred.mjs` | `npm run sim:shred`: the timetable, timings hand-off, page eater, spawn rule, shredder deaths, the shred ending, the catch → death timeline (S7) |
| `tools/sim-match.mjs` | also checks that every screen has the same match clock |

## What the player sees and hears

- **From the page**: the tray's black walls all around (about 52 m tall at the back), the ceiling
  with its fluorescent panels ~1.7 km up, her monitor, the cork board, the pencil cup, a plant, other
  cubicles, and her, a stylized office worker (bun with a pencil through it, rectangular glasses,
  mauve cardigan, red lanyard) towering over the desk. Landmarks in the tray's ~12 mm margin: a pen
  along the right edge, a paperclip front-left, a yellow sticky note on the back wall.
- **Her idle life**: she types (a loop) and every 5–12 s does something else: glances down at the
  CV, uses the mouse, sips from her mug, looks at the wall clock and sighs, stretches.
- **The shred sequence**: she notices the CV, pinches its front edge, lifts it, reads it, shakes
  her head, swivels to the shredder and feeds it in top edge first. The players stay on the page;
  the whole office swings around them. Once the top edge is in the slot the shredder pulls the page
  in over 45 s: the eaten part disappears behind a clipping plane, paper flecks fly from the cut
  line and the camera rumbles near it. In a multiplayer match it starts by itself 1:30 in, after a
  10-second countdown, on every screen at once, and the eaten part is gone from the game too (see
  "The shredder in a match"); in single player it is a visual-only demo (O, `?shred=N`).
- **Caught by the shredder** (S7): when the cut reaches you, you lose control and the camera is
  pulled along the paper to the slot and down between two shafts of spinning steel cutter discs (each
  ~15 m across at this scale), shaking harder and harder; then the view tears into paper strips and
  stays there, under "Went through the shredder", until you respawn. Everyone else sees your soldier
  dragged into the slot and sliced off by it, paper strips in your colour spraying out, and hears you
  scream. See "Death by shredder (S7)".
- **Sound**: room tone (ventilation, mains hum, fluorescent buzz), the wall clock, her keyboard and
  mouse, the mug, her chair, coworkers typing, desk phones, the photocopier, a laser printer,
  footsteps on the carpet, the water cooler, distant indistinct chatter, and the shredder.

## Controls and URL options

| | |
|---|---|
| **O** (after the intro, single player only) | she picks the CV up and shreds it (visual only); **O** again puts it back in the tray. Toasts "She noticed your CV…" / "CV back in the tray". Ignored once a room is open: in multiplayer the match clock decides. |
| `?office=0` | no office at all: the old dark backdrop, no tray walls. The game runs exactly the pre-office gameplay path (in a match the shredder still shrinks the map; a plane across the page hides what is gone). |
| `?ambience=0` | office on, soundscape off |
| `?shred=N` | single player only: start the visual shred demo N seconds after the intro ends (`?shred=0`: right away) |
| `?shredAfter=N` | on the host: the shredder starts N s into the match instead of 90 (0–3600; the host's value counts for everyone) |
| `?shredSeconds=N` | on the host: the feed takes N s instead of 45 (1–3600; the host's value counts for everyone) |
| `?shredCatch=N` | on the host: a player the shredder catches dies N s later instead of 1.6 (0.4–20; the host's value counts for everyone): a slow-motion shredder death, e.g. `?shredAfter=8&shredSeconds=30&shredCatch=10` |
| `__cv.office` | the `Office` (state, `toggleShred()`, `debugTilt(deg, liftCm)`, `shred`, `source`) |
| `__cv.ambience` | the `OfficeAmbience` (`null` with `?ambience=0` or `?office=0`) |
| `__cv.shredDeath` | the `ShredDeath` sequence (S7: `active`, `ownActive`, `clearAll()`, `confetti`) |

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
office.startShred()           // solo demo: false if already shredding or office.glb has no Shred clip
office.resetShred()           // CV back in the tray, page whole, back to Type
office.toggleShred()          // solo demo: returns true if she is now shredding
office.syncShred(t, progress) // multiplayer: follow the match clock (t = s since she reached, null = not yet)
office.shred                  // { active, feeding, progress, cutZ, plane }  (the visible cut)
office.cvInTray               // false while the shred sequence runs
clipPage(world, plane, skip)  // exported: clip the page's materials (also used by main.js without an office)
```

1. **Solo**: `startShred()` plays `Shred` on her body and starts sampling the CV's path from the
   clip, on its own timer (`shredT += dt`). **Match**: `syncShred(t, progress)` is called every frame
   with the state `game/shredder.js` works out from the match clock. The first call with `t ≥ 0`
   starts the clip *at* `t`, so a late joiner sees her mid-way through (or typing again, if the clip
   is already over); after that `shredT` is the clock's `t`, and the clip is snapped back to it if it
   drifts more than 0.3 s (clock slew, a sleeping tab) or sent back to `Type` once the clock passes
   its end. `t = null` (a new match, a rematch) calls `resetShred()`.
2. **Feeding** starts at `config.shredder.grab` (9.35 s: in her Shred clip the CV reaches the slot at
   9.33 s; `insertAt`, the time the anchor track stops moving, is only the fallback). From then on
   `feeding` and `active` are true. `progress` is `(shredT − grab) / config.shredder.seconds` solo,
   or the clock's `progress` in a match.
3. The pull: after sampling the clip, `anchor.translateZ(-(cutAt(progress, D, bite) − bite) / K)`
   (page "up" = -Z, top edge first). The clip leaves the page `bite` deep in the slot
   (`config.shredder.bite` = 1 real cm ≈ 8.5 game m), and every metre pulled moves the cut a metre
   down the page, so **the visible cut lands on the gameplay line** `cutAt()` (see below).
4. `updateShredPlane()` turns the `Shredder_Throat` empty into a game-space `THREE.Plane` (normal out
   of the shredder) and `cutZ`: how far from the top edge the page has been eaten, in page metres,
   measured where the plane crosses the page's middle, clamped to `[0, D]`. This is the *visible*
   cut; gameplay uses `shredState().cutZ`, which it matches.
5. `setPageClip(plane)` → `clipPage()` puts the plane in `clippingPlanes` of every material under
   `world.root` (paper, letters, rules). `main.js` now turns on `renderer.localClippingEnabled`
   always (not only with the office): without an animated office it clips the page itself.
6. `shredFx` in `main.js`: white paper flecks thrown from the cut line (dust particles, scaled by
   `config.gfx.particles`) and a light camera shake within 40 m of it.

**Solo vs match**: in single player (no room open) the sequence is a **visual-only, local** demo:
collision, raycasts, destruction and the minimap ignore it. In a multiplayer match the match clock
starts it on every screen and the cut is gameplay: see "The shredder in a match" below.

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

## The shredder in a match

Commits S1–S5 and S7 (+ fixes) on `feature/shred-trigger`. The shrinking map: 1:30 into a match she
grabs the CV and the shredder eats the page from the top edge down; everything above the cut is
out of the game.

### Decisions

| Topic | Choice |
|---|---|
| Trigger | **1:30 after the match starts, on the match clock** (`config.shredder.after` = 90 s). |
| When the clock starts | Round 1: **when the first guest is in the game** (a host waiting alone for friends loses nothing). Rematches: **at the Rematch press**. |
| Gameplay | **The shred changes gameplay now**: the map shrinks from the top edge. |
| Caught on the shredded part | **Dies**: counted as a death, **no killer** (nobody gets the kill). Spawn protection doesn't help. Since S7 the cut **catches** them first (next row). |
| How you die (S7) | **Pulled into the slot (~1.6 s), then dead.** Your own view goes first-person into the blades; everyone else sees your soldier dragged into the slot plus confetti in your colour; **a scream** on a shredder death. (A strained-motor grind while someone is in the shredder was offered and not chosen.) |
| Page used up, nobody at the kill target | **The match ends, the leader wins** (most kills; fewest deaths breaks a tie: the usual `results()`). |
| Warning | **A 10-second HUD countdown** before she reaches for the CV. |

### Timeline (defaults)

| Match time | Phase (`shredState`) | What you see |
|---|---|---|
| 0:00–1:20 | `waiting` | nothing; `countdown` is null |
| 1:20–1:30 | `waiting`, `countdown` 10 → 0 | "She's reaching for your CV" + a big ticking number, "the top of the page goes first"; a blip each second, a longer, higher one at zero |
| 1:30 | `grab` (`t` = 0) | she reaches for the CV, lifts it, reads it, turns to the shredder (9.35 s); notice "She picked up your CV · the shredder is next: get away from the top of the page" |
| 1:39.35 | `feeding` | notice "The shredder is eating the page · anything above the cut is gone: stay ahead of it"; match bar "shredder NN%"; the cut starts at `bite` (≈ 8.5 m) and moves down the page |
| 2:24.35 | `done` | the page is used up: the host ends the match if nobody reached the target |

The cut runs at `(D − bite) / seconds` ≈ **5.4 m/s** on the sample CV (253 m page in 45 s), slower
than walking (6.5 m/s): you can always outrun it. Notices only show for fresh changes (< 3 s old),
so a late joiner doesn't get the news of 30 s ago.

### How it stays in sync (no network messages for the shred itself)

- **The match clock** (`src/net/match.js`, S1): `startAt` is the host time (ms, `room.now()`) the
  match clock started; `elapsed(now)` = seconds since then (null before). The host calls `go(at)`
  when the player list first has a non-host player `in-game` and sends
  `{t:"match", s:"go", r, at, sh}`; a rematch (`rematch(spawns, protUntil, at)`, `at` = the Rematch
  press) sends `{t:"match", s:"start", r, u, at, sh, sp}`; the late-join snapshot carries `at`, `sh`
  and `why`. `fx.clock` fires whenever `startAt` changes. `NET_VERSION` 6 (`src/net/room.js`; 7 since S7's `caught` message).
- **The timings travel with the clock**: `sh = [after, seconds]` are the host's, so a host's dev
  override (`?shredAfter=` / `?shredSeconds=`) counts for everyone. `grab`, `warn` and `bite` come
  from each client's own config (they are tied to `office.glb`).
- **Everything else is computed** (`src/game/shredder.js`, pure JS, S2): every screen runs
  `shredState(elapsed, timings, D, bite)` → `{phase, t, progress, cutZ, countdown}` on the shared
  host clock (`net/clock.js`). A guest's clock counts only once it has synced (the first pong).
  Same clock + same timings = the same cut everywhere, late joiners and reconnects included.
- **Letters** go through `PageEater` (S4): sorted once by the middle of their footprint, a letter is
  removed (`destruction.silentKill`: no shards, no score, no network) as soon as the cut passes its
  middle. Every screen eats the same letters. A smaller `cutZ` (a rematch) starts it over.
- **Only the catches and deaths go over the network**: the host decides who the cut has reached and
  sends `caught` (S7), then, `config.shredder.catch` s later, an ordinary death message.
- `pvp.shred` is frozen while a match is over (the end screen keeps the page as it was); the
  `fx.clock` of a rematch resets it to `waiting`, which puts the CV back in the tray.

### What the cut does (S4, S5)

Everything with `z < cutZ` (Z = metres from the page's top edge) is gone, on every screen:

| | |
|---|---|
| Letters | eaten by `PageEater` (`main.js` `applyCut()`); "CV integrity" drops with them |
| Bullets | `CollisionWorld.cutZ`: no floor above the cut (`raycast()`); the eaten letters are already out of the grid |
| Players | the host (`pvp.js` `shredKills()`) **catches** every living player above the cut or within `CATCH_REACH` (0.35 m) of it: `combat.catch(id, "shred", x, z, catch × 1000)` → `{t:"caught", v, c, x, z, u}`; at `u` (1.6 s later) `combat.update()` kills them: `environmentKill(id, "shred")` → `{t:"death", v, by:v, h:0, c:"shred"}`. A death for the victim, no kill for anyone; respawn after 3 s as usual. Kill feed "X went through the shredder", killcam "Went through the shredder". The 1.6 s in between is the death sequence ("Death by shredder (S7)"); before S7 the host killed them on the spot |
| Spawns | `spawnFor()` only uses spots `SPAWN_LEAD` (30 m) or more below the cut (`spawnClear`); if none is left, a free spot in the middle of the remaining strip, facing down the page. Late joiners and reconnects that would land too close start ~40 m below the cut, facing away |
| Minimap | everything above the cut greyed out, with a red cut line (`minimap.cutZ`) |
| Rendering | the animated office hides the eaten part with the shredder's plane; without one (`?office=0`, the placeholder office) `applyCut()` puts its own plane at `z = cutZ` (`clipPage`) |
| End (S5) | when `phase` is `done` and the match is still on, the host calls `match.finish(rows, "shred")`: end message `why: "shred"`, end card "Match N · the CV went through the shredder: most kills wins". This check runs before the shredder's kills, so the final cut doesn't hand everyone a last death |
| Rematch | the world reset brings every letter back, the clock restarts at the press, the CV goes back in the tray and the countdown runs again |

### Config and dev options

`config.shredder` (see "Config reference"); on the host, `?shredAfter=N&shredSeconds=N` for quick
tests, e.g. `?shredAfter=8&shredSeconds=30&target=50`, and `?shredCatch=N` for a slow-motion
shredder death (S7). From the console: `__cv.pvp.shred` (the
current state) and `__cv.pvp.clock()` (`{elapsed, round, playing, startAt}`).

### Tests and validation (S1–S6, 2026-10-15)

- **Headless suites all pass**: `sim`, `test:ray`, `sim:pvp`, `test:interp`, `sim:net`, `sim:match`
  (28 checks, now including the match clock: waits for the first guest, started once by the host,
  same on every screen, restarted by every rematch, handed to late joiners) and the new
  **`sim:shred`** (26 checks: the timetable and countdown, `cutAt`, timings handed to live and late
  guests, a rematch restarting the clock, the page eater on 2,000 letters, the spawn rule,
  environment deaths counted as deaths with no kill and decided by the host only, the shred ending
  with the leader winning). `vite build` is clean.
- **Two windows** (headless, `?shredAfter=8&shredSeconds=30&target=50`): countdown, grab and feed
  notices on both screens; both computed the same phase and cut (within one frame) and ate the same
  letters; the host, placed near the top, went through the shredder ("Host went through the
  shredder") and respawned below the cut; at the end of the feed the match ended on both screens with
  "the CV went through the shredder: most kills wins"; Rematch put the CV back in the tray with all
  1,745 letters and restarted the countdown.
- **Three windows, a late joiner during the feed** (one window with `?office=0`): it landed on the same
  cut and letter count, the fallback plane hid the shredded part, and it spawned below the cut.

### Known limits

- Headless SwiftShader only: no real-GPU or phone check of the shredder yet.
- A guest is caught by the shredder one round trip late (the host decides it).
- The end view of a fully shredded match shows an empty tray.
- No human ear has checked the countdown blips yet.

### Death by shredder (S7)

Commits S7a (`c40e810`: the rules and the network) and S7b (`baa47c4`: what everyone sees and
hears). The cut no longer kills on the spot: it **catches** you, pulls you into the slot for
`config.shredder.catch` (1.6 s), and then the host kills you (still a death with no killer).

#### The sequence

| Time after the catch | The victim's own screen | Everyone else |
|---|---|---|
| 0 | no more control (`player.dead`, `weapon.blocked`, triggers released, crosshair hidden); the scream (not positional) | the scream from the body (positional, `refDistance` 10 m: it carries) |
| 0–0.15 s | the camera eases from the last view into the sequence (no jump) | |
| 0–30 % | slides along the paper to the slot line, turning to look at it | the soldier slides along the page to the slot |
| from 25 % | | paper strips spray out of the slot: 60 % in the victim's colour, 40 % paper white |
| 30–100 % | down the slot between the two cutter shafts, the shake growing (0.04 → 0.39 m) plus a rolling wobble | the soldier goes down the slot, falling back (tilt to −1.1 rad), cut off by the slot's plane as it goes in |
| 55 % | paper crunch at the cutters (`sfx.shredCrunch`) | the same crunch, positional at the slot |
| 72 % | the view tears into paper strips (`#shred-tear`) | |
| the death (1.6 s) | the shake jumps; the camera stays in the cutters; killcam "Went through the shredder · N" on a dark card, no camera move | the body is hidden; the strips stop 0.7 s later |
| respawn (3 s) / new match | `clear` / `clearAll`: overlay off, normal camera | original materials back, tilt reset |

Percentages are of the sequence's length (`until − now` at the catch, at least 0.4 s), so a
`?shredCatch=10` host slows everything down for everyone.

#### Path and timing (`src/fx/shredDeath.js`)

`ShredDeath.pathAt(a, k)`: the start is where the body was when caught, the **entry** the closest
point of the slot's plane (start − n · distance). For k < 0.3 it moves (smoothstep) from start to
entry, then to entry − n · depth · smoothstep((k − 0.3) / 0.7). `main.js` gives two getters:

- `plane()`: while the animated office feeds, `office.shred.plane` (the `Shredder_Throat` plane,
  normal out of the shredder); otherwise the fallback cut plane (`z ≥ cutZ`, normal +Z).
- `depth()`: with the cutters, 0.045 real m × K (≈ 38 game m: below them); without (`?office=0`,
  the placeholder office), 12 m: the body just goes through the cut.

In game space during the feed the slot's plane is vertical at z = cutZ, normal +Z (measured in the
browser), so "down the slot" is towards −Z, under the part of the page already eaten.

The sequence runs on the **wall clock** (`performance.now()`), not the frame `dt`: the first test,
at 1–2 fps headless, crawled because the game clamps `dt`; a slow frame rate can't stretch it any
more. A death message that arrives early snaps the path to its end (`died()`).

#### Rules and network (`src/net/combat.js`, `src/game/pvp.js`)

```js
combat.catch(v, cause, x, z, ms) // host only, while enabled: a living, uncaught player; death at now + ms
combat.isCaught(id)
// host → all (rel): {t:"caught", v, c:"shred", x, z, u}    u = host time of the death
// fx.caught(victim, cause, {x, z}, until)
```

- A player is caught once (`catch()` returns false after that).
- A caught player **can't be hurt**: hits on them are refused like hits on a dead player
  (`rejectedBy.dead`), so nobody steals the shredder's kill.
- At `u` the host's `Combat.update()` calls `environmentKill(id, "shred")`: the S4 death message
  `{t:"death", v, by:v, h:0, c:"shred"}`.
- A death, a respawn or a rematch (`resetRound()` → `fresh()`) clears `caught`: no death carried
  into a new match.
- `pvp.js`: `shredKills()` catches anyone with `z < cutZ + CATCH_REACH` (0.35 m, about a body
  radius), `ms` = `config.shredder.catch` × 1000 (default `CATCH_SECONDS`). `fx.caught` locks the
  local player if it is us and calls `shredDeath.caught(id, {self, color, at, until, now})`; `died`
  with cause `"shred"` → `shredDeath.died(id)`, `respawned` → `clear(id)`, `ended` / `started` →
  `clearAll()`. On a shredder death the killcam only shows the countdown (`shredded: true`).
- `NET_VERSION` 7 (`src/net/room.js`): tabs from before S7 get the usual version error.

#### The cutters (`Office.buildCutters()`)

Built in code (not in `office.glb`) under `Shredder_Throat` when the model has one, at real size, in
throat-local axes (X along the slot, +Y out of it, Z across it):

| | |
|---|---|
| Discs | a 14-tooth extruded star (R 9 mm, valleys at 0.84 R), 3.2 mm thick; one `InstancedMesh` per shaft, 31 discs at an 8 mm pitch, the second shaft offset by 4 mm so they interleave (4 mm strips) over 0.248 m |
| Shafts | at y = −0.028 m (just below the 12 mm slot), z = ±0.0095 m, a 3 mm axle each; they turn towards each other (`rotation.x += ±7 rad/s · dt`) while `office.shred.feeding` |
| Head interior | a dark `BackSide` box (0.27 × 0.05 × 0.05 m) at y = −0.037 m: only seen from inside |
| Material | `MeshMatcapMaterial` with a canvas radial-gradient steel matcap (lit the same whichever way the office swings), `fog: false`; disposed with the office |

At game scale a disc is ~15 m across; measured in the browser during a feed, the shafts sit ~24 m
behind the cut at y ≈ ±8 m. The placeholder office has no cutters.

#### Effects and sound

- **Own view** (`drive()`): the eye starts at standing height above the path point and ends just
  behind the body (0.4 m along +n), with the shake and a roll wobble (`sin(37 t) · 0.06`).
  `#shred-tear` (`index.html`, `src/style.css`): cream and grey paper strips with a red tint at the
  bottom, sliding down in 0.45 s to 94 % opacity (`.on`).
- **Other players' bodies**: position and tilt are overridden every frame; their meshes get their
  **own clones** of their materials with `clippingPlanes = [slot plane]`, so nothing else that shares
  those materials is clipped; `clear()` disposes the clones, puts the originals back and resets the
  tilt. After the death the avatar is hidden until the respawn.
- **Confetti**: its own `ParticleSystem` (900 × `config.gfx.particles`, gravity 2.5, drag 1.3),
  emitted from just outside the slot.
- **`sfx.scream(pos, seed)`**: a sawtooth voice through three "aah" formants (800, 1150, 2600 Hz),
  pitch up then falling away over 1.55 s, 6.5 Hz vibrato, a little breath; the base pitch depends
  on the player id (5 voices); `pos` null = our own (not positional). **`sfx.shredCrunch(pos)`**:
  7 quick band-passed noise crunches.
- **Killcam** (`combatHud.killcam({…, shredded: true})`): "Went through the shredder" on a dark card
  (`#killcam.shredded`) over the torn paper.

#### Config and dev options

`config.shredder.catch` = 1.6 s; `?shredCatch=N` on the host (0.4–20 s; `u` is in the message, so
the host's value counts for everyone). Console: `__cv.shredDeath`.

#### Validation (2026-10-15)

- All suites pass: `sim`, `test:ray`, `sim:pvp`, `test:interp`, `sim:net`, `sim:match` and
  `sim:shred`, now 34/34 with 8 new catch checks (caught once; guests learn who, where and when; a
  caught player can't be shot; still alive at 1.5 s; dead at 1.6 s with no kill; the guest agrees;
  respawns uncaught; a rematch frees a caught player). `vite build` is clean.
- Solo, deterministic camera check (headless): the own-view path slides to the slot and goes down
  between the two cutter shafts (the screenshots show the giant steel teeth), then the torn-paper
  overlay.
- Two windows with `?shredCatch=10`: the guest saw the caught host inside the slot between the
  cutters with orange (the host's colour) confetti; both shredder deaths counted as deaths with no
  kills; the match still ended on the shredder.
- Fixed during the test: the sequence crawled at 1–2 fps headless (the frame `dt` clamp); it now
  runs on the wall clock.

#### Known limits

- No real-GPU check (headless SwiftShader only).
- A remote victim's name tag lags the dragged body (tags are placed before the override).
- The cutters are low-poly and stylised.
- No human ear has checked the scream yet.

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

## Config reference (`config.office`, `config.shredder`)

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
| `audio` | `{ volume: 0.55, chatter: true, voices: 3, samples: {} }` | soundscape level, chatter on/off, max voices, optional recordings |

`config.shredder` (`game/shredder.js`; replaces the old `office.shredSeconds`):

| Key | Default | |
|---|---|---|
| `after` | `90` | match seconds before she reaches for the CV (the host's value counts; `?shredAfter=N` on the host) |
| `grab` | `9.35` | seconds from reaching to feeding: her Shred clip in `office.glb` (the CV reaches the slot at 9.33 s) |
| `seconds` | `45` | seconds the shredder takes to eat the page (the host's value counts; `?shredSeconds=N` on the host); also the solo demo's speed |
| `warn` | `10` | the HUD counts down these last seconds before she reaches |
| `bite` | `0.01` | real metres of the page already in the slot when the feed starts (≈ 8.5 game m): where the cut starts |
| `catch` | `1.6` | S7: seconds from the cut catching a player to their death (pulled into the slot); the host's value counts (`?shredCatch=N` on the host) |

## Validation (step 7)

Results of the validation pass on 2026-10-14 (commits O1–O7), before the shredder became gameplay
(its own results are in "The shredder in a match").

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
- [x] Network the shred sequence: in a match it runs off the shared match clock (S1–S2).
- [x] The shrinking map (S4–S5, "The shredder in a match").
- [ ] Shredder on real hardware: fps during the feed (clipping, flecks) on a mid-range laptop GPU and
      an Android phone (low preset), and a two-network match with a shred.
- [ ] Audio levels of the shredder and the countdown blips against the gunshots (a human ear).
- [ ] The end view of a fully shredded match shows an empty tray.
- [x] Death by shredder: caught, pulled into the slot, through the cutters (S7).
- [ ] The shredder death on real hardware, the scream checked by ear, other players' name tags
      following the dragged body.

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
| O8 | `4562f15` | the office documentation |
| S1 | `4bee018` | a shared match clock (`Match.startAt`, `go`, `elapsed`; `NET_VERSION` 6) |
| S2 | `13c52ff` | she grabs the CV 1:30 into a match, on every screen at once (`game/shredder.js`, `syncShred`, `sim:shred`) |
| S3 | `7d5dcb4` | the 10-second countdown, notices, "shredder NN%" in the match bar |
| S4 | `2a76c46` | the shredded part is gone: letters, bullets, players (death, no killer), spawns, minimap, fallback clip plane |
| S5 | `63f1683` | the page used up before the kill target: the leader wins |
| S5b | `f4a849d` | fixes from the two- and three-window runs (killcam text, late joiners below the cut) |
| S6 | `0d46e32` | the shredder-in-a-match documentation |
| S3b | `8e640c6` | commit the missing `#shred-warn` HUD element |
| S7a | `c40e810` | the shredder catches first, the host kills 1.6 s later (`{t:"caught"}`, `NET_VERSION` 7) |
| S7b | `baa47c4` | the death sequence: into the slot, through the cutters (`fx/shredDeath.js`, `buildCutters()`, scream) |
| S7c | | this documentation |
