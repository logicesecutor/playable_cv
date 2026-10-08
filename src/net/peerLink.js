// One WebRTC connection between a guest and the host, with two data channels:
//   "rel"  reliable + ordered: game events (join, shots, kills…) and the PDF bytes
//   "fast" unordered, no retransmits: high-rate player state, where a late packet is useless
//
// The guest is always the one that calls (creates the offer); the host answers.

import { NetError } from "./signaling.js";
import { NetSim } from "./netsim.js";

const CHUNK = 16 * 1024; // safe message size across browsers
const HIGH_WATER = 1024 * 1024; // pause sending above this much buffered data

export class PeerLink {
  /**
   * @param {object} o
   * @param {string} o.remoteId    the other side's signaling id
   * @param {string} o.cid         connection id, so stray signals from an old attempt are ignored
   * @param {import("./signaling.js").Signaling} o.signaling
   * @param {RTCIceServer[]} o.iceServers
   * @param {boolean} o.initiator  true on the guest
   * @param {number} o.connectTimeout ms
   * @param {{lag:number, jitter:number, loss:number} | null} [o.netsim] simulated bad network (testing)
   */
  constructor(o) {
    this.sim = o.netsim ? new NetSim(o.netsim) : null;
    this.remoteId = o.remoteId;
    this.cid = o.cid;
    this.signaling = o.signaling;
    this.initiator = o.initiator;
    this.isOpen = false;
    this.isClosed = false;
    /** @type {() => void} */ this.onOpen = null;
    /** @type {(reason:string) => void} */ this.onClose = null;
    /** @type {(msg:any) => void} */ this.onMessage = null;
    /** @type {(buf:ArrayBuffer) => void} */ this.onBinary = null;
    /** @type {(msg:any) => void} */ this.onFast = null;

    this.pc = new RTCPeerConnection({ iceServers: o.iceServers });
    this.rel = null;
    this.fast = null;
    this._pending = []; // remote ICE candidates that arrived before the remote description
    this._lostTimer = 0;
    this._openTimer = setTimeout(() => this.close("ice-timeout"), o.connectTimeout);

    this.pc.onicecandidate = (e) => {
      if (e.candidate) this.signaling?.send("CANDIDATE", this.remoteId, { cid: this.cid, candidate: e.candidate.toJSON() });
    };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === "failed") this.close(this.isOpen ? "lost" : "ice-failed");
      else if (s === "closed") this.close("closed");
      else if (s === "disconnected") {
        // often recovers by itself within a few seconds
        clearTimeout(this._lostTimer);
        this._lostTimer = setTimeout(() => {
          if (this.pc.connectionState === "disconnected") this.close("lost");
        }, 5000);
      } else if (s === "connected") clearTimeout(this._lostTimer);
    };

    if (this.initiator) {
      this._setup(this.pc.createDataChannel("rel", { ordered: true }));
      this._setup(this.pc.createDataChannel("fast", { ordered: false, maxRetransmits: 0 }));
    } else {
      this.pc.ondatachannel = (e) => this._setup(e.channel);
    }
  }

  /** guest: create the offer and send it through the broker */
  async call() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.signaling.send("OFFER", this.remoteId, { cid: this.cid, sdp: this.pc.localDescription.toJSON() });
  }

  /** a signaling message from the other side */
  async handleSignal(type, payload) {
    if (this.isClosed || !payload || payload.cid !== this.cid) return;
    try {
      if (type === "OFFER" && !this.initiator) {
        await this.pc.setRemoteDescription(payload.sdp);
        await this._flushCandidates();
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.signaling.send("ANSWER", this.remoteId, { cid: this.cid, sdp: this.pc.localDescription.toJSON() });
      } else if (type === "ANSWER" && this.initiator) {
        await this.pc.setRemoteDescription(payload.sdp);
        await this._flushCandidates();
      } else if (type === "CANDIDATE") {
        if (this.pc.remoteDescription) await this.pc.addIceCandidate(payload.candidate);
        else this._pending.push(payload.candidate);
      }
    } catch (e) {
      console.warn("[net] signaling step failed", type, e);
      this.close("ice-failed");
    }
  }

  async _flushCandidates() {
    for (const c of this._pending.splice(0)) {
      try {
        await this.pc.addIceCandidate(c);
      } catch (e) {
        console.warn("[net] bad ICE candidate", e);
      }
    }
  }

  _setup(ch) {
    ch.binaryType = "arraybuffer"; // Firefox defaults to Blob
    if (ch.label === "rel") {
      this.rel = ch;
      ch.bufferedAmountLowThreshold = HIGH_WATER / 4;
      ch.onmessage = (e) => {
        if (typeof e.data === "string") {
          let msg;
          try {
            msg = JSON.parse(e.data);
          } catch {
            return;
          }
          this.onMessage?.(msg);
        } else this.onBinary?.(e.data);
      };
    } else if (ch.label === "fast") {
      this.fast = ch;
      ch.onmessage = (e) => {
        if (typeof e.data !== "string") return;
        try {
          this.onFast?.(JSON.parse(e.data));
        } catch {
          /* ignore */
        }
      };
    }
    ch.onopen = () => this._checkOpen();
    ch.onclose = () => this.close(this.isOpen ? "closed" : "ice-failed");
    this._checkOpen();
  }

  _checkOpen() {
    if (this.isOpen || this.isClosed) return;
    if (this.rel?.readyState === "open" && this.fast?.readyState === "open") {
      this.isOpen = true;
      clearTimeout(this._openTimer);
      this.onOpen?.();
    }
  }

  /** reliable JSON message */
  send(msg) {
    this._out(this.rel, JSON.stringify(msg), true);
  }

  /** best-effort JSON message (player state) */
  sendFast(msg) {
    this._out(this.fast, JSON.stringify(msg), false);
  }

  _out(ch, data, reliable) {
    if (ch?.readyState !== "open") return;
    if (!this.sim) return ch.send(data);
    this.sim.send(() => ch.readyState === "open" && ch.send(data), reliable);
  }

  /**
   * Send a large binary blob over the reliable channel in chunks, respecting backpressure.
   * @param {Uint8Array} bytes
   * @param {(sent:number, total:number) => void} [onProgress]
   */
  async sendBytes(bytes, onProgress) {
    const ch = this.rel;
    for (let off = 0; off < bytes.length; off += CHUNK) {
      if (this.isClosed || ch.readyState !== "open") throw new NetError("closed", "Connection closed while sending the CV.");
      if (ch.bufferedAmount > HIGH_WATER) {
        await new Promise((r) => {
          const done = () => {
            ch.removeEventListener("bufferedamountlow", done);
            ch.removeEventListener("close", done);
            r();
          };
          ch.addEventListener("bufferedamountlow", done);
          ch.addEventListener("close", done);
        });
        if (ch.readyState !== "open") throw new NetError("closed", "Connection closed while sending the CV.");
      }
      // slice() copies into a fresh ArrayBuffer: send() can't take a view into a shared one
      this._out(ch, bytes.slice(off, Math.min(bytes.length, off + CHUNK)), true);
      onProgress?.(Math.min(bytes.length, off + CHUNK), bytes.length);
    }
  }

  close(reason = "closed") {
    if (this.isClosed) return;
    this.isClosed = true;
    clearTimeout(this._openTimer);
    clearTimeout(this._lostTimer);
    try {
      this.rel?.close();
      this.fast?.close();
      this.pc.close();
    } catch {
      /* already gone */
    }
    this.onClose?.(reason);
  }
}
