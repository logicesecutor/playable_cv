import * as THREE from "three";
import { config } from "./config.js";
import { loadPdfFile, loadPdfBytes } from "./pdf/loadPdf.js";
import { buildWorld } from "./world/buildWorld.js";
import { Intro } from "./world/intro.js";
import { PlayerController } from "./player/playerController.js";
import { CollisionWorld } from "./world/collision.js";
import { Minimap } from "./ui/minimap.js";
import { Weapon } from "./player/weapon.js";
import { Destruction } from "./world/destruction.js";
import { Debris } from "./fx/debris.js";
import { ParticleSystem } from "./fx/particles.js";
import { Sfx } from "./audio/sfx.js";
import { Hud } from "./ui/hud.js";
import { HostRoom, GuestRoom } from "./net/room.js";
import { brokerFromUrl } from "./net/signaling.js";
import { netsimFromUrl } from "./net/netsim.js";
import { applyIceUrlOptions } from "./net/ice.js";
import { NetSync } from "./net/sync.js";
import { LetterNet } from "./net/letters.js";
import { createPvp } from "./game/pvp.js";
import { CombatHud } from "./ui/combatHud.js";
import { RemoteShots } from "./fx/remoteShots.js";
import { WordShots } from "./fx/wordShots.js";
import { NameTags } from "./ui/nameTags.js";
import { findSpawn } from "./world/layout.js";
import { mapFingerprint } from "./net/mapHash.js";
import { preloadModels } from "./assets/models.js";
import { initTitles, playTitles } from "./ui/title.js";
import { JoinScreen, InvitePanel, PlayersPanel, Feed, joinIdFromUrl, clearJoinFromUrl, rejoinKey } from "./ui/lobby.js";

const $ = (id) => document.getElementById(id);
const screens = { upload: $("upload-screen"), join: $("join-screen"), loading: $("loading-screen"), game: $("game-screen") };
function show(name) {
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
  playTitles(screens[name]); // "Destroy Your" types out, CAREER is stamped (once per screen)
}
initTitles();

config.net.broker = brokerFromUrl(config.net.broker);
config.net.netsim = netsimFromUrl(); // developer tool: ?netsim=lag:80,jitter:30,loss:0.05
applyIceUrlOptions(config.net); // ?relay=1 forces the TURN relay, ?turn=<app>:<key> swaps the relay account
{
  // developer tool: ?target=3 for short test matches (only the host's value counts)
  const t = Number(new URLSearchParams(location.search).get("target"));
  if (Number.isInteger(t) && t >= 1 && t <= 100) config.net.killTarget = t;
}

let game = null; // the running map, if any
// the Blender models (characters, gun) start downloading right away; a map waits for them, but
// never longer than a few seconds (a missing model just means the built-in fallback)
const modelsReady = preloadModels();
const waitForModels = () => Promise.race([modelsReady, new Promise((r) => setTimeout(r, 8000))]);
const sfx = new Sfx(); // one audio context for the whole page

/** typing in a text field must not trigger game keys */
const isTyping = (e) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

// ------------------------------------------------------------------ step 1: pick a PDF
const dropzone = $("dropzone");
const fileInput = $("file-input");
const errorEl = $("upload-error");

fileInput.addEventListener("change", () => fileInput.files[0] && start(fileInput.files[0]));
for (const ev of ["dragenter", "dragover"]) {
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragging");
  });
}
for (const ev of ["dragleave", "drop"]) {
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragging");
  });
}
dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file) start(file);
});
// dropping outside the zone shouldn't navigate away to the PDF
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

function fail(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
  show("upload");
}

// ------------------------------------------------------------------ step 1 (guest): opened an invite link
const joinScreen = new JoinScreen();
let joining = false;

function route() {
  if (game || joining) return;
  if (joinIdFromUrl()) {
    show("join");
    joinScreen.focus();
  } else show("upload");
}
window.addEventListener("hashchange", route);
route();

joinScreen.onJoin = async (name) => {
  const roomId = joinIdFromUrl();
  if (!roomId || joining) return;
  joining = true;
  sfx.unlock(); // we have a click: audio may start now
  joinScreen.busy(true);
  try {
    const res = await GuestRoom.join(roomId, {
      name,
      net: config.net,
      key: rejoinKey(roomId),
      onStatus: (text, progress) => joinScreen.setStatus(text, progress),
    });
    const { room } = res;
    // the host may leave while we're still building the map
    room.onClosed = (_reason, message) => {
      if (!game) {
        joining = false;
        show("join");
        joinScreen.fail(message);
      }
    };
    show("loading");
    $("loading-text").textContent = "Tracing every glyph of the CV…";
    await nextFrame();
    const pdf = await loadPdfBytes(res.pdfBytes, { rasterScale: config.rasterScale });
    await waitForModels();
    if (room.closed) return;
    $("loading-text").textContent = `Extruding ${pdf.pieces.length.toLocaleString()} letters…`;
    await nextFrame();
    startGame(pdf, { room, hostMap: res.map, fileName: res.pdfName, world: res.world, roomId, name });
  } catch (err) {
    console.error(err);
    show("join");
    joinScreen.fail(err?.message || String(err));
  } finally {
    joining = false;
  }
};

async function start(file) {
  errorEl.hidden = true;
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
    return fail("That doesn't look like a PDF. Pick a .pdf file.");
  }
  show("loading");
  const status = $("loading-text");
  try {
    status.textContent = "Reading PDF and tracing every glyph…";
    await nextFrame();
    const t0 = performance.now();
    const pdf = await loadPdfFile(file, { rasterScale: config.rasterScale });
    if (!pdf.pieces.length) {
      return fail("No vector text found. Is this a scanned PDF? Scanned pages aren't supported yet.");
    }
    await waitForModels();
    status.textContent = `Extruding ${pdf.pieces.length.toLocaleString()} letters…`;
    await nextFrame();
    startGame(pdf, { fileName: file.name });
    console.info(`[playable-cv] ready in ${(performance.now() - t0).toFixed(0)} ms`, pdf);
  } catch (err) {
    console.error(err);
    fail(`Couldn't read that PDF: ${err?.message || err}`);
  }
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// ------------------------------------------------------------------ step 2: the map

/**
 * @param {any} pdf extracted PDF (+ `bytes`, the original file)
 * @param {{room?: GuestRoom, hostMap?: {hash:string,count:number}, fileName?: string, world?: any,
 *   roomId?: string, name?: string, resume?: {x:number,z:number,yaw:number}}} [online]
 *   `room` is set when we joined someone else's game; otherwise we're the (potential) host.
 *   `resume`: we reconnected: skip the intro and carry on where we were.
 */
function startGame(pdf, online = {}) {
  game?.dispose();

  const canvas = $("view");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0b0e);

  const camera = new THREE.PerspectiveCamera(config.fov, 1, 0.1, 3000);
  const world = buildWorld(pdf, config, renderer);
  scene.add(world.root);
  const map = mapFingerprint(world);
  console.info("[playable-cv] world", world.stats, "map", map);
  if (online.room && map.count !== online.hostMap.count) {
    // ids wouldn't line up with the host's: can't play together
    online.room.leave();
    renderer.dispose();
    return fail(
      `Your browser built a different map from this CV (${map.count} pieces, the host has ${online.hostMap.count}). ` +
        "Try opening the link in the same browser the host uses.",
    );
  }

  // ---- simulation + effects
  const collision = new CollisionWorld(world.entities, world.size);
  const player = new PlayerController(camera, canvas, collision, config);
  const debris = new Debris(collision);
  const sparks = new ParticleSystem(1500, { additive: true, gravity: 14, drag: 1.5 });
  const dust = new ParticleSystem(2500, { gravity: -0.3, drag: 1.8 });
  scene.add(debris.mesh, sparks.points, dust.points);
  const destruction = new Destruction({ world, collision, debris, sparks, dust, sfx, pdf, cfg: config });
  const weapon = new Weapon({ camera, scene, player, collision, destruction, sfx, cfg: config });
  const minimap = new Minimap($("minimap"), pdf.raster, world.size);
  const hud = new Hud(config);

  show("game");
  let intro = null;
  const resize = () => {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const px = h * renderer.getPixelRatio();
    sparks.setViewport(px, camera.fov);
    dust.setViewport(px, camera.fov);
    intro?.onResize();
  };
  resize();
  if (online.room) {
    // guests spawn around the middle of the page, each on their own spot (the host takes the middle)
    const a = (online.room.selfId / config.net.maxPlayers) * Math.PI * 2;
    const { W, D } = world.size;
    world.spawn = findSpawn(world.entities, W, D, config.player.radius, { x: W / 2 + Math.cos(a) * 10, z: D * 0.55 + Math.sin(a) * 10 });
  }
  intro = new Intro(camera, world, config);
  if (online.resume) intro.skip();
  window.addEventListener("resize", resize);

  // fog only once we're on the ground; from the top it would grey out the page
  const fog = new THREE.Fog(0x0b0b0e, 60, Math.max(world.size.W, world.size.D) * 0.9);

  // ---- wiring
  player.onFootstep = (core) => sfx.footstep(Math.hypot(core.vx, core.vz) > config.player.walkSpeed + 0.5);
  player.onLand = (impact) => sfx.land(impact);
  player.onTouchpadPaused = () =>
    hud.toast(
      "Your touchpad seems to pause while keys are held (system \"disable while typing\").\n" +
        "Aim with the arrow keys and fire with F, or turn that setting off.",
      9,
    );
  weapon.onAmmo = (w) => hud.ammo(w);
  weapon.onShot = (result) => hud.hitMarker(result);
  destruction.onDestroyed = (e) => {
    hud.integrity(destruction);
    // feel big letters coming down nearby
    const b = e.box;
    const dist = Math.hypot((b.minX + b.maxX) / 2 - player.core.x, (b.minZ + b.maxZ) / 2 - player.core.z);
    player.addShake((0.04 + e.height * 0.03) * Math.max(0, 1 - dist / 40));
    words.rejected(e); // REJECTED stamp (words is created below, before anything can break)
  };

  const pause = $("pause");
  hud.setIntro(true);

  const skip = (e) => {
    if (isTyping(e)) return;
    if (intro && !intro.done && (e.type === "pointerdown" || e.code === "Space")) intro.skip();
  };
  canvas.addEventListener("pointerdown", skip);
  document.addEventListener("keydown", skip);
  const onPauseClick = () => {
    sfx.unlock(); // audio may only start from a click
    player.lock();
  };
  pause.addEventListener("click", onPauseClick);

  const setPlaying = (on) => {
    player.enabled = on;
    hud.setIntro(!on);
    pause.hidden = !on || player.locked;
    if (on) {
      hud.ammo(weapon);
      hud.integrity(destruction);
    }
  };

  const onKey = (e) => {
    if (isTyping(e)) return;
    if (e.code === "KeyI" && intro?.done) {
      // replay the intro (the map keeps its damage)
      setPlaying(false);
      document.exitPointerLock?.();
      intro.reset();
      scene.fog = null;
    }
    if (e.code === "KeyM") hud.toast(sfx.toggleMute() ? "Sound off" : "Sound on");
  };
  document.addEventListener("keydown", onKey);

  player.onLockChanged = (locked) => {
    if (intro.done) pause.hidden = locked;
    if (locked) document.activeElement?.blur?.(); // don't type WASD into the name field
  };

  // ---- multiplayer
  /** end-of-match camera flight to the top view (MP5); declared before a late joiner may need it */
  let endCam = null;
  /** @type {HostRoom|GuestRoom|null} */
  let room = online.room || null;
  const invite = new InvitePanel();
  const playersPanel = new PlayersPanel();
  const feed = new Feed();
  const tags = new NameTags($("nametags"));
  /** @type {NetSync|null} other players: state sync, avatars, name tags */
  let sync = null;
  /** @type {LetterNet|null} shared destruction: who hit / destroyed which letter */
  let letters = null;
  /** @type {ReturnType<typeof createPvp>|null} player vs player */
  let pvp = null;
  const chud = new CombatHud();
  const remoteShots = new RemoteShots(scene, sfx, destruction);
  // the typewriter prints a word with every shot; REJECTED / FIRED! stamps (fx/wordShots.js)
  const words = new WordShots(scene, camera, destruction, config);
  remoteShots.words = words;
  // our word uses the sequence number sync just gave this shot, so others see the same word
  weapon.onTracer = (from, to, kind) => words.ownShot(from, to, kind, sync ? sync.room.selfId : 0, sync ? sync.shotSeq : undefined);

  const wireRoom = (r) => {
    sync = new NetSync({ room: r, scene, camera, collision, player, sfx, tags, cfg: config });
    sync.isReloading = () => weapon.reloading > 0; // others see us reload (FLAG.reload)
    const me = r.players.find((p) => p.id === r.selfId);
    if (me) weapon.setAccent(me.color); // our colour on the typewriter's space bar
    r.onFastMessage = (msg, from) => sync?.onFast(msg, from);

    letters = new LetterNet({
      entities: world.entities,
      isHost: r.isHost,
      selfId: () => r.selfId,
      fx: {
        hit: (e, h) => destruction.remoteHit(e, h),
        kill: (e, h, dir) => destruction.destroy(e, h, dir),
        silentKill: (e) => destruction.silentKill(e),
        revive: (e) => {
          destruction.revive(e);
          hud.integrity(destruction);
        },
      },
      toHost: (msg) => r.send(msg),
      toAll: (msg) => r.broadcast(msg),
      toOne: (id, msg) => r.sendTo(id, msg),
      shooterPos: (id) => sync?.positionOf(id) ?? null,
      maxDist: config.weapon.range + 25,
    });
    destruction.onLocalHit = (e, h, dir) => letters?.localHit(e, h, dir);
    letters.onStats = (kills) => playersPanel.render(r.players, r.selfId, kills);

    pvp = createPvp({
      room: r, sync, letters, player, weapon, camera, hud, chud, shots: remoteShots, sfx, world, cfg: config,
      target: config.net.killTarget,
      onStats: () => playersPanel.render(r.players, r.selfId, letters?.kills),
      onDied: (v) => {
        const pos = v === r.selfId ? player.core : sync?.remotes.get(v)?.pos;
        if (pos) words.fired(pos.x, pos.y, pos.z);
      },
      resetWorld: () => {
        destruction.resetAll();
        words.reset();
        hud.integrity(destruction);
      },
      endView: (on) => {
        // end of match: rise to the top view and look at the wrecked CV (no fog up there)
        if (on && !endCam) {
          endCam = { t: 0, pos: camera.position.clone(), quat: camera.quaternion.clone(), to: intro.topPose() };
          scene.fog = null;
        } else if (!on && endCam) {
          endCam = null;
          camera.near = 0.1;
          camera.updateProjectionMatrix();
          if (intro.done) scene.fog = fog;
        }
      },
    });
    const onGame = (msg, from) => letters?.onMessage(msg, from) || pvp?.onMessage(msg, from);
    if (r.isHost) {
      // a joining guest catches up with this (taken before it is registered)
      r.snapshotProvider = () => ({ letters: letters.snapshot(), ...pvp.snapshot() });
      r.onGameMessage = onGame;
    }

    r.onPlayers = (list) => {
      playersPanel.render(list, r.selfId, letters?.kills);
      playersPanel.show(list.length > 1 || !r.isHost);
      sync?.setPlayers(list);
      pvp?.setPlayers(list);
    };
    r.onNotice = (text) => feed.push(text);
    r.onClosed = (reason, message) => {
      if (r.isHost || reason === "left") return; // we closed it ourselves
      // the connection died without a goodbye: try to get back in, score and all
      if (reason === "lost" && online.roomId) return rejoin();
      // the host is gone: this map is dead, back to the start page
      leaveToMenu(message);
    };
    r.onPlayers(r.players);
    if (!r.isHost) {
      // catch up with what happened before we joined, then replay what came in while loading
      letters.applySnapshot(online.world?.letters);
      pvp.applySnapshot(online.world);
      hud.integrity(destruction);
      r.setGameHandler((msg) => onGame(msg, 0));
    }
  };

  if (room) {
    // guest: we joined someone else's game
    if (map.hash !== online.hostMap.hash) console.warn("[net] map geometry differs slightly from the host's", map, online.hostMap);
    wireRoom(room);
    room.ready(map);
    invite.showLink(location.href, { host: false });
  } else {
    // potential host: the room only opens when the player asks for an invite link
    invite.onInvite = async (name) => {
      invite.opening();
      try {
        const r = await HostRoom.open({ name, pdfBytes: pdf.bytes, pdfName: online.fileName || "cv.pdf", map, net: config.net });
        if (disposed) return r.leave();
        room = r;
        wireRoom(r);
        invite.showLink(r.inviteUrl, { host: true, maxPlayers: config.net.maxPlayers });
        console.info("[net] room open", r.roomId);
      } catch (e) {
        console.error(e);
        invite.failed(e?.message || String(e));
      }
    };
  }

  /** a guest lost its connection: rejoin through the same link for up to 60 s (MP5) */
  const rejoin = async () => {
    if (disposed) return;
    const banner = $("reconnect");
    banner.hidden = false;
    weapon.blocked = true;
    weapon.mouseTrigger = weapon.keyTrigger = false;
    const resume = { x: player.core.x, z: player.core.z, yaw: player.core.yaw };
    const until = performance.now() + 60000;
    for (let attempt = 1; !disposed && performance.now() < until; attempt++) {
      banner.textContent = `Connection lost. Reconnecting… (attempt ${attempt})`;
      try {
        const res = await GuestRoom.join(online.roomId, {
          name: online.name || "Player",
          net: config.net,
          key: rejoinKey(online.roomId),
          haveMap: map,
          onStatus: (text) => (banner.textContent = `Connection lost. ${text}`),
        });
        if (disposed) return res.room.leave();
        // the host skips the download when we still have the map; otherwise rebuild from its PDF
        const p2 = res.pdfBytes ? await loadPdfBytes(res.pdfBytes, { rasterScale: config.rasterScale }) : pdf;
        startGame(p2, { room: res.room, hostMap: res.map, fileName: online.fileName, world: res.world, roomId: online.roomId, name: online.name, resume });
        return;
      } catch (e) {
        console.warn("[net] rejoin attempt failed", e);
        // the room is gone from the matchmaking server: the host closed the game (or crashed)
        if (e?.code === "no-host") return leaveToMenu("The host left the game.");
        if (["version", "full", "bad-link"].includes(e?.code)) return leaveToMenu(e.message);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (!disposed) leaveToMenu("Lost the connection to the host and couldn't get back in.");
  };

  const leaveToMenu = (message) => {
    game?.dispose();
    game = null;
    document.exitPointerLock?.();
    clearJoinFromUrl();
    fail(message);
  };
  let disposed = false;

  const clock = new THREE.Clock();
  let running = true;
  // browsers stop animation frames in hidden tabs: keep the network going on a timer, so a host
  // that switches tabs still relays states and referees hits for the others
  let lastFrameAt = performance.now();
  const netTimer = setInterval(() => {
    if (!running || performance.now() - lastFrameAt < 250) return;
    sync?.update(0.1, intro.done);
    letters?.update(100);
    if (intro.done) pvp?.update(0.1);
  }, 100);
  renderer.setAnimationLoop(() => {
    if (!running) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    const playing = intro.done;
    if (!playing) {
      if (!intro.update(dt)) {
        scene.fog = fog;
        const at = online.resume || { x: world.spawn.x, z: world.spawn.z, yaw: 0 };
        player.spawn(at.x, at.z, at.yaw);
        setPlaying(true);
      }
    } else {
      sync?.pushLocal(dt);
      player.update(dt);
      weapon.update(dt);
      hud.debug(player.core.fly ? "NOCLIP (V to exit) · Q/E down/up" : "");
    }
    destruction.update(dt);
    debris.update(dt);
    sparks.update(dt);
    dust.update(dt);
    sync?.update(dt, playing);
    letters?.update(dt * 1000);
    if (playing) pvp?.update(dt);
    remoteShots.update(dt);
    words.update(dt);
    chud.update(dt);
    lastFrameAt = performance.now();
    sfx.updateListener(camera);
    if (playing) minimap.draw(player.core.x, player.core.z, player.core.yaw, sync ? sync.minimapDots() : undefined);
    hud.update(dt);

    if (endCam) {
      endCam.t += dt;
      const k = Math.min(1, endCam.t / 2.5);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      camera.position.lerpVectors(endCam.pos, endCam.to.pos, e);
      camera.quaternion.slerpQuaternions(endCam.quat, endCam.to.quat, e);
      camera.near = THREE.MathUtils.clamp(camera.position.y * 0.04, 0.1, 20); // depth precision up high
      camera.updateProjectionMatrix();
    }
    renderer.render(scene, camera);
    if (playing && !player.dead) weapon.render(renderer); // no gun in hand on the killcam
  });

  game = {
    dispose() {
      if (disposed) return;
      disposed = true;
      room?.leave();
      room = null;
      clearInterval(netTimer);
      $("reconnect").hidden = true;
      pvp?.dispose();
      pvp = null;
      sync?.dispose();
      sync = null;
      letters = null;
      destruction.onLocalHit = null;
      invite.dispose();
      playersPanel.show(false);
      feed.clear();
      running = false;
      renderer.setAnimationLoop(null);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", skip);
      document.removeEventListener("keydown", skip);
      document.removeEventListener("keydown", onKey);
      pause.removeEventListener("click", onPauseClick);
      player.dispose();
      weapon.dispose();
      renderer.dispose();
    },
  };
  // handy for poking at things from the devtools console
  window.__cv = {
    scene, camera, world, renderer, config, player, collision, weapon, destruction, map, remoteShots, words,
    get room() {
      return room;
    },
    get sync() {
      return sync;
    },
    get letters() {
      return letters;
    },
    get pvp() {
      return pvp;
    },
  };
}
