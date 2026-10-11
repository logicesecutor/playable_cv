// "Meet the job hunters" on the front page (#lp-players): the in-game character (ModelAvatar, the
// same Blender models, clips, accent tint and rim light as in a match) on the page, with drag to
// turn, outfit, player colour, animation buttons and a name tag. A showcase only: in a match the
// host still hands out outfits (room.js pickOutfit) and colours stay unique per room.
// WebGL starts only when the section comes near the viewport and renders only while it is visible
// and the front page is the active screen.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { preloadModels, getModel } from "../assets/models.js";
import { ModelAvatar } from "../player/modelAvatar.js";
import { FLAG } from "../net/snapshots.js";
import { PLAYER_COLORS } from "../net/room.js";
import { WORDS, RARE_WORDS } from "../fx/wordShots.js";

const COLOR_NAMES = ["Orange", "Blue", "Green", "Yellow", "Purple", "Pink", "Teal", "White"];
const OUTFIT_TEXT = {
  corporate: "Jacket, round glasses, a tie and a badge clip. Tie, badge and shoe soles in your colour.",
  engineer: "Beanie, a T-shirt with a </> print, cargo shorts and sneakers. T-shirt and beanie in your colour.",
};
/** network-like state that makes ModelAvatar pick each clip (speeds = modelAvatar CLIP_SPEED) */
const POSES = {
  Idle: { v: 0, f: FLAG.grounded },
  Walk: { v: 6.5, f: FLAG.grounded },
  Run: { v: 11, f: FLAG.grounded },
  Crouch: { v: 0, f: FLAG.grounded | FLAG.crouch },
  Jump: { v: 0, f: 0 },
};
const RELOAD_TIME = 1.3;
const DEATH_TIME = 2.6;
const pick = () => {
  const list = Math.random() < 1 / 8 ? RARE_WORDS : WORDS;
  return list[(Math.random() * list.length) | 0];
};

/** @param {{ isActive: () => boolean }} o isActive: the front page is the screen being shown */
export function initHunters({ isActive }) {
  const $ = (id) => document.getElementById(id);
  const stage = $("hv"), box = $("hv-canvas"), tag = $("hv-tag"), tagName = tag.querySelector(".nt-name");
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const state = { color: PLAYER_COLORS[1], outfit: "engineer", pose: "Idle" };

  // controls work before the 3D is up: they only change `state` until then
  const swatches = $("hc-colors");
  swatches.innerHTML = PLAYER_COLORS.map(
    (c, i) => `<button type="button" role="radio" aria-label="${COLOR_NAMES[i] || c}" aria-checked="${c === state.color}" style="--c:${c}" data-color="${c}"></button>`,
  ).join("");
  tag.style.setProperty("--c", state.color);
  $("hc-desc").textContent = OUTFIT_TEXT[state.outfit];
  $("hc-name").addEventListener("input", (e) => (tagName.textContent = e.target.value.trim() || "Player"));

  let view = null; // the 3D part, built on first approach
  swatches.addEventListener("click", (e) => {
    const b = e.target.closest("[data-color]");
    if (!b) return;
    for (const x of swatches.children) x.setAttribute("aria-checked", String(x === b));
    state.color = b.dataset.color;
    tag.style.setProperty("--c", state.color);
    view?.setColor(state.color);
  });
  $("hc-outfit").addEventListener("click", (e) => {
    const b = e.target.closest("[data-outfit]");
    if (!b || b.dataset.outfit === state.outfit) return;
    for (const x of b.parentNode.children) x.setAttribute("aria-checked", String(x === b));
    state.outfit = b.dataset.outfit;
    $("hc-desc").textContent = OUTFIT_TEXT[state.outfit];
    view?.rebuild();
  });
  const clips = $("hc-clips");
  const markPose = (name) => {
    for (const x of clips.querySelectorAll("[data-clip]")) if (x.hasAttribute("aria-pressed")) x.setAttribute("aria-pressed", String(x.dataset.clip === name));
  };
  clips.addEventListener("click", (e) => {
    const name = e.target.closest("[data-clip]")?.dataset.clip;
    if (!name || !view) return;
    if (name === "Fire") view.fire();
    else if (name === "Reload") view.reload();
    else if (name === "Death") (view.die(), markPose("Death"));
    else ((state.pose = name), view.revive(), markPose(name));
  });

  const near = new IntersectionObserver(
    (es) => {
      if (!es[0].isIntersecting) return;
      near.disconnect();
      build().catch((err) => {
        console.warn("[hunters] 3D preview unavailable", err);
        $("hv-load").innerHTML = "<p>The 3D preview couldn't start on this device.</p>";
      });
    },
    { rootMargin: "400px 0px" },
  );
  near.observe(stage);

  async function build() {
    await preloadModels(); // already downloading (main.js); resolves when done or failed
    if (!getModel("player_engineer") || !getModel("player_corporate")) throw new Error("character models not available");

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:pan-y";
    box.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
    camera.position.set(-1.6, 1.55, -4.4); // in front of the character (it faces -Z)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.82, 0);
    Object.assign(controls, { enablePan: false, enableDamping: true, minDistance: 3, maxDistance: 7, minPolarAngle: 0.6, maxPolarAngle: 1.5 });
    controls.autoRotate = !reduce;
    controls.autoRotateSpeed = -1.6;
    controls.addEventListener("start", () => (controls.autoRotate = false));
    controls.update();

    // lights like the game's world (buildWorld.js, dev/viewer.js)
    scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x2a2622, 1.1));
    const sun = new THREE.DirectionalLight(0xfff3e0, 2.6);
    sun.position.set(-3, 6, -4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.5, far: 20 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);
    // a shadow-only floor: the character stands on the page itself
    const floor = new THREE.Mesh(new THREE.CircleGeometry(3, 48), new THREE.ShadowMaterial({ opacity: 0.22 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    let avatar = null, dead = 0, reloadT = -1;
    const s = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, f: FLAG.grounded };
    const rebuild = () => {
      avatar?.dispose();
      avatar = new ModelAvatar(state.color, state.outfit);
      avatar.root.traverse((o) => o.isMesh && (o.castShadow = true));
      scene.add(avatar.root);
      dead = 0;
    };
    rebuild();

    const resize = () => {
      const w = box.clientWidth, h = box.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(box);
    resize();

    let visible = true;
    new IntersectionObserver((es) => (visible = es[0].isIntersecting)).observe(stage);
    const v = new THREE.Vector3(), aim = new THREE.Vector3();
    const toScreen = (p) => (p.project(camera), { x: ((p.x + 1) / 2) * box.clientWidth, y: ((1 - p.y) / 2) * box.clientHeight });

    let last = performance.now();
    renderer.setAnimationLoop(() => {
      const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!visible || !isActive()) return;
      if (dead > 0 && (dead -= dt) <= 0) view.revive();
      if (reloadT >= 0 && (reloadT += dt) > RELOAD_TIME) reloadT = -1;
      const pose = POSES[state.pose] || POSES.Idle;
      s.vz = pose.v;
      s.f = pose.f | (reloadT >= 0 ? FLAG.reload : 0);
      avatar.update(dt, s);
      // the Death clip falls forward (towards the camera): follow it so the body stays in frame
      aim.set(0, dead > 0 ? 0.38 : 0.82, dead > 0 ? -0.55 : 0);
      v.copy(aim).sub(controls.target).multiplyScalar(Math.min(1, dt * 4));
      controls.target.add(v);
      camera.position.add(v);
      controls.update();
      renderer.render(scene, camera);
      const t = toScreen(avatar.tagAnchor(v));
      tag.style.transform = `translate(${t.x}px, ${t.y}px) translate(-50%, -100%)`;
    });
    stage.classList.add("ready");

    view = {
      rebuild,
      setColor(c) {
        avatar.inst.setAccent(c);
        avatar.gun.setAccent(c);
      },
      fire() {
        if (dead > 0) return;
        avatar.fire();
        slip(toScreen(avatar.muzzle.getWorldPosition(v)));
      },
      reload() {
        if (dead <= 0 && reloadT < 0) reloadT = 0;
      },
      die() {
        if (dead > 0) return;
        avatar.die();
        dead = DEATH_TIME;
        fired(toScreen(avatar.tagAnchor(v)));
      },
      revive() {
        if (!avatar.dead) return;
        avatar.revive();
        dead = 0;
        markPose(state.pose);
      },
    };
  }

  /** a typed rejection flying out of the blaster */
  function slip(at) {
    const el = document.createElement("span");
    el.className = "lp-slip hv-slip";
    el.textContent = pick();
    stage.appendChild(el);
    const dx = (at.x > stage.clientWidth / 2 ? -1 : 1) * (60 + Math.random() * 60), dy = -90 - Math.random() * 60;
    const from = `translate(${at.x}px, ${at.y}px) translate(-50%, -50%)`;
    if (reduce || !el.animate) {
      el.style.transform = from;
      setTimeout(() => el.remove(), 900);
      return;
    }
    el.animate(
      [
        { transform: `${from} scale(.4)`, opacity: 0 },
        { transform: `translate(${at.x + dx * 0.7}px, ${at.y + dy}px) translate(-50%, -50%) rotate(-4deg)`, opacity: 1, offset: 0.3 },
        { transform: `translate(${at.x + dx}px, ${at.y + dy + 10}px) translate(-50%, -50%) rotate(-3deg)`, opacity: 1, offset: 0.7 },
        { transform: `translate(${at.x + dx + 10}px, ${at.y + dy + 80}px) translate(-50%, -50%) rotate(20deg)`, opacity: 0 },
      ],
      { duration: 1500, easing: "cubic-bezier(.2,.7,.3,1)" },
    ).onfinish = () => el.remove();
  }

  /** FIRED! over the body, like the in-game stamp (wordShots.fired) */
  function fired(at) {
    const el = document.createElement("span");
    el.className = `lp-stamp hv-fired${reduce ? "" : " slam"}`;
    el.textContent = "Fired!";
    el.style.left = `${at.x}px`;
    el.style.top = `${at.y}px`;
    stage.appendChild(el);
    setTimeout(() => el.classList.add("gone"), 1600);
    setTimeout(() => el.remove(), 2400);
  }
}
