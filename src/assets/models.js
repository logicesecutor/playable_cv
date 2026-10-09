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
import { config } from "../config.js";

/** character look: config.characters, overridable with ?toon=1 / ?rim=0.5 (and the model viewer) */
export const style = { ...config.characters };
{
  const q = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
  if (q?.has("toon")) style.toon = q.get("toon") !== "0";
  if (q?.has("rim")) style.rim = Math.max(0, Number(q.get("rim")) || 0);
}

/** name -> file in public/models */
export const MODEL_FILES = {
  player_corporate: "player_corporate.glb",
  player_engineer: "player_engineer.glb",
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
    const styled = stylize(m);
    if (m.name !== "Accent") return styled;
    let c = owned.find((x) => x.userData.src === m);
    if (!c) {
      c = styled.clone();
      if (style.rim > 0) addRim(c, style.rim); // clone() doesn't carry the shader hook
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

// ------------------------------------------------------------------ look: toon ramp + rim light

let gradient = null;
/** 3-band ramp for MeshToonMaterial (shadow, mid, lit) */
function toonGradient() {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
  }
  return gradient;
}

/** the loaded material as the current `style` wants it (cached per source material and style) */
function stylize(m) {
  if (!style.toon && !(style.rim > 0)) return m;
  const key = `${style.toon ? 1 : 0}|${style.rim}`;
  const cache = (m.userData.styled ??= {});
  if (cache[key]) return cache[key];
  let s;
  if (style.toon) {
    s = new THREE.MeshToonMaterial({
      name: m.name, map: m.map, color: m.color.clone(), gradientMap: toonGradient(),
      emissive: m.emissive.clone(), emissiveMap: m.emissiveMap, emissiveIntensity: m.emissiveIntensity, side: m.side,
    });
  } else s = m.clone();
  if (style.rim > 0) addRim(s, style.rim);
  return (cache[key] = s);
}

/** adds a cool fresnel rim to a standard / toon material (silhouettes pop against the paper) */
export function addRim(mat, strength) {
  const rim = { value: strength };
  mat.userData.rim = rim;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.rimStrength = rim;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float rimStrength;")
      .replace(
        "#include <opaque_fragment>",
        `{
          float rimF = 1.0 - saturate(dot(normal, normalize(vViewPosition)));
          outgoingLight += rimStrength * pow(rimF, 3.0) * vec3(0.78, 0.88, 1.0);
        }
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => `pcv-rim-${mat.type}`;
  mat.needsUpdate = true;
}
