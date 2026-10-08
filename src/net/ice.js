// ICE servers: STUN (find your public address) + optional TURN relay for networks where a direct
// connection is impossible (two strict NATs, corporate firewalls, some mobile carriers).
//
// TURN comes from Metered (https://www.metered.ca, free plan: 500 MB/month). The page asks for
// short-lived credentials with the front-end API key of a Metered "credential":
//   GET https://<app>.metered.live/api/v1/turn/credentials?apiKey=<key>   -> [{urls, username, credential}…]
// That key is meant to be public (it can only fetch relay credentials). Never put the account's
// Secret Key here.
//
// Developer switches (URL): ?relay=1 forces every connection through the relay (to check it works
// on one machine); ?turn=<app>:<apiKey> uses another Metered app for this page load.

/** @typedef {{urls:string|string[], username?:string, credential?:string}} IceServer */

let cache = null; // {at, list}

/**
 * STUN servers from the config, plus the relay's TURN servers when one is configured.
 * @param {typeof import("../config.js").config.net} net
 * @returns {Promise<{iceServers: IceServer[], relay: boolean, policy: RTCIceTransportPolicy}>}
 */
export async function resolveIce(net) {
  const policy = net.forceRelay ? "relay" : "all";
  const m = net.turn?.metered;
  if (!m?.app || !m?.apiKey) return { iceServers: net.iceServers, relay: false, policy: "all" };
  // credentials last a while; reuse them for 10 minutes
  if (cache && performance.now() - cache.at < 600000) return { iceServers: [...net.iceServers, ...cache.list], relay: true, policy };
  try {
    const url = `https://${encodeURIComponent(m.app)}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(m.apiKey)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout?.(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = (await res.json()).filter((s) => s && (typeof s.urls === "string" || Array.isArray(s.urls)));
    if (!list.length) throw new Error("no servers in the answer");
    cache = { at: performance.now(), list };
    return { iceServers: [...net.iceServers, ...list], relay: true, policy };
  } catch (e) {
    console.warn("[net] couldn't get relay (TURN) credentials, direct connections only:", e?.message || e);
    return { iceServers: net.iceServers, relay: false, policy: "all" };
  }
}

/** ?turn=<app>:<apiKey> and ?relay=1 from the page URL */
export function applyIceUrlOptions(net, search = location.search) {
  const q = new URLSearchParams(search);
  const t = q.get("turn");
  if (t && /^[a-z0-9-]+:[A-Za-z0-9_-]+$/.test(t)) {
    const [app, apiKey] = t.split(":");
    net.turn = { ...net.turn, metered: { app, apiKey } };
  }
  if (q.get("relay") === "1") net.forceRelay = true;
}

/**
 * How a connected RTCPeerConnection actually talks: "direct" (host / STUN candidates) or "relay" (TURN).
 * @param {RTCPeerConnection} pc
 * @returns {Promise<"direct"|"relay"|"unknown">}
 */
export async function routeOf(pc) {
  try {
    const stats = await pc.getStats();
    let pair = null;
    stats.forEach((s) => {
      if (s.type === "transport" && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId);
    });
    if (!pair) stats.forEach((s) => { if (s.type === "candidate-pair" && (s.selected || s.nominated) && s.state === "succeeded") pair = s; });
    if (!pair) return "unknown";
    const l = stats.get(pair.localCandidateId), r = stats.get(pair.remoteCandidateId);
    return l?.candidateType === "relay" || r?.candidateType === "relay" ? "relay" : "direct";
  } catch {
    return "unknown";
  }
}
