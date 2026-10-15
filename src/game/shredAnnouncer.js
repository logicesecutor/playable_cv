// The shredder's countdown and announcements on the HUD (S3), shared by a multiplayer match
// (game/pvp.js) and single player (game/soloShred.js): the last `warn` seconds tick down under the
// match bar with a blip each second, then a short notice when she picks the CV up and when the
// shredder starts. Only fresh changes are announced (a late joiner doesn't need old news).

export class ShredAnnouncer {
  /**
   * @param {object} o
   * @param {import("../ui/matchHud.js").MatchHud} o.mhud
   * @param {any} o.sfx
   * @param {number} o.grab seconds from her reaching to the feed (config.shredder.grab)
   */
  constructor(o) {
    this.o = o;
    this.reset();
  }

  reset() {
    this.notice = null;
    this.noticeUntil = 0;
    this.lastPhase = "waiting";
    this.lastCount = null;
  }

  /**
   * @param {{phase:string, t:number|null, countdown:number|null}} shred  game/shredder.js shredState
   * @param {boolean} active  false between matches: nothing shown
   */
  update(shred, active) {
    const { mhud, sfx } = this.o;
    const t = performance.now();
    if (!active) {
      this.lastPhase = shred.phase;
      this.lastCount = null;
      this.notice = null;
      return mhud.warn(null);
    }
    if (shred.phase !== this.lastPhase) {
      const fresh = shred.t != null && (shred.phase === "grab" ? shred.t < 3 : shred.phase === "feeding" ? shred.t - this.o.grab < 3 : true);
      if (shred.phase === "grab" && fresh) this.notice = { title: "She picked up your CV", sub: "the shredder is next: get away from the top of the page" };
      else if (shred.phase === "feeding" && fresh) this.notice = { title: "The shredder is eating the page", sub: "anything above the cut is gone: stay ahead of it" };
      else this.notice = null;
      this.noticeUntil = t + 4500;
      this.lastPhase = shred.phase;
    }
    if (shred.countdown != null) {
      const count = Math.ceil(shred.countdown);
      if (count !== this.lastCount && count >= 1) sfx.countdown?.(false);
      this.lastCount = count;
      return mhud.warn({ title: "She's reaching for your CV", count: Math.max(1, count), sub: "the top of the page goes first" });
    }
    if (this.lastCount != null) {
      sfx.countdown?.(true); // zero: she grabs it
      this.lastCount = null;
    }
    mhud.warn(this.notice && t < this.noticeUntil ? this.notice : null);
  }
}
