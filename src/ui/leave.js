// The Home button (pause card and end-of-match card): back to the page where you pick a CV.
// The game closes; a host's room closes with it (the guests get "The host left the game." and
// go back to their start page), a guest just leaves. A host with other players in the game is
// asked first, everyone else leaves at once.
const $ = (id) => document.getElementById(id);

export class LeaveControl {
  /**
   * @param {object} o
   * @param {() => number} o.othersAffected  players whose game ends with ours (a host's guests; 0 otherwise)
   * @param {() => void} o.onLeave  close the game and show the start page
   */
  constructor(o) {
    this.o = o;
    this.el = { pause: $("home-button"), end: $("ec-home"), box: $("leave-confirm"), text: $("lc-text"), stay: $("lc-stay"), go: $("lc-leave") };
    // these sit on cards that grab the mouse (pause) or swallow clicks: keep ours to ourselves
    this._request = (e) => {
      e.stopPropagation();
      this.request();
    };
    this._stay = (e) => {
      e.stopPropagation();
      this.close();
    };
    this._go = (e) => {
      e.stopPropagation();
      this.close();
      this.o.onLeave();
    };
    this._stop = (e) => e.stopPropagation();
    this._key = (e) => {
      if (this.el.box.hidden) return;
      if (e.key === "Escape") this.close();
      else if (e.key === "Enter") this._go(e);
    };
    this.el.pause.addEventListener("click", this._request);
    this.el.end.addEventListener("click", this._request);
    this.el.stay.addEventListener("click", this._stay);
    this.el.go.addEventListener("click", this._go);
    this.el.box.addEventListener("click", this._stop);
    document.addEventListener("keydown", this._key);
  }

  /** Home was clicked: leave, or ask first if that ends other people's game */
  request() {
    const n = this.o.othersAffected();
    if (n <= 0) return this.o.onLeave();
    this.el.text.textContent = `You're the host: leaving ends the game for ${n === 1 ? "the other player" : `the other ${n} players`}.`;
    this.el.box.hidden = false;
    this.el.stay.focus();
  }

  close() {
    this.el.box.hidden = true;
  }

  dispose() {
    this.close();
    this.el.pause.removeEventListener("click", this._request);
    this.el.end.removeEventListener("click", this._request);
    this.el.stay.removeEventListener("click", this._stay);
    this.el.go.removeEventListener("click", this._go);
    this.el.box.removeEventListener("click", this._stop);
    document.removeEventListener("keydown", this._key);
  }
}
