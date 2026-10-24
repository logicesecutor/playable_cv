// Binary BVH over axis-aligned boxes, binned SAH. Plain JS: runs in the page, the worker and Node.
// Node = 8 words (32 B, the GPU layout): min xyz (f32), first (u32), max xyz (f32), count (u32).
// count > 0: a leaf over order[first .. first + count); count = 0: children at first and first + 1.

const BINS = 12;

/** boxes: Float32Array, 6 per primitive (min xyz, max xyz). Returns { nodes, order }. */
export function build(boxes, leafSize = 4) {
  const n = boxes.length / 6;
  const order = new Uint32Array(n).map((_, i) => i);
  const centre = new Float32Array(3 * n);
  for (let i = 0; i < 3 * n; i++) centre[i] = (boxes[(i / 3 | 0) * 6 + i % 3] + boxes[(i / 3 | 0) * 6 + 3 + i % 3]) / 2;
  const f = new Float32Array(8 * Math.max(1, 2 * n - 1));
  const u = new Uint32Array(f.buffer);
  let count = 1;
  const binBox = new Float32Array(6 * BINS);
  const binN = new Uint32Array(BINS);
  const rightArea = new Float32Array(BINS);
  const stack = [[0, 0, n]];
  while (stack.length) {
    const [node, start, end] = stack.pop();
    // bounds of the boxes and of their centres
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    const c = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = start; i < end; i++) {
      const p = order[i];
      for (let k = 0; k < 3; k++) {
        b[k] = Math.min(b[k], boxes[p * 6 + k]);
        b[k + 3] = Math.max(b[k + 3], boxes[p * 6 + 3 + k]);
        c[k] = Math.min(c[k], centre[p * 3 + k]);
        c[k + 3] = Math.max(c[k + 3], centre[p * 3 + k]);
      }
    }
    f.set(b.slice(0, 3), node * 8);
    f.set(b.slice(3), node * 8 + 4);
    const leaf = () => {
      u[node * 8 + 3] = start;
      u[node * 8 + 7] = end - start;
    };
    if (end - start <= leafSize) { leaf(); continue; }

    // best binned SAH split over the three axes
    let best = Infinity, bestAxis = -1, bestBin = 0;
    for (let axis = 0; axis < 3; axis++) {
      const lo = c[axis], extent = c[axis + 3] - lo;
      if (extent <= 0) continue;
      binBox.fill(Infinity);
      for (let k = 0; k < BINS; k++) binBox.fill(-Infinity, k * 6 + 3, k * 6 + 6);
      binN.fill(0);
      for (let i = start; i < end; i++) {
        const p = order[i];
        const k = Math.min(BINS - 1, ((centre[p * 3 + axis] - lo) / extent * BINS) | 0);
        binN[k]++;
        for (let j = 0; j < 3; j++) {
          binBox[k * 6 + j] = Math.min(binBox[k * 6 + j], boxes[p * 6 + j]);
          binBox[k * 6 + 3 + j] = Math.max(binBox[k * 6 + 3 + j], boxes[p * 6 + 3 + j]);
        }
      }
      // sweep from the right, then from the left: cost of splitting after bin k
      const acc = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      let nRight = 0;
      for (let k = BINS - 1; k > 0; k--) {
        grow(acc, binBox, k);
        nRight += binN[k];
        rightArea[k] = nRight ? area(acc) * nRight : 0;
      }
      acc.fill(Infinity, 0, 3).fill(-Infinity, 3);
      let nLeft = 0;
      for (let k = 0; k < BINS - 1; k++) {
        grow(acc, binBox, k);
        nLeft += binN[k];
        const cost = (nLeft ? area(acc) * nLeft : 0) + rightArea[k + 1];
        if (nLeft && nLeft < end - start && cost < best) [best, bestAxis, bestBin] = [cost, axis, k];
      }
    }
    let mid;
    if (bestAxis >= 0) {
      if (best >= area(b) * (end - start) && end - start <= 16) { leaf(); continue; } // splitting doesn't pay
      const lo = c[bestAxis], extent = c[bestAxis + 3] - lo;
      mid = start;
      for (let i = start; i < end; i++) {
        const p = order[i];
        if (Math.min(BINS - 1, ((centre[p * 3 + bestAxis] - lo) / extent * BINS) | 0) <= bestBin) {
          [order[i], order[mid]] = [order[mid], order[i]];
          mid++;
        }
      }
    } else {
      mid = (start + end) >> 1; // all centres coincide: any split will do
    }
    u[node * 8 + 3] = count;
    u[node * 8 + 7] = 0;
    stack.push([count, start, mid], [count + 1, mid, end]);
    count += 2;
  }
  return { nodes: f.slice(0, 8 * count), order };
}

/** Recompute every node box from its children (children always come after their parent). */
export function refit(nodes, boxes, order) {
  const u = new Uint32Array(nodes.buffer, nodes.byteOffset, nodes.length);
  for (let node = nodes.length / 8 - 1; node >= 0; node--) {
    const o = node * 8, first = u[o + 3], n = u[o + 7];
    const src = n ? boxes : nodes, stride = n ? 6 : 8, hi = n ? 3 : 4; // a leaf's boxes or 2 children
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = first; i < first + (n || 2); i++) {
      const p = (n && order ? order[i] : i) * stride;
      x0 = Math.min(x0, src[p]);
      y0 = Math.min(y0, src[p + 1]);
      z0 = Math.min(z0, src[p + 2]);
      x1 = Math.max(x1, src[p + hi]);
      y1 = Math.max(y1, src[p + hi + 1]);
      z1 = Math.max(z1, src[p + hi + 2]);
    }
    nodes[o] = x0;
    nodes[o + 1] = y0;
    nodes[o + 2] = z0;
    nodes[o + 4] = x1;
    nodes[o + 5] = y1;
    nodes[o + 6] = z1;
  }
}

/** Boxes of triangles given as 9 floats each. */
export function triangleBoxes(tris) {
  const n = tris.length / 9;
  const boxes = new Float32Array(6 * n);
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const a = tris[t * 9 + k], b = tris[t * 9 + 3 + k], c = tris[t * 9 + 6 + k];
      boxes[t * 6 + k] = Math.min(a, b, c);
      boxes[t * 6 + 3 + k] = Math.max(a, b, c);
    }
  }
  return boxes;
}

// grow box `acc` by entry i of `src` (min at i*stride, max at i*stride + maxAt)
function grow(acc, src, i, stride = 6, maxAt = 3) {
  for (let k = 0; k < 3; k++) {
    acc[k] = Math.min(acc[k], src[i * stride + k]);
    acc[k + 3] = Math.max(acc[k + 3], src[i * stride + maxAt + k]);
  }
}

function area(b) {
  const x = b[3] - b[0], y = b[4] - b[1], z = b[5] - b[2];
  return x * y + y * z + z * x;
}
