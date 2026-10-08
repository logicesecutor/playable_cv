// Fingerprint of a built map, to check that a guest's browser turned the CV into the same
// world as the host's. Entity ids index everything that gets synced later (which letter was
// hit, which one died), so host and guests must agree on them.
//
//   count  number of entities: if this differs, ids can't line up and the guest can't play
//   hash   kinds + glyph ids + footprints rounded to 10 cm. A difference here is only logged:
//          different JS engines may round a few last digits differently.

/** @param {{entities: {kind:string, box:{minX:number,minZ:number,maxX:number,maxZ:number}, height:number, piece?:{pathId:number}}[]}} world */
export function mapFingerprint(world) {
  let h = 0x811c9dc5; // FNV-1a, 32 bit
  const mix = (n) => {
    h ^= n & 0xffff;
    h = Math.imul(h, 0x01000193);
    h ^= (n >>> 16) & 0xffff;
    h = Math.imul(h, 0x01000193);
  };
  const KIND = { glyph: 1, shape: 2, rule: 3 };
  for (const e of world.entities) {
    mix(KIND[e.kind] || 0);
    mix(e.piece ? e.piece.pathId : -1);
    const b = e.box;
    mix(Math.round(b.minX * 10));
    mix(Math.round(b.minZ * 10));
    mix(Math.round(b.maxX * 10));
    mix(Math.round(b.maxZ * 10));
    mix(Math.round(e.height * 10));
  }
  return { count: world.entities.length, hash: (h >>> 0).toString(16).padStart(8, "0") };
}
