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
| Multiplayer | **Peer-to-peer WebRTC, host's browser is the referee.** No game server: the public PeerJS broker (`0.peerjs.com`, overridable with `?broker=`) only does the handshake, Google + Cloudflare STUN, no TURN yet (strict NATs may fail). 2–8 players, deathmatch first to 10, a fresh CV per match, host leaving ends the game. Deployed on GitHub Pages (MP5). |

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
- [ ] **MP5 — Match flow + ship.** First to 10 → end screen → rematch on a fresh CV, disconnect
      handling, GitHub Pages deploy + real remote testing (ping display already done in MP2).

## Multiplayer architecture

- **Signaling vs P2P.** `net/signaling.js` speaks the PeerJS server protocol over a WebSocket, only to
  swap WebRTC offer/answer/ICE. The host registers as `pcv-<id>` (the id in the invite link); a guest
  registers a throwaway id, sends an OFFER to it, and drops the broker once the CV has arrived.
- **One link per guest** (`net/peerLink.js`): the guest offers, the host answers. Channel `rel`
  (reliable, ordered) for events and the PDF (16 KB chunks with backpressure); `fast` (unordered,
  no retransmits) for player state and ping/pong.
- **Host authority** (`net/room.js`): the host assigns ids and colours, owns the player list,
  validates letter hits (MP3) and referees PvP (MP4). Star topology: guests only talk to the host.
- **Messages** (JSON, `NET_VERSION` = 3). `rel`:
  `hello {v,name}` → `welcome {you,players,map,pdf,world}` + PDF bytes, or `reject {reason}` (version,
  full); `world` = `{letters, combat}`: `letters` = destruction snapshot `{dead:[id…], hp:[[id,hp]…],
  kills:[[player,n]…]}`, `combat` = `[[player, hp, alive, protectedUntil, kills, deaths]…]` (MP4);
  `ready {hash,count}` once the guest's map is built; `players` on every change; `pings {p:[[id,ms]…]}`
  every 2 s; `kick` (map mismatch); `bye` on leaving. Unknown types go to `onGameMessage` (a guest
  queues them while its map loads and replays them on `setGameHandler`).
  Destruction (MP3): `hits {h:[[id, px,py,pz, nx,ny,nz, dx,dy,dz]…]}` guest → host every 50 ms;
  `dmg {e:[[type, id, by, hp, px,py,pz, a,b,c]…]}` host → all every 50 ms (type 0 hit, `a,b,c` = surface
  normal; 1 kill, `a,b,c` = bullet direction); `hitNo {id,hp}` host → shooter for a refused hit.
  PvP (MP4): `pvp {v,h,d,p:[x,y,z],vt}` shooter → host (victim, headshot, distance, hit point, `vt` =
  when the shooter saw the victim, host clock); host → all: `hurt {v,by,hp,h,s:[x,z]}` (`s` = shooter
  position for the direction arc), `death {v,by,h}`, 3 s later `respawn {v,x,z,y,u}` (`y` = yaw,
  `u` = end of spawn protection).
  `fast`: `ping {c,r}` (guest → host, `r` = its measured RTT) → `pong {c,h}` (`h` = host clock);
  state `s {i,k,h,p:[x,y,z],a:[yaw,pitch],v:[vx,vy,vz],f}` (`f` flags crouch/grounded/sprint/fly,
  ~110 bytes) plus, when we fired since the last state, `x:[[ox,oy,oz, ex,ey,ez, kind]…]` (≤ 12
  shots; kind 0 miss, 1 floor, 2 letter, 3 player). Other fast types go to `onFastMessage`.
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
  letters + combat whenever frames stop (a host can switch tabs). `NET_VERSION` stays 3.
- **Map fingerprint** (`net/mapHash.js`): entity count + FNV-1a hash of kinds, glyph ids and footprints
  rounded to 10 cm. Entity ids are what later sync uses, so a count mismatch kicks the guest; a hash
  mismatch is only logged (JS engines may round differently).

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
`npm run signal` starts a local signaling server for LAN multiplayer (open the game with `?broker=ws://<ip>:9000`).
`npm run test:interp` tests remote-player smoothing under simulated networks; `npm run sim:net` tests shared
destruction and `npm run sim:pvp` player vs player (`LAG=`, `JITTER=`, `SEED=`); `?netsim=lag:80,jitter:40,loss:0.05` simulates a bad network in the browser.
