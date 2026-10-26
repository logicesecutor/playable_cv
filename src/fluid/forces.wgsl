// The coffee's push back on the bodies (M11), summed over a frame by the grid and G2P passes (after
// mpm.wgsl): per body an impulse and an angular impulse about its centre of mass, in particle mass ·
// u/s fixed-point (mpm.js turns them into kg·u/s and applies them in Havok).

@group(0) @binding(10) var<storage, read_write> forces : array<atomic<i32>>; // per body: impulse xyz, angular xyz, 2 unused
@group(0) @binding(11) var<storage, read> clock : array<u32>; // substeps begun this frame (clear counts them)

// this substep's time before the frame's end (mpm.wgsl)
fn setBack() { back = (params.walls.y - f32(clock[0])) * params.step.x; }

fn push(i : u32, p : vec3f, impulse : vec3f) {
  let j = impulse * IMPULSE_FIX;
  if (all(j == vec3f(0.0))) { return; }
  let angular = cross(p - bodies[i].centre.xyz, j);
  atomicAdd(&forces[8u * i], i32(round(j.x)));
  atomicAdd(&forces[8u * i + 1u], i32(round(j.y)));
  atomicAdd(&forces[8u * i + 2u], i32(round(j.z)));
  atomicAdd(&forces[8u * i + 3u], i32(round(angular.x)));
  atomicAdd(&forces[8u * i + 4u], i32(round(angular.y)));
  atomicAdd(&forces[8u * i + 5u], i32(round(angular.z)));
}
