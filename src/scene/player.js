import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import "@babylonjs/loaders/glTF/index.js";
import "@babylonjs/core/Animations/animatable.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { PhysicsCharacterController, CharacterSupportedState } from "@babylonjs/core/Physics/v2/characterController.js";
import { PhysicsRaycastResult } from "@babylonjs/core/Physics/physicsRaycastResult.js";

const HEIGHT = 1.8; // the figure, in its own metres (2 cm real)
const MODEL_HEIGHT = 2.09; // player_corporate.glb as exported
const RADIUS = 0.3;
const SPEED = { walk: 1.6, run: 4.5, crouch: 0.8 }; // u/s
const JUMP = 0.9; // u
const G = 9.81;
const SHOULDER = new Vector3(0.6, 1.6, 0); // camera pivot from the feet: right, up
const LOOP_CLIPS = ["Idle", "Walk", "Run", "Jump", "Crouch", "CrouchWalk"];

/**
 * player_corporate on a Havok character controller, third-person over-the-shoulder camera with
 * pointer lock. WASD relative to the camera, the figure turns to where it walks; Shift runs,
 * Space jumps, C crouches, the wheel zooms 2–10 u.
 */
export async function createPlayer(scene, canvas, spawn, lookAt) {
  const c = await LoadAssetContainerAsync("models/player_corporate.glb", scene);
  c.addAllToScene();
  const model = c.meshes[0]; // __root__
  model.scaling.setAll(HEIGHT / MODEL_HEIGHT);
  model.rotationQuaternion = null; // facing through rotation.y
  const clips = Object.fromEntries(c.animationGroups.map((g) => [g.name.split("|")[1], g]));
  c.animationGroups.forEach((g) => g.stop());
  for (const name of LOOP_CLIPS) {
    clips[name].start(true);
    clips[name].weight = name === "Idle" ? 1 : 0;
  }

  const ctrl = new PhysicsCharacterController(spawn.clone(), { capsuleHeight: HEIGHT, capsuleRadius: RADIUS }, scene);
  ctrl.characterMass = 70;
  ctrl.characterStrength = 700; // N: the default (1e38) would shove a mug of hundreds of tonnes
  ctrl.maxStepHeight = 0.35;

  const keys = new Set();
  addEventListener("keydown", (e) => keys.add(e.code));
  addEventListener("keyup", (e) => keys.delete(e.code));
  addEventListener("blur", () => keys.clear());
  const key = (code) => keys.has(code);

  const toTarget = lookAt.subtract(spawn);
  let yaw = Math.atan2(-toTarget.x, -toTarget.z); // camera looks along (-sin yaw, ., -cos yaw)
  let pitch = 0.25;
  let dist = 3.5;
  canvas.addEventListener("click", () => canvas.requestPointerLock());
  addEventListener("mousemove", (e) => {
    if (document.pointerLockElement !== canvas) return;
    yaw -= e.movementX * 0.0025;
    pitch = Math.min(1.4, Math.max(-1.2, pitch + e.movementY * 0.0025));
  });
  canvas.addEventListener("wheel", (e) => {
    dist = Math.min(10, Math.max(2, dist * Math.exp(e.deltaY * 0.001)));
    e.preventDefault();
  }, { passive: false });

  const camera = new UniversalCamera("camera", spawn.clone(), scene);
  camera.minZ = 0.05;
  camera.maxZ = 3000;
  camera.fov = 1.0;
  const ray = new PhysicsRaycastResult();
  const physics = scene.getPhysicsEngine();
  const up = Vector3.Up();
  const down = Vector3.Down();
  const gravity = new Vector3(0, -G, 0);
  let facing = yaw + Math.PI;

  scene.onAfterPhysicsObservable.add(() => {
    const dt = Math.min(scene.getEngine().getDeltaTime() / 1000, 0.05);
    if (!dt) return;
    const fwd = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const input = fwd.scale(+key("KeyW") - +key("KeyS")).addInPlace(right.scale(+key("KeyD") - +key("KeyA")));
    const moving = input.lengthSquared() > 0;
    if (moving) input.normalize();
    const crouch = key("KeyC");
    const speed = crouch ? SPEED.crouch : key("ShiftLeft") || key("ShiftRight") ? SPEED.run : SPEED.walk;

    const support = ctrl.checkSupport(dt, down);
    const grounded = support.supportedState === CharacterSupportedState.SUPPORTED;
    const v = ctrl.getVelocity();
    let out;
    if (grounded) {
      out = ctrl.calculateMovement(dt, fwd, support.averageSurfaceNormal, v, support.averageSurfaceVelocity, input.scale(speed), up);
      if (key("Space")) out.y = Math.sqrt(2 * G * JUMP);
    } else {
      out = ctrl.calculateMovement(dt, fwd, up, v, Vector3.ZeroReadOnly, input.scale(speed), up);
      out.y = v.y - G * dt; // integrate() only uses gravity for contacts
    }
    ctrl.setVelocity(out);
    ctrl.integrate(dt, support, gravity);

    // the figure: feet under the capsule, turning smoothly toward where it walks
    const pos = ctrl.getPosition();
    model.position.set(pos.x, pos.y - HEIGHT / 2, pos.z);
    if (moving) {
      const target = Math.atan2(input.x, input.z); // the model faces +Z
      facing += (Math.atan2(Math.sin(target - facing), Math.cos(target - facing))) * Math.min(1, dt * 10);
    }
    model.rotation.y = facing;
    const clip = !grounded ? "Jump" : crouch ? (moving ? "CrouchWalk" : "Crouch") : moving ? (speed === SPEED.run ? "Run" : "Walk") : "Idle";
    for (const name of LOOP_CLIPS) {
      const g = clips[name];
      g.weight += ((name === clip ? 1 : 0) - g.weight) * Math.min(1, dt * 8);
    }

    // camera over the right shoulder, pulled in when something is between it and the pivot
    const look = new Vector3(-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const pivot = model.position.add(right.scale(SHOULDER.x)).addInPlaceFromFloats(0, SHOULDER.y, 0);
    let d = dist;
    physics.raycastToRef(pivot, pivot.subtract(look.scale(dist)), ray);
    if (ray.hasHit) d = Math.max(0.3, ray.hitDistance - 0.2);
    camera.position.copyFrom(pivot.subtract(look.scale(d)));
    camera.setTarget(pivot.add(look));
  });

  return {
    camera,
    model,
    get position() {
      return ctrl.getPosition();
    },
  };
}
