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
| Tab (hold) | scoreboard (multiplayer) |
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

- Node 18+ runs the site. Node 22.13+ is needed only for the Node debug tools that read a PDF (`npm run extract`, `npm run sim`)
  (pdf.js 6 requirement); on older Node, `npm install` may print an engine warning you can ignore.
- `window.__cv` in the devtools console exposes `scene`, `camera`, `world`, `config`, `player`, `collision`, `weapon`, `destruction`, `map` (fingerprint), `remoteShots`, `room` (the open multiplayer room, if any), `sync` (other players: buffers, avatars, stats), `letters` (shared destruction) and `pvp` (combat referee, killcam, scoreboard, `match`).
- `npm run signal` starts a local matchmaking server for LAN / offline multiplayer (see below).
- http://localhost:5173/viewer.html is the model viewer (dev only, see "Characters and the gun").
- `npm run build` writes the static site to `dist/` (`BASE_PATH=/<repo>/` when it is served from a
  sub-path, as on GitHub Pages; the deploy workflow sets it).

## Multiplayer

Peer-to-peer over WebRTC: the host's browser is the server, there is no game backend. A public
matchmaking ("signaling") server only introduces the browsers to each other. Single player makes no
network connections at all: the room opens only when you click **Invite friends**.

**Host**

1. Drop your CV and get in the map.
2. Esc → the pause card has an invite box: type your name → **Invite friends**.
3. **Copy** the link (`…/#join=pcv-…`) and send it. Up to 7 friends (8 players). Keep the tab open:
   closing it ends the game for everyone.

**Join**: open the link → type a name → **Join game**. The host's browser sends you the original PDF
and your browser rebuilds the same map from it. The name is remembered in `localStorage`.

**What works now (MP5)**: lobby + shared map (MP1), you see each other (MP2), letters break for
everyone (MP3), you can shoot each other (MP4), and it's a real match that survives Wi-Fi blips (MP5,
below). Every player is a chibi "job hunter" (corporate or software-engineer outfit, details in
their colour) holding the typewriter blaster, animated with Blender clips (see "Characters and the
gun" below), moving smoothly even on a laggy connection.
Name tags and minimap dots (with a facing tick) appear only while that player is in your line of sight, not through letters. Positional
footsteps, ping per guest in the player list (amber > 140 ms, red > 250 ms), "connection lost…" on a
tag after 2.5 s without updates, and a soft push so players can't stand inside each other. Guests
spawn on their own spot around the middle.
Your own shots hit and shatter letters instantly; the host checks them and everyone sees the same
letters fall (a hit the host refuses puts the letter back, its soot stays on the paper). Late joiners
get the map with the real damage already on it. The player list shows "N letters" destroyed per
player.
PvP: 100 HP, 25 per body shot / 50 per headshot (its own crosshair marker), less past 40 m (60 % at 120 m+);
health comes back at 8 HP/s after 5 s without damage. What you see is what you hit: your screen
decides the hit, the host checks it against where the victim really was at that moment. Health bar
(bottom centre), red flash + an arc pointing at the shooter. When you die: 3 s killcam watching your
killer ("Killed by X · headshot"), then you respawn far from enemies with full ammo and 2 s of spawn
protection (ends when you shoot). Kill feed "Killer ▸ Victim", **Tab** scoreboard (kills, deaths,
letters, ping). You see and hear others' tracers, muzzle flashes and gunshots (duller with distance),
with floor scorch marks; whoever shoots shows on everyone's minimap for 1.5 s, even through letters.
A host in a background tab keeps the game running for the guests.

**Match**: first to 10 kills wins (`config.net.killTarget`; the host referees). A bar at the top
centre shows "First to 10 · leader N · you M". At the end everyone gets the same card: winner, final
table (kills, deaths, letters) and three awards: **Demolition** (most letters destroyed), **On a roll**
(best kill streak), **Sharpshooter** (most headshot kills). Shooting stops, the mouse is released and
the camera rises to the top view of the wrecked CV. The host gets **Rematch on a fresh CV**, guests
see "Waiting for <host> to start a rematch…". A rematch is instant (no map rebuild): every letter and
the clean paper come back, scores go to zero and everyone respawns spread over the page with 2 s of
protection. Hits still in flight from the old match don't count. Players who join mid-match or during
the end card get the current match state (and the end card).

**Drop-outs**: a guest whose connection dies without saying goodbye stays in the list as
"reconnecting…" (with its score, no avatar) for 60 s. Its tab shows "Connection lost. Reconnecting…
(attempt n)" and retries every 2 s; back within 60 s it gets the same player, colour and score, skips
the PDF download and carries on where it was. After 60 s it is removed. If the host has gone, the
guest sees "The host left the game.". Both sides treat 10 s without any traffic as a dead connection.
If the host loses the matchmaking server, it reconnects on its own (1 s → 30 s backoff) under the
same room id, so the invite link keeps working; players already in are not affected.

## Play with friends (online)

The game is a static site: the GitHub Action in `.github/workflows/deploy-pages.yml` builds it and
publishes it on GitHub Pages at **https://logicesecutor.github.io/playable_cv/**. Invite links made
there work for anyone on the internet.

**One-time setup**

1. Make the repo public (GitHub Pages needs that on the free plan).
2. Repo **Settings → Pages → Source: "GitHub Actions"**.
3. Push `main`. The "Deploy to GitHub Pages" workflow runs on every push to `main` (or by hand from the
   Actions tab). Wait for it to go green.
4. Open https://logicesecutor.github.io/playable_cv/.

**Play**

1. Host: open the site, drop your CV, Esc → type your name → **Invite friends** → **Copy** the link.
2. Send it (chat, mail…). Keep your tab open: closing it ends the game for everyone.
3. Friends: open the link → name → **Join game**. They download your CV from your browser and build
   the same map. Up to 8 players.

**A friend can't connect** ("Found the host but couldn't connect…"): some networks (mobile data,
corporate or university Wi-Fi, strict routers) don't allow a direct peer-to-peer connection. Set up
the free relay below once and push again; the host's player list then shows "· relay" next to the ping
of anyone who goes through it.

### Relay (TURN)

Without a relay only direct connections work (STUN). With a free [Metered](https://www.metered.ca)
account (500 MB/month, no card):

1. Sign up at https://dashboard.metered.ca/signup (free plan).
2. Dashboard → **TURN Server → Credentials** → **Create Credential** (label/region optional) →
   **Create credential**. A new credential can take up to 2 minutes to start working.
3. On that credential's row click **ICE**: it copies the ICE servers list (STUN + TURN entries
   with `username` and `credential`).
4. Paste the TURN entries into `src/config.js` → `net.turnServers`:
   ```js
   turnServers: [
     { urls: "turn:global.relay.metered.ca:80", username: "…", credential: "…" },
     { urls: "turn:global.relay.metered.ca:80?transport=tcp", username: "…", credential: "…" },
     { urls: "turn:global.relay.metered.ca:443", username: "…", credential: "…" },
     { urls: "turns:global.relay.metered.ca:443?transport=tcp", username: "…", credential: "…" },
   ],
   ```
   These credentials end up in the public site; that's normal for a browser game (the worst case is
   someone using up the free 500 MB). If that happens, delete the credential in the dashboard and
   create a new one. **Never put the account's Secret Key (Developers page) in the code.**
5. Commit, push, wait for the Action.
6. Check: open the site with `?relay=1` on both sides (forces every connection through the relay, so
   it can be tested on one machine): if the guest joins, the relay works. The host's player list
   shows "· relay" next to anyone connected through it.

Alternative to step 4: `net.turn.metered = { app, apiKey }` with a credential's API key; the page then
fetches fresh credentials from `https://<app>.metered.live/api/v1/turn/credentials?apiKey=…`.
Credentials are cached 10 min; the host refreshes them every 9 min for guests who join later. If the
fetch fails, the game falls back to direct connections only. `?turn=<app>:<key>` uses another
Metered app for one page load. Only players whose connection needs the relay use it; in a full
8-player game each of them costs roughly 100 MB per hour (plus the CV download once), so 500 MB is a
few evenings of play.

### Test it from two networks yourself

- [ ] Host on the PC (home Wi-Fi): open the deployed site, drop a CV, **Invite friends**, send the link
      to your phone.
- [ ] Phone: **Wi-Fi off**, mobile data on (a different network), open the invite link.
- [ ] Expect: the phone joins, downloads the CV, shows the same map, and both player lists show both
      players (with "· relay" on the host if the relay was needed).
- [ ] The phone has no touch controls (it can't move or shoot): this checks connection and map, not
      gameplay.
- [ ] If it fails with "couldn't connect", set up the relay above and retry (or try `?relay=1` on both).

### Testing on a bad connection

Add `?netsim=lag:80,jitter:40,loss:0.05` to the page URL to make a same-computer test behave like the
internet. It applies to what *that tab sends*, so set it on both tabs (round trip ≈ 2 × lag + jitter).
`lag`/`jitter` in ms; `loss` drops only fast-channel messages (player state, which may also arrive out
of order), reliable ones are only delayed, in order. The invite link carries the query string: remove
it before sharing a real link.

Other developer URL options: `?target=3` for short test matches (first to 3; only the host's value
counts), `?relay=1` forces every connection through the TURN relay, `?turn=<app>:<key>` uses another
Metered relay app for this page load.

### Where the link works

| Setup | How |
|---|---|
| Same computer (testing) | `npm run dev`, invite, open the link in a second tab/window. `localhost` links only work here. |
| Same LAN | `npm run dev -- --host`, open the game via the LAN address Vite prints (`http://192.168.x.x:5173`), then invite. |
| Over the internet | The deployed site on GitHub Pages (see "Play with friends (online)"), plus the relay for strict networks. |
| LAN without internet | `npm run signal` (listens on :9000, `PORT=` to change) and open the game with `?broker=ws://<that machine's IP>:9000`. |

`?broker=` overrides the signaling server for that page load (`ws://…` or `wss://host/path`); the
invite link keeps it, so guests use the same one. Default: `0.peerjs.com` (free public PeerJS server),
with Google + Cloudflare STUN, plus the Metered relay when `net.turn.metered` is filled in. All of it
lives in `src/config.js` → `net`.

### Troubleshooting

| Message | Meaning |
|---|---|
| "No game at that link…" | The host closed the game or the link is old. Ask for a new one. |
| "Found the host but couldn't connect directly…" | A network on either side blocks peer-to-peer (mobile data, corporate Wi-Fi, strict routers) and no relay is configured: see "Relay (TURN)". |
| "…couldn't connect, not even through the relay server." | A firewall blocks the relay too, or the free monthly 500 MB are used up. Try another network on one side. |
| "The matchmaking server (…) didn't answer." | Broker down or unreachable: try later, or run `npm run signal` + `?broker=`. |
| "Connection lost. Reconnecting… (attempt n)" | The guest's connection died (Wi-Fi blip, laptop sleep). It retries for 60 s and comes back with the same score. |
| "The host left the game." | The room no longer exists (host closed the tab or crashed). |
| "Lost the matchmaking server. Reconnecting…" (host feed) | Players already in are fine; new joins work again once "Matchmaking server back" shows. |
| "The download from the host stalled…" | No CV data for 20 s. The host's connection dropped: try the link again. (A slow download that keeps going never times out.) |
| "Your browser built a different map…" | The guest's browser extracted a different number of pieces. Use the same browser as the host. |

## Characters and the gun

Players are chibi **job hunters** made in Blender, in two outfits on the same rig:

| Outfit | Look (parts in the player's colour in bold) |
|---|---|
| Corporate | jacket, **tie**, **badge clip**, **shoe soles**, round glasses |
| Software Engineer | **T-shirt** with a `</>` print, **beanie**, cargo shorts, sneakers |

The host hands out outfits balanced-random (`pickOutfit` in `src/net/room.js`; kept on rejoin and
rematch, `PlayerInfo.outfit`, `NET_VERSION` 5). Colours were already unique per room. Hitboxes follow
the bigger chibi head: head sphere 0.29 m (was 0.17), body capsule tops 1.32 m standing / 0.72 m
crouched (`src/net/hitbox.js`).

Everyone holds the **typewriter blaster** (`public/models/gun.glb`): the glowing paper slot is the
muzzle, the ink-ribbon cartridge is the magazine, the space bar takes the player's colour. In first
person you see it with mitten hands; on reload it rolls over and the cartridge drops out.

**Animation**: 9 clips made in Blender and shipped in both character files: Idle, Walk, Run, Crouch,
CrouchWalk, Jump, Death (ragdoll-style slump) on the body, Fire and Reload on the gun. The avatar
cross-fades between them from the network state (Walk / Run / CrouchWalk play at the real speed) and
adds a procedural layer on top: aim pitch, head pitch, hands on the gun's grips, the cartridge swap,
the gun flopping on death. Others see you reload (`FLAG.reload` in the player state) and every
remote shot kicks their gun.

**Look**: a cool rim light on the silhouettes (`config.characters.rim`, 0.35) and an optional 3-band
toon ramp (`config.characters.toon`, off). For one page load: `?toon=1`, `?rim=0.5` (`?rim=0` = off).

If a model file is missing or fails to load, the game keeps working with the old procedural box
soldier and box gun. A map waits at most 8 s for the models.

### Model viewer

`npm run dev`, then open http://localhost:5173/viewer.html. It shows both outfits exactly as the game
does (same avatar code fed the same network state) next to the old box soldier and the real hitboxes:
pose buttons (idle, walk, sprint, crouch, crouch walk, jump, dead), aim pitch slider, force a clip,
fire ×5, reload, accent colour picker, toon / rim switches, skeleton / wireframe, and a measure of the
visual head against the head hitbox. **Reload models (R)** picks up a fresh export without reloading
the page. In a hidden tab (no animation frames) call `step(1.2)` in the console to advance time.

### Rebuilding the models from Blender

The models are built entirely by Python scripts in `blender_src/scripts/`:

| Script | Builds |
|---|---|
| `common.py` | shared helpers: palette texture (colour swatches), materials `Palette` / `Accent` (tinted per player) / `Glow`, `part()`, `join()`, `export_glb()`, `render_sheet()` |
| `build_characters.py` | `public/models/player_corporate.glb` + `player_engineer.glb` (14-bone rig, calls `build_anims.py` for the clips) |
| `build_anims.py` | the 9 animation clips, keyed by script on the rig |
| `build_gun.py` | `public/models/gun.glb` (nodes `Gun`, `Magazine`, `Muzzle`, `Grip.R/L`, `FPHand.R/L`) |

Each build exports the `.glb` straight into `public/models/` and renders a preview sheet into
`blender_src/renders/`. Two ways to run them:

- **Live**, in an open Blender with the MCP add-on: `import build_characters; build_characters.build()`
  (or `build_gun.build()`), with `blender_src/scripts` on `sys.path`.
- **Headless**:
  ```bash
  blender --background blender_src/characters.blend --python blender_src/scripts/build_characters.py
  blender --background blender_src/characters.blend --python blender_src/scripts/build_gun.py
  ```

Then press **R** in the model viewer (or reload the game). `blender_src/` (scripts, `.blend` files,
renders) is local-only and git-ignored; the exported `.glb` files in `public/models/` are committed.

Conventions the game relies on: metres, Z up, models face Blender -Y (`src/assets/models.js` turns
them to three.js -Z); one shared palette texture; the material named `Accent` is cloned and tinted
per player. The rig has 14 bones (Root, Hips, Spine, Head, Aim, Weapon, Hand.R/L, Thigh/Shin/Foot.R/L),
every bone points up in Blender so its rest rotation is the identity in three.js. GLTFLoader drops
the dots from names (`Hand.R` → `HandR`): look nodes up through
`THREE.PropertyBinding.sanitizeNodeName`.

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

`npm run test:interp` checks remote-player smoothing (`src/net/snapshots.js`): a fake player moves for
60 s, its state goes through 5 simulated networks (LAN, good internet, bad wifi, awful mobile, stalls)
and the script fails if the drawn position strays or pops too much. Now: error p95 ≈ 0.03 m in all of
them, pop p95 < 0.015 m, delay 66–314 ms.

`npm run sim:net` tests shared destruction (`src/net/letters.js`): a host, 3 guests and a late joiner
shoot letters for 60 s at ~630 rpm over a laggy, ordered fake link (guest 3 gets half its hits
rejected), then every map must match the host's (alive letters, HP, per-player counts). Tune with
`LAG=`, `JITTER=` (ms) and `SEED=`. Now: 80 ± 40 ms and 200 ± 150 ms both pass, ~1,080 letters
destroyed, ~315 rejected hits, 127–143 predicted kills undone, 0 mismatches.

`npm run sim:pvp` tests player vs player (`src/net/combat.js`): a host and 5 guests fight for 90 s
over a laggy fake link, 8 % of hits are fakes (claimed far from the victim). Every screen must end with
the host's kills, deaths and HP, kills = deaths, no damage while dead or protected, every death followed
by a respawn, every fake refused by the rewind check and no honest hit refused. Same `LAG=`, `JITTER=`,
`SEED=`. Now: 80 ± 40 ms and 200 ± 150 ms both pass, ≈ 90–97 kills, 0 honest hits refused.

`npm run sim:match` tests the match flow (`src/net/match.js`): a host and 3 guests play 3 matches to
10 over a laggy fake link, the host starts each rematch at once (so old hits are still in flight), one
player joins during an end screen and another mid-match. Winner, scores and awards must be identical
everywhere, kills = deaths, nothing scores on the end screen, old-round hits don't count, every letter
is back after a rematch. Same `LAG=`, `JITTER=`, `SEED=`. Now: 21/21 checks pass at 80 ± 40 and
200 ± 150 ms.

## Layout

```
src/
  main.js               upload / join screen -> loading -> game loop, host + guest wiring;
                        100 ms timer keeps the network running when a hidden tab gets no frames;
                        guest auto-rejoin after a drop, end-of-match camera flight to the top view
  config.js             all tunables (scale, heights, speeds, intro timings, net incl. killTarget, turn,
                        characters: toon / rim)
  pdf/extract.js        pdf.js render with a recording Path2D -> glyph outlines, colours, rules, raster
  pdf/outlines.js       path commands -> polygons with holes (pure, no three.js)
  pdf/loadPdf.js        browser wiring for pdf.js + worker (from a File or raw bytes; keeps `pdf.bytes`)
  world/buildWorld.js   instanced extruded letters, rule walls, paper floor, lights, spawn point
  world/intro.js        top view -> letters rise -> camera swoop
  world/collision.js    spatial grid + circle-vs-letter-outline collision (pure JS)
  world/layout.js       letter heights, spawn points (middle, or near a given centre) (pure JS)
  player/playerCore.js  movement simulation: accel, jump, gravity, step-up (pure JS)
  player/playerController.js  pointer lock + keys -> PlayerCore -> camera (head bob, landing dip), `dead` flag
  player/weapon.js      view-model (typewriter via gunModel.js: restPos, roll-over + cartridge drop on reload,
                        setAccent), firing, spread, recoil, reload, tracers, muzzle flash; buildGun() (box gun);
                        hooks for player hits (playerRay / onPlayerHit / onFired / blocked)
  player/avatar.js      createAvatar(color, outfit): the Blender character, or the fallback BoxAvatar (low-poly
                        soldier in the player's colour, walk/run, crouch, jump, aim; die / revive)
  player/modelAvatar.js ModelAvatar: chibi job hunter, AnimationMixer state machine over the Blender clips
                        (cross-fades, speed-scaled locomotion) + procedural aim / head / hands / reload / death
  player/gunModel.js    createGun({fp, accent}): typewriter blaster for the view-model (mitten hands) or the
                        characters, box-gun fallback; muzzle, magazine, grips, setAccent
  assets/models.js      preload public/models/*.glb, instantiate(name, {accent}) per-player copies (SkeletonUtils,
                        tinted "Accent", turned to face -Z), rim light / toon ramp (`style`, ?toon= ?rim=)
  dev/viewer.js         model viewer (viewer.html): poses, forced clips, fire / reload, hitboxes + head measure
  world/destruction.js  letter HP, hit effects + wobble, shattering, burning the ink off the paper;
                        remote hits, silent kills (late join), revive (refused prediction);
                        resetAll (rematch) from a clean raster copy (`pdf.rasterClean`)
  fx/debris.js          instanced shards with gravity, spin, bounce on paper and letters; clear()
  fx/particles.js       sparks and dust (soft points, one draw call each)
  fx/remoteShots.js     other players' shots: tracer, muzzle flash, positional gunshot, floor scorch, player puff
  audio/sfx.js          procedural Web Audio: gun (others' positional, duller far away), impacts, crumble,
                        steps (own + other players'), reload, body hit, hurt
  ui/hud.js             crosshair hit markers (letter, player, headshot, kill), ammo, CV integrity, toasts
  ui/combatHud.js       health bar, damage flash + direction, killcam text, spawn protection, kill feed, Tab scoreboard
  ui/minimap.js         page raster + player arrow + dots for other players in sight
  ui/nameTags.js        HTML name tags projected from 3D over other players
  ui/matchHud.js        match bar (first to N, leader, you) and end card (winner, table, awards, Rematch)
  ui/lobby.js           join screen, invite box (pause card), player list with ping (+ "relay", "reconnecting…"),
                        notice feed, saved nickname, per-tab rejoin key (sessionStorage)
  net/signaling.js      PeerJS-protocol signaling client over WebSocket, ?broker= override, reusable token
  net/peerLink.js       one RTCPeerConnection: "rel" (reliable) + "fast" (unreliable) channels, chunked binary,
                        lastRecv (watchdogs), forced relay policy
  net/ice.js            STUN + Metered TURN credentials (cached), ?relay= / ?turn=, routeOf (direct or relay)
  net/netsim.js         ?netsim= developer network simulator (lag, jitter, loss on what this tab sends)
  net/room.js           HostRoom / GuestRoom: hello/welcome, PDF transfer, player list, ping/pong, leave/kick;
                        away players + rejoin by key, 10 s silence watchdogs, broker reconnect;
                        outfits (OUTFITS, pickOutfit: balanced random)
  net/clock.js          ClockSync: guests estimate the host's clock (shared game time) from ping/pong
  net/snapshots.js      SnapshotBuffer: adaptive-delay interpolation / extrapolation, state wire format
                        incl. shots fired (`x`, with sequence number), FLAG bits (crouch, grounded, sprint,
                        fly, reload) (pure JS)
  net/sync.js           NetSync: send own state 20 Hz, host relay, avatars, tags, visibility, soft push;
                        shots in two states each (duplicates dropped), raycast against players as we see
                        them, minimap reveal of shooters
  net/letters.js        LetterNet: shared destruction, predicted hits, host validation, late-join snapshot,
                        round-tagged hits, reset per match (pure JS)
  net/combat.js         Combat: PvP referee: HP, damage + falloff, rewind check, deaths, respawns, regen, K/D,
                        streaks + headshot kills, round tags, reset per match (pure JS)
  net/match.js          Match: first to N, end (scores + awards), rematch, round number, late-join state (pure JS)
  net/hitbox.js         player hitboxes (body capsule + head sphere, standing / crouched), ray vs players (pure JS)
  game/pvp.js           PvP glue: weapon -> combat, killcam, respawn spot, remote shots, HUD, kill feed, scoreboard;
                        match: end view, rematch spawns spread over the page
  net/mapHash.js        map fingerprint (entity count + geometry hash) to check host and guest agree
public/models/          exported Blender models (committed): player_corporate.glb, player_engineer.glb, gun.glb
viewer.html             model viewer page (dev, `npm run dev` → /viewer.html)
blender_src/            LOCAL ONLY, git-ignored: .blend files, renders/, scripts/ (common.py, build_characters.py,
                        build_anims.py, build_gun.py) that export into public/models/
tools/extract-debug.mjs
tools/sim-player.mjs
tools/test-raycast.mjs
tools/test-interp.mjs   snapshot interpolation under simulated networks (`npm run test:interp`)
tools/sim-net.mjs       shared destruction: 5 players on a laggy fake link must end with the host's map (`npm run sim:net`)
tools/sim-pvp.mjs       PvP: host + 5 guests fight 90 s on a laggy fake link, scores agree, fakes refused (`npm run sim:pvp`)
tools/sim-match.mjs     match flow: 3 matches to 10, instant rematches, late joiners, results agree (`npm run sim:match`)
tools/bodies.mjs        shared Node helper: collision bodies from a PDF
tools/signal-server.mjs dependency-free PeerJS-compatible signaling server (`npm run signal`)
vite.config.js          `base` from BASE_PATH (sub-path on GitHub Pages)
.github/workflows/deploy-pages.yml  build on push to main (or by hand) and publish dist/ to GitHub Pages
```
