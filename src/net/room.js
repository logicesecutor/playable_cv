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
// MP5, drop-outs: a guest whose connection dies without saying "bye" stays in the list as "away"
// for 60 s with its score. hello carries a per-tab key `k`; the same key within 60 s gets the same
// player id back. hello may also carry `have:{hash,count}`: a guest that already has this map
// (it was here a moment ago) gets no PDF. Both sides close a link that has been silent for 10 s.
// The host keeps its matchmaking id across broker drops (same token), so the invite link survives.
//
// Fast (unreliable) channel:
//   guest -> host  {t:"ping", c, r}  host -> guest {t:"pong", c, h}   clock sync + round trip
//   anything else (player states…) goes to `onFastMessage`; the host relays what it wants.
//
// Later milestones add their own messages; anything unknown is handed to `onGameMessage`.

import { Signaling, NetError, randomId } from "./signaling.js";
import { PeerLink, signalCid } from "./peerLink.js";
import { ClockSync } from "./clock.js";
import { resolveIce, routeOf } from "./ice.js";

export const NET_VERSION = 5; // bump when the message format changes: old tabs get a clear error

export const PLAYER_COLORS = ["#ff5a36", "#3fa7ff", "#3ddc84", "#ffc53d", "#c77dff", "#ff6fb5", "#40e0d0", "#e8e8f0"];

/** character outfits (public/models/player_<outfit>.glb); the host hands them out */
export const OUTFITS = ["corporate", "engineer"];

/** balanced random: the outfit fewest players wear, a random one of those on a tie */
export function pickOutfit(players, rand = Math.random) {
  const count = new Map(OUTFITS.map((o) => [o, 0]));
  for (const p of players) if (count.has(p.outfit)) count.set(p.outfit, count.get(p.outfit) + 1);
  const least = Math.min(...count.values());
  const pool = OUTFITS.filter((o) => count.get(o) === least);
  return pool[Math.floor(rand() * pool.length)];
}

/** @typedef {{id:number, name:string, color:string, outfit:string, host:boolean, state:"loading"|"in-game"|"away", ping?:number, route?:"direct"|"relay"|"unknown"}} PlayerInfo */

const AWAY_MS = 60000; // a dropped guest keeps its place (and score) this long
const SILENCE_MS = 10000; // a link with no traffic for this long is dead

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
    clearInterval(this._watchdog);
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
    this.players = [{ id: 0, name: o.name, color: PLAYER_COLORS[0], outfit: pickOutfit([]), host: true, state: "in-game" }];
    this.nextId = 1;
    /** @type {Map<string, {link:PeerLink, player:PlayerInfo|null}>} remote signaling id -> guest */
    this.guests = new Map();
    this.roomId = "";
    /** the game's state for a joining guest (taken before the guest receives any live event) */
    this.snapshotProvider = null;
    /** player id -> rejoin key (kept here, never broadcast) */
    this.keys = new Map();
    this._pingTimer = setInterval(() => {
      this._broadcastPings();
      this._expireAway();
    }, 2000);
    this._watchdog = watchdog(() => this.guests.values(), (g) => g.link, (g) =>
      // a guest still building its map (seconds of busy main thread on a slow machine) gets longer
      g.player?.state === "in-game" ? SILENCE_MS : 60000,
    );
  }

  _expireAway() {
    const now = performance.now();
    const gone = this.players.filter((p) => p.state === "away" && p.awayUntil <= now);
    if (!gone.length) return;
    this.players = this.players.filter((p) => !gone.includes(p));
    for (const p of gone) {
      this.keys.delete(p.id);
      this.onNotice?.(`${p.name} left`);
    }
    this._broadcastPlayers();
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
    this.ice = await resolveIce(this.net);
    // relay credentials don't last forever: refresh them for guests who join later
    this._iceTimer = this.ice.relay ? setInterval(async () => (this.ice = await resolveIce(this.net)), 9 * 60000) : 0;
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
    this.token = this.signaling.token;
    this._wireSignaling();
  }

  _wireSignaling() {
    this.signaling.onMessage = (m) => this._onSignal(m);
    this.signaling.onClose = () => this._reconnectBroker();
  }

  /** the matchmaking server dropped us: keep trying with the same id + token (the invite link stays valid) */
  async _reconnectBroker() {
    if (this.closed || this._reconnecting) return;
    this._reconnecting = true;
    this.brokerLost = true;
    this.onNotice?.("Lost the matchmaking server. Reconnecting… (players already in are fine)");
    for (let attempt = 0; !this.closed; attempt++) {
      await new Promise((r) => setTimeout(r, Math.min(30000, 1000 * 2 ** attempt)));
      if (this.closed) break;
      const sig = new Signaling(this.net.broker);
      try {
        await sig.connect(this.roomId, this.token);
        this.signaling = sig;
        // links still setting up keep using the new socket for their remaining candidates
        for (const g of this.guests.values()) if (!g.link.isOpen) g.link.signaling = sig;
        this._wireSignaling();
        this.brokerLost = false;
        this.onNotice?.("Matchmaking server back: the invite link works again");
        break;
      } catch (e) {
        sig.close();
        if (e.code === "id-taken") {
          // the server still holds our old session under another token: it frees it after a timeout
          console.warn("[net] room id still taken on the broker, retrying");
        }
      }
    }
    this._reconnecting = false;
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
    if (!g && m.type === "OFFER" && signalCid(m.payload)) {
      const link = new PeerLink({
        remoteId: m.src,
        cid: signalCid(m.payload),
        signaling: this.signaling,
        iceServers: this.ice.iceServers,
        policy: this.ice.policy,
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
      const p = g.player;
      if (!p || g.replaced || this.closed) return;
      if (!g.bye && p.state === "in-game") {
        // dropped without saying goodbye: keep the place (and the score) for a while
        p.state = "away";
        p.awayUntil = performance.now() + AWAY_MS;
        p.ping = undefined;
        this.onNotice?.(`${p.name} lost connection. Waiting for them to come back…`);
      } else {
        this.players = this.players.filter((x) => x !== p);
        this.keys.delete(p.id);
        this.onNotice?.(`${p.name} left`);
      }
      this._broadcastPlayers();
    };
    link.onMessage = (msg) => {
      if (msg.t === "hello") return this._hello(g, msg).catch((e) => {
        console.warn("[net] sending the CV failed", e);
        link.close("closed");
      });
      if (!g.player) return;
      if (msg.t === "ready") return this._ready(g, msg);
      if (msg.t === "bye") {
        g.bye = true;
        return link.close("closed");
      }
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
    // coming back after a drop? (same per-tab key)
    const key = typeof msg.k === "string" ? msg.k.slice(0, 40) : "";
    const back = key ? this.players.find((p) => !p.host && this.keys.get(p.id) === key) : null;
    if (back) {
      // its old link may not have noticed the drop yet: retire it quietly
      for (const og of this.guests.values()) {
        if (og !== g && og.player === back) {
          og.replaced = true;
          og.link.close("replaced");
        }
      }
    }
    if (!back && this.players.length >= this.net.maxPlayers) {
      link.send({ t: "reject", reason: "full", message: `This game is full (${this.net.maxPlayers} players).` });
      return setTimeout(() => link.close("rejected"), 500);
    }
    // snapshot BEFORE this guest is registered: live events from now on reach it after the welcome
    const world = this.snapshotProvider?.() ?? null;
    let player;
    if (back) {
      player = back;
      player.state = "loading";
      delete player.awayUntil;
      player.name = cleanName(msg.name) || player.name;
    } else {
      const used = new Set(this.players.map((p) => p.color));
      player = {
        id: this.nextId++,
        name: cleanName(msg.name) || `Player ${this.nextId - 1}`,
        color: PLAYER_COLORS.find((c) => !used.has(c)) || PLAYER_COLORS[0],
        outfit: pickOutfit(this.players), // kept on rejoin and rematch (same player entry)
        host: false,
        state: "loading",
      };
      this.players.push(player);
    }
    if (key) this.keys.set(player.id, key);
    g.player = player;
    g.rejoined = !!back;
    // a guest that was just here already has the map: skip the download
    const has = msg.have && msg.have.hash === this.map.hash && msg.have.count === this.map.count;
    link.send({
      t: "welcome",
      you: player.id,
      players: this.players,
      map: this.map,
      pdf: has ? null : { size: this.pdfBytes.length, name: this.pdfName },
      world,
    });
    this._broadcastPlayers();
    this.onNotice?.(back ? `${player.name} is reconnecting…` : `${player.name} is joining…`);
    if (!has) await link.sendBytes(this.pdfBytes);
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
    this.onNotice?.(g.rejoined ? `${p.name} is back` : `${p.name} joined`);
    this._broadcastPlayers();
    // direct or through the relay? (shown next to the ping)
    routeOf(g.link.pc).then((route) => {
      if (g.player !== p || this.closed) return;
      p.route = route;
      if (route === "relay") this.onNotice?.(`${p.name} is connected through the relay server`);
      this._broadcastPlayers();
    });
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
    clearInterval(this._watchdog);
    clearInterval(this._iceTimer);
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
   * @param {string} [o.key]        per-tab key: rejoining with it gets our place (and score) back
   * @param {{hash:string,count:number}} [o.haveMap]  we already have this map: no PDF download
   * @returns {Promise<{room:GuestRoom, pdfBytes:Uint8Array|null, pdfName:string, map:{hash:string,count:number}, world:any}>}
   *   pdfBytes is null when the host skipped the download (haveMap matched)
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

    const ice = await resolveIce(this.net);
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
        cid: `dc_${randomId(10)}`, // PeerJS-style connection id
        signaling: this.signaling,
        iceServers: ice.iceServers,
        policy: ice.policy,
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
        link.send({ t: "hello", v: NET_VERSION, name: o.name, k: o.key, have: o.haveMap });
      };
      const done = (pdfBytes) => {
        settled = true;
        this.downloadedPdf = !!pdfBytes;
        clearTimeout(timer);
        // the broker was only needed to set the connection up
        this.signaling.close();
        this.signaling = null;
        this._startPinging();
        this._watchdog = watchdog(() => [link], (l) => l, () => SILENCE_MS);
        resolve({ room: this, pdfBytes, pdfName: welcome.pdf?.name || "cv.pdf", map: welcome.map, world: welcome.world });
      };
      link.onClose = (reason) => {
        if (!settled) {
          fail(
            reason === "no-answer"
              ? new NetError("no-answer", "The host's game didn't answer. Make sure the host's tab is still open (and on the same game version), then try the link again.")
              : reason === "ice-failed" || reason === "ice-timeout"
                ? new NetError(
                    "p2p-blocked",
                    ice.relay
                      ? "Found the host but couldn't connect, not even through the relay server. A firewall may block it, or the relay's free monthly allowance is used up. Try another network (e.g. a phone hotspot) on one side."
                      : "Found the host but couldn't connect directly: the networks on the two sides don't allow it (common with mobile data, corporate Wi-Fi or strict routers), and this game has no relay server set up. See \"Relay (TURN)\" in the README.",
                  )
                : new NetError("closed", "The host closed the connection."),
          );
        } else if (this._closeReason) this._finish(this._closeReason, this._closeMessage);
        // no "bye", no kick: the connection died (Wi-Fi blip, sleep…). The game tries to rejoin.
        else this._finish("lost", "Lost the connection to the host.");
      };
      link.onMessage = (msg) => {
        if (msg.t === "reject") return fail(new NetError(msg.reason, msg.message));
        if (msg.t === "welcome") {
          welcome = msg;
          this.selfId = msg.you;
          this.players = msg.players;
          if (!msg.pdf) return done(null); // we already have the map
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
        if (got >= buf.length) done(buf);
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
    clearInterval(this._watchdog);
    this.signaling?.close();
    this.link?.close("closed");
  }
}

/**
 * Close links that have been silent too long. If this timer itself ran late (our own tab was busy
 * building a map, or throttled in the background), the silence is ours, not theirs: start over.
 * @returns {number} interval id
 */
function watchdog(items, linkOf, limitOf) {
  let last = performance.now();
  return setInterval(() => {
    const now = performance.now();
    const late = now - last > 3000;
    last = now;
    for (const it of items()) {
      const link = linkOf(it);
      if (!link.isOpen) continue;
      if (late) link.lastRecv = Math.max(link.lastRecv, now);
      else if (now - link.lastRecv > limitOf(it)) link.close("lost");
    }
  }, 1000);
}

function cleanName(s) {
  return String(s ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 20);
}
