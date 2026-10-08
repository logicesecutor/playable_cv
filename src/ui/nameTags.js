// Floating name tags over other players: HTML labels projected from 3D each frame (crisp text at
// any distance). Only shown while the player is actually visible to you (see NetSync).
import * as THREE from "three";

export class NameTags {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.el = container;
    /** @type {Map<number, HTMLElement>} */
    this.tags = new Map();
    this._v = new THREE.Vector3();
  }

  /** @param {number} id @param {string} name @param {string} color */
  ensure(id, name, color) {
    let t = this.tags.get(id);
    if (!t) {
      t = document.createElement("div");
      t.className = "nametag";
      t.innerHTML = `<span class="nt-name"></span><span class="nt-note"></span>`;
      this.el.append(t);
      this.tags.set(id, t);
    }
    t.firstChild.textContent = name;
    t.style.setProperty("--c", color);
    return t;
  }

  remove(id) {
    this.tags.get(id)?.remove();
    this.tags.delete(id);
  }

  /**
   * @param {number} id
   * @param {THREE.Vector3|null} anchor world position above the head, or null to hide
   * @param {THREE.Camera} camera
   * @param {string} [note] small status text ("lagging")
   */
  place(id, anchor, camera, note = "") {
    const t = this.tags.get(id);
    if (!t) return;
    if (!anchor) {
      t.hidden = true;
      return;
    }
    const v = this._v.copy(anchor).project(camera);
    if (v.z > 1 || v.z < -1) {
      t.hidden = true;
      return;
    }
    const dist = camera.position.distanceTo(anchor);
    const x = (v.x * 0.5 + 0.5) * innerWidth;
    const y = (-v.y * 0.5 + 0.5) * innerHeight;
    const scale = Math.max(0.6, Math.min(1, 14 / Math.max(1, dist)));
    t.hidden = false;
    t.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
    t.style.opacity = String(Math.max(0.35, Math.min(1, 1.4 - dist / 120)));
    t.lastChild.textContent = note;
  }

  dispose() {
    for (const t of this.tags.values()) t.remove();
    this.tags.clear();
  }
}
