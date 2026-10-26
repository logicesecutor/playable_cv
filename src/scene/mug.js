import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";

const SHOVE = 17; // u/s of push near the rim, for the mug alone: a full mug (its coffee steadies it, M11) goes over in ~3 s
const SHOVE_TIME = 0.3; // s: a push, not a blow: a mug kicked in one step spins up before its coffee (a frame behind) can hold it back

/** F shoves the mug over, away from the player; R puts the mug and every loose prop back. */
export function mugControls(office, player) {
  const scene = office.mug.mesh.getScene(), physics = scene.getPhysicsEngine();
  const shove = () => {
    const { mesh, body } = office.mug;
    const dir = mesh.position.subtract(player.position);
    dir.y = 0;
    dir.normalize();
    const total = body.getMassProperties().mass * SHOVE;
    let left = SHOVE_TIME;
    const pushing = scene.onBeforePhysicsObservable.add(() => {
      const dt = Math.min(physics.getTimeStep(), left);
      left -= dt;
      const rim = Vector3.TransformCoordinates(new Vector3(0, 8, 0), mesh.computeWorldMatrix(true)); // the mug is 9 u tall, origin at its base
      body.applyImpulse(dir.scale((total * dt) / SHOVE_TIME), rim);
      if (left <= 0) scene.onBeforePhysicsObservable.remove(pushing);
    });
  };
  addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.code === "KeyF") shove();
    if (e.code === "KeyR") office.reset();
  });
  return { shove };
}
