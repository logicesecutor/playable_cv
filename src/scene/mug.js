import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";

const SHOVE = 7; // u/s of push near the rim: 5 rocks the mug back, 7 lays it on its side

/** F shoves the mug over, away from the player; R puts the mug and every loose prop back. */
export function mugControls(office, player) {
  const shove = () => {
    const { mesh, body } = office.mug;
    const dir = mesh.position.subtract(player.position);
    dir.y = 0;
    dir.normalize();
    const rim = mesh.position.add(new Vector3(0, 8, 0)); // the mug is 9 u tall, origin at its base
    body.applyImpulse(dir.scale(body.getMassProperties().mass * SHOVE), rim);
  };
  addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.code === "KeyF") shove();
    if (e.code === "KeyR") office.reset();
  });
  return { shove };
}
