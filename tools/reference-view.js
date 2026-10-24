// Evaluated in the game page by tools/shot.mjs (see tools/reference.mjs): freezes the animations,
// lets the traced image converge, and returns what blender_src/scripts/render_reference.py needs to
// render the same view in Cycles: the camera, the sun, the posed player (world positions, skinned normals,
// UVs, material names per triangle) and the converged linear radiance in 8×8-pixel block means.
(async () => {
  const g = __game, scene = g.scene, camera = g.player.camera, wait = (ms) => new Promise((r) => setTimeout(r, ms));
  scene.animationsEnabled = false; // the idling figure would restart its pixels every frame
  const samples = SAMPLES;
  for (let n = 0; n < samples; ) {
    await wait(1000);
    const r = await g.tracer.radiance.readPixels();
    n = r[3]; // pixel 0's count: every still pixel has the same
  }
  const w = g.gbuffer.mrt.getRenderWidth(), h = g.gbuffer.mrt.getRenderHeight();

  // the player: positions from the ray tracer's copy, normals skinned here the same way (no translation)
  const pose = g.rt.pose();
  const body = g.player.model.getChildMeshes().filter((m) => m.getTotalVertices() > 0);
  const normals = [], uvs = [];
  for (const m of body) {
    const nrm = m.getVerticesData("normal"), uv = m.getVerticesData("uv");
    const idx = m.getVerticesData("matricesIndices"), wt = m.getVerticesData("matricesWeights");
    const bones = m.skeleton.getTransformMatrices(m), world = m.getWorldMatrix().m;
    for (let v = 0; v < nrm.length / 3; v++) {
      const M = new Float32Array(16);
      for (let k = 0; k < 4; k++) for (let j = 0; j < 16; j++) M[j] += wt[4 * v + k] * bones[16 * idx[4 * v + k] + j];
      const [x, y, z] = [0, 1, 2].map((c) => nrm[3 * v] * M[c] + nrm[3 * v + 1] * M[4 + c] + nrm[3 * v + 2] * M[8 + c]);
      const n = [0, 1, 2].map((c) => x * world[c] + y * world[4 + c] + z * world[8 + c]);
      const l = Math.hypot(...n);
      normals.push(...n.map((c) => c / l));
      uvs.push(uv[2 * v], uv[2 * v + 1]);
    }
  }

  // the image, linear, block means (readPixels rows go bottom-up: flip)
  const r = await g.tracer.radiance.readPixels();
  const B = 8, bw = Math.floor(w / B), bh = Math.floor(h / B), blocks = [];
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const s = [0, 0, 0];
      for (let y = by * B; y < by * B + B; y++) {
        for (let x = bx * B; x < bx * B + B; x++) {
          const i = 4 * ((h - 1 - y) * w + x);
          for (let c = 0; c < 3; c++) s[c] += r[i + c] / (B * B);
        }
      }
      blocks.push(...s.map((v) => +v.toFixed(5)));
    }
  }

  const target = camera.getTarget();
  return {
    size: [w, h],
    camera: { position: camera.globalPosition.asArray(), target: target.asArray(), fov: camera.fov },
    sun: g.tracer.sun,
    samples: r[3],
    player: {
      verts: Array.from(pose.verts, (v) => +v.toFixed(5)),
      normals: normals.map((v) => +v.toFixed(4)),
      uvs: uvs.map((v) => +v.toFixed(5)),
      corners: Array.from(pose.corners),
      materials: Array.from(pose.mats, (id) => g.gbuffer.materials[id - 1].name),
    },
    blocks: { size: B, width: bw, height: bh, rgb: blocks },
  };
})()
