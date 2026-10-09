// Model viewer (dev tool): http://localhost:5173/viewer.html
// Shows the Blender models as three.js renders them, next to the old box soldier and the real
// hitboxes, so proportions, colours and animation clips can be checked without starting a match.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { preloadModels, reloadModels, instantiate, getModel, MODEL_FILES } from "../assets/models.js";
import { Avatar } from "../player/avatar.js";
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
const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
camera.position.set(-1.2, 1.7, -4.2); // in front of the models (they face -Z)
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1.0, 0);
controls.update();

// lights like the game's world (buildWorld.js)
scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x2a2622, 1.1));
const sun = new THREE.DirectionalLight(0xfff3e0, 2.6);
sun.position.set(3, 6, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 20 });
scene.add(sun);

// paper floor
const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ color: 0xf3efe6, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(12, 24, 0xc9c3b4, 0xddd8cc);
grid.position.y = 0.001;
scene.add(grid);

// ---- the old soldier, for scale
const old = new Avatar("#4d8dff");
old.root.position.set(-1.3, 0, 0);
scene.add(old.root);

// ---- hitbox overlay (follows the "crouched" checkbox)
const hbMat = new THREE.MeshBasicMaterial({ color: 0xff3b6b, wireframe: true, transparent: true, opacity: 0.35 });
const hitboxes = new THREE.Group();
scene.add(hitboxes);
function drawHitboxes() {
  hitboxes.clear();
  const crouch = $("crouch").checked ? 1 : 0;
  for (const x of [0, -1.3]) {
    const b = hitboxOf(x, 0, 0, crouch);
    const cap = new THREE.Mesh(new THREE.CapsuleGeometry(b.r, b.y1 - b.y0, 6, 16), hbMat);
    cap.position.set(b.x, (b.y0 + b.y1) / 2, b.z);
    const head = new THREE.Mesh(new THREE.SphereGeometry(b.hr, 16, 10), hbMat);
    head.position.set(b.hx, b.hy, b.hz);
    hitboxes.add(cap, head);
  }
}

// ---- the Blender models
let player = null; // instantiate("player")
let gun = null; // instantiate("gun")
let mixer = null;
let skeleton = null;
let activeClip = null;

function clearModels() {
  player?.dispose();
  gun?.dispose();
  skeleton?.removeFromParent();
  player = gun = mixer = skeleton = null;
}

function placeModels() {
  clearModels();
  const accent = $("accent").value;
  const lines = [];
  player = instantiate("player", { accent });
  if (player) {
    scene.add(player.root);
    mixer = new THREE.AnimationMixer(player.model);
    skeleton = new THREE.SkeletonHelper(player.model);
    skeleton.visible = $("skeleton").checked;
    scene.add(skeleton);
    lines.push(`player: ${stats(player.model)}`);
  } else lines.push(`player: ${MODEL_FILES.player} not exported yet`);
  gun = instantiate("gun", { accent });
  if (gun) {
    gun.root.position.set(1.2, 1.2, 0);
    gun.root.rotation.y = Math.PI / 2; // barrel pointing right: side view from the default camera
    scene.add(gun.root);
    lines.push(`gun: ${stats(gun.model)}`);
  } else lines.push(`gun: ${MODEL_FILES.gun} not exported yet`);
  $("status").textContent = lines.join("\n");
  buildClipButtons();
  applyWireframe();
}

function stats(obj) {
  let tris = 0, meshes = 0, bones = 0;
  const mats = new Set();
  obj.traverse((o) => {
    if (o.isBone) bones++;
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    [o.material].flat().forEach((m) => mats.add(m.name));
  });
  return `${Math.round(tris)} tris, ${meshes} mesh, ${bones} bones, [${[...mats].join(", ")}]`;
}

function buildClipButtons() {
  const box = $("clips");
  box.innerHTML = "";
  const clips = player?.animations || [];
  if (!clips.length) {
    box.innerHTML = '<span class="muted">none yet</span>';
    return;
  }
  for (const clip of clips) {
    const b = document.createElement("button");
    b.textContent = clip.name;
    b.onclick = () => playClip(clip, b);
    box.appendChild(b);
  }
}

function playClip(clip, button) {
  for (const b of $("clips").children) b.classList.remove("on");
  if (activeClip === clip.name) {
    mixer.stopAllAction();
    activeClip = null;
    return;
  }
  const prev = mixer.existingAction(activeClip && player.animations.find((c) => c.name === activeClip));
  const action = mixer.clipAction(clip).reset().play();
  if (prev) action.crossFadeFrom(prev, 0.2, false);
  activeClip = clip.name;
  button.classList.add("on");
}

function applyWireframe() {
  const on = $("wire").checked;
  for (const m of [player, gun]) m?.model.traverse((o) => o.isMesh && [o.material].flat().forEach((x) => (x.wireframe = on)));
}

// ---- UI
$("hitbox").onchange = () => (hitboxes.visible = $("hitbox").checked);
$("old").onchange = () => (old.root.visible = $("old").checked);
$("skeleton").onchange = () => skeleton && (skeleton.visible = $("skeleton").checked);
$("wire").onchange = applyWireframe;
$("crouch").onchange = drawHitboxes;
$("accent").oninput = () => {
  player?.setAccent($("accent").value);
  gun?.setAccent($("accent").value);
};
const reload = () => {
  $("status").textContent = "reloading…";
  activeClip = null;
  reloadModels().then(placeModels);
};
$("reload").onclick = reload;
addEventListener("keydown", (e) => e.code === "KeyR" && !e.repeat && reload());

drawHitboxes();
preloadModels().then(placeModels);

// ---- loop
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  mixer?.update(dt);
  const crouch = $("crouch").checked;
  old.update(dt, { x: -1.3, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, f: FLAG.grounded | (crouch ? FLAG.crouch : 0) });
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();

// for poking around from the console
Object.assign(window, { THREE, scene, camera, getModel, get player() { return player; }, get gun() { return gun; } });
