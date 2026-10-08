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
- `window.__cv` in the devtools console exposes `scene`, `camera`, `world`, `config`, `player`, `collision`, `weapon`, `destruction`, `map` (fingerprint), `room` (the open multiplayer room, if any) and `sync` (other players: buffers, avatars, stats).
- `npm run signal` starts a local matchmaking server for LAN / offline multiplayer (see below).

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

**What works now (MP2)**: lobby + shared map (MP1), and you see each other. Every player is a low-poly
soldier in their colour holding the same gun (walk/run, crouch, jump, aim pitch), moving smoothly even
on a laggy connection. Name tags and minimap dots (with a facing tick) appear only while that player is
in your line of sight, not through letters. Positional footsteps, ping per guest in the player list
(amber > 140 ms, red > 250 ms), "connection lost…" on a tag after 2.5 s without updates, and a soft
push so players can't stand inside each other. Guests spawn on their own spot around the middle.
Destruction is still local to each browser until MP3 (see PLAN.md).

### Testing on a bad connection

Add `?netsim=lag:80,jitter:40,loss:0.05` to the page URL to make a same-computer test behave like the
internet. It applies to what *that tab sends*, so set it on both tabs (round trip ≈ 2 × lag + jitter).
`lag`/`jitter` in ms; `loss` drops only fast-channel messages (player state, which may also arrive out
of order), reliable ones are only delayed, in order. The invite link carries the query string: remove
it before sharing a real link.

### Where the link works

| Setup | How |
|---|---|
| Same computer (testing) | `npm run dev`, invite, open the link in a second tab/window. `localhost` links only work here. |
| Same LAN | `npm run dev -- --host`, open the game via the LAN address Vite prints (`http://192.168.x.x:5173`), then invite. |
| Over the internet | Deployed build on GitHub Pages: coming in MP5. |
| LAN without internet | `npm run signal` (listens on :9000, `PORT=` to change) and open the game with `?broker=ws://<that machine's IP>:9000`. |

`?broker=` overrides the signaling server for that page load (`ws://…` or `wss://host/path`); the
invite link keeps it, so guests use the same one. Default: `0.peerjs.com` (free public PeerJS server),
with Google + Cloudflare STUN. All of it lives in `src/config.js` → `net`.

### Troubleshooting

| Message | Meaning |
|---|---|
| "No game at that link…" | The host closed the game or the link is old. Ask for a new one. |
| "Found the host but couldn't connect directly…" | A network on either side blocks peer-to-peer (corporate, some mobile). Needs a TURN relay in `config.net.iceServers` (none configured yet). |
| "The matchmaking server (…) didn't answer." | Broker down or unreachable: try later, or run `npm run signal` + `?broker=`. |
| "Your browser built a different map…" | The guest's browser extracted a different number of pieces. Use the same browser as the host. |

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

## Layout

```
src/
  main.js               upload / join screen -> loading -> game loop, host + guest wiring
  config.js             all tunables (scale, heights, speeds, intro timings, net)
  pdf/extract.js        pdf.js render with a recording Path2D -> glyph outlines, colours, rules, raster
  pdf/outlines.js       path commands -> polygons with holes (pure, no three.js)
  pdf/loadPdf.js        browser wiring for pdf.js + worker (from a File or raw bytes; keeps `pdf.bytes`)
  world/buildWorld.js   instanced extruded letters, rule walls, paper floor, lights, spawn point
  world/intro.js        top view -> letters rise -> camera swoop
  world/collision.js    spatial grid + circle-vs-letter-outline collision (pure JS)
  world/layout.js       letter heights, spawn points (middle, or near a given centre) (pure JS)
  player/playerCore.js  movement simulation: accel, jump, gravity, step-up (pure JS)
  player/playerController.js  pointer lock + keys -> PlayerCore -> camera (head bob, landing dip)
  player/weapon.js      view-model, firing, spread, recoil, reload, tracers, muzzle flash; buildGun()
  player/avatar.js      other players: low-poly soldier in their colour, walk/run, crouch, jump, aim
  world/destruction.js  letter HP, hit wobble, shattering, burning the ink off the paper
  fx/debris.js          instanced shards with gravity, spin, bounce on paper and letters
  fx/particles.js       sparks and dust (soft points, one draw call each)
  audio/sfx.js          procedural Web Audio: gun, impacts, crumble, steps (own + other players'), reload
  ui/hud.js             crosshair hit markers, ammo, CV integrity, toasts
  ui/minimap.js         page raster + player arrow + dots for other players in sight
  ui/nameTags.js        HTML name tags projected from 3D over other players
  ui/lobby.js           join screen, invite box (pause card), player list with ping, notice feed, saved nickname
  net/signaling.js      PeerJS-protocol signaling client over WebSocket, ?broker= override
  net/peerLink.js       one RTCPeerConnection: "rel" (reliable) + "fast" (unreliable) channels, chunked binary
  net/netsim.js         ?netsim= developer network simulator (lag, jitter, loss on what this tab sends)
  net/room.js           HostRoom / GuestRoom: hello/welcome, PDF transfer, player list, ping/pong, leave/kick
  net/clock.js          ClockSync: guests estimate the host's clock (shared game time) from ping/pong
  net/snapshots.js      SnapshotBuffer: adaptive-delay interpolation / extrapolation, state wire format (pure JS)
  net/sync.js           NetSync: send own state 20 Hz, host relay, avatars, tags, visibility, soft push
  net/mapHash.js        map fingerprint (entity count + geometry hash) to check host and guest agree
tools/extract-debug.mjs
tools/sim-player.mjs
tools/test-raycast.mjs
tools/test-interp.mjs   snapshot interpolation under simulated networks (`npm run test:interp`)
tools/bodies.mjs        shared Node helper: collision bodies from a PDF
tools/signal-server.mjs dependency-free PeerJS-compatible signaling server (`npm run signal`)
```
