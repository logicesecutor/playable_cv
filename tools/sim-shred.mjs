// Headless test of the shredder's timetable (src/game/shredder.js) and of how its timings travel
// with the match clock (src/net/match.js): every screen must work out the same cut from the
// shared clock alone, late joiners included.
//
//   npm run sim:shred
import { shredState, cutAt, gameMetres, PageEater, spawnClear, SPAWN_LEAD } from "../src/game/shredder.js";
import { Combat } from "../src/net/combat.js";
import { Match } from "../src/net/match.js";
import { config } from "../src/config.js";

let ok = true;
const check = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"} ${msg}`); ok &&= cond; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

const S = { after: 90, grab: 9.35, seconds: 45, warn: 10 };
const D = 252.567, bite = 0.01 * gameMetres(config);
check(near(bite, 8.5039, 1e-3), `bite = 1 cm of real paper = ${bite.toFixed(2)} game m`);
check(near(cutAt(0, D, bite), bite) && near(cutAt(1, D, bite), D) && near(cutAt(2, D, bite), D) && near(cutAt(-1, D, bite), bite), "cutAt: bite at the start, the bottom edge at the end, clamped");

const at = (e) => shredState(e, S, D, bite);
check(at(null).phase === "waiting" && at(null).t === null && at(null).cutZ === 0, "no match clock: waiting, nothing cut");
check(at(0).phase === "waiting" && at(0).countdown === null, "match start: waiting, no countdown yet");
check(at(79.9).countdown === null && near(at(80).countdown, 10) && near(at(85.5).countdown, 4.5), "countdown only in the last 10 s");
check(at(90).phase === "grab" && at(90).t === 0 && at(90).cutZ === 0, "1:30: she reaches for the CV (nothing cut yet)");
check(at(99.3).phase === "grab" && at(99.36).phase === "feeding" && near(at(99.36).cutZ, bite, 0.1), "feeding starts when the CV is in the slot");
check(near(at(99.35 + 22.5).progress, 0.5) && near(at(99.35 + 22.5).cutZ, (bite + D) / 2), "half way through the feed: the cut is half way down the page");
check(at(144.36).phase === "done" && at(144.36).progress === 1 && near(at(200).cutZ, D), "after 45 s of feeding the page is used up");
let mono = true, prev = -1;
for (let e = 0; e < 200; e += 0.05) { const c = at(e).cutZ; if (c < prev) mono = false; prev = c; }
check(mono, "the cut never moves back up the page");
const speed = (D - bite) / S.seconds;
check(speed < config.player.walkSpeed, `the cut (${speed.toFixed(1)} m/s) is slower than walking (${config.player.walkSpeed} m/s): you can outrun it`);

// timings travel with the clock: the host's dev override counts for every guest
const msgs = [];
const host = new Match({ isHost: true, target: 10, shred: { after: 20, seconds: 15 }, toAll: (m) => msgs.push(JSON.parse(JSON.stringify(m))), fx: { ended() {}, started() {} } });
const guest = new Match({ isHost: false, target: 10, fx: { ended() {}, started() {} } });
const late = new Match({ isHost: false, target: 10, fx: { ended() {}, started() {} } });
host.go(5000);
for (const m of msgs) guest.onMessage(m);
late.applySnapshot(JSON.parse(JSON.stringify(host.snapshot())));
const same = [guest, late].every((g) => g.startAt === 5000 && g.shred?.after === 20 && g.shred?.seconds === 15);
check(same, "guests (live and late) get the host's clock and shredder timings");
const cut = (m, hostNow) => shredState(m.elapsed(hostNow), { ...S, ...m.shred }, D, bite).cutZ;
check([host, guest, late].every((m) => near(cut(m, 5000 + 40000), cut(host, 5000 + 40000))) && cut(host, 45000) > bite, "same clock + same timings = the same cut on every screen");
host.check(() => [{ id: 0, kills: 10, deaths: 0, letters: 0, heads: 0, best: 1 }]);
msgs.length = 0;
host.rematch([[0, 1, 1, 0]], 90000, 88000);
for (const m of msgs) guest.onMessage(m);
check(guest.startAt === 88000 && guest.shred.after === 20 && shredState(guest.elapsed(88000), { ...S, ...guest.shred }, D, bite).phase === "waiting", "a rematch restarts the clock: the CV is back in the tray");

// S4: the page eater (every screen eats the same letters, in order, once)
let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const letters = Array.from({ length: 2000 }, (_, id) => { const z = rand() * (D - 4); return { id, alive: true, box: { minZ: z, maxZ: z + 1 + rand() * 3 } }; });
const eaten = [];
const eater = new PageEater(letters, (e) => { if (!e.alive) eaten.push(-1); e.alive = false; eaten.push(e.id); });
let lastCut = 0, wrong = 0;
for (let e = 0; e <= 160; e += 0.1) {
  const c = shredState(e, S, D, bite).cutZ;
  eater.update(c);
  for (const L of letters) if ((L.box.minZ + L.box.maxZ) / 2 < c === L.alive) wrong++;
  lastCut = c;
}
check(wrong === 0 && !eaten.includes(-1) && eaten.length === letters.length, `page eater: every letter goes once, exactly when the cut passes its middle (${eaten.length} eaten)`);
for (const L of letters) L.alive = true; // rematch: the world reset brings them back
eaten.length = 0;
eater.update(0);
eater.update(cutAt(0.25, D, bite));
check(eaten.length > 0 && letters.every((L) => ((L.box.minZ + L.box.maxZ) / 2 < cutAt(0.25, D, bite)) !== L.alive), "after a rematch the eater starts over");
check(spawnClear(10, 0) && !spawnClear(50, 30) && spawnClear(30 + SPAWN_LEAD + 1, 30), `spawns: anywhere before the cut, then only ${SPAWN_LEAD} m+ below it`);

// S4: deaths without a killer (the host only; a death, no kill)
const sent = [];
const died = [];
let clock = 0;
const hc = new Combat({ isHost: true, selfId: () => 0, now: () => clock, toAll: (m) => sent.push(m), spawnFor: () => ({ x: 1, z: 200, yaw: 0 }),
  fx: { hurt() {}, died: (v, by, h, c) => died.push([v, by, c]), respawned() {}, stats() {} } });
const gc = new Combat({ isHost: false, selfId: () => 1, now: () => clock, toHost() {}, fx: { hurt() {}, died: (v, by, h, c) => died.push(["g", v, by, c]), respawned() {}, stats() {} } });
hc.syncPlayers([0, 1, 2]); gc.syncPlayers([0, 1, 2]);
hc.get(1).prot = 1e9; // spawn protection doesn't help
check(hc.environmentKill(1, "shred") && !hc.environmentKill(1, "shred"), "the host shreds a player once (protection or not)");
for (const m of sent) gc.onMessage(JSON.parse(JSON.stringify(m)), 0);
const hp = hc.get(1), gp = gc.get(1);
check(hp.deaths === 1 && gp.deaths === 1 && [...hc.players.values()].every((p) => p.kills === 0) && [...gc.players.values()].every((p) => p.kills === 0), "it counts as a death, and nobody gets the kill (host and guest agree)");
check(died.some((d) => d[0] === "g" && d[1] === 1 && d[2] === 1 && d[3] === "shred"), "guests hear the cause (kill feed: went through the shredder)");
clock += 3100; hc.update();
check(hc.get(1).alive && sent.at(-1).t === "respawn", "and respawns 3 s later like any death");
check(!gc.environmentKill(2, "shred"), "guests can't decide shredder deaths");

// S7: caught first, dead 1.6 s later; nobody can shoot a caught player for the kill
{
  let t = 0;
  const out = [], seen = [];
  const h = new Combat({ isHost: true, selfId: () => 0, now: () => t, toAll: (m) => out.push(JSON.parse(JSON.stringify(m))), spawnFor: () => ({ x: 1, z: 240, yaw: 0 }),
    fx: { hurt() {}, died: (v, by, hd, c) => seen.push(["died", v, c]), caught: (v, c) => seen.push(["caught", v, c]), respawned() {}, stats() {} } });
  const g = new Combat({ isHost: false, selfId: () => 1, now: () => t, toHost() {}, fx: { hurt() {}, died: (v, by, hd, c) => seen.push(["g-died", v, c]), caught: (v, c, at, u) => seen.push(["g-caught", v, c, at.x, at.z, u]), respawned() {}, stats() {} } });
  h.syncPlayers([0, 1]); g.syncPlayers([0, 1]);
  check(h.catch(1, "shred", 12.345, 40.5, 1600) && !h.catch(1, "shred", 0, 0, 1600) && h.isCaught(1), "the host catches a player once");
  for (const m of out) g.onMessage(m, 0);
  check(g.isCaught(1) && seen.some((x) => x[0] === "g-caught" && x[1] === 1 && x[2] === "shred" && x[3] === 12.35 && x[4] === 40.5 && x[5] === 1600), "guests hear who was caught, where, and when they die");
  h.localHit({ victim: 1, head: true, dist: 5, point: { x: 0, y: 1, z: 0 }, viewTime: 0 });
  check(h.get(1).hp === 100 && h.get(0).kills === 0, "a caught player can't be shot (no stolen kills)");
  t = 1500; h.update();
  check(h.get(1).alive, "still being pulled in at 1.5 s");
  t = 1600; h.update();
  check(!h.get(1).alive && !h.isCaught(1) && h.get(1).deaths === 1 && h.get(0).kills === 0 && seen.some((x) => x[0] === "died" && x[1] === 1 && x[2] === "shred"), "dead at 1.6 s: a death, no kill");
  for (const m of out.slice(1)) g.onMessage(m, 0);
  check(!g.isCaught(1) && !g.get(1).alive && g.get(1).deaths === 1, "the guest agrees");
  t = 1600 + 3100; h.update();
  check(h.get(1).alive && !h.isCaught(1), "respawns uncaught");
  h.catch(0, "shred", 0, 0, 1600);
  h.resetRound(t + 2000);
  t += 5000; h.update();
  check(h.get(0).alive && h.get(0).deaths === 0 && !h.isCaught(0), "a rematch frees a caught player (no death carried over)");
}

// S5: the page is used up first: the match ends, the leader wins (guests and late joiners agree)
{
  const out = [];
  const m = new Match({ isHost: true, target: 10, toAll: (x) => out.push(JSON.parse(JSON.stringify(x))), fx: { ended() {}, started() {} } });
  const g = new Match({ isHost: false, target: 10, fx: { ended() {}, started() {} } });
  m.go(0);
  const rows = () => [
    { id: 0, kills: 3, deaths: 5, letters: 0, heads: 0, best: 1 },
    { id: 1, kills: 6, deaths: 2, letters: 4, heads: 1, best: 3 },
    { id: 2, kills: 6, deaths: 4, letters: 0, heads: 0, best: 2 },
  ];
  check(!m.check(rows), "nobody at the target: the match goes on");
  check(m.finish(rows, "shred") && !m.finish(rows, "shred") && !m.playing, "the host ends it when the page is gone (once)");
  for (const x of out) g.onMessage(x);
  const late = new Match({ isHost: false, target: 10, fx: { ended() {}, started() {} } });
  late.applySnapshot(JSON.parse(JSON.stringify(m.snapshot())));
  check(m.winner === 1 && g.winner === 1 && late.winner === 1, "the leader wins (most kills; fewest deaths breaks the tie)");
  check(g.why === "shred" && late.why === "shred" && m.why === "shred", "everyone knows why it ended (end card: the CV went through the shredder)");
}
process.exit(ok ? 0 : 1);
