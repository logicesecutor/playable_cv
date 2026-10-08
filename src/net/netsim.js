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
    this._relNext = 0; // reliable messages must not overtake each other
  }

  /** run `fn` later as if it had crossed the network; `reliable` = no loss, keep order */
  send(fn, reliable) {
    const { lag, jitter, loss } = this.o;
    if (!reliable && Math.random() < loss) return;
    let at = performance.now() + lag + Math.random() * jitter;
    if (reliable) {
      at = Math.max(at, this._relNext);
      this._relNext = at;
    }
    setTimeout(fn, Math.max(0, at - performance.now()));
  }
}
