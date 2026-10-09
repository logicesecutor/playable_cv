// The typewriter blaster (public/models/gun.glb, built by blender_src/scripts/build_gun.py), for
// the first-person view-model and for the characters' hands, with the old box gun as fallback.
//
// Both kinds return the same shape:
//   root      Object3D to place (faces -Z like the camera)
//   muzzle    Vector3 in root space: flash, tracers (and later the flying words) start here
//   magazine  Object3D the reload moves (the ink-ribbon cartridge), or null
//   grips     {r, l} Vector3 in root space where the hands hold it
//   hands     {r, l} first-person mitten hands (null on the third-person gun / the box gun)
//   setAccent(color), dispose()
import * as THREE from "three";
import { instantiate } from "../assets/models.js";
import { buildGun } from "./weapon.js";

const name = (n) => THREE.PropertyBinding.sanitizeNodeName(n);

/**
 * @param {{fp?: boolean, accent?: THREE.ColorRepresentation}} [o]
 *   fp: first-person (keeps the mitten hands), otherwise they're removed
 */
export function createGun({ fp = false, accent } = {}) {
  const inst = instantiate("gun", { accent });
  if (!inst) return boxGun();
  const n = inst.nodes;
  inst.root.updateMatrixWorld(true);
  const local = (node) => (node ? inst.root.worldToLocal(node.getWorldPosition(new THREE.Vector3())) : null);
  const muzzle = local(n[name("Muzzle")]) || new THREE.Vector3(0, 0, -0.3);
  const grips = { r: local(n[name("Grip.R")]), l: local(n[name("Grip.L")]) };
  const hands = { r: n[name("FPHand.R")] || null, l: n[name("FPHand.L")] || null };
  if (!fp) {
    for (const h of Object.values(hands)) h?.removeFromParent();
    hands.r = hands.l = null;
  }
  return {
    root: inst.root,
    muzzle,
    magazine: n[name("Magazine")] || null,
    grips,
    hands,
    model: true,
    setAccent: inst.setAccent,
    dispose: () => inst.dispose(),
  };
}

/** the old procedural box gun, same shape as createGun()'s result */
function boxGun() {
  const g = buildGun();
  return {
    root: g.root,
    muzzle: g.muzzle,
    magazine: null,
    grips: { r: new THREE.Vector3(0, -0.09, 0.11), l: new THREE.Vector3(0, -0.005, -0.25) },
    hands: { r: null, l: null },
    model: false,
    setAccent() {},
    dispose() {
      g.root.removeFromParent();
      g.root.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        o.material.dispose();
      });
    },
  };
}
