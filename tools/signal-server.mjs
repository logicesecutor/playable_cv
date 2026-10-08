// A tiny matchmaking ("signaling") server, compatible with the PeerJS protocol the game speaks.
// No dependencies. Use it to play on a LAN without internet, or to test locally:
//
//   npm run signal                 # listens on :9000
//   PORT=9100 npm run signal
//
// then open the game with ?broker=ws://<this machine's IP>:9000 (host and guests alike; the
// invite link keeps the ?broker part). Only the WebRTC handshake goes through here: the game
// traffic itself is peer-to-peer.
//
// Protocol (subset of peerjs-server):
//   ws  /peerjs?key=peerjs&id=<id>&token=<token>  -> {type:"OPEN"} | {type:"ID-TAKEN"} | {type:"ERROR"}
//   client {type:"HEARTBEAT"}                         keeps the socket alive
//   client {type, dst, payload}                       forwarded to `dst` with `src` added
//   messages for an id that isn't connected are held for 5 s, then {type:"EXPIRE"} goes back
//
// Like the public server (0.peerjs.com), payloads that don't look like PeerJS's are dropped
// silently, so a local test catches what would fail online:
//   OFFER {sdp, type, connectionId, label, serialization}, ANSWER / CANDIDATE {type, connectionId}

import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT || 9000);
const KEY = process.env.KEY || "peerjs";
const EXPIRE_MS = 5000;
const ALIVE_MS = 60000;
const FORWARDED = new Set(["OFFER", "ANSWER", "CANDIDATE", "LEAVE", "EXPIRE"]);

/** @type {Map<string, {token:string, sock:import("node:net").Socket, seen:number}>} */
const clients = new Map();
/** @type {Map<string, {msg:any, at:number}[]>} */
const queues = new Map();

const log = (...a) => process.env.QUIET || console.log(new Date().toISOString().slice(11, 19), ...a);

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const url = new URL(req.url, "http://x");
  if (url.pathname.endsWith("/id")) {
    res.end(crypto.randomUUID());
  } else {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ name: "playable-cv signal server", clients: clients.size }));
  }
});

server.on("upgrade", (req, sock) => {
  const url = new URL(req.url, "http://x");
  const wsKey = req.headers["sec-websocket-key"];
  if (!url.pathname.endsWith("/peerjs") || !wsKey) return sock.destroy();
  const accept = crypto.createHash("sha1").update(wsKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  sock.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  sock.setNoDelay(true);

  const id = url.searchParams.get("id");
  const token = url.searchParams.get("token");
  const key = url.searchParams.get("key");
  if (!id || !token || !key) return sendAndClose(sock, { type: "ERROR", payload: { msg: "No id, token, or key supplied to websocket server" } });
  if (key !== KEY) return sendAndClose(sock, { type: "ERROR", payload: { msg: "Invalid key provided" } });
  const existing = clients.get(id);
  if (existing && existing.token !== token) return sendAndClose(sock, { type: "ID-TAKEN", payload: { msg: "ID is taken" } });

  if (existing) existing.sock.destroy();
  const client = { token, sock, seen: Date.now() };
  clients.set(id, client);
  log("+", id, `(${clients.size} online)`);
  send(sock, { type: "OPEN" });
  // deliver anything that was waiting for this id
  for (const { msg } of queues.get(id) || []) send(sock, msg);
  queues.delete(id);

  readFrames(sock, (text) => {
    client.seen = Date.now();
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.type === "HEARTBEAT") return;
    if (!FORWARDED.has(msg.type)) return;
    if (!validPayload(msg)) {
      log("dropped malformed", msg.type, "from", id);
      return;
    }
    msg.src = id;
    route(msg);
  });
  sock.on("close", () => {
    if (clients.get(id) === client) {
      clients.delete(id);
      log("-", id, `(${clients.size} online)`);
    }
  });
  sock.on("error", () => sock.destroy());
});

/** the shapes the public PeerJS server accepts (checked against 0.peerjs.com) */
function validPayload(m) {
  const p = m.payload;
  const has = (...k) => p && typeof p === "object" && k.every((x) => p[x] !== undefined && p[x] !== null);
  if (m.type === "OFFER") return has("sdp", "type", "connectionId", "label", "serialization");
  if (m.type === "ANSWER") return has("sdp", "type", "connectionId");
  if (m.type === "CANDIDATE") return has("candidate", "type", "connectionId");
  return false; // LEAVE / EXPIRE from clients aren't relayed by the public server either
}

function route(msg) {
  const dst = clients.get(msg.dst);
  if (dst) return send(dst.sock, msg);
  if (msg.type === "LEAVE" || msg.type === "EXPIRE" || !msg.dst) return;
  const q = queues.get(msg.dst) || [];
  q.push({ msg, at: Date.now() });
  queues.set(msg.dst, q);
}

// expire undelivered messages, drop silent clients
setInterval(() => {
  const now = Date.now();
  for (const [dstId, q] of queues) {
    const keep = [];
    const told = new Set();
    for (const item of q) {
      if (now - item.at < EXPIRE_MS) keep.push(item);
      else if (!told.has(item.msg.src)) {
        told.add(item.msg.src);
        route({ type: "EXPIRE", src: dstId, dst: item.msg.src });
      }
    }
    if (keep.length) queues.set(dstId, keep);
    else queues.delete(dstId);
  }
  for (const [id, c] of clients) {
    if (now - c.seen > ALIVE_MS) {
      log("timeout", id);
      c.sock.destroy();
      clients.delete(id);
    }
  }
}, 1000).unref();

// ------------------------------------------------------------------ minimal WebSocket framing
function send(sock, obj) {
  const data = Buffer.from(JSON.stringify(obj));
  let header;
  if (data.length < 126) header = Buffer.from([0x81, data.length]);
  else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  if (!sock.destroyed) sock.write(Buffer.concat([header, data]));
}

function sendAndClose(sock, obj) {
  send(sock, obj);
  sock.end(Buffer.from([0x88, 0]));
}

function readFrames(sock, onText) {
  let buf = Buffer.alloc(0);
  let parts = [];
  sock.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const op = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
      }
      if (len > 1 << 20) return sock.destroy(); // nobody needs 1 MB of SDP
      const maskOff = off;
      if (masked) off += 4;
      if (buf.length < off + len) return;
      const payload = Buffer.from(buf.subarray(off, off + len));
      if (masked) for (let i = 0; i < len; i++) payload[i] ^= buf[maskOff + (i & 3)];
      buf = buf.subarray(off + len);

      if (op === 0x8) return sock.end(Buffer.from([0x88, 0]));
      if (op === 0x9) {
        sock.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
        continue;
      }
      if (op === 0x1 || op === 0x0) {
        parts.push(payload);
        if (fin) {
          onText(Buffer.concat(parts).toString("utf8"));
          parts = [];
        }
      }
    }
  });
}

server.listen(PORT, () => {
  console.log(`signal server on :${PORT}  ->  open the game with ?broker=ws://<this-ip>:${PORT}`);
});
