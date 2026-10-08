// Shared game clock. Everything time-stamped on the network (player states, later shots) uses the
// HOST's clock, in ms. The host simply uses performance.now(); a guest estimates the offset from
// ping / pong round trips (NTP-style: trust the samples with the shortest round trip, they have
// the least queueing noise) and slews towards it so the clock never jumps backwards mid-game.

export class ClockSync {
  constructor() {
    this.offset = 0; // host time = performance.now() + offset
    this.synced = false;
    this.rtt = 0; // median round trip of recent samples (ms)
    /** @type {{rtt:number, off:number}[]} */
    this.samples = [];
  }

  /**
   * @param {number} sentAt   our performance.now() when the ping left
   * @param {number} hostTime the host's clock when it answered
   * @param {number} now      our performance.now() when the pong arrived
   */
  sample(sentAt, hostTime, now = performance.now()) {
    const rtt = now - sentAt;
    if (!(rtt >= 0 && rtt < 5000)) return;
    this.samples.push({ rtt, off: hostTime - (sentAt + rtt / 2) });
    if (this.samples.length > 12) this.samples.shift();

    let best = this.samples[0];
    for (const s of this.samples) if (s.rtt < best.rtt) best = s;
    const err = best.off - this.offset;
    if (!this.synced || Math.abs(err) > 250) this.offset = best.off; // first sample, or way off: jump
    else this.offset += Math.max(-4, Math.min(4, err)); // otherwise slew a few ms per sample

    this.synced = true;
    const sorted = this.samples.map((s) => s.rtt).sort((a, b) => a - b);
    this.rtt = sorted[sorted.length >> 1];
  }

  now() {
    return performance.now() + this.offset;
  }
}
