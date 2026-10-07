// Pure layout helpers shared by the 3D world and the Node tests.

/** extrusion height (m) for a piece: body text = cfg.bodyHeight, bigger fonts taller */
export function makeHeightFn(pdf, cfg) {
  const sizes = pdf.pieces.filter((p) => p.isGlyph).map((p) => p.fontSize).sort((a, b) => a - b);
  const ref = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 10; // median = body text
  return (p) =>
    p.isGlyph
      ? Math.max(cfg.minHeight, cfg.bodyHeight * Math.pow(p.fontSize / ref, cfg.heightExponent))
      : cfg.vectorHeight;
}

/** Nearest empty spot to the middle of the page, with clearance around it. */
export function findSpawn(bodies, W, D, radius = 0.35) {
  const clearance = Math.max(1.2, radius * 3);
  const blocked = (x, z) =>
    x < 2 || z < 2 || x > W - 2 || z > D - 2 ||
    bodies.some((e) => x > e.box.minX - clearance && x < e.box.maxX + clearance && z > e.box.minZ - clearance && z < e.box.maxZ + clearance);
  const cx = W / 2, cz = D * 0.55;
  for (let r = 0; r < Math.max(W, D); r += 0.75) {
    const steps = Math.max(1, Math.round((2 * Math.PI * r) / 0.75));
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (!blocked(x, z)) return { x, z };
    }
  }
  return { x: cx, z: D - 2 };
}
