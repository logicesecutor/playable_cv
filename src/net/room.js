// A multiplayer room. The host's browser is the referee: it owns the room id that goes in the
// invite link, accepts guests, sends them the CV and keeps the player list.
//
//   guest -> host  {t:"hello", v, name}
//   host  -> guest {t:"welcome", you, players, map:{hash,count}, pdf:{size,name}, world}  + PDF bytes (binary)
//                  (`world` = the game's catch-up snapshot, e.g. letters already destroyed)
//                  {t:"reject", reason}
//   guest -> host  {t:"ready", hash, count}           once its map is built from the PDF
//   host  -> all   {t:"players", players}             whenever the list changes
//   host  -> guest {t:"kick", reason}                  e.g. its map came out different
//   either         {t:"bye"}                           leaving on purpose (tab closed, back to menu)
//   host  -> all   {t:"pings", p:[[id, ms]…]}          every 2 s, for the player list
//
// Fast (unreliable) channel:
//   guest -> host  {t:"ping", c, r}  host -> guest {t:"pong", c, h}   clock sync + round trip
//   anything else (player states…) goes to `onFastMessage`; the host relays what it wants.
//
// Later milestones add their own messages; anything unknown is handed to `onGameMessage`.

import { Signaling, NetError, randomId } from "./signaling.js";
import { PeerLink } from "./peerLink.js";
import { ClockSync } from "./clock.js";

export const NET_VERSION = 3; // bump when the message format changes: old tabs get a clear error

export const PLAYER_COLORS = ["#ff5a36", "#3fa7ff", "#3ddc84", "#ffc53d", "#c77dff", "#ff6fb5", "#40e0d0", "#e8e8f0"];

/** @typedef {{id:number, name:string, color:string, host:boolean, state:"loading"|"in-game", ping?:number}} PlayerInfo */

class BaseRoom {
  constructor(net) {
    this.net = net;
    /** @type {PlayerInfo[]} */
    this.players = [];
    this.selfId = -1;
    this.closed = false;
    /** @type {(players:PlayerInfo[]) => void} */ this.onPlayers = null;
    /** @type {(text:string) => void} */ this.onNotice = null;
    /** @type {(reason:string, message:string) => void} */ this.onClosed = null;
    /** @type {(msg:any, fromId:number) => void} */ this.onGameMessage = null;
    /** @type {(msg:any, fromId:number) => void} */ this.onFastMessage = null;
    this._onPageHide = () => this.leave();
    window.addEventListener("pagehide", this._onPageHide);
  }

  get self() {
    return this.players.find((p) => p.id === this.selfId);
  }

  _emitPlayers() {
    this.onPlayers?.(this.players);
  }

  _finish(reason, message) {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this._pingTimer);
    window.removeEventListener("pagehide", this._onPageHide);
    this.onClosed?.(reason, message);
  }
}

// ================================================================================== host

export class HostRoom extends BaseRoom {
  /**
   * @param {object} o
   * @param {string} o.name          host's nickname
   * @param {Uint8Array} o.pdfBytes  the original file, sent to every guest
   * @param {string} o.pdfName
   * @param {{hash:string, count:number}} o.map
   * @param {typeof import("../config.js").config.net} o.net
   */
  static async open(o) {
    const room = new HostRoom(o);
    await room._start();
    return room;
  }

  constructor(o) {
    super(o.net);
    this.pdfBytes = o.pdfBytes;
    this.pdfName = o.pdfName;
    this.map = o.map;
    this.isHost = true;
    this.selfId = 0;
    this.players = [{ id: 0, name: o.name, color: PLAYER_COLORS[0], host: true, state: "in-game" }];
    this.nextId = 1;
    /** @type {Map<string, {link:PeerLink, player:PlayerInfo|null}>} remote signaling id -> guest */
    this.guests = new Map();
    this.roomId = "";
    /** the game's state for a joining guest (taken before the guest receives any live event) */
    this.snapshotProvider = null;
    this._pingTimer = setInterval(() => this._broadcastPings(), 2000);
  }

  /** the shared game clock (ms): on the host it is just the local clock */
  now() {
    return performance.now();
  }

  get synced() {
    return true;
  }

  _broadcastPings() {
    const p = this.players.filter((pl) => !pl.host).map((pl) => [pl.id, Math.round(pl.ping ?? 0)]);
    if (!p.length) return;
    this.broadcast({ t: "pings", p });
    this._emitPlayers();
  }

  async _start() {
    for (let attempt = 0; ; attempt++) {
      this.signaling = new Signaling(this.net.broker);
      this.roomId = `pcv-${randomId(10)}`;
      try {
        await this.signaling.connect(this.roomId);
        break;
      } catch (e) {
        if (e.code !== "id-taken" || attempt >= 3) throw e;
      }
    }
    this.signaling.onMessage = (m) => this._onSignal(m);
    this.signaling.onClose = () =>
      this.onNotice?.("Lost the matchmaking server: players already in stay connected, new ones can't join.");
  }

  /** the link to share */
  get inviteUrl() {
    const u = new URL(location.href);
    u.hash = `join=${this.roomId}`;
    return u.toString();
  }

  _onSignal(m) {
    if (!m.src) return;
    let g = this.guests.get(m.src);
    if (!g && m.type === "OFFER" && m.payload?.cid) {
      const link = new PeerLink({
        remoteId: m.src,
        cid: m.payload.cid,
        signaling: this.signaling,
        iceServers: this.net.iceServers,
        initiator: false,
        connectTimeout: this.net.connectTimeout,
        netsim: this.net.netsim,
      });
      g = { link, player: null };
      this.guests.set(m.src, g);
      this._wire(m.src, g);
    }
    if (!g) return;
    if (m.type === "LEAVE" || m.type === "EXPIRE") g.link.close("closed");
    else g.link.handleSignal(m.type, m.payload);
  }

  _wire(sid, g) {
    const { link } = g;
    const helloTimer = setTimeout(() => !g.player && link.close("no-hello"), this.net.connectTimeout + 10000);
    link.onClose = () => {
      clearTimeout(helloTimer);
      this.guests.delete(sid);
      if (g.player) {
        this.players = this.players.filter((p) => p !== g.player);
        if (!this.closed) this.onNotice?.(`${g.player.name} left`);
        this._broadcastPlayers();
      }
    };
    link.onMessage = (msg) => {
      if (msg.t === "hello") return this._hello(g, msg).catch((e) => {
        console.warn("[net] sending the CV failed", e);
        link.close("closed");
      });
      if (!g.player) return;
      if (msg.t === "ready") return this._ready(g, msg);
      if (msg.t === "bye") return link.close("closed");
      this.onGameMessage?.(msg, g.player.id);
    };
    link.onFast = (msg) => {
      if (!g.player) return;
      if (msg.t === "ping") {
        link.sendFast({ t: "pong", c: msg.c, h: performance.now() });
        if (typeof msg.r === "number") g.player.ping = msg.r;
        return;
      }
      if (g.player.state === "in-game") this.onFastMessage?.(msg, g.player.id);
    };
  }

  /** reliable message to one guest */
  sendTo(id, msg) {
    for (const g of this.guests.values()) if (g.player?.id === id) return g.link.send(msg);
  }

  /** unreliable message to one guest */
  sendFastTo(id, msg) {
    for (const g of this.guests.values()) if (g.player?.id === id) return g.link.sendFast(msg);
  }

  /** unreliable message to every in-game guest except `exceptId` */
  broadcastFast(msg, exceptId = -1) {
    const data = msg;
    for (const g of this.guests.values()) {
      if (g.player && g.player.state === "in-game" && g.player.id !== exceptId) g.link.sendFast(data);
    }
  }

  async _hello(g, msg) {
    const { link } = g;
    if (g.player) return;
    if (msg.v !== NET_VERSION) {
      link.send({ t: "reject", reason: "version", message: "You're on a different version of the game. Reload the page and try again." });
      return setTimeout(() => link.close("rejected"), 500);
    }
    if (this.players.length >= this.net.maxPlayers) {
      link.send({ t: "reject", reason: "full", message: `This game is full (${this.net.maxPlayers} players).` });
      return setTimeout(() => link.close("rejected"), 500);
    }
    // snapshot BEFORE this guest is registered: live events from now on reach it after the welcome
    const world = this.snapshotProvider?.() ?? null;
    const used = new Set(this.players.map((p) => p.color));
    const player = {
      id: this.nextId++,
      name: cleanName(msg.name) || `Player ${this.nextId - 1}`,
      color: PLAYER_COLORS.find((c) => !used.has(c)) || PLAYER_COLORS[0],
      host: false,
      state: "loading",
    };
    g.player = player;
    this.players.push(player);
    link.send({
      t: "welcome",
      you: player.id,
      players: this.players,
      map: this.map,
      pdf: { size: this.pdfBytes.length, name: this.pdfName },
      world,
    });
    this._broadcastPlayers();
    this.onNotice?.(`${player.name} is joining…`);
    await link.sendBytes(this.pdfBytes);
  }

  _ready(g, msg) {
    const p = g.player;
    if (msg.count !== this.map.count) {
      g.link.send({
        t: "kick",
        reason: "map-mismatch",
        message: `Your browser built a different map from this CV (${msg.count} pieces vs ${this.map.count}). Try the same browser as the host.`,
      });
      setTimeout(() => g.link.close("kicked"), 500);
      return;
    }
    if (msg.hash !== this.map.hash) console.warn(`[net] ${p.name}'s map geometry differs slightly from the host's`, msg.hash, this.map.hash);
    p.state = "in-game";
    this.onNotice?.(`${p.name} joined`);
    this._broadcastPlayers();
  }

  _broadcastPlayers() {
    this.broadcast({ t: "players", players: this.players });
    this._emitPlayers();
  }

  /** reliable message to every connected guest */
  broadcast(msg, exceptId = -1) {
    for (const g of this.guests.values()) if (g.player && g.player.id !== exceptId) g.link.send(msg);
  }

  /** host leaves: everybody's game ends */
  leave() {
    if (this.closed) return;
    this.broadcast({ t: "bye" });
    // let the "bye" go out before tearing the connections down
    const links = [...this.guests.values()].map((g) => g.link);
    setTimeout(() => links.forEach((l) => l.close("closed")), 200);
    this.guests.clear();
    this.signaling?.close();
    clearInterval(this._pingTimer);
    this._finish("left", "You closed the room.");
  }
}

// ================================================================================== guest

export class GuestRoom extends BaseRoom {
  /**
   * Connect to a host, say hello and download the CV.
   * @param {string} roomId from the invite link
   * @param {object} o
   * @param {string} o.name
   * @param {typeof import("../config.js").config.net} o.net
   * @param {(text:string, progress?:number) => void} [o.onStatus]
   * @returns {Promise<{room:GuestRoom, pdfBytes:Uint8Array, pdfName:string, map:{hash:string,count:number}}>}
   */
  static async join(roomId, o) {
    const room = new GuestRoom(o.net);
    try {
      return await room._join(roomId, o);
    } catch (e) {
      room._teardown();
      room.closed = true;
      window.removeEventListener("pagehide", room._onPageHide);
      throw e;
    }
  }

  constructor(net) {
    super(net);
    this.isHost = false;
    this.link = null;
    this.signaling = null;
    this.clock = new ClockSync();
    this._pingTimer = 0;
    this._gameQueue = []; // game messages that arrive while the map is still loading
  }

  /** set the game's message handler and hand it whatever arrived while we were loading */
  setGameHandler(fn) {
    this.onGameMessage = fn;
    for (const m of this._gameQueue.splice(0)) fn(m, 0);
  }

  /** the shared game clock (host's ms), estimated from ping / pong */
  now() {
    return this.clock.now();
  }

  get synced() {
    return this.clock.synced;
  }

  /** round trip to the host (ms) */
  get ping() {
    return this.clock.rtt;
  }

  _startPinging() {
    const ping = () => this.link?.sendFast({ t: "ping", c: performance.now(), r: this.clock.synced ? Math.round(this.clock.rtt) : undefined });
    // a quick burst for a good first estimate, then once a second
    for (let i = 0; i < 6; i++) setTimeout(ping, i * 120);
    this._pingTimer = setInterval(ping, 1000);
  }

  async _join(roomId, o) {
    const status = o.onStatus || (() => {});
    if (!/^pcv-[a-z0-9]{4,32}$/.test(roomId)) throw new NetError("bad-link", "That invite link looks broken. Ask for a new one.");

    status("Contacting the matchmaking server…");
    this.signaling = new Signaling(this.net.broker);
    await this.signaling.connect(`pcv-g-${randomId(12)}`);

    status("Finding the host…");
    return await new Promise((resolve, reject) => {
      let welcome = null;
      let buf = null;
      let got = 0;
      let settled = false;
      const fail = (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      };
      // give up when nothing happens for a while (not after a fixed total: a big CV on a slow
      // uplink may take a while to download, and that's fine as long as it keeps coming)
      let timer = 0;
      const arm = (ms, message) => {
        clearTimeout(timer);
        timer = setTimeout(() => fail(new NetError("timeout", message)), ms);
      };
      arm(this.net.connectTimeout + 20000, "The host didn't answer. They may have closed the game, or a firewall is blocking peer-to-peer connections.");
      const stalled = "The download from the host stalled. Their connection may have dropped; try the link again.";

      const link = (this.link = new PeerLink({
        remoteId: roomId,
        cid: randomId(8),
        signaling: this.signaling,
        iceServers: this.net.iceServers,
        initiator: true,
        connectTimeout: this.net.connectTimeout,
        netsim: this.net.netsim,
      }));
      link.onFast = (msg) => {
        if (msg.t === "pong") return this.clock.sample(msg.c, msg.h);
        if (settled) this.onFastMessage?.(msg, 0);
      };

      this.signaling.onMessage = (m) => {
        if (m.src !== roomId) return;
        if (m.type === "EXPIRE") fail(new NetError("no-host", "No game at that link: the host has closed it, or the link is old."));
        else if (m.type === "LEAVE") link.close("closed");
        else link.handleSignal(m.type, m.payload);
      };

      link.onOpen = () => {
        status("Connected. Saying hello…");
        link.send({ t: "hello", v: NET_VERSION, name: o.name });
      };
      link.onClose = (reason) => {
        if (!settled) {
          fail(
            reason === "ice-failed" || reason === "ice-timeout"
              ? new NetError("p2p-blocked", "Found the host but couldn't connect directly. One of your networks blocks peer-to-peer connections (common on corporate or some mobile networks).")
              : new NetError("closed", "The host closed the connection."),
          );
        } else this._finish(this._closeReason || "host-left", this._closeMessage || "The host left the game.");
      };
      link.onMessage = (msg) => {
        if (msg.t === "reject") return fail(new NetError(msg.reason, msg.message));
        if (msg.t === "welcome") {
          welcome = msg;
          this.selfId = msg.you;
          this.players = msg.players;
          buf = new Uint8Array(msg.pdf.size);
          arm(20000, stalled);
          status(`Downloading ${msg.pdf.name || "the CV"}…`, 0);
          return;
        }
        if (settled || msg.t === "players") this._onMessage(msg);
      };
      link.onBinary = (chunk) => {
        if (!buf || settled) return;
        const bytes = new Uint8Array(chunk);
        buf.set(bytes.subarray(0, buf.length - got), got);
        got += bytes.length;
        arm(20000, stalled);
        status(`Downloading ${welcome.pdf.name || "the CV"}…`, Math.min(1, got / buf.length));
        if (got >= buf.length) {
          settled = true;
          clearTimeout(timer);
          // the broker was only needed to set the connection up
          this.signaling.close();
          this.signaling = null;
          this._startPinging();
          resolve({ room: this, pdfBytes: buf, pdfName: welcome.pdf.name || "cv.pdf", map: welcome.map, world: welcome.world });
        }
      };

      link.call().catch((e) => fail(new NetError("p2p-error", `WebRTC error: ${e?.message || e}`)));
    });
  }

  _onMessage(msg) {
    if (msg.t === "players") {
      // keep the pings we already know until the next "pings" message
      const old = new Map(this.players.map((p) => [p.id, p.ping]));
      this.players = msg.players.map((p) => ({ ...p, ping: p.ping ?? old.get(p.id) }));
      this._emitPlayers();
    } else if (msg.t === "pings") {
      const m = new Map(msg.p);
      for (const p of this.players) if (m.has(p.id)) p.ping = m.get(p.id);
      this._emitPlayers();
    } else if (msg.t === "bye") {
      this._closeReason = "host-left";
      this._closeMessage = "The host left the game.";
      this.link.close("closed");
    } else if (msg.t === "kick") {
      this._closeReason = msg.reason;
      this._closeMessage = msg.message;
      this.link.close("closed");
    } else if (this.onGameMessage) this.onGameMessage(msg, 0);
    else this._gameQueue.push(msg);
  }

  /** tell the host our map is built */
  ready(map) {
    this.link?.send({ t: "ready", hash: map.hash, count: map.count });
  }

  send(msg) {
    this.link?.send(msg);
  }

  sendFast(msg) {
    this.link?.sendFast(msg);
  }

  leave() {
    if (this.closed) return;
    this._closeReason = "left";
    this._closeMessage = "You left the game.";
    this.link?.send({ t: "bye" });
    setTimeout(() => this._teardown(), 100);
    this._finish("left", "You left the game.");
  }

  _teardown() {
    clearInterval(this._pingTimer);
    this.signaling?.close();
    this.link?.close("closed");
  }
}

function cleanName(s) {
  return String(s ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 20);
}
