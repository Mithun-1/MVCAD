import { Box3, Vector3 } from 'three';

/** World bounds of model content. Future curves/solids can union their bounds into this box. */
export function pointContentBounds(sets: Iterable<ArrayLike<number>>): Box3 {
  const bounds = new Box3();
  const point = new Vector3();
  for (const positions of sets) {
    for (let i = 0; i < positions.length; i += 3) {
      bounds.expandByPoint(point.set(positions[i], positions[i + 1], positions[i + 2]));
    }
  }
  return bounds;
}

/** Size only the displayed patch; the infinite reference plane and its frame do not change. */
export function planeDisplayBounds(frame: number[], content: Box3) {
  if (content.isEmpty()) return { width: 140, height: 140, centerU: 0, centerV: 0 };
  const origin = new Vector3(...frame.slice(0, 3));
  const u = new Vector3(...frame.slice(3, 6));
  const v = new Vector3(...frame.slice(6, 9));
  const point = new Vector3();
  let minU = Infinity,
    maxU = -Infinity,
    minV = Infinity,
    maxV = -Infinity;
  for (const x of [content.min.x, content.max.x]) {
    for (const y of [content.min.y, content.max.y]) {
      for (const z of [content.min.z, content.max.z]) {
        point.set(x, y, z).sub(origin);
        const pu = point.dot(u),
          pv = point.dot(v);
        minU = Math.min(minU, pu);
        maxU = Math.max(maxU, pu);
        minV = Math.min(minV, pv);
        maxV = Math.max(maxV, pv);
      }
    }
  }
  const size = content.getSize(point);
  const scale = Math.max(size.x, size.y, size.z) || 10;
  // Keep edge-on, collinear, and single-point data readable without forcing a 140-unit patch.
  const spanU = Math.max(maxU - minU, scale * 0.1, 1e-6);
  const spanV = Math.max(maxV - minV, scale * 0.1, 1e-6);
  return {
    width: spanU * 1.16,
    height: spanV * 1.16,
    centerU: (minU + maxU) / 2,
    centerV: (minV + maxV) / 2,
  };
}
