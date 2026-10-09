// Extracted PDF data -> three.js scene graph.
//
// World axes: X = page right, Z = page down, Y = up. The page's top-left corner is the origin,
// so a PDF point (x, y) lands at world (x * s, 0, y * s). That keeps the minimap trivial.
//
// Every distinct glyph outline becomes ONE extruded geometry (1 unit tall) shared by all the
// letters that use it through an InstancedMesh. Each letter = one instance = one "entity" that
// can later be damaged / hidden individually.

import * as THREE from "three";
import { pathToPolygons } from "../pdf/outlines.js";
import { pieceFootprint } from "./collision.js";
import { makeHeightFn, findSpawn } from "./layout.js";

/**
 * @param {ReturnType<typeof import("../pdf/extract.js").extractPdf> extends Promise<infer T> ? T : never} pdf
 * @param {typeof import("../config.js").config} cfg
 * @param {THREE.WebGLRenderer} renderer
 */
export function buildWorld(pdf, cfg, renderer) {
  const s = cfg.metersPerPt;
  const W = pdf.pageW * s;
  const D = pdf.pageH * s;

  const root = new THREE.Group();
  root.name = "world";
  const letters = new THREE.Group(); // everything that rises out of the page
  letters.name = "letters";
  root.add(letters);

  /** @type {Entity[]} */
  const entities = [];

  // ---------------------------------------------------------------- glyphs & vector fills
  const heightOf = makeHeightFn(pdf, cfg);

  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.05 });
  const materialMirrored = material.clone();
  materialMirrored.side = THREE.BackSide; // instances whose transform mirrors the outline

  // group pieces by (outline, mirrored?)
  const groups = new Map();
  for (const p of pdf.pieces) {
    const [a, b, c, d] = p.m;
    const mirrored = -(a * d - b * c) < 0; // see matrix below: det = -H s^2 (ad - bc)
    const key = `${p.pathId}|${mirrored ? 1 : 0}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { pathId: p.pathId, mirrored, pieces: [] }));
    g.pieces.push(p);
  }

  const geoCache = new Map();
  const outlines = new Map(); // pathId -> polygons in PDF local units (shared by render + collision)
  const outlineOf = (pathId) => {
    let o = outlines.get(pathId);
    if (!o) outlines.set(pathId, (o = pathToPolygons(pdf.paths[pathId], cfg.curveSteps)));
    return o;
  };
  const tmp = new THREE.Matrix4();
  const col = new THREE.Color();
  let triangles = 0;

  for (const g of groups.values()) {
    let geo = geoCache.get(g.pathId);
    if (geo === undefined) {
      geo = outlineGeometry(outlineOf(g.pathId));
      geoCache.set(g.pathId, geo);
    }
    if (!geo) continue;

    const mesh = new THREE.InstancedMesh(geo, g.mirrored ? materialMirrored : material, g.pieces.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `glyph-${g.pathId}`;

    g.pieces.forEach((p, i) => {
      const H = heightOf(p);
      const [a, b, c, d, e, f] = p.m;
      // outline local (gx, gy) was rotated to (X', Y', Z') = (gx, extrude, -gy); map to world:
      //   X = s(a gx + c gy + e),  Y = H * extrude,  Z = s(b gx + d gy + f)
      tmp.set(
        s * a, 0, -s * c, s * e,
        0,     H, 0,      0,
        s * b, 0, -s * d, s * f,
        0,     0, 0,      1,
      );
      mesh.setMatrixAt(i, tmp);
      col.setRGB(...lift(p.color, cfg.inkLift), THREE.SRGBColorSpace);
      mesh.setColorAt(i, col);

      entities.push({
        id: entities.length,
        kind: p.isGlyph ? "glyph" : "shape",
        mesh,
        index: i,
        matrix: tmp.clone(),
        color: p.color,
        height: H,
        // footprint in world metres
        box: { minX: p.box[0] * s, minZ: p.box[1] * s, maxX: p.box[2] * s, maxZ: p.box[3] * s },
        pageBox: p.box,
        piece: p, // outline + matrix, used to burn the ink off the paper
        alive: true,
        hp: hpFor(H),
        maxHp: hpFor(H),
        footprint: () => pieceFootprint(outlineOf(p.pathId), p.m, s),
      });
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    triangles += (geo.index ? geo.index.count : geo.attributes.position.count) / 3 * g.pieces.length;
    letters.add(mesh);
  }

  // ---------------------------------------------------------------- rules -> thin walls
  if (pdf.segments.length) {
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0); // base on the floor
    const ruleMesh = new THREE.InstancedMesh(box, material, pdf.segments.length);
    ruleMesh.castShadow = true;
    ruleMesh.receiveShadow = true;
    ruleMesh.name = "rules";
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    pdf.segments.forEach((seg, i) => {
      const ax = seg.a[0] * s, az = seg.a[1] * s, bx = seg.b[0] * s, bz = seg.b[1] * s;
      const len = Math.hypot(bx - ax, bz - az);
      const thick = Math.max(seg.width * s, cfg.ruleMinThickness);
      pos.set((ax + bx) / 2, 0, (az + bz) / 2);
      quat.setFromAxisAngle(up, -Math.atan2(bz - az, bx - ax));
      scl.set(len, cfg.ruleHeight, thick);
      tmp.compose(pos, quat, scl);
      ruleMesh.setMatrixAt(i, tmp);
      col.setRGB(...lift(seg.color, cfg.inkLift), THREE.SRGBColorSpace);
      ruleMesh.setColorAt(i, col);
      const hx = Math.abs(Math.cos(Math.atan2(bz - az, bx - ax))) * len / 2 + thick / 2;
      const hz = Math.abs(Math.sin(Math.atan2(bz - az, bx - ax))) * len / 2 + thick / 2;
      entities.push({
        id: entities.length,
        kind: "rule",
        mesh: ruleMesh,
        index: i,
        matrix: tmp.clone(),
        color: seg.color,
        height: cfg.ruleHeight,
        box: { minX: pos.x - hx, minZ: pos.z - hz, maxX: pos.x + hx, maxZ: pos.z + hz },
        pageBox: [pos.x / s - hx / s, pos.z / s - hz / s, pos.x / s + hx / s, pos.z / s + hz / s],
        alive: true,
        hp: hpFor(cfg.ruleHeight),
        maxHp: hpFor(cfg.ruleHeight),
        footprint: ruleFootprint(ax, az, bx, bz, thick),
      });
    });
    ruleMesh.instanceMatrix.needsUpdate = true;
    if (ruleMesh.instanceColor) ruleMesh.instanceColor.needsUpdate = true;
    ruleMesh.computeBoundingSphere();
    letters.add(ruleMesh);
  }

  // ---------------------------------------------------------------- floor = the page itself
  const pageTex = new THREE.CanvasTexture(pdf.raster);
  pageTex.colorSpace = THREE.SRGBColorSpace;
  pageTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  pageTex.generateMipmaps = true;
  pageTex.minFilter = THREE.LinearMipmapLinearFilter;
  const paper = new THREE.Mesh(
    new THREE.PlaneGeometry(W, D),
    // no polygonOffset here: at eye level it grows with distance and let the desk below show
    // through past ~7 m. The intro avoids ink/letter z-fighting by moving the near plane instead.
    new THREE.MeshStandardMaterial({ map: pageTex, roughness: 0.92, metalness: 0 }),
  );
  paper.rotation.x = -Math.PI / 2;
  paper.position.set(W / 2, 0, D / 2);
  paper.receiveShadow = true;
  paper.name = "paper";
  root.add(paper);

  // the "desk" around the page
  const desk = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 6, D * 6),
    new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 1 }),
  );
  desk.rotation.x = -Math.PI / 2;
  desk.position.set(W / 2, -0.25, D / 2); // well below the paper: no depth fighting at any distance
  desk.receiveShadow = true;
  root.add(desk);

  // ---------------------------------------------------------------- lights
  const hemi = new THREE.HemisphereLight(0xdfe6ff, 0x2a2622, 1.1);
  root.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.6);
  const span = Math.max(W, D);
  sun.position.set(W / 2 - span * 0.35, span * 0.6, D / 2 + span * 0.25);
  sun.target.position.set(W / 2, 0, D / 2);
  sun.castShadow = true;
  const shadowSize = cfg.gfx?.shadowMapSize ?? 4096; // smaller on phones (config.graphics)
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  const half = span * 0.62;
  Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: span * 2.5 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  root.add(sun, sun.target);

  const spawn = findSpawn(entities, W, D, cfg.player.radius);

  return {
    root,
    letters,
    entities,
    size: { W, D },
    spawn,
    pageTexture: pageTex,
    stats: { entities: entities.length, drawCalls: letters.children.length, triangles: Math.round(triangles) },
  };
}

/** @typedef {{id:number, kind:string, mesh:THREE.InstancedMesh, index:number, matrix:THREE.Matrix4,
 *   color:number[], height:number, box:{minX:number,minZ:number,maxX:number,maxZ:number},
 *   pageBox:number[], alive:boolean, hp:number}} Entity */

// ------------------------------------------------------------------------------------------------

/** shots to destroy: body text 2, the name ~7, rules 1 */
function hpFor(height) {
  return Math.max(1, Math.round(height * 1.6));
}

function ruleFootprint(ax, az, bx, bz, thick) {
  return () => {
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const nx = (-(bz - az) / len) * (thick / 2), nz = ((bx - ax) / len) * (thick / 2);
    return [{ outer: [[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]], holes: [] }];
  };
}

function outlineGeometry(polys) {
  if (!polys.length) return null;
  const shapes = polys.map((p) => {
    const shape = new THREE.Shape(p.outer.map(([x, y]) => new THREE.Vector2(x, y)));
    for (const h of p.holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
    return shape;
  });
  const geo = new THREE.ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: false, steps: 1, curveSegments: 1 });
  geo.rotateX(-Math.PI / 2); // (x, y, z) -> (x, z, -y): extrusion now points up
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

function lift(c, k) {
  return [c[0] + (1 - c[0]) * k, c[1] + (1 - c[1]) * k, c[2] + (1 - c[2]) * k];
}
