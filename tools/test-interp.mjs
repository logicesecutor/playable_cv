// Headless test of remote-player smoothing (src/net/snapshots.js) under simulated networks.
//
//   npm run test:interp
//
// A fake player runs, turns, sprints and jumps for 60 s. Its state is sent 20x/s through a fake
// network (one-way lag + random jitter + packet loss, packets may arrive out of order), and a
// receiver samples the SnapshotBuffer at 60 fps like the game does. We measure:
//   error  distance between what the receiver draws and where the player really was at that
//          (delayed) render time
//   pop    frame-to-frame jump of the drawn position beyond the real movement in that frame
//   delay  the buffer's adaptive delay (= how far in the past remote players are shown)
import { SnapshotBuffer, FLAG } from "../src/net/snapshots.js";

let seed = Number(process.env.SEED || 1);
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

const SCENARIOS = [
  { name: "LAN", lag: 2, jitter: 2, loss: 0, maxP95: 0.12, maxPop: 0.15 },
  { name: "good internet", lag: 40, jitter: 15, loss: 0.01, maxP95: 0.2, maxPop: 0.3 },
  { name: "bad wifi", lag: 80, jitter: 40, loss: 0.05, maxP95: 0.3, maxPop: 0.45 },
  { name: "awful mobile", lag: 150, jitter: 90, loss: 0.15, maxP95: 0.6, maxPop: 0.8 },
  // wifi that stalls: 3% of packets stuck for an extra 250-400 ms
  { name: "stalls", lag: 50, jitter: 20, loss: 0.02, spike: 0.03, maxP95: 0.3, maxPop: 0.5 },
];

/** ground truth: a player-like path sampled every 1/240 s */
function simulatePath(seconds) {
  const dt = 1 / 240;
  const path = [];
  let x = 50, z = 50, y = 0, vx = 0, vz = 0, vy = 0, tx = 0, tz = 0, nextTurn = 0, nextJump = 2;
  let yaw = 0;
  for (let i = 0, t = 0; t <= seconds; i++, t = i * dt) {
    if (t >= nextTurn) {
      const a = rand() * Math.PI * 2, sp = rand() < 0.3 ? 11 : rand() < 0.15 ? 0 : 6.5;
      tx = Math.cos(a) * sp; tz = Math.sin(a) * sp;
      nextTurn = t + 0.4 + rand() * 1.2;
    }
    const grounded = y <= 0;
    const k = 1 - Math.exp(-(grounded ? 14 : 3) * dt);
    vx += (tx - vx) * k; vz += (tz - vz) * k;
    if (grounded && t >= nextJump) { vy = 7.8; nextJump = t + 1.5 + rand() * 3; }
    if (y > 0 || vy > 0) { vy -= 22 * dt; y += vy * dt; if (y <= 0) { y = 0; vy = 0; } }
    x += vx * dt; z += vz * dt;
    if (Math.hypot(vx, vz) > 0.5) yaw = Math.atan2(-vx, -vz);
    path.push({ t: t * 1000, x, y, z, vx, vy, vz, yaw, grounded: y <= 0 });
  }
  return { at: (ms) => path[Math.max(0, Math.min(path.length - 1, Math.round(ms / (1000 / 240))))] };
}

function run(sc) {
  const seconds = 60;
  const truth = simulatePath(seconds + 1);
  const buf = new SnapshotBuffer({ interval: 50 });
  // packets "in flight": {arrive, snap}
  const flight = [];
  let k = 0;
  for (let t = 0; t <= seconds * 1000; t += 50 + (rand() - 0.5) * 4) {
    if (rand() < sc.loss) { k++; continue; }
    const s = truth.at(t);
    flight.push({
      arrive: t + sc.lag + rand() * sc.jitter + (rand() < (sc.spike || 0) ? 250 + rand() * 150 : 0),
      snap: { t, k: k++, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: 0, vx: s.vx, vy: s.vy, vz: s.vz, f: s.grounded ? FLAG.grounded : 0 },
    });
  }
  flight.sort((a, b) => a.arrive - b.arrive);

  const errors = [], pops = [], delays = [];
  const modes = {};
  let fi = 0, prev = null, prevTrue = null;
  const out = {};
  for (let now = 1000; now < seconds * 1000; now += 1000 / 60) {
    while (fi < flight.length && flight[fi].arrive <= now) buf.push(flight[fi].snap, flight[fi].arrive), fi++;
    buf.sample(now, out);
    if (out.mode === "none") continue;
    modes[out.mode] = (modes[out.mode] || 0) + 1;
    const rt = now - buf.delay;
    const tr = truth.at(rt);
    errors.push(Math.hypot(out.x - tr.x, out.z - tr.z, out.y - tr.y));
    delays.push(buf.delay);
    if (prev) {
      const drawn = Math.hypot(out.x - prev.x, out.z - prev.z);
      const real = Math.hypot(tr.x - prevTrue.x, tr.z - prevTrue.z);
      pops.push(Math.max(0, drawn - real));
    }
    prev = { x: out.x, z: out.z };
    prevTrue = tr;
  }
  const q = (a, p) => [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) * p)];
  const total = Object.values(modes).reduce((a, b) => a + b, 0);
  const res = {
    p50: q(errors, 0.5), p95: q(errors, 0.95), max: Math.max(...errors),
    pop95: q(pops, 0.95), popMax: Math.max(...pops),
    delay: delays.reduce((a, b) => a + b, 0) / delays.length,
    extrap: ((modes.extrap || 0) / total) * 100, hold: ((modes.hold || 0) / total) * 100,
  };
  const ok = res.p95 <= sc.maxP95 && res.pop95 <= sc.maxPop;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${sc.name.padEnd(14)} lag ${String(sc.lag).padStart(3)}±${String(sc.jitter).padEnd(2)} loss ${(sc.loss * 100).toFixed(0).padStart(2)}%  ` +
      `error p50 ${res.p50.toFixed(3)} p95 ${res.p95.toFixed(3)} max ${res.max.toFixed(2)} m · ` +
      `pop p95 ${res.pop95.toFixed(3)} max ${res.popMax.toFixed(2)} m · delay ${res.delay.toFixed(0)} ms · ` +
      `extrap ${res.extrap.toFixed(1)}% hold ${res.hold.toFixed(1)}%`,
  );
  return ok;
}

let allOk = true;
for (const sc of SCENARIOS) allOk = run(sc) && allOk;
process.exit(allOk ? 0 : 1);
