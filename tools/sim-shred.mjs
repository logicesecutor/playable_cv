// Headless test of the shredder's timetable (src/game/shredder.js) and of how its timings travel
// with the match clock (src/net/match.js): every screen must work out the same cut from the
// shared clock alone, late joiners included.
//
//   npm run sim:shred
import { shredState, cutAt, gameMetres } from "../src/game/shredder.js";
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
process.exit(ok ? 0 : 1);
