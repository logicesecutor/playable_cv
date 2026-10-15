# Destroy Your Career — plan

Formerly "Playable CV" (renamed in v0.4.0); the repo and the GitHub Pages URL keep the old
`playable_cv` name. Current version: **0.5.0** (mobile touch controls; the "prototype · vX" tag on
the first page reads `package.json`).

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
| Multiplayer | **Peer-to-peer WebRTC, host's browser is the referee.** No game server: the public PeerJS broker (`0.peerjs.com`, overridable with `?broker=`) only does the handshake, Google + Cloudflare STUN, optional free Metered TURN relay for strict networks. 2–8 players, deathmatch first to 10, a fresh CV per match, host leaving ends the game (a dropped guest can come back). Deployed on GitHub Pages by a GitHub Action (MP5). |
| Mobile | **Phones and tablets in landscape, on-screen controls.** Floating joystick with auto-sprint at the edge (roughly forward), drag to look, fire button that also aims with the same thumb, crouch on hold; fullscreen + landscape lock on Play where supported (Android yes, iPad fullscreen only, iPhone neither); automatic low graphics preset; no aim assist for now. Targets Android Chrome and tablets. Full plan in [MOBILE.md](MOBILE.md). |
| Office (environment) | **The CV lies in a letter tray on a giant office worker's desk, at true scale** (1 real m ≈ 850 game m). The office is modelled in real metres in Blender and placed around the page by `office.root.matrix = T(page centre) · S(K) · inverse(CV_Anchor)`: the page never moves, when she lifts the CV the office swings around the players, so gameplay and networking are untouched. Static parts are **baked** (Cycles lightmaps shown unlit); she is lit by a small office-frame Lambert shader. 50-bone rig, 7 clips, idle scheduler. **Procedural, positional soundscape** (no files; optional recordings via `config.office.audio.samples`). **Tray walls stop bullets only** (players are already clamped to the page). Shred sequence: gameplay in a match (next rows), a visual-only demo in single player (O key, `?shred=N`). `?office=0` = no office (in a match the shredder still shrinks the map). Details in [docs/OFFICE.md](docs/OFFICE.md). |
| Shredder trigger | **1:30 after the match starts, on a shared match clock** (`config.shredder.after`). Round 1's clock starts **when the first guest is in the game** (a host waiting alone loses nothing); every rematch restarts it **at the Rematch press**. Nothing about the shred is sent: every screen computes it from the clock (`src/game/shredder.js`). |
| Shrinking map | **The shred changes gameplay**: the page is eaten from the top edge in 45 s (~5.4 m/s, walking outruns it); letters, floor and spawns above the cut are gone. A player caught there **dies: a death with no killer** (host decides; since S7 pulled into the slot first, next rows). |
| Shred ending + warning | If nobody reached the kill target when the page is used up, **the match ends and the leader wins**. Warning: a **10-second HUD countdown** before she reaches for the CV. |
| Death by shredder (S7) | **Caught, pulled into the slot (~1.6 s), then dead** (still a death with no killer; a caught player can't be shot, so nobody steals the kill). The victim's own view goes **first-person into the blades**; everyone else sees the soldier **dragged into the slot plus confetti in the victim's colour**; **a scream** on a shredder death. A strained-motor grind while someone is inside was offered and not chosen. Details in [docs/OFFICE.md](docs/OFFICE.md) "Death by shredder (S7)". |

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
      marks, ammo, CV integrity). Left: zoom/rotate minimap option, end screen at 0% (kill feed came with MP4).
- [ ] **M9 — Polish.** Multi-page CVs (pages laid side by side), settings panel (scale, height,
      mouse sensitivity), performance pass, restart / load another CV.
- [x] **MP1 — Lobby + shared map.** "Invite friends" on the pause card opens a room (only then:
      single player stays offline) and gives a `#join=pcv-…` link. Guests pick a name, connect
      peer-to-peer, receive the host's original PDF and rebuild the same map (fingerprint checked).
      Player list, join/leave feed, clear errors (dead link, full, version, p2p blocked, broker
      down), host leaving sends everyone back to the start page. `npm run signal` + `?broker=` for
      LAN/offline play. Tested with 2–3 headless Chromium tabs on `example_cv.pdf` (1,745 entities).
- [x] **MP2 — See each other.** Player state 20×/s over the "fast" channel on a shared host clock,
      host relays to the other guests, adaptive snapshot interpolation (Hermite + extrapolation).
      Low-poly soldier avatars in player colour holding the same gun (walk/run, crouch, jump, aim
      pitch), HTML name tags and minimap dots only in line of sight ("fair" visibility), positional
      footsteps, ping in the player list, soft push between players, per-guest spawn spots.
      `?netsim=` simulates a bad network; `npm run test:interp` tests smoothing under 5 networks
      (error p95 ≈ 0.03 m). Two headless Chromium tabs at 80 ± 40 ms / 5 % loss each way: RTT
      ~200 ms, guest drawn within p95 0.14 m (0.08 m without netsim), no teleports. Not yet tested
      over the real internet (`0.peerjs.com` unreachable from the sandbox).
- [x] **MP3 — Shared destruction.** Every player predicts their own shots (instant hit effects and
      kills), guests batch hits to the host every 50 ms, the host validates them (letter alive,
      shooter in range) on its authoritative map and batches hits/kills by entity id to everyone; a
      refused hit revives the letter for its shooter. Late joiners get a snapshot of the damaged map
      (destroyed ids, HP, counts). "N letters" destroyed per player in the player list. Guest join
      timeout is now inactivity-based (big CVs on slow uplinks are fine). `npm run sim:net`: host +
      3 guests + a late joiner shoot 60 s over a laggy link, all maps match the host's at 80 ± 40 and
      200 ± 150 ms (~1,080 kills, ~315 rejected hits, 0 mismatches). Two headless Chromium tabs at
      80 ± 40 ms / 5 % loss: guest joined into an already damaged CV with identical state, both fired
      150 shots at the same letters (2 contested kills went to the host), identical alive letters,
      HP, integrity and counts on both; a late joiner matched too. Floor scorch marks and remote
      tracers / gunshots moved to MP4.
- [x] **MP4 — PvP.** Hitboxes (body capsule + head sphere, standing / crouched), 100 HP, 25 body /
      50 head, linear falloff past 40 m to 60 % at 120 m+, regen 8 HP/s after 5 s without damage.
      The shooter's screen decides the hit, the host rewinds the victim to that moment and checks it.
      Death: 3 s killcam on the killer, collapse for the others, auto respawn at the free spot farthest
      from enemies with full ammo and 2 s spawn protection (ends when you shoot). Health bar, damage
      flash + direction arc, kill feed, Tab scoreboard (K/D, letters, ping). Others' tracers, muzzle
      flashes, positional gunshots and floor scorch play in step with their avatar; a shooter shows on
      everyone's minimap for 1.5 s. A host in a hidden tab keeps the network running on a timer.
      Fix: your own tracers never showed (the muzzle point was a shared vector `tracer()` overwrote).
      `npm run sim:pvp`: host + 5 guests fight 90 s with 8 % fake hits, all PASS at 80 ± 40 and
      200 ± 150 ms (≈ 90–97 kills, every fake refused, 0 honest hits refused). Two headless Chromium
      tabs at 80 ± 40 ms / 5 % loss: 4 body shots or 2 headshots kill, killcam, kill feed, respawn
      with protection, guest → host hits pass the rewind check, 5/5 remote shots played, identical
      scoreboards; a host with no animation frames still sends ~9 states/s.
- [x] **MP5 — Match flow + ship.** First to 10 kills (host referees) → the same end card on every
      screen (winner, final table, awards: Demolition / On a roll / Sharpshooter), shooting stops, the
      camera rises to the top view of the wrecked CV; the host's **Rematch** restores every letter and
      the clean paper in place (no rebuild), zeroes scores and spreads everyone over the page. Hits from
      an earlier round are dropped. Match bar "First to 10 · leader · you"; late joiners get the match
      (and the end card). Drop-outs: a guest lost without "bye" is "away" for 60 s with its score,
      auto-rejoins with a per-tab key (same id, colour, score, no PDF download, same position); 10 s
      silence watchdogs both ways; the host re-registers on the broker with the same id + token so
      the invite link survives. Optional Metered TURN relay (`?relay=1`, `?turn=`, "· relay" in the
      player list). Shots sent twice with a sequence number. GitHub Pages workflow
      (`BASE_PATH=/<repo>/`). `NET_VERSION` 4. `npm run sim:match`: 3 matches over a laggy link with
      instant rematches and late joiners, 21/21 PASS at 80 ± 40 and 200 ± 150 ms. Two headless
      Chromium browsers at 80 ± 40 ms / 5 % loss: match end + identical end cards + awards, host-only
      rematch, late joiner on the end card, all letters back and scores zeroed on 3 screens; guest
      silenced → away within 10 s → auto-rejoin with same id, score and position, no download; broker
      restarted → new guest joins via the old link; a guest that never returns is removed after ~60 s;
      earlier milestones re-checked. **Still to do (Christian):** fill in the Metered relay key in
      `src/config.js`, push to deploy, and the real two-network test (PC + phone on mobile data).
- [x] **Characters, gun & animation (P0–P3).** Models built by Python scripts in Blender
      (`blender_src/scripts/`, local-only and git-ignored), exported to `public/models/*.glb` (committed).
      **P0 pipeline:** one shared palette texture, materials `Palette` / `Accent` (tinted per player) /
      `Glow`; `src/assets/models.js` preloads the models (a map waits ≤ 8 s), `instantiate()` gives
      per-player copies facing three.js -Z, procedural fallback when a file is missing; dev model viewer
      `viewer.html`. **P1 characters:** chibi job hunters, Corporate and Software Engineer outfits on one
      14-bone rig, outfits assigned by the host balanced-random (`PlayerInfo.outfit`, `NET_VERSION` 5),
      hitboxes resized (head 0.29 m, body tops 1.32 / 0.72 m). **P1.7 look:** rim light, optional toon
      ramp (`config.characters`, `?toon=1` / `?rim=`). **P2 gun:** typewriter blaster (paper-slot muzzle,
      ink-ribbon cartridge magazine, space bar in the player's colour, first-person mittens).
      **P3 animation:** 9 Blender clips (Idle, Walk, Run, Crouch, CrouchWalk, Jump, Death, Fire, Reload)
      on an AnimationMixer state machine with a procedural layer (aim, head, hands, reload, death);
      `FLAG.reload` lets others see a reload. `test:ray`, `test:interp`, `sim:pvp`, `sim:match` and the
      build still pass. Details in the README ("Characters and the gun").
- [x] **Word shots (P4).** Every shot (ours and remote) flies a typed rejection slip (`WORDS` /
      `RARE_WORDS` 1 in 8, `src/fx/wordShots.js`) at 120 m/s, same word everywhere via deterministic
      `pickWord(shooterId, seq)` (no new network data); REJECTED stamp over destroyed letters, printed
      on the paper (≤ 1 per ~7 m, cleared on rematch); FIRED! over kills. Purely visual. Single player +
      headless two-page duel, `sim:pvp`, `sim:match`, `test:ray` and the build pass. Details in the
      README ("Word shots").
- [x] **Rename + animated title (v0.4.0).** The game is now **Destroy Your Career** everywhere players
      see it (browser tab, first page, join screen "Join the game", loading screen, end card, model
      viewer, package name `destroy-your-career`); tagline "Your CV. Their bullets. No callbacks."
      `src/ui/title.js`: "Destroy Your" types itself out, then a red rubber stamp CAREER slams down
      (the REJECTED / FIRED! stamp look), animated once on the first page and the join screen, static
      and small on the loading screen and end card, respects `prefers-reduced-motion`. The
      "prototype · vX" tag reads `package.json` via the Vite define `__APP_VERSION__`, bumped to 0.4.0.
      Kept on purpose: repo + Pages URL (`playable_cv`, invite links keep working), `localStorage` keys
      `playable-cv:*` (saved names, rejoin keys) and the `[playable-cv]` console prefixes.
- [x] **Mobile touch controls (T1–T5), v0.5.0.** Touch mode decided once at load (`?touch=1/0`);
      `player.active` (pointer lock or touch Play) replaces the pointer-lock checks; on-screen controls
      (`ui/touchControls.js`): floating joystick with analog speed and auto-sprint, drag look, fire + aim
      with one thumb, jump, crouch (hold), reload, pause / scoreboard / mute, multi-touch by `pointerId`;
      landscape only (rotate card), fullscreen + orientation lock on Play, auto-pause (portrait,
      background, leaving fullscreen); HUD inside the safe areas; "low" graphics preset on touch
      (`?gfx=`). All sims pass, desktop unchanged in Chromium, emulated Pixel 7 multi-touch checked.
      **Still to do (Christian):** the real-device checklist in [MOBILE.md](MOBILE.md).
- [x] **Office environment (O1–O8)**, branch `feature/office-environment`. **O1** real-scale placeholder
      office around the CV, inverse-anchor placement (`src/world/office.js`, `debugTilt`). **O2** Blender
      blockout exported to `public/models/office.glb` (placeholder kept as the fallback). **O2b** the
      letter tray's walls stop bullets (`CollisionWorld.walls`, weapon result `"wall"`, sparks; a plain
      shot on the network). **O3** furnished open-plan office, Cycles-baked lightmaps (`bake_office.py`),
      `Baked_*` materials unlit in the game. **O4** the giant woman (`build_woman.py`): one skinned mesh,
      50-bone rig, office-lit shader (`config.office.shade`). **O5** her 7 clips (`anim_woman.py`: Type,
      Mouse, Sip, Stretch, Glance, Clock, Shred; NLA tracks at 30 fps), idle scheduler
      (`config.office.idle`, `idleGap`), the shred sequence (O key, `?shred=N`, `office.shred` =
      `{active, feeding, progress, cutZ, plane}`, page clipped by the shredder's plane, paper flecks +
      rumble): visual and local only. **O6** procedural positional soundscape
      (`src/audio/officeAmbience.js`, `?ambience=0`, `config.office.audio.samples` hook). **O7** models
      preload per file: the landing preview waits only for `CHARACTER_MODELS`, never for `office.glb`.
      **Validation:** `sim`, `test:ray` (+ 2,000 wall rays, 0 errors), `sim:pvp`, `sim:match`,
      `test:interp`, `sim:net` and the build pass; `?office=0` is the old gameplay path byte for byte.
      Cost: +7 draw calls (283 → 290), ≈ +27k triangles (573k → 600k), +4 textures (~11 MB GPU),
      `office.update` 0.1–0.3 ms/frame, GLB 2.2 MB (headless SwiftShader only, no real-GPU fps yet).
      Two-window multiplayer: same map hash, office on both, destruction and kills synced, host shots hit
      tray walls, shred on the host only. Transient guest "Connection lost" banners (recovered in ~10 s)
      came from two SwiftShader windows starving one CPU (also seen with the office off, more often with
      it on). **O8** docs: [docs/OFFICE.md](docs/OFFICE.md), README "The office".
      **Still to do:** real-GPU / real-device fps, mobile check, a human listening pass on the audio
      (chatter). (Network-syncing the shred and the shrinking map: done in S1–S5 below.)
- [x] **The shredder in a match (S1–S6)**, branch `feature/shred-trigger` (from
      `feature/office-environment`). **S1** a shared match clock: `Match.startAt` in host time, `go(at)`
      when the first guest is in the game (`{t:"match", s:"go", r, at, sh}`), restarted by every
      rematch (`start` carries `at`), in the late-join snapshot; `NET_VERSION` 6. **S2** she grabs the CV
      1:30 in on every screen at once: `src/game/shredder.js` (pure) turns the clock into
      `{phase waiting / grab / feeding / done, t, progress, cutZ, countdown}`; timings in `config.shredder`
      (after 90 s, grab 9.35 s = her Shred clip, seconds 45, warn 10 s, bite 1 cm; `office.shredSeconds`
      removed), the host's `after` / `seconds` travel with the clock (`sh`, dev `?shredAfter=` /
      `?shredSeconds=` on the host); `office.syncShred(t, progress)` follows the clock (late joiners see
      her mid-clip) with the visible cut on the gameplay line (`cutAt`); O key / `?shred=N` now solo-only.
      **S3** the 10 s countdown ("She's reaching for your CV", blips), grab / feed notices, match bar
      "shredder NN%". **S4** the shredded part is gone: letters eaten when the cut passes their middle
      (`PageEater`, every screen, no network), no floor for bullets (`CollisionWorld.cutZ`), the host
      kills anyone above the cut (`Combat.environmentKill`, `{t:"death", v, by:v, h:0, c:"shred"}`:
      a death, no kill; kill feed / killcam "went through the shredder"), respawns 30 m+ below the cut,
      minimap greyed out with a red line, a fallback clip plane without the animated office. **S5** the
      page used up first: the host ends the match (`Match.finish(rows, "shred")`, `why: "shred"`), the
      leader wins, end card "the CV went through the shredder: most kills wins". Fixes: killcam text,
      late joiners / reconnects spawn below the cut. **Validation:** `sim`, `test:ray`, `sim:pvp`,
      `test:interp`, `sim:net`, `sim:match` (now with match-clock checks, 28/28) and the new `sim:shred`
      (26/26) pass, the build is clean. Two headless windows (`?shredAfter=8&shredSeconds=30&target=50`):
      countdown and notices on both, same phase and cut within a frame, same letters eaten, the host
      near the top went through the shredder and respawned below the cut, the match ended on both with
      the shred end card, Rematch brought back all 1,745 letters and the countdown. Three windows with a
      late joiner during the feed (one with `?office=0`): same cut and letter count, fallback plane,
      spawned below the cut. **S6** docs: [docs/OFFICE.md](docs/OFFICE.md) "The shredder in a match",
      README. **Known limits:** headless SwiftShader only (no real-GPU / phone check), guests see their
      own shredder death one round trip late, the end view of a fully shredded match shows an empty
      tray, the countdown blips are unheard by a human so far.
- [x] **Death by shredder (S7)**, branch `feature/shred-trigger`. **S7a** (`c40e810`) the cut catches
      before it kills: the host's `shredKills()` calls `Combat.catch(v, "shred", x, z, ms)` for anyone
      above the cut or within `CATCH_REACH` (0.35 m) of it → `{t:"caught", v, c, x, z, u}` (`u` = host
      time of the death); a caught player can't move (own screen) or be hurt (no stolen kills); at `u`
      `Combat.update()` kills them (`environmentKill`); a death, respawn or rematch clears it;
      `NET_VERSION` 7; `sim:shred` +8 checks. **S7b** (`baa47c4`) the sequence (`src/fx/shredDeath.js`,
      on the wall clock): the victim's camera turns to the slot, slides along the paper and goes down
      between the cutters shaking harder, then the torn-paper overlay (`#shred-tear`) and the killcam on
      a dark card; the others see the soldier dragged into the slot, clipped by the slot's plane
      (per-avatar cloned materials), with confetti in the victim's colour; `sfx.scream` /
      `shredCrunch`; the cutters (`Office.buildCutters()`: two shafts of interleaved 14-tooth steel
      discs, Ø 18 mm, 4 mm strips, matcap steel, spinning while feeding, ~15 m across in game);
      `config.shredder.catch` 1.6 s, dev `?shredCatch=N` (host), `__cv.shredDeath`. **Validation:**
      all suites pass (`sim:shred` 34/34), the build is clean; a headless solo camera check went down
      between the cutter shafts, then the paper tore; two windows with `?shredCatch=10`: the guest saw
      the host in the slot between the cutters with orange confetti, both shredder deaths were deaths
      with no kills, the match still ended on the shredder; the sequence crawled at 1–2 fps headless
      until it moved to the wall clock. **S7c** docs: [docs/OFFICE.md](docs/OFFICE.md) "Death by
      shredder (S7)", README. **Known limits:** no real-GPU check, a remote victim's name tag lags the
      dragged body, low-poly stylised cutters, the scream unheard by a human so far.

## Multiplayer architecture

- **Signaling vs P2P.** `net/signaling.js` speaks the PeerJS server protocol over a WebSocket, only to
  swap WebRTC offer/answer/ICE. The host registers as `pcv-<id>` (the id in the invite link); a guest
  registers a throwaway id, sends an OFFER to it, and drops the broker once the CV has arrived.
- **One link per guest** (`net/peerLink.js`): the guest offers, the host answers. Channel `rel`
  (reliable, ordered) for events and the PDF (16 KB chunks with backpressure); `fast` (unordered,
  no retransmits) for player state and ping/pong.
- **Host authority** (`net/room.js`): the host assigns ids and colours, owns the player list,
  validates letter hits (MP3), referees PvP (MP4) and the match (MP5). Star topology: guests only talk to the host.
- **Messages** (JSON, `NET_VERSION` = 7 since the shredder's `caught` message, S7; 6 was the shredder's match clock, S1; 5 was the characters: `PlayerInfo.outfit` in `players` /
  `welcome`). `rel`:
  `hello {v,name,k,have}` (`k` = per-tab rejoin key, `have` = `{hash,count}` of a map the guest already
  has) → `welcome {you,players,map,pdf,world}` + PDF bytes (`pdf` = null and no bytes when `have`
  matches), or `reject {reason}` (version, full); `world` = `{letters, combat, match}`: `letters` =
  destruction snapshot `{dead:[id…], hp:[[id,hp]…], kills:[[player,n]…]}`, `combat` = `[[player, hp,
  alive, protectedUntil, kills, deaths, streak, best, heads]…]` (MP4/5), `match` = `{p,r,t,w,sc,aw,at,sh,why}`
  (phase, round, target, winner, scores, awards; since S1 the match clock start, the host's shredder
  timings and how the last match ended);
  `ready {hash,count}` once the guest's map is built; `players` on every change (state `loading` /
  `in-game` / `away`, `route` direct / relay); `pings {p:[[id,ms]…]}`
  every 2 s; `kick` (map mismatch); `bye` on leaving. Unknown types go to `onGameMessage` (a guest
  queues them while its map loads and replays them on `setGameHandler`).
  Destruction (MP3): `hits {r,h:[[id, px,py,pz, nx,ny,nz, dx,dy,dz]…]}` guest → host every 50 ms (`r` =
  match round, MP5);
  `dmg {e:[[type, id, by, hp, px,py,pz, a,b,c]…]}` host → all every 50 ms (type 0 hit, `a,b,c` = surface
  normal; 1 kill, `a,b,c` = bullet direction); `hitNo {id,hp}` host → shooter for a refused hit.
  PvP (MP4): `pvp {r,v,h,d,p:[x,y,z],vt}` shooter → host (round, victim, headshot, distance, hit point,
  `vt` = when the shooter saw the victim, host clock); host → all: `hurt {v,by,hp,h,s:[x,z]}` (`s` = shooter
  position for the direction arc), `death {v,by,h}`, 3 s later `respawn {v,x,z,y,u}` (`y` = yaw,
  `u` = end of spawn protection).
  Match (MP5), host → all: `match {s:"end", r, w, sc:[[id,kills,deaths,letters,heads,best]…],
  aw:[[key,id,value]…], why}` and `match {s:"start", r, u, at, sh, sp:[[id,x,z,yaw]…]}` (rematch, `u` =
  end of spawn protection); since S1 (`NET_VERSION` 6) also `match {s:"go", r, at, sh}` (the match clock
  started: `at` = host time, `sh` = the host's shredder `[after, seconds]`), `why` = `"kills"` /
  `"shred"`, and the late-join `match` snapshot gains `at`, `sh`, `why`. Shredder deaths:
  `death {v, by:v, h:0, c:"shred"}`; since S7 (`NET_VERSION` 7) preceded by
  `caught {v, c:"shred", x, z, u}` (host → all: the cut has them, `x, z` = where; `u` = host time of
  the death, `config.shredder.catch` s later; a caught player can't be hurt).
  `fast`: `ping {c,r}` (guest → host, `r` = its measured RTT) → `pong {c,h}` (`h` = host clock);
  state `s {i,k,h,p:[x,y,z],a:[yaw,pitch],v:[vx,vy,vz],f}` (`f` flags crouch/grounded/sprint/fly/reload,
  ~110 bytes) plus, when we fired recently, `x:[[ox,oy,oz, ex,ey,ez, kind, seq]…]` (kind 0 miss,
  1 floor, 2 letter, 3 player). Since MP5 each shot rides in two consecutive states; the receiver drops
  a `seq` it has already seen, so one lost packet no longer hides a gunshot. Other fast types go to
  `onFastMessage`.
- **State sync** (`net/sync.js`, MP2): each client sends its own state at 20 Hz once its intro is over
  and its clock is synced; the host relays guest states to the other guests (overwriting `i` with
  the sender's id). ~110 B × 20 Hz per player: with 8 players the host uploads ≈ 1–1.5 Mbit/s.
- **Shared clock** (`net/clock.js`): the host's `performance.now()` is game time. Guests ping 6× in
  quick succession then 1/s, take the offset from the lowest-RTT of the last 12 samples, slew ≤ 4 ms
  per sample (jump if > 250 ms off). Ping shown = median RTT.
- **Interpolation** (`net/snapshots.js`): remote players are drawn at `now − delay`, delay = lateness
  EWMA + 2.5 × jitter + 50 ms interval + 10 ms, clamped 60–400 ms (grows fast, shrinks slowly). Cubic
  Hermite between snapshots using the sent velocities; extrapolate up to 250 ms when packets are
  missing, then hold; no interpolation across a jump > 4 m. A state gap > 2.5 s shows "connection lost…".
- **Visibility** ("fair"): every 0.1 s, a remote player counts as seen if its head or chest is in the
  view frustum and a ray through the collision grid reaches it. Only then are its name tag and
  minimap dot shown (the avatar itself is always rendered, letters occlude it naturally).
- **Soft push**: each client only moves itself, sliding out of any other player closer than 2 radii.
- **Shared destruction** (`net/letters.js`, MP3): `Destruction.bullet` predicts our own shot (effects,
  HP − 1, shatter at once if it kills) then calls `onLocalHit`. The host accepts a guest's hit only if
  the letter is still alive and the shooter's last known position is within weapon range + 25 m,
  applies it to its own (authoritative) map and broadcasts the result. Guests play others' hits, shatter
  kills unless already gone (own prediction), and only lower HP to the host's value (own hits may still
  be in flight). `hitNo` revives a letter predicted dead (soot stays). Late join: the host takes the
  snapshot *before* registering the guest, flushing pending events to the others first, so nothing is
  missed or applied twice; the guest applies it with silent kills (no shards). `netsim` sends reliable
  messages through one in-order queue (separate timers could overtake each other).
- **Combat** (`net/combat.js` pure JS, glue in `game/pvp.js`, MP4): what you see is what you hit. The
  shooter raycasts the hitboxes (`net/hitbox.js`) at the *interpolated* positions it draws and sends
  `pvp`; the host's own hits apply directly. The host checks shooter + victim alive, victim not
  protected, and rewinds the victim's 2 s position history to `vt`: the claimed point must be within
  1.2 m + body radius (`rejectedBy` counts dead / protected / rewind refusals). 100 HP, 25 body / 50
  head, falloff past 40 m to 60 % at 120 m+, regen 8 HP/s after 5 s (also run locally for display;
  every `hurt` carries the host's exact HP), respawn after 3 s with 2 s protection. The host's rewind
  history comes from relayed state messages + its own player. Shots ride in the next 20 Hz state
  (`x`) and are played when the delayed avatar reaches that moment, so tracer and gun line up.
  Browsers stop animation frames in hidden tabs, so a 100 ms timer keeps sending states and updating
  letters + combat whenever frames stop (a host can switch tabs). `NET_VERSION` stayed 3 in MP4.
- **Match + rounds** (`net/match.js` pure JS, glue in `game/pvp.js`, HUD in `ui/matchHud.js`, MP5): the
  host runs `Match.check` after every kill; at `killTarget` it sends `match end` (winner, final rows,
  awards computed by `results()`) and every client disables combat (`combat.enabled = false`), blocks
  the weapon and flies the camera to the top view. The host's Rematch bumps the round and sends
  `match start` with spawns spread over the page; everyone runs `Destruction.resetAll` (letters + paper
  from the pristine raster copy `pdf.rasterClean`, `Debris.clear`), `LetterNet.reset`,
  `Combat.resetRound`. Guest `hits` and `pvp` carry `r`; the host drops any from an earlier round. All
  of it goes over the reliable, ordered channel, so a guest sees the last kill before the end.
- **Drop-outs + rejoin** (`net/room.js`, MP5): both sides close a link with no traffic for 10 s
  (`PeerLink.lastRecv`; test switch `link.blackhole`). A guest that closes without `bye` stays in the
  list as `away` for 60 s (score kept, no avatar), then is removed. The guest side gets reason `lost`
  and retries `GuestRoom.join` every 2 s for 60 s with the same `rejoinKey(roomId)` (sessionStorage)
  and `have` = its map, then rebuilds the game from the same pdf without intro, at the same position.
  The host matches the key to the away player (same id, colour, score) and retires any stale link. If
  the broker says the room is gone: "The host left the game."
- **Broker reconnect** (MP5): the host keeps its room id and signaling token; when the broker socket
  drops it reconnects with backoff 1 s → 30 s (notices in the feed), so the invite link keeps working.
  Guests already in never need the broker.
- **Relay (TURN)** (`net/ice.js`, MP5): with `config.net.turn.metered {app, apiKey}` set, both sides
  fetch `https://<app>.metered.live/api/v1/turn/credentials?apiKey=<key>` (free plan, 500 MB/month;
  the credential key is public by design, never the Secret Key), cached 10 min, host refresh every
  9 min, fallback to STUN only on error. `?relay=1` sets `iceTransportPolicy: "relay"`, `?turn=<app>:<key>`
  overrides per page load. The host reads the selected candidate pair (`routeOf`, getStats) and shows
  "· relay" + a notice. The p2p error text depends on whether a relay was configured. Key not filled
  in yet.
- **Deploy** (MP5): `.github/workflows/deploy-pages.yml` builds on push to `main` (or by hand) with
  `BASE_PATH=/<repo>/` (`vite.config.js` `base`) and publishes `dist/` to GitHub Pages
  (https://logicesecutor.github.io/playable_cv/). One-time: repo public, Pages source "GitHub Actions".
  Claude commits locally only; Christian pushes.
- **Map fingerprint** (`net/mapHash.js`): entity count + FNV-1a hash of kinds, glyph ids and footprints
  rounded to 10 cm. Entity ids are what later sync uses, so a count mismatch kicks the guest; a hash
  mismatch is only logged (JS engines may round differently).

## Open questions for later

- Multi-page PDFs: pages side by side, or one level per page?
- Single player win condition (e.g. "destroy the whole Skills section"), or pure sandbox? (Multiplayer
  has deathmatch to 10 since MP5.)
- The shrinking map (what starts the shred, are players behind the cut killed or pushed): **decided and
  built** in S1–S5, a 1:30 match timer and players above the cut die with no killer (pulled into the slot first since S7; see "Decisions so
  far"). The timings (1:30 + 45 s) still need a check with real players.

## Run it

```bash
npm install
npm run dev     # opens http://localhost:5173
```

Node 18+ is needed. Node-only debug tools (Node 22.13+):
`npm run extract -- example_cv.pdf` dumps what the extractor sees;
`npm run sim -- example_cv.pdf` runs the headless movement/collision test.
`npm run signal` starts a local signaling server for LAN multiplayer (open the game with `?broker=ws://<ip>:9000`).
`npm run test:interp` tests remote-player smoothing under simulated networks; `npm run sim:net` tests shared
destruction, `npm run sim:pvp` player vs player and `npm run sim:match` the match flow (`LAG=`, `JITTER=`, `SEED=`);
`?netsim=lag:80,jitter:40,loss:0.05` simulates a bad network in the browser, `?target=3` shortens matches,
`?relay=1` / `?turn=<app>:<key>` test the TURN relay, `?touch=1` / `?touch=0` force the touch controls,
`?gfx=low` / `?gfx=high` pick the graphics preset, `?office=0` / `?ambience=0` turn off the office / its sound,
`?shred=N` starts the solo shred demo N s after the intro (also the O key, single player only),
`?shredAfter=N` / `?shredSeconds=N` on the host time the match shredder, `?shredCatch=N` slows down a shredder death; `npm run sim:shred` tests it. `npm run build` builds the site (GitHub Pages: see the README).
