// Model viewer (dev tool): http://localhost:5173/viewer.html
// The Blender characters exactly as the game shows them (createAvatar + the same procedural
// poses), next to the old box soldier and the real hitboxes. "measure" checks that the visual
// head sits inside the head hitbox, standing and crouched.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { preloadModels, reloadModels, instantiate, getModel, style } from "../assets/models.js";
import { BoxAvatar, createAvatar } from "../player/avatar.js";
import { OUTFITS } from "../net/room.js";
import { FLAG } from "../net/snapshots.js";
import { hitboxOf } from "../net/hitbox.js";

const $ = (id) => document.getElementById(id);
const canvas = $("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; // same as the game

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x16171c);
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
camera.position.set(-1.5, 1.8, -5.5); // in front of the characters (they face -Z)
const controls = new OrbitControls(camera, canvas);
controls.target.set(0.3, 1.0, 0);
controls.update();

// lights like the game's world (buildWorld.js)
scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x2a2622, 1.1));
const sun = new THREE.DirectionalLight(0xfff3e0, 2.6);
sun.position.set(-3, 6, -4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 20 });
sun.shadow.bias = -0.0004; // as in buildWorld.js (no shadow acne on the round shapes)
sun.shadow.normalBias = 0.02;
scene.add(sun);

// paper floor
const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshStandardMaterial({ color: 0xf3efe6, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(14, 28, 0xc9c3b4, 0xddd8cc);
grid.position.y = 0.001;
scene.add(grid);

// ---- poses: the network state the avatars would get in a game
const POSES = {
  idle: { speed: 0, f: FLAG.grounded },
  walk: { speed: 6, f: FLAG.grounded },
  sprint: { speed: 9.5, f: FLAG.grounded },
  crouch: { speed: 0, f: FLAG.grounded | FLAG.crouch },
  "crouch walk": { speed: 3, f: FLAG.grounded | FLAG.crouch },
  jump: { speed: 5, f: 0 },
  dead: { speed: 0, f: FLAG.grounded, dead: true },
};
let pose = "idle";

// ---- characters: [box soldier, one per outfit]
const SPACING = 1.4;
let bodies = []; // {avatar, x, label, mixer?, skeleton?}
const hbMat = new THREE.MeshBasicMaterial({ color: 0xff3b6b, wireframe: true, transparent: true, opacity: 0.35 });
const hitboxes = new THREE.Group();
scene.add(hitboxes);
let gunDisplay = null;

function placeBodies() {
  for (const b of bodies) {
    b.avatar.dispose();
    b.skeleton?.removeFromParent();
  }
  gunDisplay?.dispose();
  const accent = $("accent").value;
  const lines = [];
  bodies = [{ avatar: new BoxAvatar(accent), x: -SPACING, label: "box" }];
  OUTFITS.forEach((outfit, i) => {
    const avatar = createAvatar(accent, outfit);
    const ok = !(avatar instanceof BoxAvatar);
    lines.push(`${outfit}: ${ok ? stats(avatar.inst.model) : "model not available (box fallback)"}`);
    const b = { avatar, x: i * SPACING, label: outfit };
    if (ok) {
      b.mixer = new THREE.AnimationMixer(avatar.inst.model);
      b.skeleton = new THREE.SkeletonHelper(avatar.inst.model);
      b.skeleton.visible = $("skeleton").checked;
      scene.add(b.skeleton);
    }
    bodies.push(b);
  });
  for (const b of bodies) scene.add(b.avatar.root);
  old().root.visible = $("old").checked;

  gunDisplay = instantiate("gun", { accent });
  if (gunDisplay) {
    gunDisplay.root.position.set(OUTFITS.length * SPACING, 1.2, 0);
    gunDisplay.root.rotation.y = Math.PI / 2;
    scene.add(gunDisplay.root);
    lines.push(`gun: ${stats(gunDisplay.model)}`);
  } else lines.push("gun: gun.glb not exported yet");
  $("status").textContent = lines.join("\n");
  setPose(pose);
  buildClipButtons();
  applyWireframe();
}
const old = () => bodies[0].avatar;

function stats(obj) {
  let tris = 0, bones = 0;
  const mats = new Set();
  obj.traverse((o) => {
    if (o.isBone) bones++;
    if (!o.isMesh) return;
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    [o.material].flat().forEach((m) => mats.add(m.name));
  });
  return `${Math.round(tris)} tris, ${bones} bones, [${[...mats].join(", ")}]`;
}

function setPose(name) {
  pose = name;
  for (const b of $("poses").children) b.classList.toggle("on", b.textContent === name);
  for (const b of bodies) {
    if (POSES[name].dead) b.avatar.die();
    else if (b.avatar.dead) b.avatar.revive();
  }
}
for (const name of Object.keys(POSES)) {
  const b = document.createElement("button");
  b.textContent = name;
  b.onclick = () => setPose(name);
  $("poses").appendChild(b);
}

// ---- clips (Phase 3): played on top of the procedural pose
let activeClip = null;
function buildClipButtons() {
  const box = $("clips");
  box.innerHTML = "";
  const clips = bodies.find((b) => b.mixer)?.avatar.inst.animations || [];
  if (!clips.length) {
    box.innerHTML = '<span class="muted">none yet</span>';
    return;
  }
  for (const clip of clips) {
    const btn = document.createElement("button");
    btn.textContent = clip.name;
    btn.onclick = () => {
      const on = activeClip !== clip.name;
      for (const x of box.children) x.classList.remove("on");
      for (const b of bodies) {
        if (!b.mixer) continue;
        b.mixer.stopAllAction();
        if (on) b.mixer.clipAction(b.avatar.inst.animations.find((c) => c.name === clip.name)).play();
      }
      activeClip = on ? clip.name : null;
      if (on) btn.classList.add("on");
    };
    box.appendChild(btn);
  }
}

function applyWireframe() {
  const on = $("wire").checked;
  for (const b of bodies.slice(1)) b.avatar.inst?.model.traverse((o) => o.isMesh && [o.material].flat().forEach((m) => (m.wireframe = on)));
}

// ---- UI
$("hitbox").onchange = () => (hitboxes.visible = $("hitbox").checked);
$("old").onchange = () => (old().root.visible = $("old").checked);
$("skeleton").onchange = () => bodies.forEach((b) => b.skeleton && (b.skeleton.visible = $("skeleton").checked));
$("wire").onchange = applyWireframe;
$("accent").oninput = () => {
  for (const b of bodies.slice(1)) b.avatar.inst?.setAccent($("accent").value);
  gunDisplay?.setAccent($("accent").value);
};
// look switches (same as ?toon=1 / ?rim=0.5 in the game)
$("toon").checked = style.toon;
$("rim").value = style.rim;
$("rimv").textContent = style.rim;
$("toon").onchange = () => {
  style.toon = $("toon").checked;
  placeBodies();
};
$("rim").onchange = () => {
  style.rim = Number($("rim").value);
  $("rimv").textContent = style.rim;
  placeBodies();
};
const reload = () => {
  $("status").textContent = "reloading…";
  activeClip = null;
  reloadModels().then(placeBodies);
};
$("reload").onclick = reload;
addEventListener("keydown", (e) => e.code === "KeyR" && !e.repeat && reload());

preloadModels().then(placeBodies);

// ---- loop
const clock = new THREE.Clock();
const _v = new THREE.Vector3();
let measureT = 0;
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const p = POSES[pose];
  const pitch = Number($("pitch").value);
  for (const m of hitboxes.children) m.geometry.dispose();
  hitboxes.clear();
  const lines = [];
  for (const b of bodies) {
    b.avatar.update(dt, { x: b.x, y: 0, z: 0, yaw: 0, pitch, vx: 0, vz: -p.speed, f: p.f });
    b.mixer?.update(dt);
    if (b.avatar.dead) continue;
    // hitboxes follow the smoothed crouch, like the game's
    const hb = hitboxOf(b.x, 0, 0, b.avatar.crouch);
    const cap = new THREE.Mesh(new THREE.CapsuleGeometry(hb.r, hb.y1 - hb.y0, 4, 12), hbMat);
    cap.position.set(hb.x, (hb.y0 + hb.y1) / 2, hb.z);
    const head = new THREE.Mesh(new THREE.SphereGeometry(hb.hr, 12, 8), hbMat);
    head.position.set(hb.hx, hb.hy, hb.hz);
    hitboxes.add(cap, head);
    if (b.label !== "box") {
      b.avatar.root.updateMatrixWorld(true);
      const c = b.avatar.sightPoints()[0];
      _v.set(hb.hx, hb.hy, hb.hz);
      lines.push(`${b.label}: head centre y ${c.y.toFixed(2)} (hitbox ${hb.hy.toFixed(2)}), off by ${c.distanceTo(_v).toFixed(2)} m`);
    }
  }
  if ((measureT -= dt) <= 0) {
    $("measure").textContent = lines.join("\n");
    measureT = 0.25;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();

// for poking around from the console
Object.assign(window, { THREE, scene, camera, getModel, get bodies() { return bodies; }, setPose });
