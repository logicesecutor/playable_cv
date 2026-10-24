import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import "@babylonjs/loaders/glTF/index.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate.js";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody.js";
import { PhysicsShapeBox, PhysicsShapeContainer, PhysicsShapeConvexHull, PhysicsShapeCylinder } from "@babylonjs/core/Physics/v2/physicsShape.js";
import { PhysicsMotionType, PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin.js";

/** The office is modelled in real metres; world units are the 2 cm figure's metres. */
export const SCALE = 90;
const NO_COLLIDER = /^(Lights|Screens)/; // ceiling panels and window panes: out of reach

/**
 * Load office.glb at ×90: static mesh colliders for the room, loose rigid bodies for the nodes the
 * export marked `dynamic` (the mug, the desk clutter). Returns { mug, bodies, reset() }.
 */
export async function loadOffice(scene) {
  const c = await LoadAssetContainerAsync("models/office.glb", scene);
  c.addAllToScene();
  c.meshes[0].scaling.setAll(SCALE); // __root__
  c.meshes[0].computeWorldMatrix(true);
  previewMaterials(scene, c.materials);

  const bodies = [];
  const loose = new Set();
  for (const node of [...c.transformNodes, ...c.meshes]) {
    const extras = node.metadata?.gltf?.extras;
    if (!extras?.dynamic) continue;
    const mesh = makeDynamic(node, extras, scene);
    bodies.push({ name: node.name, mesh, body: mesh.physicsBody, pos: mesh.position.clone(), rot: mesh.rotationQuaternion.clone() });
    loose.add(mesh);
  }
  for (const m of c.meshes) {
    if (m.isDisposed() || loose.has(m) || !m.getTotalVertices() || NO_COLLIDER.test(m.name)) continue;
    m.setParent(null);
    m.bakeCurrentTransformIntoVertices();
    m.refreshBoundingInfo();
    new PhysicsAggregate(m, PhysicsShapeType.MESH, { mass: 0 }, scene);
  }

  return {
    bodies,
    mug: bodies.find((b) => b.name === "Mug"),
    /** Put every loose body back where the export placed it, at rest. */
    reset() {
      for (const b of bodies) {
        b.body.disablePreStep = false;
        b.mesh.position.copyFrom(b.pos);
        b.mesh.rotationQuaternion.copyFrom(b.rot);
        b.body.setLinearVelocity(Vector3.ZeroReadOnly);
        b.body.setAngularVelocity(Vector3.ZeroReadOnly);
      }
      scene.onAfterPhysicsObservable.addOnce(() => bodies.forEach((b) => (b.body.disablePreStep = true)));
    },
  };
}

/** One mesh per loose node (its primitives merged), origin where the export put it, real mass. */
function makeDynamic(node, extras, scene) {
  const origin = node.computeWorldMatrix(true).getTranslation(); // forced: the cached one predates the ×90
  const parts = [node, ...node.getChildMeshes()].filter((m) => m.getTotalVertices?.() > 0);
  let mesh;
  if (parts.length > 1) {
    mesh = Mesh.MergeMeshes(parts, true, true, undefined, false, true); // bakes world transforms
    node.dispose();
  } else {
    mesh = parts[0];
    mesh.setParent(null);
    mesh.bakeCurrentTransformIntoVertices();
  }
  mesh.name = node.name;
  mesh.bakeTransformIntoVertices(Matrix.Translation(-origin.x, -origin.y, -origin.z));
  mesh.position.copyFrom(origin);
  mesh.rotationQuaternion = Quaternion.Identity();
  mesh.refreshBoundingInfo(); // the bakes leave stale bounds: the mesh would be culled
  const body = new PhysicsBody(mesh, PhysicsMotionType.DYNAMIC, false, scene);
  // real densities (kg/m³) in player metres; Havok derives mass and inertia together from them
  body.shape = extras.cup ? cupShape(extras.cup, extras.density, scene) : new PhysicsShapeConvexHull(mesh, scene);
  body.shape.density = extras.density;
  return mesh;
}

/**
 * A hollow cup: a disc for the bottom and a ring of boxes for the wall, so things can fall in.
 * `cup` = [outer radius, height, wall, bottom, base y] in real metres.
 * shortcut: the mug's handle has no collider, add a box child if props should catch on it.
 */
function cupShape(cup, density, scene) {
  const [r, h, wall, bottom, base] = cup.map((v) => v * SCALE);
  const shape = new PhysicsShapeContainer(scene);
  const add = (child) => {
    child.density = density;
    shape.addChild(child);
  };
  add(new PhysicsShapeCylinder(new Vector3(0, base, 0), new Vector3(0, base + bottom, 0), r, scene));
  const n = 16;
  const width = 2 * r * Math.tan(Math.PI / n) * 1.05; // a little overlap: no gaps between the boxes
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const at = new Vector3(Math.cos(a) * (r - wall / 2), base + h / 2, Math.sin(a) * (r - wall / 2));
    add(new PhysicsShapeBox(at, Quaternion.RotationAxis(Vector3.Up(), -a), new Vector3(wall, h, width), scene));
  }
  return shape;
}

/** M3 preview until the ray tracer lights the scene (M6): unlit albedo, macro texture only. */
function previewMaterials(scene, materials) {
  const albedo = {};
  for (const m of materials) {
    m.unlit = true;
    const set = m.metadata?.gltf?.extras?.set;
    if (set) {
      m.albedoTexture = albedo[set] ??= new Texture(`textures/${set}_albedo.jpg`, scene);
      m.albedoTexture.anisotropicFilteringLevel = 8;
    }
  }
}
