import * as THREE from "three";
import { config } from "./config.js";
import { loadPdfFile } from "./pdf/loadPdf.js";
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

const $ = (id) => document.getElementById(id);
const screens = { upload: $("upload-screen"), loading: $("loading-screen"), game: $("game-screen") };
function show(name) {
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
}

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
    status.textContent = `Extruding ${pdf.pieces.length.toLocaleString()} letters…`;
    await nextFrame();
    startGame(pdf);
    console.info(`[playable-cv] ready in ${(performance.now() - t0).toFixed(0)} ms`, pdf);
  } catch (err) {
    console.error(err);
    fail(`Couldn't read that PDF: ${err?.message || err}`);
  }
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// ------------------------------------------------------------------ step 2: the map
let game = null;
const sfx = new Sfx(); // one audio context for the whole page

function startGame(pdf) {
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
  console.info("[playable-cv] world", world.stats);

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
  intro = new Intro(camera, world, config);
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
  };

  const pause = $("pause");
  hud.setIntro(true);

  const skip = (e) => {
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
  };

  const clock = new THREE.Clock();
  let running = true;
  renderer.setAnimationLoop(() => {
    if (!running) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    const playing = intro.done;
    if (!playing) {
      if (!intro.update(dt)) {
        scene.fog = fog;
        player.spawn(world.spawn.x, world.spawn.z, 0);
        setPlaying(true);
      }
    } else {
      player.update(dt);
      weapon.update(dt);
      hud.debug(player.core.fly ? "NOCLIP (V to exit) · Q/E down/up" : "");
    }
    destruction.update(dt);
    debris.update(dt);
    sparks.update(dt);
    dust.update(dt);
    sfx.updateListener(camera);
    if (playing) minimap.draw(player.core.x, player.core.z, player.core.yaw);
    hud.update(dt);

    renderer.render(scene, camera);
    if (playing) weapon.render(renderer);
  });

  game = {
    dispose() {
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
  window.__cv = { scene, camera, world, renderer, config, player, collision, weapon, destruction };
}
