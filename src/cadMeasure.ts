import * as cad from 'replicad';
import type { OpenCascadeInstance } from 'replicad-opencascadejs';
import type { CadFaceMeasurement, MeasureSelection, MeasureResult, MeasurePoint } from './measure.ts';

export function faceMeasurement(
  oc: OpenCascadeInstance,
  face: cad.Face,
  body: number,
  index: number,
): CadFaceMeasurement {
  const area = cad.measureArea(face);
  let diameter: number | undefined;
  if (face.geomType === 'CYLINDRE' || face.geomType === 'SPHERE') {
    const adaptor = new oc.BRepAdaptor_Surface(face.wrapped, false);
    const surface = face.geomType === 'CYLINDRE' ? adaptor.Cylinder() : adaptor.Sphere();
    try {
      diameter = surface.Radius() * 2;
    } finally {
      surface.delete();
      adaptor.delete();
    }
  } else if (face.geomType === 'PLANE') {
    const edges = face.edges;
    try {
      // Only an entire circular disk has one diameter. A trimmed disk or annulus does not.
      if (edges.length === 1 && edges[0].geomType === 'CIRCLE') {
        const adaptor = new oc.BRepAdaptor_Curve(edges[0].wrapped);
        const circle = adaptor.Circle();
        try {
          const radius = circle.Radius();
          if (Math.abs(area - Math.PI * radius ** 2) <= Math.max(1e-8, area * 1e-7)) diameter = radius * 2;
        } finally {
          circle.delete();
          adaptor.delete();
        }
      }
    } finally {
      edges.forEach((edge) => edge.delete());
    }
  }
  return { body, id: face.hashCode, index, area, diameter, surface: face.geomType };
}

export function measureCadDistance(breps: string[], selections: MeasureSelection[]): MeasureResult {
  const garbage: { delete(): void }[] = [];
  const own = <T extends { delete(): void }>(value: T): T => {
    garbage.push(value);
    return value;
  };
  try {
    const shapes = selections.map((selection) => {
      if (!selection.face) return own(cad.makeVertex(selection.position));
      const data = breps[selection.face.body];
      if (!data) throw new Error('This body is no longer available. Select it again.');
      const body = own(cad.deserializeShape(data));
      const faces = body.faces.map(own);
      const face = faces[selection.face.index];
      if (!face) throw new Error('This face changed. Select it again.');
      return face;
    });
    const tool = own(new cad.DistanceTool());
    const distance = tool.distanceBetween(shapes[0], shapes[1]);
    const a = own(tool.wrapped.PointOnShape1(1)),
      b = own(tool.wrapped.PointOnShape2(1));
    const tuple = (p: typeof a): MeasurePoint => [p.X(), p.Y(), p.Z()];
    return { distance, from: tuple(a), to: tuple(b), minimum: true };
  } finally {
    garbage.reverse().forEach((value) => value.delete());
  }
}
