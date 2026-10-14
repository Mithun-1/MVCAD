import { MAX_POINTS, COORDINATE_LIMIT, type PointSet } from './points.ts';
import { MAX_CURVES, MAX_CURVE_POINTS, type CurveFeature } from './curves.ts';
import { validateSourceNurbs } from './nurbs.ts';
import { validateReference, type ReferenceAsset } from './references.ts';
export const BASE_PLANES = [
  { id: 'front', name: 'Front Plane', color: '#328c9b', orientation: 'XY', normal: '+Z' },
  { id: 'top', name: 'Top Plane', color: '#4b80cb', orientation: 'XZ', normal: '+Y' },
  { id: 'right', name: 'Right Plane', color: '#bd8a42', orientation: 'YZ', normal: '+X' },
] as const;

export type ReferencePlane = {
  id: string;
  name: string;
  parentId: string;
  offset: number;
  visible: boolean;
  suppressed?: boolean;
};
export type Document = {
  version: 1;
  name: string;
  planes: ReferencePlane[];
  baseVisibility: Record<string, boolean>;
  baseNames: Record<string, string>;
  pointSets: PointSet[];
  curves: CurveFeature[];
  fillets?: FilletFeature[];
  references?: ReferenceAsset[];
  groups?: FeatureGroup[];
  autoSweep?: boolean;
  removeCaps?: boolean;
  boundingBox?: { planeIds: [string, string, string] };
};
export type FilletFeature = {
  id: string;
  name: string;
  radius: number;
  edges: string[];
  suppressed?: boolean;
};
export type FeatureGroup = { id: string; name: string; visible: boolean; members: string[] };
export type EvaluatedPlane = { id: string; frame: number[] };
export const MAX_PLANES = 4093;
export const MAX_OFFSET = 1_000_000;
export const STORAGE_KEY = 'mvcad.document.v1';
export function newDocument(): Document {
  return {
    version: 1,
    name: 'Untitled part',
    planes: [],
    pointSets: [],
    curves: [],
    baseVisibility: { front: true, top: true, right: true },
    baseNames: Object.fromEntries(BASE_PLANES.map((p) => [p.id, p.name])),
  };
}
export function planeName(doc: Document, id: string): string {
  if (id.startsWith('__body__:')) return `Body ${Number(id.slice(9)) + 1}`;
  if (id === '__sweep__') return 'Auto Sweep';
  const base = BASE_PLANES.find((p) => p.id === id);
  return base
    ? (doc.baseNames?.[id] ?? base.name)
    : (doc.planes.find((p) => p.id === id)?.name ??
        doc.pointSets?.find((p) => p.id === id)?.name ??
        doc.curves?.find((p) => p.id === id)?.name ??
        doc.fillets?.find((p) => p.id === id)?.name ??
        doc.references?.find((p) => p.id === id)?.name ??
        doc.groups?.find((p) => p.id === id)?.name ??
        id);
}
export function validateDocument(value: unknown): Document {
  if (!value || typeof value !== 'object') throw new Error('This is not an MVCAD document.');
  const doc = value as Document;
  if (doc.autoSweep !== undefined && typeof doc.autoSweep !== 'boolean')
    throw new Error('Invalid Auto Sweep setting.');
  if (doc.removeCaps !== undefined && typeof doc.removeCaps !== 'boolean')
    throw new Error('Invalid Remove setting.');
  if (
    doc.version !== 1 ||
    typeof doc.name !== 'string' ||
    !doc.name.trim() ||
    doc.name.length > 100 ||
    !Array.isArray(doc.planes) ||
    doc.planes.length > MAX_PLANES ||
    !doc.baseVisibility ||
    BASE_PLANES.some((p) => typeof doc.baseVisibility[p.id] !== 'boolean')
  )
    throw new Error('Invalid or unsupported MVCAD document.');
  const ids = new Set<string>(BASE_PLANES.map((p) => p.id));
  // Older v1 documents have no baseNames; restore their original labels.
  if (
    doc.baseNames !== undefined &&
    (!doc.baseNames || typeof doc.baseNames !== 'object' || Array.isArray(doc.baseNames))
  )
    throw new Error('Invalid default plane names.');
  const baseNames: Record<string, string> = {};
  const names = new Set<string>(['origin']);
  for (const p of BASE_PLANES) {
    const name = doc.baseNames === undefined ? p.name : doc.baseNames[p.id];
    if (typeof name !== 'string' || !name.trim() || name.length > 60 || names.has(name.trim().toLowerCase()))
      throw new Error('Invalid or duplicate default plane name.');
    baseNames[p.id] = name.trim();
    names.add(name.trim().toLowerCase());
  }
  for (const p of doc.planes) {
    if (
      !p ||
      typeof p.id !== 'string' ||
      !p.id ||
      p.id.length > 100 ||
      ids.has(p.id) ||
      p.id === 'origin' ||
      p.id === '__preview__' ||
      p.id === '__sweep__' ||
      p.id.startsWith('__body__:') ||
      typeof p.name !== 'string' ||
      !p.name.trim() ||
      p.name.length > 60 ||
      p.name.trim().toLowerCase() === 'origin' ||
      names.has(p.name.trim().toLowerCase()) ||
      !ids.has(p.parentId) ||
      typeof p.offset !== 'number' ||
      !Number.isFinite(p.offset) ||
      Math.abs(p.offset) > MAX_OFFSET ||
      typeof p.visible !== 'boolean' ||
      (p.suppressed !== undefined && typeof p.suppressed !== 'boolean')
    )
      throw new Error('Invalid plane or broken plane dependency.');
    ids.add(p.id);
    names.add(p.name.trim().toLowerCase());
  }
  if (
    doc.boundingBox !== undefined &&
    (!doc.boundingBox ||
      !Array.isArray(doc.boundingBox.planeIds) ||
      doc.boundingBox.planeIds.length !== 3 ||
      doc.boundingBox.planeIds.some((id, axis) => {
        const plane = doc.planes.find((p) => p.id === id);
        return !plane || plane.parentId !== ['right', 'top', 'front'][axis] || plane.offset <= 0;
      }))
  )
    throw new Error('Invalid bounding box planes.');
  const pointSets = doc.pointSets === undefined ? [] : doc.pointSets;
  if (!Array.isArray(pointSets)) throw new Error('Invalid point sets.');
  let pointCount = 0;
  const validatedSets: PointSet[] = pointSets.map((set) => {
    if (
      !set ||
      typeof set.id !== 'string' ||
      !set.id ||
      set.id.length > 100 ||
      ids.has(set.id) ||
      set.id === 'origin' ||
      set.id === '__preview__' ||
      set.id === '__sweep__' ||
      set.id.startsWith('__body__:') ||
      typeof set.name !== 'string' ||
      !set.name.trim() ||
      set.name.length > 60 ||
      names.has(set.name.trim().toLowerCase()) ||
      typeof set.visible !== 'boolean' ||
      (set.suppressed !== undefined && typeof set.suppressed !== 'boolean') ||
      !Array.isArray(set.points) ||
      !set.points.length ||
      !Array.isArray(set.sourceFiles) ||
      set.sourceFiles.some((s: unknown) => typeof s !== 'string' || s.length > 255)
    )
      throw new Error('Invalid point set.');
    ids.add(set.id);
    names.add(set.name.trim().toLowerCase());
    pointCount += set.points.length;
    if (pointCount > MAX_POINTS)
      throw new Error(`A document supports up to ${MAX_POINTS.toLocaleString()} points.`);
    const pointIds = new Set<string>(),
      pointNames = new Set<string>();
    const points = set.points.map((p) => {
      if (
        !p ||
        typeof p.id !== 'string' ||
        !p.id ||
        p.id.length > 100 ||
        pointIds.has(p.id) ||
        typeof p.name !== 'string' ||
        !p.name.trim() ||
        p.name.length > 60 ||
        pointNames.has(p.name.trim().toLowerCase()) ||
        ![p.x, p.y, p.z].every(
          (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= COORDINATE_LIMIT,
        )
      )
        throw new Error('Invalid point name or coordinates.');
      pointIds.add(p.id);
      pointNames.add(p.name.trim().toLowerCase());
      return { id: p.id, name: p.name.trim(), x: p.x, y: p.y, z: p.z };
    });
    return {
      id: set.id,
      name: set.name.trim(),
      visible: set.visible,
      ...(set.suppressed ? { suppressed: true } : {}),
      points,
      sourceFiles: [...set.sourceFiles],
    };
  });
  const curves = doc.curves === undefined ? [] : doc.curves;
  if (!Array.isArray(curves) || curves.length > MAX_CURVES) throw new Error('Invalid curve features.');
  const pointLookup = new Map(validatedSets.map((set) => [set.id, new Set(set.points.map((p) => p.id))]));
  const validatedCurves: CurveFeature[] = curves.map((curve) => {
    if (
      !curve ||
      typeof curve.id !== 'string' ||
      !curve.id ||
      curve.id.length > 100 ||
      ids.has(curve.id) ||
      ['origin', '__preview__', '__sweep__'].includes(curve.id) ||
      curve.id.startsWith('__body__:') ||
      typeof curve.name !== 'string' ||
      !curve.name.trim() ||
      curve.name.length > 60 ||
      names.has(curve.name.trim().toLowerCase()) ||
      typeof curve.visible !== 'boolean' ||
      (curve.suppressed !== undefined && typeof curve.suppressed !== 'boolean') ||
      !Array.isArray(curve.nodes) ||
      curve.nodes.length < 2 ||
      curve.nodes.length > MAX_CURVE_POINTS
    )
      throw new Error('Invalid curve feature.');
    ids.add(curve.id);
    names.add(curve.name.trim().toLowerCase());
    const nodeIds = new Set<string>();
    const nodes = curve.nodes.map((node, i) => {
      const previous = curve.nodes[i - 1]?.point;
      if (
        !node ||
        typeof node.id !== 'string' ||
        !node.id ||
        node.id.length > 100 ||
        nodeIds.has(node.id) ||
        !['spline', 'line'].includes(node.connection) ||
        (node.diameter !== undefined &&
          (typeof node.diameter !== 'number' || !Number.isFinite(node.diameter) || node.diameter <= 0)) ||
        (['startCutoff', 'endCutoff', 'roundingDiameter'] as const).some(
          (key) =>
            node[key] !== undefined &&
            (typeof node[key] !== 'number' ||
              !Number.isFinite(node[key]) ||
              node[key]! < 0 ||
              (key !== 'roundingDiameter' && node[key]! > 50)),
        ) ||
        !node.point ||
        !pointLookup.get(node.point.setId)?.has(node.point.pointId) ||
        (previous?.setId === node.point.setId && previous?.pointId === node.point.pointId)
      )
        throw new Error('Invalid curve point or broken point reference.');
      nodeIds.add(node.id);
      return {
        id: node.id,
        point: { setId: node.point.setId, pointId: node.point.pointId },
        connection: node.connection,
        ...(node.diameter !== undefined ? { diameter: node.diameter } : {}),
        ...(node.startCutoff !== undefined ? { startCutoff: node.startCutoff } : {}),
        ...(node.endCutoff !== undefined ? { endCutoff: node.endCutoff } : {}),
        ...(node.roundingDiameter !== undefined ? { roundingDiameter: node.roundingDiameter } : {}),
      };
    });
    return {
      id: curve.id,
      name: curve.name.trim(),
      visible: curve.visible,
      nodes,
      ...(curve.sourceNurbs ? { sourceNurbs: validateSourceNurbs(curve.sourceNurbs) } : {}),
      ...(curve.suppressed ? { suppressed: true } : {}),
    };
  });
  if (doc.fillets !== undefined && !Array.isArray(doc.fillets)) throw new Error('Invalid fillet features.');
  const fillets = (doc.fillets ?? []).map((feature) => {
    if (
      !feature ||
      typeof feature.id !== 'string' ||
      !feature.id ||
      feature.id.length > 100 ||
      ids.has(feature.id) ||
      feature.id.startsWith('__') ||
      feature.id === 'origin' ||
      typeof feature.name !== 'string' ||
      !feature.name.trim() ||
      feature.name.length > 60 ||
      feature.name.trim().toLowerCase() === 'origin' ||
      names.has(feature.name.trim().toLowerCase()) ||
      !Number.isFinite(feature.radius) ||
      feature.radius <= 0 ||
      feature.radius > MAX_OFFSET ||
      !Array.isArray(feature.edges) ||
      !feature.edges.length ||
      feature.edges.length > 10000 ||
      feature.edges.some((edge) => typeof edge !== 'string' || !edge || edge.length > 1000) ||
      new Set(feature.edges).size !== feature.edges.length ||
      (feature.suppressed !== undefined && typeof feature.suppressed !== 'boolean')
    )
      throw new Error('Invalid or duplicate fillet feature.');
    ids.add(feature.id);
    names.add(feature.name.trim().toLowerCase());
    return {
      id: feature.id,
      name: feature.name.trim(),
      radius: feature.radius,
      edges: [...feature.edges],
      ...(feature.suppressed ? { suppressed: true } : {}),
    };
  });
  if (doc.references !== undefined && (!Array.isArray(doc.references) || doc.references.length > 100))
    throw new Error('Import at most 100 references.');
  const references = (doc.references ?? []).map((asset) => {
    const result = validateReference(asset, new Set([...BASE_PLANES, ...doc.planes].map((p) => p.id)));
    if (
      ids.has(result.id) ||
      result.id === 'origin' ||
      names.has(result.name.toLowerCase()) ||
      result.name.toLowerCase() === 'origin'
    )
      throw new Error('Duplicate reference name or ID.');
    ids.add(result.id);
    names.add(result.name.toLowerCase());
    return result;
  });
  const groups = doc.groups === undefined ? [] : doc.groups;
  if (!Array.isArray(groups)) throw new Error('Invalid feature groups.');
  const featureIds = new Set(
    [...BASE_PLANES, ...doc.planes, ...validatedSets, ...validatedCurves].map((p) => p.id),
  );
  const grouped = new Set<string>();
  const validatedGroups: FeatureGroup[] = groups.map((group) => {
    if (
      !group ||
      typeof group.id !== 'string' ||
      !group.id ||
      group.id.length > 100 ||
      ids.has(group.id) ||
      ['origin', '__preview__', '__sweep__'].includes(group.id) ||
      group.id.startsWith('__body__:') ||
      typeof group.name !== 'string' ||
      !group.name.trim() ||
      group.name.length > 60 ||
      names.has(group.name.trim().toLowerCase()) ||
      typeof group.visible !== 'boolean' ||
      !Array.isArray(group.members) ||
      !group.members.length
    )
      throw new Error('Invalid or duplicate feature group.');
    ids.add(group.id);
    names.add(group.name.trim().toLowerCase());
    for (const id of group.members) {
      if (!featureIds.has(id) || grouped.has(id)) throw new Error('Invalid or duplicate group member.');
      grouped.add(id);
    }
    return { id: group.id, name: group.name.trim(), visible: group.visible, members: [...group.members] };
  });
  return {
    version: 1,
    name: doc.name.trim(),
    planes: doc.planes.map((p) => ({
      id: p.id,
      name: p.name.trim(),
      parentId: p.parentId,
      offset: p.offset,
      visible: p.visible,
      ...(p.suppressed ? { suppressed: true } : {}),
    })),
    baseVisibility: Object.fromEntries(BASE_PLANES.map((p) => [p.id, doc.baseVisibility[p.id]])),
    baseNames,
    pointSets: validatedSets,
    curves: validatedCurves,
    ...(fillets.length ? { fillets } : {}),
    ...(references.length ? { references } : {}),
    ...(validatedGroups.length ? { groups: validatedGroups } : {}),
    ...(doc.autoSweep ? { autoSweep: true } : {}),
    ...(doc.removeCaps ? { removeCaps: true } : {}),
    ...(doc.boundingBox
      ? { boundingBox: { planeIds: [...doc.boundingBox.planeIds] as [string, string, string] } }
      : {}),
  };
}
export function nextPlaneName(doc: Document) {
  let n = 1;
  const names = [
    ...BASE_PLANES.map((p) => planeName(doc, p.id)),
    ...doc.planes.map((p) => p.name),
    ...(doc.pointSets ?? []).map((p) => p.name),
    ...(doc.curves ?? []).map((p) => p.name),
    ...(doc.groups ?? []).map((p) => p.name),
    ...(doc.references ?? []).map((p) => p.name),
    ...(doc.fillets ?? []).map((p) => p.name),
  ];
  while (names.some((name) => name.toLowerCase() === `plane ${n}`)) n++;
  return `Plane ${n}`;
}
export function descendants(doc: Document, id: string) {
  const result = new Set([id]);
  for (const p of doc.planes) if (result.has(p.parentId)) result.add(p.id);
  for (const curve of doc.curves ?? [])
    if (curve.nodes.some((node) => node.point && result.has(node.point.setId))) result.add(curve.id);
  for (const reference of doc.references ?? [])
    if (reference.kind === 'image' && result.has(reference.planeId)) result.add(reference.id);
  result.delete(id);
  return result;
}
