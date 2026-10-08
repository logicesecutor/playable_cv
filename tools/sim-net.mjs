// Headless test of shared destruction (src/net/letters.js): one host + guests shoot thousands of
// letters through a fake network with lag, jitter and ordered-but-late delivery (like the reliable
// WebRTC channel), a guest joins halfway through, and one guest sometimes sends hits the host must
// reject. At the end every player's map must match the host's exactly.
//
//   npm run sim:net            (SEED=3 npm run sim:net for another run)
import { LetterNet } from "../src/net/letters.js";

let seed = Number(process.env.SEED || 1);
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

const N = 1745; // letters on example_cv.pdf
const maxHp = Array.from({ length: N }, () => 1 + Math.floor(rand() * rand() * 7)); // mostly 1–2, a few up to 7
const LAG = Number(process.env.LAG || 80), JITTER = Number(process.env.JITTER || 40);
const SECONDS = 60, STEP = 10; // ms
const FIRE_PROB = 0.105; // ~630 rounds/min while "holding the trigger" in bursts
let now = 0;

// reliable + ordered link: each message arrives after lag + jitter, never before an earlier one
class Link {
  constructor() { this.q = []; this.last = 0; }
  send(fn) { this.last = Math.max(this.last, now + LAG + rand() * JITTER); this.q.push({ at: this.last, fn }); }
  pump() { while (this.q.length && this.q[0].at <= now) this.q.shift().fn(); }
}

const fxFor = (st) => ({
  hit: () => st.fxHits++,
  kill: (e) => { e.alive = false; e.hp = Math.min(e.hp, 0); st.fxKills++; },
  silentKill: (e) => { e.alive = false; e.hp = 0; },
  revive: (e) => { e.alive = true; st.revived++; },
});
const freshLetters = () => maxHp.map((hp, id) => ({ id, hp, maxHp: hp, alive: true }));

// ---- host
const players = new Map(); // id -> {net, letters, up:Link (guest->host), down:Link (host->guest)}
const host = { id: 0, letters: freshLetters(), st: { fxHits: 0, fxKills: 0, revived: 0 } };
host.net = new LetterNet({
  entities: host.letters, isHost: true, selfId: () => 0, fx: fxFor(host.st),
  toAll: (msg) => { const s = JSON.stringify(msg); for (const p of players.values()) p.down.send(() => p.net.onMessage(JSON.parse(s), 0)); },
  toOne: (id, msg) => { const p = players.get(id); const s = JSON.stringify(msg); p?.down.send(() => p.net.onMessage(JSON.parse(s), 0)); },
  // guest 3 is a "liar": half of the time the host thinks it's far away from where it shoots
  shooterPos: (id) => (id === 3 && rand() < 0.5 ? { x: 9999, z: 9999 } : { x: 0, z: 0 }),
  maxDist: 500,
});

function addGuest(id, snapshot) {
  const g = { id, letters: freshLetters(), st: { fxHits: 0, fxKills: 0, revived: 0 }, up: new Link(), down: new Link() };
  g.net = new LetterNet({
    entities: g.letters, isHost: false, selfId: () => id, fx: fxFor(g.st),
    toHost: (msg) => { const s = JSON.stringify(msg); g.up.send(() => host.net.onMessage(JSON.parse(s), id)); },
  });
  if (snapshot) g.net.applySnapshot(JSON.parse(JSON.stringify(snapshot)));
  players.set(id, g);
  return g;
}
addGuest(1);
addGuest(2);
addGuest(3);

// local shot, exactly like Destruction.bullet + onLocalHit
function shoot(p) {
  // aim at a letter that is alive on OUR screen, biased to a small "neighbourhood" so players
  // often fight over the same letters
  let e;
  for (let tries = 0; tries < 20 && !e; tries++) {
    const id = rand() < 0.6 ? Math.floor(rand() * 60) : Math.floor(rand() * N);
    if (p.letters[id].alive) e = p.letters[id];
  }
  if (!e) return;
  e.hp -= 1;
  if (e.hp <= 0) e.alive = false;
  p.net.localHit(e, { x: rand() * 100, y: 1, z: rand() * 100, nx: 0, ny: 0, nz: 1 }, { x: 0, y: 0, z: -1 });
  p.shots = (p.shots || 0) + 1;
}

let joined = false;
for (now = 0; now < SECONDS * 1000; now += STEP) {
  for (const p of [host, ...players.values()]) if (rand() < FIRE_PROB) shoot(p);
  if (!joined && now >= (SECONDS * 1000) / 2) {
    // late join: the host takes the snapshot, then the new guest gets the welcome over its link
    joined = true;
    const snap = host.net.snapshot();
    const g = addGuest(4, null);
    g.down.send(() => g.net.applySnapshot(JSON.parse(JSON.stringify(snap))));
  }
  for (const p of players.values()) { p.up.pump(); }
  for (const p of [host, ...players.values()]) p.net.update(STEP);
  for (const p of players.values()) { p.down.pump(); }
}
// stop shooting, let everything drain
for (let i = 0; i < 300; i++, now += STEP) {
  for (const p of players.values()) p.up.pump();
  for (const p of [host, ...players.values()]) p.net.update(STEP);
  for (const p of players.values()) p.down.pump();
}

// ---- compare
let ok = true;
const dead = (L) => L.filter((e) => !e.alive).length;
console.log(`lag ${LAG}±${JITTER} ms, ${SECONDS} s, ${players.size + 1} players, ${N} letters`);
console.log(`host: ${host.shots} shots, ${dead(host.letters)} letters destroyed, ${host.net.rejected} hits rejected`);
for (const p of players.values()) {
  let diffAlive = 0, diffHp = 0;
  for (let i = 0; i < N; i++) {
    const a = host.letters[i], b = p.letters[i];
    if (a.alive !== b.alive) diffAlive++;
    else if (a.alive && a.hp !== b.hp) diffHp++;
  }
  const kh = JSON.stringify([...host.net.kills].sort()), kg = JSON.stringify([...p.net.kills].sort());
  const good = diffAlive === 0 && diffHp === 0 && kh === kg;
  ok &&= good;
  console.log(
    `${good ? "PASS" : "FAIL"} guest ${p.id}${p.id === 4 ? " (joined late)" : p.id === 3 ? " (half its hits rejected)" : ""}: ` +
      `${p.shots || 0} shots, ${dead(p.letters)} destroyed, alive mismatches ${diffAlive}, hp mismatches ${diffHp}, ` +
      `kill counts ${kg === kh ? "match" : `differ ${kg} vs ${kh}`}, predicted kills undone ${p.st.revived}`,
  );
}
const totalKills = [...host.net.kills.values()].reduce((a, b) => a + b, 0);
const sane = totalKills === dead(host.letters);
ok &&= sane;
console.log(`${sane ? "PASS" : "FAIL"} per-player kill counts add up to the destroyed letters (${totalKills})`);
process.exit(ok ? 0 : 1);
