// Headless test of the match flow (src/net/match.js + combat.js + letters.js): a host and 3 guests
// play 3 matches to 10 kills over a laggy fake link (ordered like the reliable channel), shooting
// each other and the letters. The host starts each rematch at once, so hits fired just before the
// end are still in flight when the next match begins: they must not count. A 5th player joins
// during an end screen, and a 6th in the middle of a match.
//
//   npm run sim:match            (LAG=, JITTER=, SEED= to vary)
import { Combat } from "../src/net/combat.js";
import { LetterNet } from "../src/net/letters.js";
import { Match } from "../src/net/match.js";

let seed = Number(process.env.SEED || 1);
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const LAG = Number(process.env.LAG || 80), JITTER = Number(process.env.JITTER || 40);
const STEP = 10, TARGET = 10, LETTERS = 400;
let now = 0;
const clock = () => now;

class Link {
  constructor() { this.q = []; this.last = 0; }
  send(fn) { this.last = Math.max(this.last, now + LAG + rand() * JITTER); this.q.push({ at: this.last, fn }); }
  pump() { while (this.q.length && this.q[0].at <= now) this.q.shift().fn(); }
}
const freshLetters = () => Array.from({ length: LETTERS }, (_, id) => ({ id, hp: 2, maxHp: 2, alive: true }));
const restoreLetters = (L) => L.forEach((e) => { e.alive = true; e.hp = e.maxHp; });

const nodes = new Map(); // id -> node
const log = { ends: [], violations: [] };
let host;

function makeNode(id) {
  const isHost = id === 0;
  const n = { id, isHost, up: new Link(), down: new Link(), letters: freshLetters(), ends: [], starts: 0 };
  const toHost = (msg) => { const s = JSON.stringify(msg); n.up.send(() => host.onMsg(JSON.parse(s), id)); };
  const toAll = (msg) => { const s = JSON.stringify(msg); for (const g of nodes.values()) if (!g.isHost) g.down.send(() => g.onMsg(JSON.parse(s), 0)); };
  n.match = new Match({
    isHost, target: TARGET, toAll,
    fx: {
      ended: (m) => { n.combat.enabled = false; n.ends.push({ r: m.round, w: m.winner, sc: JSON.stringify(m.scores), aw: JSON.stringify(m.awards) }); },
      started: (m) => { restoreLetters(n.letters); n.lettersNet.reset(); n.combat.resetRound(m.protUntil); n.starts++; },
    },
  });
  n.combat = new Combat({
    isHost, selfId: () => id, now: clock, toHost, toAll, round: () => n.match.round,
    spawnFor: () => ({ x: rand() * 100, z: rand() * 100, yaw: 0 }),
    fx: {
      hurt() {}, respawned() {}, stats() {},
      died: () => { if (isHost) n.match.check(() => rows(n)); },
    },
  });
  n.combat.cfg = { ...n.combat.cfg, protection: 0.3 }; // short protection keeps the sim busy
  n.lettersNet = new LetterNet({
    entities: n.letters, isHost, selfId: () => id, round: () => n.match.round,
    fx: { hit() {}, kill: (e) => { e.alive = false; }, silentKill: (e) => { e.alive = false; e.hp = 0; }, revive: (e) => { e.alive = true; } },
    toHost, toAll, toOne: (to, msg) => { const g = nodes.get(to); const s = JSON.stringify(msg); g?.down.send(() => g.onMsg(JSON.parse(s), 0)); },
  });
  n.onMsg = (msg, from) => n.lettersNet.onMessage(msg, from) || n.combat.onMessage(msg, from) || n.match.onMessage(msg);
  nodes.set(id, n);
  return n;
}
const rows = (n) => [...n.combat.players].map(([id, p]) => ({ id, kills: p.kills, deaths: p.deaths, letters: n.lettersNet.kills.get(id) || 0, heads: p.heads, best: p.best }));
const syncRoster = () => { const ids = [...nodes.keys()]; for (const n of nodes.values()) n.combat.syncPlayers(ids); };

function join(id) {
  // like the room: the snapshot is taken before the new guest is registered, then sent over its link
  const snap = { letters: host.lettersNet.snapshot(), combat: host.combat.snapshot(), match: host.match.snapshot() };
  const g = makeNode(id);
  syncRoster();
  const s = JSON.stringify(snap);
  g.down.send(() => {
    const w = JSON.parse(s);
    g.match.applySnapshot(w.match);
    if (w.match.p === "ended") g.combat.enabled = false;
    g.lettersNet.applySnapshot(w.letters);
    g.combat.applySnapshot(w.combat);
  });
  return g;
}

host = makeNode(0);
for (let i = 1; i <= 3; i++) makeNode(i);
syncRoster();

function tick() {
  for (const n of nodes.values()) {
    if (!n.combat.enabled || rand() > 0.06) continue;
    const me = n.combat.get(n.id);
    if (!me?.alive) continue;
    if (rand() < 0.3) {
      // shoot a letter
      const e = n.letters[Math.floor(rand() * 60)];
      if (!e.alive) continue;
      e.hp -= 1;
      if (e.hp <= 0) e.alive = false;
      n.lettersNet.localHit(e, { x: 1, y: 1, z: 1, nx: 0, ny: 0, nz: 1 }, { x: 0, y: 0, z: -1 });
    } else {
      const others = [...nodes.keys()].filter((v) => v !== n.id);
      const v = others[Math.floor(rand() * others.length)];
      if (n.combat.isProtected(v) || !n.combat.get(v)?.alive) continue;
      n.combat.localHit({ victim: v, head: rand() < 0.25, dist: 10, point: { x: 0, y: 1.2, z: 0 }, viewTime: now - 100 });
      if (!n.isHost) host.combat.firedBy(n.id);
      else host.combat.firedBy(0);
    }
  }
  for (const n of nodes.values()) n.up.pump();
  for (const n of nodes.values()) { n.combat.update(); n.lettersNet.update(STEP); }
  for (const n of nodes.values()) n.down.pump();
  now += STEP;
}
const drain = (ms) => { const end = now + ms; while (now < end) { for (const n of nodes.values()) n.up.pump(); for (const n of nodes.values()) n.lettersNet.update(STEP); for (const n of nodes.values()) n.down.pump(); now += STEP; } };

let ok = true;
const check = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"} ${msg}`); ok &&= cond; };

for (let round = 1; round <= 3; round++) {
  const t0 = now;
  while (host.match.playing && now - t0 < 600000) {
    tick();
    if (round === 2 && !nodes.has(5) && now - t0 > 3000) join(5); // joins in the middle of match 2
  }
  check(!host.match.playing, `match ${round} ended after ${((now - t0) / 1000).toFixed(1)} s`);
  // everyone gets the end before anything else; keep "shooting" for a while (late hits must not count)
  const hostEnd = host.ends.at(-1);
  for (let k = 0; k < 40; k++) tick(); // clients that haven't heard yet keep firing
  drain(LAG + JITTER + 200);
  const sc = JSON.parse(hostEnd.sc);
  check(sc[0][1] >= TARGET && sc.every((r) => r[1] <= sc[0][1]), `match ${round}: winner ${hostEnd.w} has ${sc[0][1]} kills, nobody more`);
  const kills = sc.reduce((a, r) => a + r[1], 0), deaths = sc.reduce((a, r) => a + r[2], 0);
  check(kills === deaths, `match ${round}: kills (${kills}) = deaths (${deaths})`);
  const same = [...nodes.values()].filter((n) => !n.isHost).every((n) => { const e = n.ends.find((x) => x.r === round); return e && e.w === hostEnd.w && e.sc === hostEnd.sc && e.aw === hostEnd.aw; });
  check(same, `match ${round}: every guest saw the same winner, scores and awards (${hostEnd.aw})`);
  const frozen = JSON.stringify(rows(host));
  for (let k = 0; k < 50; k++) tick();
  drain(300);
  check(JSON.stringify(rows(host)) === frozen, `match ${round}: nothing scores during the end screen`);
  if (round === 1) {
    const late = join(4); // joins during the end screen
    drain(LAG + JITTER + 50);
    check(late.ends.length === 1 && late.ends[0].w === hostEnd.w && !late.combat.enabled, "player joining during the end screen sees the results");
  }
  if (round === 3) break;
  // a guest fires just before the host starts the rematch: those hits are in flight during the start
  const g1 = nodes.get(1);
  g1.combat.enabled = true; // (as if it hadn't received the end yet)
  g1.combat.localHit({ victim: 2, head: true, dist: 5, point: { x: 0, y: 1.6, z: 0 }, viewTime: now });
  const e = g1.letters[300];
  for (let k = 0; k < 2; k++) {
    e.hp -= 1;
    if (e.hp <= 0) e.alive = false;
    g1.lettersNet.localHit(e, { x: 1, y: 1, z: 1, nx: 0, ny: 0, nz: 1 }, { x: 0, y: 0, z: -1 });
  }
  g1.lettersNet.update(1000);
  const ids = [...nodes.keys()];
  // no spawn protection on this one, so only the round tag can stop the old hit
  host.match.rematch(ids.map((id) => [id, rand() * 100, rand() * 100, 0]), now);
  drain(LAG + JITTER + 200);
  const hp2 = host.combat.get(2);
  const L = host.letters[300];
  check(hp2.hp === 100 && L.alive && L.hp === L.maxHp, `rematch ${round + 1}: hits fired in match ${round} didn't count (player 2 at ${hp2.hp} HP, letter 300 at ${L.hp}/${L.maxHp})`);
  const reset = [...nodes.values()].every((n) => n.match.round === round + 1 && n.match.playing && n.letters.every((x) => x.alive) && [...n.combat.players.values()].every((p) => p.kills === 0 && p.deaths === 0 && p.alive));
  check(reset, `rematch ${round + 1}: every screen back to a fresh CV, all alive, scores zero`);
}
// final: every guest agrees with the host on the live numbers
drain(1000);
const hostRows = JSON.stringify(rows(host).map((r) => [r.id, r.kills, r.deaths, r.letters]));
const agree = [...nodes.values()].every((n) => JSON.stringify(rows(n).map((r) => [r.id, r.kills, r.deaths, r.letters])) === hostRows);
check(agree, `all ${nodes.size} players agree on kills / deaths / letters (incl. the two late joiners)`);
process.exit(ok ? 0 : 1);
