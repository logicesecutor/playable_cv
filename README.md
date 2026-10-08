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
- `window.__cv` in the devtools console exposes `scene`, `camera`, `world`, `config`, `player`, `collision`, `weapon`, `destruction`, `map` (fingerprint) and `room` (the open multiplayer room, if any).
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

**What works now (MP1)**: lobby + shared map. Player list (top left, colour dot, "joining…" / "host"),
join/leave notices (top right), clean errors (full game, old link, host left, version mismatch).
Players don't see each other yet, and destruction is still local to each browser (MP2/MP3, see PLAN.md).

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
  ui/lobby.js           join screen, invite box (pause card), player list, notice feed, saved nickname
  net/signaling.js      PeerJS-protocol signaling client over WebSocket, ?broker= override
  net/peerLink.js       one RTCPeerConnection: "rel" (reliable) + "fast" (unreliable) channels, chunked binary
  net/room.js           HostRoom / GuestRoom: hello/welcome, PDF transfer, player list, leave/kick
  net/mapHash.js        map fingerprint (entity count + geometry hash) to check host and guest agree
tools/extract-debug.mjs
tools/sim-player.mjs
tools/test-raycast.mjs
tools/bodies.mjs        shared Node helper: collision bodies from a PDF
tools/signal-server.mjs dependency-free PeerJS-compatible signaling server (`npm run signal`)
```
