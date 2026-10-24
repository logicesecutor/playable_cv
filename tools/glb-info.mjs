// Print what a .glb holds: nodes, materials, triangles per material, UVs, emissive parts.
//   node tools/glb-info.mjs public/models/office.glb
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "public/models/office.glb";
const b = readFileSync(file);
const j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
const trisOf = (p) => (p.indices !== undefined ? j.accessors[p.indices].count : j.accessors[p.attributes.POSITION].count) / 3;

const perMaterial = new Map();
let total = 0;
let noUv = 0;
for (const n of j.nodes ?? []) {
  if (n.mesh === undefined) continue;
  let tris = 0;
  for (const p of j.meshes[n.mesh].primitives) {
    const t = trisOf(p);
    tris += t;
    perMaterial.set(p.material, (perMaterial.get(p.material) ?? 0) + t);
    if (!p.attributes.TEXCOORD_0) noUv++;
  }
  total += tris;
  console.log(`node ${n.name}: ${tris} tris, at [${(n.translation ?? [0, 0, 0]).map((v) => v.toFixed(3))}]`);
}
console.log(`\n${total} triangles, ${j.materials?.length ?? 0} materials, ${noUv} primitives without UVs, extensions: ${j.extensionsUsed ?? "none"}`);

const hex = (c) => "#" + c.slice(0, 3).map((v) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)).toString(16).padStart(2, "0")).join("");
console.log("\nmaterial            colour   rough metal emission  tris  texture set (extras)");
(j.materials ?? []).forEach((m, i) => {
  const pbr = m.pbrMetallicRoughness ?? {};
  const strength = m.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1;
  const emit = Math.max(...(m.emissiveFactor ?? [0, 0, 0])) * strength;
  console.log(`${m.name.padEnd(19)} ${hex(pbr.baseColorFactor ?? [1, 1, 1])} ${(pbr.roughnessFactor ?? 1).toFixed(2).padStart(5)} ${(pbr.metallicFactor ?? 1).toFixed(2).padStart(5)} ${emit ? emit.toFixed(2).padStart(8) : "       -"} ${String(perMaterial.get(i) ?? 0).padStart(5)}  ${m.extras?.set ? `${m.extras.set} + ${m.extras.micro} x${m.extras.microRepeat}` : ""}`);
});
