// A multiplayer room. The host's browser is the referee: it owns the room id that goes in the
// invite link, accepts guests, sends them the CV and keeps the player list.
//
//   guest -> host  {t:"hello", v, name}
//   host  -> guest {t:"welcome", you, players, map:{hash,count}, pdf:{size,name}}  + PDF bytes (binary)
//                  {t:"reject", reason}
//   guest -> host  {t:"ready", hash, count}           once its map is built from the PDF
//   host  -> all   {t:"players", players}             whenever the list changes
//   host  -> guest {t:"kick", reason}                  e.g. its map came out different
//   either         {t:"bye"}                           leaving on purpose (tab closed, back to menu)
//
// Later milestones add their own messages; anything unknown is handed to `onGameMessage`.

import { Signaling, NetError, randomId } from "./signaling.js";
import { PeerLink } from "./peerLink.js";

export const NET_VERSION = 1; // bump when the message format changes: old tabs get a clear error

export const PLAYER_COLORS = ["#ff5a36", "#3fa7ff", "#3ddc84", "#ffc53d", "#c77dff", "#ff6fb5", "#40e0d0", "#e8e8f0"];

/** @typedef {{id:number, name:string, color:string, host:boolean, state:"loading"|"in-game"}} PlayerInfo */

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
      const timer = setTimeout(
        () => fail(new NetError("timeout", "The host didn't answer. They may have closed the game, or a firewall is blocking peer-to-peer connections.")),
        this.net.connectTimeout + 20000,
      );

      const link = (this.link = new PeerLink({
        remoteId: roomId,
        cid: randomId(8),
        signaling: this.signaling,
        iceServers: this.net.iceServers,
        initiator: true,
        connectTimeout: this.net.connectTimeout,
      }));

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
        status(`Downloading ${welcome.pdf.name || "the CV"}…`, Math.min(1, got / buf.length));
        if (got >= buf.length) {
          settled = true;
          clearTimeout(timer);
          // the broker was only needed to set the connection up
          this.signaling.close();
          this.signaling = null;
          resolve({ room: this, pdfBytes: buf, pdfName: welcome.pdf.name || "cv.pdf", map: welcome.map });
        }
      };

      link.call().catch((e) => fail(new NetError("p2p-error", `WebRTC error: ${e?.message || e}`)));
    });
  }

  _onMessage(msg) {
    if (msg.t === "players") {
      this.players = msg.players;
      this._emitPlayers();
    } else if (msg.t === "bye") {
      this._closeReason = "host-left";
      this._closeMessage = "The host left the game.";
      this.link.close("closed");
    } else if (msg.t === "kick") {
      this._closeReason = msg.reason;
      this._closeMessage = msg.message;
      this.link.close("closed");
    } else this.onGameMessage?.(msg, 0);
  }

  /** tell the host our map is built */
  ready(map) {
    this.link?.send({ t: "ready", hash: map.hash, count: map.count });
  }

  send(msg) {
    this.link?.send(msg);
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
    this.signaling?.close();
    this.link?.close("closed");
  }
}

function cleanName(s) {
  return String(s ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 20);
}
