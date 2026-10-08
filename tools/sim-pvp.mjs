// Headless test of player-vs-player authority (src/net/combat.js): a host and 5 guests run around
// and shoot each other for 90 s over a fake network (lag + jitter, ordered like the reliable
// channel). Some hits are fake (the shooter claims a point far from the victim) and must be
// rejected. At the end every player's scoreboard and health must match the host's, nobody may take
// damage while dead or spawn-protected, and every death must be followed by a respawn.
//
//   npm run sim:pvp            (LAG=, JITTER=, SEED= to vary)
import { Combat, COMBAT, damageFor } from "../src/net/combat.js";

let seed = Number(process.env.SEED || 1);
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const LAG = Number(process.env.LAG || 80), JITTER = Number(process.env.JITTER || 40);
const N = 6, SECONDS = 90, STEP = 10;
let now = 0;
const clock = () => now;

class Link {
  constructor() { this.q = []; this.last = 0; }
  send(fn) { this.last = Math.max(this.last, now + LAG + rand() * JITTER); this.q.push({ at: this.last, fn }); }
  pump() { while (this.q.length && this.q[0].at <= now) this.q.shift().fn(); }
}

// ground truth positions: everyone wanders on a 100 x 100 m field
const pos = Array.from({ length: N }, () => ({ x: rand() * 100, z: rand() * 100, vx: 0, vz: 0 }));
const posHistory = Array.from({ length: N }, () => []);
const truthAt = (id, t) => { const h = posHistory[id]; for (let i = h.length - 1; i >= 0; i--) if (h[i].t <= t) return h[i]; return h[0]; };

const nodes = [];
const viol = { hurtWhileDead: 0, hurtWhileProtected: 0, hpOver: 0 };
const deathsSeen = new Map(); // host: victim -> pending respawn count
let respawnsMissing = 0;

for (let id = 0; id < N; id++) {
  const node = { id, up: new Link(), down: new Link(), spawns: 0 };
  node.combat = new Combat({
    isHost: id === 0,
    selfId: () => id,
    now: clock,
    toHost: (msg) => { const s = JSON.stringify(msg); node.up.send(() => nodes[0].combat.onMessage(JSON.parse(s), id)); },
    toAll: (msg) => { const s = JSON.stringify(msg); for (const n of nodes) if (n.id !== 0) n.down.send(() => n.combat.onMessage(JSON.parse(s), 0)); },
    spawnFor: (v) => { pos[v].x = rand() * 100; pos[v].z = rand() * 100; return { x: pos[v].x, z: pos[v].z, yaw: 0 }; },
    fx: {
      hurt: (v) => {
        if (id !== 0) return;
        const p = nodes[0].combat.get(v);
        if (p.hp > COMBAT.maxHp) viol.hpOver++;
      },
      died: (v) => { if (id === 0) deathsSeen.set(v, (deathsSeen.get(v) || 0) + 1); },
      respawned: (v) => { if (id === 0) deathsSeen.set(v, deathsSeen.get(v) - 1); },
    },
  });
  nodes.push(node);
}
const ids = nodes.map((n) => n.id);
for (const n of nodes) n.combat.syncPlayers(ids);

// host-side guard: wrap the host's apply to catch damage to dead / protected victims
const host = nodes[0].combat;
const origApply = host._hostApply.bind(host);
const judged = { fakeAccepted: 0, fakeRefused: 0, honestRefused: 0, honestAccepted: 0 };
host._hostApply = (by, v, head, dist, point, vt, trusted) => {
  const victim = host.get(v);
  const before = victim ? victim.hp : 0;
  const wasDead = victim && !victim.alive, wasProt = victim && victim.prot > now;
  const rw = host.rejectedBy.rewind, rejected = host.rejected;
  origApply(by, v, head, dist, point, vt, trusted);
  if (!trusted && !wasDead && !wasProt && host.get(by)?.alive !== false) {
    const truth = truthAt(v, vt);
    const fake = Math.hypot(point.x - truth.x, point.z - truth.z) > 3;
    const refusedByRewind = host.rejectedBy.rewind > rw;
    if (fake) refusedByRewind ? judged.fakeRefused++ : host.rejected === rejected && judged.fakeAccepted++;
    else refusedByRewind ? judged.honestRefused++ : judged.honestAccepted++;
  }
  if (victim && victim.hp < before && wasDead) viol.hurtWhileDead++;
  if (victim && victim.hp < before && wasProt) viol.hurtWhileProtected++;
};

// positions reach the host's rewind history late, like state messages do
let pendingPos = [];
function setPos(i, t, x, z, d) {
  pendingPos.push({ at: t + d, i, t, x, z });
  const due = pendingPos.filter((p) => p.at <= now);
  pendingPos = pendingPos.filter((p) => p.at > now);
  for (const p of due) host.record(p.i, p.t, p.x, 0, p.z, false);
}

let shots = 0, fakes = 0;
for (now = 0; now < SECONDS * 1000; now += STEP) {
  // move
  for (let i = 0; i < N; i++) {
    const p = pos[i];
    if (rand() < 0.02) { p.vx = (rand() - 0.5) * 12; p.vz = (rand() - 0.5) * 12; }
    p.x = Math.min(100, Math.max(0, p.x + (p.vx * STEP) / 1000));
    p.z = Math.min(100, Math.max(0, p.z + (p.vz * STEP) / 1000));
    posHistory[i].push({ t: now, x: p.x, y: 0, z: p.z });
    if (posHistory[i].length > 400) posHistory[i].shift();
    // the host hears about positions LAG ms late (its own immediately), like state messages
    const d = i === 0 ? 0 : LAG;
    const t = now, x = p.x, z = p.z;
    setPos(i, t, x, z, d);
  }
  // shoot
  for (const n of nodes) {
    if (rand() > 0.05) continue;
    const me = n.combat.get(n.id);
    if (!me?.alive) continue;
    let v = Math.floor(rand() * N);
    if (v === n.id) v = (v + 1) % N;
    const viewTime = now - 100 - (n.id === 0 ? 0 : LAG); // what the shooter sees is a bit in the past
    const seen = truthAt(v, viewTime);
    const fake = rand() < 0.08;
    const point = fake ? { x: seen.x + 6, y: 1, z: seen.z } : { x: seen.x + (rand() - 0.5) * 0.5, y: 1.2, z: seen.z + (rand() - 0.5) * 0.5 };
    const shooterAt = pos[n.id];
    const dist = Math.hypot(point.x - shooterAt.x, point.z - shooterAt.z);
    n.combat.localHit({ victim: v, head: rand() < 0.2, dist, point, viewTime });
    if (n.id !== 0) host.firedBy(n.id); // (in the game this arrives with the state message)
    else host.firedBy(0);
    shots++;
    if (fake) fakes++;
  }
  for (const n of nodes) n.up.pump();
  for (const n of nodes) n.combat.update();
  for (const n of nodes) n.down.pump();
}

// drain
for (let k = 0; k < 2000; k++, now += STEP) { for (const n of nodes) n.up.pump(); for (const n of nodes) n.combat.update(); for (const n of nodes) n.down.pump(); }

let ok = true;
const row = (c, id) => { const p = c.get(id); return `${id}:${p.kills}/${p.deaths}/${p.alive ? "A" : "D"}`; };
const hostBoard = ids.map((id) => row(host, id)).join(" ");
console.log(`lag ${LAG}±${JITTER} ms, ${SECONDS} s, ${N} players: ${shots} hits claimed (${fakes} fake), host rejected ${host.rejected}`);
console.log(`host board (kills/deaths/alive): ${hostBoard}`);
for (const n of nodes.slice(1)) {
  const b = ids.map((id) => row(n.combat, id)).join(" ");
  const hpOk = ids.every((id) => Math.abs(n.combat.get(id).hp - host.get(id).hp) < 0.01);
  const good = b === hostBoard && hpOk;
  ok &&= good;
  console.log(`${good ? "PASS" : "FAIL"} guest ${n.id} board ${b === hostBoard ? "matches" : "differs: " + b}${hpOk ? "" : " (hp differs)"}`);
}
const kills = ids.reduce((a, id) => a + host.get(id).kills, 0), deaths = ids.reduce((a, id) => a + host.get(id).deaths, 0);
const c1 = kills === deaths && deaths > 0;
console.log(`${c1 ? "PASS" : "FAIL"} kills (${kills}) = deaths (${deaths})`);
const c2 = viol.hurtWhileDead === 0 && viol.hurtWhileProtected === 0 && viol.hpOver === 0;
console.log(`${c2 ? "PASS" : "FAIL"} no damage while dead (${viol.hurtWhileDead}) or protected (${viol.hurtWhileProtected}), never above max HP (${viol.hpOver})`);
respawnsMissing = [...deathsSeen.values()].reduce((a, b) => a + b, 0);
const c3 = respawnsMissing === 0 && ids.every((id) => host.get(id).alive);
console.log(`${c3 ? "PASS" : "FAIL"} every death was followed by a respawn (${respawnsMissing} missing)`);
const rb = host.rejectedBy;
const c4 = judged.fakeAccepted === 0 && judged.fakeRefused > 0 && judged.honestRefused <= judged.honestAccepted * 0.01;
console.log(
  `${c4 ? "PASS" : "FAIL"} rewind check: fake hits refused ${judged.fakeRefused}, accepted ${judged.fakeAccepted}; ` +
    `honest hits accepted ${judged.honestAccepted}, wrongly refused ${judged.honestRefused} (also refused: ${rb.dead} at dead players, ${rb.protected} at protected ones)`,
);
const c5 = damageFor(false, 10) === 25 && damageFor(true, 10) === 50 && damageFor(false, 200) === 15 && damageFor(true, 80) === 40;
console.log(`${c5 ? "PASS" : "FAIL"} damage: body 25, head 50, 60 % past 120 m, head at 80 m = ${damageFor(true, 80)}`);
ok &&= c1 && c2 && c3 && c4 && c5;
process.exit(ok ? 0 : 1);
