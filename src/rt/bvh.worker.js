import { build, triangleBoxes } from "./bvh.js";

// Builds bottom-level BVHs off the main thread: in [triangles (9 floats each)], out [{ nodes, order }].
onmessage = ({ data }) => {
  const out = data.map((tris) => build(triangleBoxes(tris)));
  postMessage(out, out.flatMap((b) => [b.nodes.buffer, b.order.buffer]));
};
