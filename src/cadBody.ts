import * as cad from 'replicad';
import type { BRepBuilderAPI_MakeShape, OpenCascadeInstance } from 'replicad-opencascadejs';
import type { Document } from './model.ts';
import { resolvePoint, type EvaluatedCurve } from './curves.ts';
import { sweepPaths, type SweepMesh } from './sweep.ts';
import { faceMeasurement } from './cadMeasure.ts';

type Point = [number, number, number];
type Tag = { face: cad.Face; owner: number; cap: boolean };
type Input = Pick<Document, 'planes' | 'pointSets' | 'curves' | 'fillets'>;

// CAD shapes are authoritative. Triangulation below is only a display/measurement
// derivative; STEP export deserializes the unchanged B-Rep stored in cadBreps.
export function buildCadBody(
  oc: OpenCascadeInstance,
  doc: Input,
  evaluated: EvaluatedCurve[],
  removeCaps: boolean,
  progress: (value: number) => void = () => {},
): SweepMesh {
  cad.setOC(oc);
  const garbage: { delete(): void }[] = [];
  const own = <T extends { delete(): void }>(object: T): T => {
    garbage.push(object);
    return object;
  };
  const facesOf = (shape: cad.AnyShape) => shape.faces.map(own);
  const edgesOf = (shape: cad.AnyShape) => shape.edges.map(own);
  const valid = (shape: cad.AnyShape, stage: string) => {
    const checker = own(new oc.BRepCheck_Analyzer(shape.wrapped));
    if (!checker.IsValid())
      throw new Error(
        `${stage} produced an invalid B-Rep. Check the centerline, diameters, and junction rounding.`,
      );
  };
  const historyTags = (builder: BRepBuilderAPI_MakeShape, tags: Tag[]) =>
    tags.flatMap((tag) => {
      const modifications = own(new oc.NCollection_List_TopoDS_Shape(builder.Modified(tag.face.wrapped)));
      const result: Tag[] = [];
      while (!modifications.IsEmpty()) {
        const face = own(cad.cast(modifications.First()));
        if (face instanceof cad.Face) result.push({ ...tag, face });
        modifications.RemoveFirst();
      }
      if (!result.length && !builder.IsDeleted(tag.face.wrapped)) result.push(tag);
      return result;
    });
  try {
    const { paths, skipped } = sweepPaths(doc, evaluated);
    if (!paths.length)
      return {
        positions: new Float32Array(),
        normals: new Float32Array(),
        indices: new Uint32Array(),
        renderPositions: new Float32Array(),
        renderNormals: new Float32Array(),
        renderIndices: new Uint32Array(),
        surfaceIds: new Uint32Array(),
        endCapTriangles: new Uint8Array(),
        creases: new Float32Array(),
        origin: [0, 0, 0],
        cellSize: 0,
        bodies: 0,
        bodyRanges: [],
        skipped,
        cadBreps: [],
      };
    const tolerance = 1e-4;
    const shapes: cad.Shape3D[] = [];
    let tags: Tag[] = [];
    for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
      const path = paths[pathIndex];
      const curve = doc.curves.find((c) => c.id === path.curveId)!;
      const points = curve.nodes.map((node) => {
        const p = node.point && resolvePoint(doc, node.point);
        if (!p) throw new Error(`Missing point in ${curve.name}.`);
        return [p.x, p.y, p.z] as Point;
      });
      const edges: cad.Edge[] = [];
      const source = curve.sourceNurbs;
      // Preserve the exact imported NURBS while its sampled point references are
      // unchanged. Editing points/order/modes intentionally returns to their guide.
      const useSource =
        source &&
        source.samples.length === curve.nodes.length &&
        source.samples.every(
          (s, i) =>
            s.nodeId === curve.nodes[i].id &&
            curve.nodes[i].connection === 'line' &&
            s.position.every((v, c) => Math.abs(v - points[i][c]) < 1e-10),
        );
      if (source && useSource) {
        const poles = own(new oc.NCollection_Array1_gp_Pnt(1, source.controls.length));
        const weights = own(new oc.NCollection_Array1_double(1, source.weights.length));
        const knots = own(new oc.NCollection_Array1_double(1, source.knots.length));
        const mults = own(new oc.NCollection_Array1_int(1, source.multiplicities.length));
        source.controls.forEach((p, i) => poles.SetValue(i + 1, own(new oc.gp_Pnt(...p))));
        source.weights.forEach((v, i) => weights.SetValue(i + 1, v));
        source.knots.forEach((v, i) => knots.SetValue(i + 1, v));
        source.multiplicities.forEach((v, i) => mults.SetValue(i + 1, v));
        const geometry = own(
          new oc.Geom_BSplineCurve(poles, weights, knots, mults, source.degree, false, true),
        );
        let a = source.samples[path.nodeStart].parameter,
          b = source.samples[path.nodeEnd].parameter;
        if (a > b) {
          a = geometry.ReversedParameter(a);
          b = geometry.ReversedParameter(b);
          geometry.Reverse();
        }
        const builder = own(new oc.BRepBuilderAPI_MakeEdge(geometry, a, b));
        if (!builder.IsDone()) throw new Error(`Could not reconstruct the imported guide of ${curve.name}.`);
        edges.push(own(new cad.Edge(builder.Edge())));
      } else
        for (let i = path.nodeStart + 1; i <= path.nodeEnd; i++) {
          const a = points[i - 1],
            b = points[i];
          if (Math.hypot(...a.map((v, c) => v - b[c])) < 1e-7)
            throw new Error(
              `${curve.name} contains coincident consecutive points. Separate or remove them before sweeping.`,
            );
          if (curve.nodes[i].connection === 'line') edges.push(own(cad.makeLine(a, b)));
          else {
            // Exact cubic Hermite -> Bezier conversion matches planes.cpp, including
            // tangents at spline/straight boundaries and across subcurve junctions.
            const c1 = a.map(
              (v, c) =>
                v +
                (i > 1 && curve.nodes[i - 1].connection === 'spline'
                  ? (b[c] - points[i - 2][c]) / 2
                  : b[c] - v) /
                  3,
            ) as Point;
            const c2 = b.map(
              (v, c) =>
                v -
                (i + 1 < points.length && curve.nodes[i + 1].connection === 'spline'
                  ? (points[i + 1][c] - a[c]) / 2
                  : v - a[c]) /
                  3,
            ) as Point;
            edges.push(own(cad.makeBezierCurve([a, c1, c2, b])));
          }
        }
      const spine = own(cad.assembleWire(edges));
      const tangent = own(edges[0].tangentAt(0));
      const start = own(edges[0].pointAt(0));
      const circle = own(cad.makeCircle(path.radii[0], start, tangent));
      const profile = own(cad.assembleWire([circle]));
      const pipe = own(new oc.BRepOffsetAPI_MakePipeShell(spine.wrapped));
      pipe.SetTolerance(tolerance, tolerance, 1e-3);
      pipe.SetTransitionMode(oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner);
      if (path.radii.every((radius) => Math.abs(radius - path.radii[0]) < 1e-12)) {
        pipe.Add(profile.wrapped, false, false);
      } else {
        const distances = [0];
        for (let i = 1; i < path.radii.length; i++)
          distances.push(
            distances[i - 1] +
              Math.hypot(
                ...[0, 1, 2].map((c) => path.positions[i * 3 + c] - path.positions[(i - 1) * 3 + c]),
              ),
          );
        const samples = own(new oc.NCollection_Array1_gp_Pnt2d(1, distances.length));
        const length = spine.length;
        distances.forEach((d, i) => {
          const point = own(
            new oc.gp_Pnt2d((d / distances[distances.length - 1]) * length, path.radii[i] / path.radii[0]),
          );
          samples.SetValue(i + 1, point);
        });
        const law = own(new oc.Law_Interpol());
        law.Set(samples, 0, 0, false);
        const trimmed = own(law.Trim(0, length, tolerance));
        pipe.SetLaw(profile.wrapped, trimmed, false, false);
      }
      pipe.Build();
      if (!pipe.IsDone() || !pipe.MakeSolid())
        throw new Error(
          `Could not sweep ${curve.name}. Check for tight bends or a diameter larger than the bend radius.`,
        );
      const shape = own(cad.cast(pipe.Shape()).asShape3D());
      valid(shape, `Sweep of ${curve.name}`);
      shapes.push(shape);
      tags.push(
        ...facesOf(shape).map((face) => ({ face, owner: pathIndex, cap: face.geomType === 'PLANE' })),
      );
      progress(10 + (35 * (pathIndex + 1)) / paths.length);
    }
    let fused = shapes[0];
    for (let i = 1; i < shapes.length; i++) {
      const builder = own(new oc.BRepAlgoAPI_Fuse(fused.wrapped, shapes[i].wrapped));
      if (!builder.IsDone())
        throw new Error(
          'Could not join the vessel bodies. Check for tangent-only or self-intersecting connections.',
        );
      tags = historyTags(builder, tags);
      fused = own(cad.cast(builder.Shape()).asShape3D());
      valid(fused, 'Vessel union');
      progress(45 + (20 * i) / shapes.length);
    }
    // Fillets are explicit, ordered CAD features, never part of Auto Sweep.
    for (const feature of doc.fillets ?? []) {
      if (feature.suppressed) continue;
      const available = new Map(edgesOf(fused).map((edge) => [cadEdgeKey(edge), edge]));
      const fillet = own(new oc.BRepFilletAPI_MakeFillet(fused.wrapped));
      for (const key of feature.edges) {
        const edge = available.get(key);
        if (!edge)
          throw new Error(
            feature.name + ': a selected edge changed. Edit the feature and reselect its edges.',
          );
        fillet.Add(feature.radius, edge.wrapped);
      }
      fillet.Build();
      if (!fillet.IsDone())
        throw new Error(
          feature.name +
            ': this radius cannot be built on the selected edges. Reduce the radius or reselect the edges.',
        );
      tags = historyTags(fillet, tags);
      fused = own(cad.cast(fillet.Shape()).asShape3D());
      valid(fused, feature.name);
    }
    progress(75);
    const capIds = new Set(tags.filter((tag) => tag.cap).map((tag) => tag.face.hashCode));
    const solids = fused.solids.map(own);
    if (!solids.length) throw new Error('The CAD operation did not produce a solid.');
    const bodies: cad.Shape3D[] = [];
    for (const solid of solids) {
      if (!removeCaps) {
        bodies.push(solid);
        continue;
      }
      const faces = facesOf(solid);
      const walls = faces.filter((face) => !capIds.has(face.hashCode));
      // Sewing a single cylindrical face returns a Face, not a Shell. Build
      // that shell explicitly so an isolated vessel has the same open topology.
      let shell: cad.Shape3D;
      if (walls.length === 1) {
        const topology = own(new oc.TopoDS_Shell());
        const builder = own(new oc.TopoDS_Builder());
        builder.MakeShell(topology);
        builder.Add(topology, walls[0].wrapped);
        shell = own(cad.cast(topology).asShape3D());
      } else shell = own(cad.weldShellsAndFaces(walls));
      valid(shell, 'Removed end caps');
      bodies.push(shell);
    }
    const positions: number[] = [],
      normals: number[] = [],
      indices: number[] = [],
      sources: number[] = [],
      caps: number[] = [];
    const cadEdges: NonNullable<SweepMesh['cadEdges']> = [];
    const cadFaces: NonNullable<SweepMesh['cadFaces']> = [];
    // Curved tube faces may be NURBS rather than analytic cylinders. Preserve
    // their known constant circular cross-section, separately from face geometry.
    const faceDiameters = new Map<number, Set<number>>();
    for (const tag of tags) {
      if (tag.cap) continue;
      const radii = paths[tag.owner].radii;
      const diameter = radii.every((radius) => Math.abs(radius - radii[0]) < 1e-10) ? radii[0] * 2 : NaN;
      const values = faceDiameters.get(tag.face.hashCode) ?? new Set<number>();
      values.add(diameter);
      faceDiameters.set(tag.face.hashCode, values);
    }
    const bodyRanges: SweepMesh['bodyRanges'] = [],
      breps: string[] = [];
    const minRadius = Math.min(...paths.map((p) => Math.min(...p.radii)));
    // Chordal deflection controls only the preview, not the B-Rep or STEP precision.
    const deflection = Math.max(1e-5, Math.min(0.02, minRadius / 100));
    bodies.forEach((body, index) => {
      facesOf(body).forEach((face, faceIndex) => {
        const measurement = faceMeasurement(oc, face, index, faceIndex);
        const values = faceDiameters.get(face.hashCode);
        const diameter = values?.size === 1 ? [...values][0] : undefined;
        if (measurement.diameter === undefined && diameter !== undefined && Number.isFinite(diameter)) {
          measurement.diameter = diameter;
          measurement.sweepDiameter = true;
        }
        cadFaces.push(measurement);
      });
      const mesh = body.mesh({ tolerance: deflection, angularTolerance: 0.12 });
      const offset = positions.length / 3,
        start = indices.length;
      // Append in loops: large meshes exceed JS argument limits.
      for (const value of mesh.vertices) positions.push(value);
      for (const value of mesh.normals) normals.push(value);
      for (const value of mesh.triangles) indices.push(value + offset);
      for (const group of mesh.faceGroups)
        for (let i = 0; i < group.count / 3; i++) {
          sources.push(group.faceId);
          caps.push(capIds.has(group.faceId) ? 1 : 0);
        }
      bodyRanges.push({ start, count: indices.length - start, creaseStart: 0, creaseCount: 0 });
      breps.push(body.serialize());
      for (const edge of edgesOf(body)) {
        const key = cadEdgeKey(edge),
          samples: number[] = [];
        const steps = Math.max(8, Math.min(256, Math.ceil(edge.length / Math.max(deflection * 5, 0.1))));
        for (let i = 0; i <= steps; i++) {
          const p = edge.pointAt(i / steps);
          samples.push(...p.toTuple());
          p.delete();
        }
        cadEdges.push({ key, positions: new Float32Array(samples), body: index });
      }
      progress(75 + (25 * (index + 1)) / bodies.length);
    });
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      indices: new Uint32Array(indices),
      renderPositions: new Float32Array(positions),
      renderNormals: new Float32Array(normals),
      renderIndices: new Uint32Array(indices),
      surfaceIds: new Uint32Array(sources),
      endCapTriangles: new Uint8Array(caps),
      creases: new Float32Array(),
      bodyRanges,
      bodies: bodies.length,
      origin: [0, 0, 0],
      cellSize: deflection,
      skipped,
      surfaceShell: removeCaps,
      cadBreps: breps,
      cadEdges,
      cadFaces,
    };
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(
      'The B-Rep kernel rejected the vessel geometry. Check tight bends, overlapping paths, or the fillet radius.',
    );
  } finally {
    for (let i = garbage.length - 1; i >= 0; i--) garbage[i].delete();
  }
}

// Geometric references survive regeneration/save/load. If the underlying edge
// changes, fail explicitly rather than filleting an unrelated topological index.
export function cadEdgeKey(edge: cad.Edge): string {
  const samples = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const point = edge.pointAt(t);
    const values = point.toTuple();
    point.delete();
    return values.map((value) => Math.round(value * 1e5)).join(',');
  });
  return (
    edge.geomType +
    ':' +
    Math.round(edge.length * 1e5) +
    ':' +
    [samples.join(';'), samples.reverse().join(';')].sort()[0]
  );
}
