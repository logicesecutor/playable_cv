// DOM HUD: crosshair + hit markers, ammo, CV integrity, hints / toasts.
const $ = (id) => document.getElementById(id);

export class Hud {
  /** @param {{touch?: boolean}} [opts] touch: word the hints for the on-screen controls */
  constructor(cfg, opts = {}) {
    this.cfg = cfg;
    this.touch = !!opts.touch;
    this.el = {
      crosshair: $("crosshair"),
      minimap: $("minimap"),
      hint: $("hint"),
      ammo: $("ammo"),
      ammoCount: $("ammo-count"),
      ammoMax: $("ammo-max"),
      ammoStatus: $("ammo-status"),
      integrity: $("integrity"),
      integrityValue: $("integrity-value"),
      integrityCount: $("integrity-count"),
    };
    this.markerT = 0;
    this.toastT = 0;
    this.bumpT = 0;
    this.debugText = "";
  }

  setIntro(on) {
    const e = this.el;
    e.crosshair.hidden = e.minimap.hidden = e.ammo.hidden = e.integrity.hidden = on;
    e.hint.textContent = on ? (this.touch ? "Tap to skip the intro" : "Click or press Space to skip the intro") : "";
  }

  ammo(w) {
    const e = this.el;
    e.ammoCount.textContent = String(w.ammo);
    e.ammoMax.textContent = String(w.w.magazine);
    e.ammo.classList.toggle("low", w.ammo <= Math.ceil(w.w.magazine * 0.2));
    e.ammoStatus.textContent = w.reloading > 0 ? "reloading…" : w.ammo === 0 ? (this.touch ? "tap ↻ to reload" : "R to reload") : "";
  }

  integrity(d) {
    const e = this.el;
    e.integrityValue.textContent = `${(d.integrity * 100).toFixed(1)}%`;
    e.integrityCount.textContent = d.destroyed ? `${d.destroyed.toLocaleString()} / ${d.total.toLocaleString()} pieces destroyed` : "";
    if (d.destroyed) {
      e.integrity.classList.add("bump");
      this.bumpT = 0.25;
    }
  }

  /** @param {"hit"|"kill"|"floor"|"miss"|"player"|"head"} result */
  hitMarker(result) {
    if (result === "player") result = "hit";
    if (result !== "hit" && result !== "kill" && result !== "head") return;
    const c = this.el.crosshair;
    c.classList.remove("hit", "kill", "head");
    c.classList.add(result);
    this.markerT = result === "kill" ? 0.35 : result === "head" ? 0.15 : 0.08;
  }

  toast(msg, seconds = 1.5) {
    this.el.hint.textContent = msg;
    this.toastT = seconds;
  }

  debug(text) {
    if (this.toastT > 0) return;
    if (text !== this.debugText) {
      this.debugText = text;
      this.el.hint.textContent = text;
    }
  }

  update(dt) {
    if (this.markerT > 0) {
      this.markerT -= dt;
      if (this.markerT <= 0) this.el.crosshair.classList.remove("hit", "kill", "head");
    }
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) {
        this.el.hint.textContent = this.debugText;
      }
    }
    if (this.bumpT > 0) {
      this.bumpT -= dt;
      if (this.bumpT <= 0) this.el.integrity.classList.remove("bump");
    }
  }
}
