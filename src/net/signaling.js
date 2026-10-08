// Signaling over a PeerJS server (the free public one at 0.peerjs.com by default).
//
// We only use the server as a mailbox to exchange WebRTC offers / answers / ICE candidates;
// everything after that goes peer-to-peer. The wire protocol is PeerJS's, so any stock
// `peerjs-server` works too (and `npm run signal` starts a tiny compatible one for LAN play):
//
//   connect   wss://host:port/<path>peerjs?key=peerjs&id=<id>&token=<random>
//   server -> {type:"OPEN"} | {type:"ID-TAKEN"} | {type:"ERROR", payload:{msg}}
//   client -> {type:"HEARTBEAT"} every few seconds, or the server drops us
//   client -> {type:"OFFER"|"ANSWER"|"CANDIDATE"|"LEAVE", dst, payload}
//   server -> the same message, with `src` filled in, to the peer with id `dst`
//   server -> {type:"EXPIRE", src:<dst>} when `dst` never showed up (e.g. a stale invite link)
//
// Payloads are ours (both ends run this code), the server just forwards them.

const PROTOCOL_VERSION = "1.5.4"; // what a PeerJS client would report; the server only logs it

export class Signaling {
  /**
   * @param {{host:string, port:number, path:string, secure:boolean, key:string, heartbeat:number, openTimeout:number}} broker
   */
  constructor(broker) {
    this.broker = broker;
    this.id = null;
    this.ws = null;
    this.open = false;
    this.closed = false;
    /** @type {(msg:{type:string, src?:string, payload?:any}) => void} */
    this.onMessage = null;
    /** called if the socket drops after it was open: (reason:string) => void */
    this.onClose = null;
    this._hb = 0;
  }

  /** Connect with the given id. Resolves once the server accepts it. */
  connect(id) {
    this.id = id;
    const b = this.broker;
    const path = b.path.endsWith("/") ? b.path : b.path + "/";
    const url =
      `${b.secure ? "wss" : "ws"}://${b.host}:${b.port}${path}peerjs` +
      `?key=${encodeURIComponent(b.key)}&id=${encodeURIComponent(id)}&token=${randomId(12)}&version=${PROTOCOL_VERSION}`;

    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          this.close();
          reject(err);
        } else resolve(this);
      };
      const timer = setTimeout(
        () => done(new NetError("broker-timeout", `The matchmaking server (${b.host}) didn't answer.`)),
        b.openTimeout,
      );

      let ws;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        return done(new NetError("broker-unreachable", `Can't reach the matchmaking server (${b.host}).`));
      }
      this.ws = ws;

      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type === "OPEN") {
          this.open = true;
          this._hb = setInterval(() => this._send({ type: "HEARTBEAT" }), b.heartbeat);
          done();
        } else if (msg.type === "ID-TAKEN") {
          done(new NetError("id-taken", "That room id is already in use."));
        } else if (msg.type === "ERROR") {
          done(new NetError("broker-error", msg.payload?.msg || "Matchmaking server error."));
        } else {
          this.onMessage?.(msg);
        }
      };
      ws.onerror = () => done(new NetError("broker-unreachable", `Can't reach the matchmaking server (${b.host}).`));
      ws.onclose = () => {
        const wasOpen = this.open;
        this._stop();
        if (!settled) done(new NetError("broker-unreachable", `The matchmaking server (${b.host}) closed the connection.`));
        else if (wasOpen && !this.closed) this.onClose?.("broker-lost");
      };
    });
  }

  /** @param {"OFFER"|"ANSWER"|"CANDIDATE"|"LEAVE"} type */
  send(type, dst, payload) {
    this._send({ type, dst, payload });
  }

  _send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  _stop() {
    this.open = false;
    clearInterval(this._hb);
    this._hb = 0;
  }

  close() {
    this.closed = true;
    this._stop();
    try {
      this.ws?.close();
    } catch {
      /* already closed */
    }
    this.ws = null;
  }
}

/** An error with a machine-readable `code` and a message fit for the UI. */
export class NetError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Random [a-z0-9] string. Works on plain http too (crypto.randomUUID needs a secure context). */
export function randomId(n = 10) {
  const abc = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/o/1/l: easier to read out loud
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let s = "";
  for (const v of bytes) s += abc[v % abc.length];
  return s;
}

/**
 * `?broker=` override from the page URL, e.g. `ws://192.168.1.20:9000` or `wss://peer.example.com/myapp`.
 * Returns the default broker when absent or unparsable.
 */
export function brokerFromUrl(defaults, search = location.search) {
  const raw = new URLSearchParams(search).get("broker");
  if (!raw) return defaults;
  try {
    const u = new URL(/^wss?:\/\//.test(raw) ? raw : `ws://${raw}`);
    const secure = u.protocol === "wss:";
    return { ...defaults, host: u.hostname, port: Number(u.port) || (secure ? 443 : 80), path: u.pathname || "/", secure };
  } catch {
    console.warn("[net] ignoring bad ?broker=", raw);
    return defaults;
  }
}
