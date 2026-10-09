// Models made in Blender (blender_src/, exported to public/models/*.glb).
//
// - preloadModels() starts the downloads once (call it early; await it before building a map).
// - instantiate(name, {accent}) gives an independent copy: skinned meshes get their own skeleton
//   (SkeletonUtils.clone), the "Accent" material is cloned and tinted with the player's colour, the
//   shared palette texture is reused.
// - Blender models face -Y; glTF turns that into +Z. The returned `root` wraps the model turned by
//   180°, so it faces three.js -Z like the rest of the game (the camera, the old box avatar).
// - A missing / broken file is not fatal: getModel() returns null and callers keep their
//   procedural fallback.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

/** name -> file in public/models */
export const MODEL_FILES = {
  player: "player.glb",
  gun: "gun.glb",
};

const cache = new Map(); // name -> gltf | null (failed)
let pending = null;
let bust = 0; // cache-buster after reloadModels()

const url = (file) => `${import.meta.env?.BASE_URL ?? "/"}models/${file}${bust ? `?v=${bust}` : ""}`;

/** drop everything and download again (model viewer, after a new export from Blender) */
export function reloadModels() {
  cache.clear();
  pending = null;
  bust = Date.now();
  return preloadModels();
}

/** @returns {Promise<void>} resolves when every model has loaded or failed */
export function preloadModels(names = Object.keys(MODEL_FILES)) {
  if (pending) return pending;
  const loader = new GLTFLoader();
  pending = Promise.all(
    names.map((name) =>
      loader
        .loadAsync(url(MODEL_FILES[name]))
        .then((gltf) => {
          prepare(gltf);
          cache.set(name, gltf);
        })
        .catch((err) => {
          console.warn(`[models] ${name}: not available, using the built-in fallback`, err?.message || err);
          cache.set(name, null);
        }),
    ),
  ).then(() => undefined);
  return pending;
}

/** the loaded glTF, or null if it isn't loaded (yet) or failed */
export function getModel(name) {
  return cache.get(name) || null;
}

/** one-time fixes on a freshly loaded glTF (shared by every copy) */
function prepare(gltf) {
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    for (const m of [o.material].flat()) {
      if (m.map) {
        // the palette: UVs sit in the middle of flat swatches, no mip-maps needed (and none bleeding)
        m.map.generateMipmaps = false;
        m.map.minFilter = THREE.LinearFilter;
        m.map.magFilter = THREE.LinearFilter;
        m.map.needsUpdate = true;
      }
    }
  });
}

/**
 * An independent copy of a loaded model, or null if it isn't available.
 * @param {string} name key of MODEL_FILES
 * @param {{accent?: THREE.ColorRepresentation}} [o] player colour for the "Accent" material
 * @returns {null | {root: THREE.Group, model: THREE.Object3D, nodes: Record<string, THREE.Object3D>,
 *   animations: THREE.AnimationClip[], setAccent: (c: THREE.ColorRepresentation) => void, dispose: () => void}}
 */
export function instantiate(name, { accent } = {}) {
  const gltf = getModel(name);
  if (!gltf) return null;
  const model = cloneSkinned(gltf.scene);
  model.rotation.y = Math.PI; // Blender -Y forward -> three.js -Z forward
  const root = new THREE.Group();
  root.name = name;
  root.add(model);

  const nodes = {};
  const owned = []; // materials cloned for this copy
  model.traverse((o) => {
    if (o.name && !(o.name in nodes)) nodes[o.name] = o;
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    if (Array.isArray(o.material)) o.material = o.material.map(own);
    else o.material = own(o.material);
  });
  function own(m) {
    if (m.name !== "Accent") return m;
    let c = owned.find((x) => x.userData.src === m);
    if (!c) {
      c = m.clone();
      c.userData.src = m;
      owned.push(c);
    }
    return c;
  }
  const setAccent = (color) => {
    for (const m of owned) m.color.set(color);
  };
  if (accent !== undefined) setAccent(accent);

  return {
    root,
    model,
    nodes,
    animations: gltf.animations,
    setAccent,
    dispose() {
      root.removeFromParent();
      for (const m of owned) m.dispose(); // geometry + palette texture are shared: keep them
    },
  };
}
