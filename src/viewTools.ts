import { Box3, Plane, Ray, Triangle, Vector3 } from 'three';
import { MAX_OFFSET, type Document, type EvaluatedPlane } from './model.ts';
import type { SweepMesh } from './sweep.ts';

export type SectionView = { planeId: string; offset: number; keepAbove: boolean };
export type ActiveSectionView = SectionView & { id: string };
export type BoxSpacing = {
  distance: number;
  bodyPoint: number[];
  boxPoint: number[];
  face: string;
  body: number;
};
export const BOX_BASES = ['right', 'top', 'front'] as const;
export function boxDimensions(doc: Document): [number, number, number] | undefined {
  const ids = doc.boundingBox?.planeIds;
  if (!ids) return;
  const planes = ids.map((id) => doc.planes.find((p) => p.id === id));
  if (planes.some((p, i) => !p || p.parentId !== BOX_BASES[i] || p.offset <= 0)) return;
  return planes.map((p) => p!.offset) as [number, number, number];
}
export function setBoundingBox(doc: Document, dimensions: number[]): Document {
  if (dimensions.length !== 3 || dimensions.some((v) => !Number.isFinite(v) || v <= 0 || v > MAX_OFFSET))
    throw new Error(`Enter Lx, Ly, and Lz greater than 0 and at most ${MAX_OFFSET.toLocaleString()}.`);
  const ids = doc.boundingBox?.planeIds ?? [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const domain = doc.groups?.find((group) => BOX_BASES.every((id) => group.members.includes(id)));
  const baseNames = { ...doc.baseNames, right: 'Lx_0', top: 'Ly_0', front: 'Lz_0' };
  const reserved = new Set(['lx_0', 'ly_0', 'lz_0', ...(domain ? [] : ['computational domain'])]);
  if (
    [
      ...doc.planes,
      ...doc.pointSets,
      ...doc.curves,
      ...(doc.groups ?? []).filter((g) => g.id !== domain?.id),
    ].some((item) => reserved.has(item.name.toLowerCase()))
  )
    throw new Error(
      'Rename the existing feature using Lx_0, Ly_0, Lz_0, or Computational Domain before creating the bounding box.',
    );
  const names = new Set(
    [
      'origin',
      ...Object.values(baseNames),
      ...doc.planes.map((p) => p.name),
      ...doc.curves.map((p) => p.name),
      ...doc.pointSets.map((p) => p.name),
      ...(doc.groups ?? []).map((p) => p.name),
    ].map((n) => n.toLowerCase()),
  );
  const planes = [...doc.planes];
  ids.forEach((id, axis) => {
    const existing = planes.findIndex((p) => p.id === id);
    let name = ['Lx', 'Ly', 'Lz'][axis],
      suffix = 2;
    while (names.has(name.toLowerCase())) name = `${['Lx', 'Ly', 'Lz'][axis]} ${suffix++}`;
    names.add(name.toLowerCase());
    const plane = { id, name, parentId: BOX_BASES[axis], offset: dimensions[axis], visible: true };
    if (existing >= 0) {
      planes[existing] = { ...planes[existing], offset: dimensions[axis], visible: true };
      delete planes[existing].suppressed;
    } else planes.push(plane);
  });
  return {
    ...doc,
    planes,
    baseVisibility: { front: true, top: true, right: true },
    baseNames,
    groups: [
      {
        id: domain?.id ?? crypto.randomUUID(),
        name: domain?.name ?? 'Computational Domain',
        visible: true,
        members: BOX_BASES.flatMap((base, axis) => [base, ids[axis]]),
      },
      ...(doc.groups ?? [])
        .filter((group) => group.id !== domain?.id)
        .map((group) => ({
          ...group,
          members: group.members.filter(
            (id) => !BOX_BASES.includes(id as (typeof BOX_BASES)[number]) && !ids.includes(id),
          ),
        }))
        .filter((group) => group.members.length),
    ],
    boundingBox: { planeIds: ids as [string, string, string] },
  };
}

export function boundingPlanePatch(doc: Document, plane: EvaluatedPlane) {
  const size = boxDimensions(doc);
  if (!size || ![...BOX_BASES, ...doc.boundingBox!.planeIds].includes(plane.id)) return;
  const origin = new Vector3(...plane.frame.slice(0, 3));
  const u = new Vector3(...plane.frame.slice(3, 6)),
    v = new Vector3(...plane.frame.slice(6, 9));
  const us: number[] = [],
    vs: number[] = [];
  for (const x of [0, size[0]])
    for (const y of [0, size[1]])
      for (const z of [0, size[2]]) {
        const p = new Vector3(x, y, z).sub(origin);
        us.push(p.dot(u));
        vs.push(p.dot(v));
      }
  const minU = Math.min(...us),
    maxU = Math.max(...us),
    minV = Math.min(...vs),
    maxV = Math.max(...vs);
  return { width: maxU - minU, height: maxV - minV, centerU: (minU + maxU) / 2, centerV: (minV + maxV) / 2 };
}

export function sectionPlane(section: SectionView | undefined, geometry: EvaluatedPlane[]) {
  if (!section) return;
  const frame = geometry.find((p) => p.id === section.planeId)?.frame;
  if (!frame) return;
  const normal = new Vector3(...frame.slice(9, 12));
  const distance = normal.dot(new Vector3(...frame.slice(0, 3))) + section.offset;
  if (!section.keepAbove) normal.negate();
  return new Plane(normal, section.keepAbove ? -distance : distance);
}

export function sectionPlanes(sections: SectionView[], geometry: EvaluatedPlane[]): Plane[] {
  return sections.flatMap((section) => {
    const plane = sectionPlane(section, geometry);
    return plane ? [plane] : [];
  });
}

// Closest points on two finite line segments, including degenerate and parallel edges.
function edgeClosest(p: Vector3, q: Vector3, a: Vector3, b: Vector3): [Vector3, Vector3] {
  const d1 = q.clone().sub(p),
    d2 = b.clone().sub(a),
    r = p.clone().sub(a);
  const aa = d1.lengthSq(),
    ee = d2.lengthSq(),
    f = d2.dot(r);
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  let s = 0,
    t = 0;
  if (aa <= 1e-24) t = ee ? clamp(f / ee) : 0;
  else {
    const c = d1.dot(r);
    if (ee <= 1e-24) s = clamp(-c / aa);
    else {
      const dot = d1.dot(d2),
        denominator = aa * ee - dot * dot;
      if (denominator > 1e-24) s = clamp((dot * f - c * ee) / denominator);
      t = (dot * s + f) / ee;
      if (t < 0) {
        t = 0;
        s = clamp(-c / aa);
      } else if (t > 1) {
        t = 1;
        s = clamp((dot - c) / aa);
      }
    }
  }
  return [p.clone().addScaledVector(d1, s), a.clone().addScaledVector(d2, t)];
}

// Measure against the six finite box faces, using the actual solid/shell triangles.
export function measureBoxSpacing(
  mesh: SweepMesh,
  dimensions: [number, number, number],
): BoxSpacing | undefined {
  if (!mesh.indices.length) return;
  const origin = new Vector3(...mesh.origin),
    world = (i: number) => new Vector3().fromArray(mesh.positions, i * 3).add(origin);
  let best: BoxSpacing | undefined;
  const consider = (a: Vector3, b: Vector3, face: string, body: number) => {
    const distance = a.distanceTo(b);
    if (!best || distance < best.distance)
      best = { distance, bodyPoint: a.toArray(), boxPoint: b.toArray(), face, body };
  };
  const faces = dimensions.flatMap((length, axis) =>
    [0, length].map((value) => {
      const other = [0, 1, 2].filter((n) => n !== axis);
      const corners = [
        [0, 0],
        [dimensions[other[0]], 0],
        [dimensions[other[0]], dimensions[other[1]]],
        [0, dimensions[other[1]]],
      ].map(([u, v]) => {
        const p = new Vector3();
        p.setComponent(axis, value);
        p.setComponent(other[0], u);
        p.setComponent(other[1], v);
        return p;
      });
      return {
        axis,
        value,
        corners,
        box: new Box3().setFromPoints(corners),
        label: `${['X', 'Y', 'Z'][axis]} = ${value}`,
      };
    }),
  );
  const modelBounds = new Box3();
  const visited = new Uint8Array(mesh.positions.length / 3);
  // First find a vertex-to-face upper bound. For a contained body this is the exact result.
  for (const index of mesh.indices) {
    if (visited[index]) continue;
    visited[index] = 1;
    const p = world(index);
    modelBounds.expandByPoint(p);
    for (const face of faces) consider(p, face.box.clampPoint(p, new Vector3()), face.label, 0);
  }
  const box = new Box3(new Vector3(), new Vector3(...dimensions));
  if (!box.containsBox(modelBounds)) {
    const triangle = new Triangle(),
      ray = new Ray(),
      hit = new Vector3();
    for (let i = 0; i < mesh.indices.length && best!.distance > 1e-10; i += 3) {
      const vertices = [world(mesh.indices[i]), world(mesh.indices[i + 1]), world(mesh.indices[i + 2])];
      triangle.set(...(vertices as [Vector3, Vector3, Vector3]));
      const bounds = new Box3().setFromPoints(vertices);
      for (const face of faces) {
        const lower = [0, 1, 2].reduce(
          (sum, axis) =>
            sum +
            Math.max(
              0,
              bounds.min.getComponent(axis) - face.box.max.getComponent(axis),
              face.box.min.getComponent(axis) - bounds.max.getComponent(axis),
            ) **
              2,
          0,
        );
        if (lower >= best!.distance ** 2) continue;
        for (const p of face.corners)
          consider(triangle.closestPointToPoint(p, new Vector3()), p, face.label, 0);
        for (let j = 0; j < 3; j++) {
          const a = vertices[j],
            b = vertices[(j + 1) % 3],
            delta = b.getComponent(face.axis) - a.getComponent(face.axis);
          if (delta) {
            const t = (face.value - a.getComponent(face.axis)) / delta;
            if (t >= 0 && t <= 1) {
              const p = a.clone().lerp(b, t);
              if (face.box.distanceToPoint(p) < 1e-9) consider(p, p, face.label, 0);
            }
          }
          for (let k = 0; k < 4; k++) {
            const [p, q] = edgeClosest(a, b, face.corners[k], face.corners[(k + 1) % 4]);
            consider(p, q, face.label, 0);
          }
        }
        for (let k = 0; k < 4; k++) {
          const a = face.corners[k],
            b = face.corners[(k + 1) % 4],
            length = a.distanceTo(b);
          ray.set(a, b.clone().sub(a).normalize());
          if (
            ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, hit) &&
            hit.distanceTo(a) <= length + 1e-9
          )
            consider(hit, hit, face.label, 0);
        }
      }
    }
  }
  // Body ranges index the display mesh, so identify the measured surface point geometrically.
  if (best) {
    const p = new Vector3(...best.bodyPoint),
      triangle = new Triangle(),
      q = new Vector3();
    let minimum = Infinity;
    mesh.bodyRanges.forEach((range, body) => {
      for (let i = range.start; i < range.start + range.count; i += 3) {
        const vertices = [0, 1, 2].map((j) =>
          new Vector3().fromArray(mesh.renderPositions, mesh.renderIndices[i + j] * 3).add(origin),
        );
        triangle.set(...(vertices as [Vector3, Vector3, Vector3])).closestPointToPoint(p, q);
        const d = p.distanceToSquared(q);
        if (d < minimum) {
          minimum = d;
          best!.body = body;
        }
        if (minimum < 1e-16) break;
      }
    });
  }
  return best;
}
