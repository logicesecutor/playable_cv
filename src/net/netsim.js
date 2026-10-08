// Network simulator: makes a LAN / same-computer test behave like a real internet connection.
//
//   ?netsim=lag:80,jitter:25,loss:0.05
//
//   lag     one-way delay added to everything this tab sends (ms). Set it on both tabs:
//           round trip = 2 x lag.
//   jitter  random extra delay, 0..jitter ms. The reliable channel stays in order (like TCP-ish
//           SCTP would); the fast channel can reorder (like UDP).
//   loss    probability that a fast-channel message is dropped. Reliable messages are never lost,
//           they only arrive later.
//
// Developer tool only: the invite link carries the query string, so remove it before sharing.

/** @returns {{lag:number, jitter:number, loss:number} | null} */
export function netsimFromUrl(search = location.search) {
  const raw = new URLSearchParams(search).get("netsim");
  if (!raw) return null;
  const o = { lag: 0, jitter: 0, loss: 0 };
  for (const part of raw.split(",")) {
    const [k, v] = part.split(":");
    if (k in o && Number.isFinite(Number(v))) o[k] = Math.max(0, Number(v));
  }
  o.loss = Math.min(0.9, o.loss);
  console.info("[net] network simulator on", o);
  return o;
}

export class NetSim {
  /** @param {{lag:number, jitter:number, loss:number}} o */
  constructor(o) {
    this.o = o;
    // reliable messages go through one in-order queue: separate timers could overtake each other
    // (setTimeout rounds delays to whole ms), which would scramble the CV download
    this._rel = [];
    this._relTimer = 0;
  }

  /** run `fn` later as if it had crossed the network; `reliable` = no loss, keep order */
  send(fn, reliable) {
    const { lag, jitter, loss } = this.o;
    const at = performance.now() + lag + Math.random() * jitter;
    if (!reliable) {
      if (Math.random() >= loss) setTimeout(fn, at - performance.now());
      return;
    }
    const last = this._rel.length ? this._rel[this._rel.length - 1].at : 0;
    this._rel.push({ at: Math.max(at, last), fn });
    if (!this._relTimer) this._pump();
  }

  _pump() {
    this._relTimer = 0;
    const now = performance.now();
    while (this._rel.length && this._rel[0].at <= now) this._rel.shift().fn();
    if (this._rel.length) this._relTimer = setTimeout(() => this._pump(), Math.max(1, this._rel[0].at - now));
  }
}
