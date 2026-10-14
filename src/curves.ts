import type { Document } from './model.ts';
import type { DatumPoint } from './points.ts';
import type { SourceNurbs } from './nurbs.ts';

export type PointReference = { setId: string; pointId: string };
export type CurveNode = {
  id: string;
  point: PointReference | null;
  connection: 'spline' | 'line';
  // Diameter of the incoming span. This preserves assignments when junctions split a section.
  diameter?: number;
  // Outgoing/incoming section transition lengths at this node, in percent.
  startCutoff?: number;
  endCutoff?: number;
  // Shared junction setting, synchronized across occurrences of the datum point.
  roundingDiameter?: number;
};
export type CurveFeature = {
  id: string;
  name: string;
  nodes: CurveNode[];
  visible: boolean;
  suppressed?: boolean;
  sourceNurbs?: SourceNurbs;
};
export type EvaluatedCurve = { id: string; positions: Float64Array; nodeOffsets: number[] };
export type CurveSection = { id: string; curveId: string; index: number; start: number; end: number };
export type CurveJunction = { point: PointReference; sectionIds: string[] };
export const pointReferenceKey = (point: PointReference) => JSON.stringify([point.setId, point.pointId]);

// Keep every branch at a junction together rather than storing redundant pairwise links.
export function curveJunctions(
  doc: Pick<Document, 'curves'>,
  sections: CurveSection[],
): Map<string, CurveJunction> {
  const curves = new Map(doc.curves.map((curve) => [curve.id, curve]));
  const endpoints = new Map<string, { point: PointReference; sections: Set<string> }>();
  for (const section of sections) {
    const curve = curves.get(section.curveId);
    for (const index of [section.start, section.end]) {
      const point = curve?.nodes[index]?.point;
      if (!point) continue;
      const key = pointReferenceKey(point);
      if (!endpoints.has(key)) endpoints.set(key, { point, sections: new Set() });
      endpoints.get(key)!.sections.add(section.id);
    }
  }
  return new Map(
    [...endpoints]
      .filter(([, endpoint]) => endpoint.sections.size > 1)
      .map(([key, endpoint]) => [key, { point: endpoint.point, sectionIds: [...endpoint.sections] }]),
  );
}

export function sectionDiameter(curve: CurveFeature, section: CurveSection): number | 'mixed' | undefined {
  const spans = curve.nodes.slice(section.start + 1, section.end + 1);
  const value = spans[0]?.diameter;
  return spans.every((node) => node.diameter === value) ? value : 'mixed';
}

export function sectionConnections(
  doc: Pick<Document, 'curves'>,
  sections: CurveSection[],
  section: CurveSection,
) {
  const curve = doc.curves.find((c) => c.id === section.curveId)!;
  const junctions = curveJunctions(doc, sections);
  return [section.start, section.end].map((index) => {
    const point = curve.nodes[index].point;
    return !!point && junctions.has(pointReferenceKey(point));
  }) as [boolean, boolean];
}

export function junctionRoundingDiameter(doc: Pick<Document, 'curves'>, point: PointReference) {
  const key = pointReferenceKey(point);
  const values = doc.curves.flatMap((curve) =>
    curve.nodes.flatMap((node) =>
      node.point && pointReferenceKey(node.point) === key && node.roundingDiameter !== undefined
        ? [node.roundingDiameter]
        : [],
    ),
  );
  return values.length ? values.reduce((maximum, value) => Math.max(maximum, value), 0) : 3;
}

export function sectionSweepSettings(
  doc: Pick<Document, 'curves'>,
  sections: CurveSection[],
  section: CurveSection,
  junctionKey?: string,
) {
  const curve = doc.curves.find((c) => c.id === section.curveId)!;
  const connected = sectionConnections(doc, sections, section);
  const junctions = sectionRoundingJunctions(doc, sections, section);
  const junction = junctions.find((item) => item.key === junctionKey) ?? junctions[0];
  return {
    startCutoff: curve.nodes[section.start].startCutoff ?? 10,
    endCutoff: curve.nodes[section.end].endCutoff ?? 10,
    roundingDiameter: junction?.diameter ?? 3,
    connected,
  };
}

// Rounding belongs to a junction, not to either end of an individual vessel.
export function sectionRoundingJunctions(
  doc: Pick<Document, 'curves'>,
  sections: CurveSection[],
  section: CurveSection,
) {
  return [...curveJunctions(doc, sections)].flatMap(([key, junction], index) => {
    if (!junction.sectionIds.includes(section.id)) return [];
    const peers = sections.filter((item) => item.id !== section.id && junction.sectionIds.includes(item.id));
    const names = peers.map(
      (item) => `${doc.curves.find((curve) => curve.id === item.curveId)!.name} · Subcurve ${item.index + 1}`,
    );
    return [
      {
        key,
        label: `Junction ${index + 1} — ${names.join(', ')}`,
        diameter: junctionRoundingDiameter(doc, junction.point),
      },
    ];
  });
}

export function assignSectionSweepSetting(
  doc: Document,
  section: CurveSection,
  property: 'startCutoff' | 'endCutoff' | 'roundingDiameter',
  value: number,
  junctionKey?: string,
): Document {
  const settings = sectionSweepSettings(doc, curveSections(doc), section);
  if (!Number.isFinite(value) || value < 0 || (property !== 'roundingDiameter' && value > 50))
    throw new Error(
      property === 'roundingDiameter'
        ? 'Enter a rounding diameter of zero or greater.'
        : 'Enter a cutoff from 0 to 50%.',
    );
  const curve = doc.curves.find((c) => c.id === section.curveId)!;
  if (property === 'roundingDiameter') {
    const junctions = sectionRoundingJunctions(doc, curveSections(doc), section);
    const junction =
      junctionKey === undefined ? junctions[0] : junctions.find((item) => item.key === junctionKey);
    if (!junction) return doc;
    return {
      ...doc,
      curves: doc.curves.map((c) => ({
        ...c,
        nodes: c.nodes.map((node) =>
          node.point && junction.key === pointReferenceKey(node.point)
            ? { ...node, roundingDiameter: value }
            : node,
        ),
      })),
    };
  }
  const start = property === 'startCutoff';
  if (!settings.connected[start ? 0 : 1]) return doc;
  return {
    ...doc,
    curves: doc.curves.map((c) =>
      c.id !== curve.id
        ? c
        : {
            ...c,
            nodes: c.nodes.map((node, index) =>
              index === (start ? section.start : section.end) ? { ...node, [property]: value } : node,
            ),
          },
    ),
  };
}

export function assignSectionDiameter(
  curve: CurveFeature,
  section: CurveSection,
  diameter: number,
): CurveFeature {
  if (!Number.isFinite(diameter) || diameter <= 0) throw new Error('Enter a diameter greater than zero.');
  return {
    ...curve,
    nodes: curve.nodes.map((node, index) =>
      index > section.start && index <= section.end ? { ...node, diameter } : node,
    ),
  };
}

// Junctions are shared datum-point references, not apparent crossings in a camera view.
// Visibility does not change topology; suppression does.
export function curveSections(doc: Pick<Document, 'planes' | 'pointSets' | 'curves'>): CurveSection[] {
  const suppressed = suppressedFeatures(doc);
  const owners = new Map<string, Set<string>>();
  const key = pointReferenceKey;
  for (const curve of doc.curves) {
    if (suppressed.has(curve.id)) continue;
    for (const node of curve.nodes) {
      if (!node.point) continue;
      const pointKey = key(node.point);
      if (!owners.has(pointKey)) owners.set(pointKey, new Set());
      owners.get(pointKey)!.add(curve.id);
    }
  }
  return doc.curves.flatMap((curve) => {
    if (suppressed.has(curve.id) || curve.nodes.length < 2) return [];
    const cuts = [0];
    for (let i = 1; i < curve.nodes.length - 1; i++) {
      const point = curve.nodes[i].point;
      if (point && (owners.get(key(point))?.size ?? 0) > 1) cuts.push(i);
    }
    cuts.push(curve.nodes.length - 1);
    return cuts.slice(1).map((end, index) => {
      const start = cuts[index];
      return {
        id: `subcurve:${JSON.stringify([curve.id, curve.nodes[start].id, curve.nodes[end].id])}`,
        curveId: curve.id,
        index,
        start,
        end,
      };
    });
  });
}
export const MAX_CURVE_POINTS = 1000;
export const MAX_CURVES = 128;
export function resolvePoint(
  doc: Pick<Document, 'pointSets'>,
  ref: PointReference | null,
): DatumPoint | undefined {
  return ref
    ? doc.pointSets.find((set) => set.id === ref.setId)?.points.find((p) => p.id === ref.pointId)
    : undefined;
}
export function createPointResolver(doc: Pick<Document, 'pointSets'>) {
  const sets = new Map(doc.pointSets.map((set) => [set.id, new Map(set.points.map((p) => [p.id, p]))]));
  return (ref: PointReference | null) => (ref ? sets.get(ref.setId)?.get(ref.pointId) : undefined);
}
export function suppressedFeatures(doc: Pick<Document, 'planes' | 'pointSets' | 'curves'>): Set<string> {
  const result = new Set<string>();
  for (const p of doc.planes) if (p.suppressed || result.has(p.parentId)) result.add(p.id);
  for (const set of doc.pointSets) if (set.suppressed) result.add(set.id);
  for (const curve of doc.curves ?? [])
    if (curve.suppressed || curve.nodes.some((n) => n.point && result.has(n.point.setId)))
      result.add(curve.id);
  return result;
}
export function curveError(doc: Document, curve: CurveFeature, allowIncomplete = false): string {
  if (!curve.name.trim() || curve.name.length > 60) return 'Enter a curve name (up to 60 characters).';
  if (curve.nodes.length > MAX_CURVE_POINTS) return `A curve supports up to ${MAX_CURVE_POINTS} points.`;
  if (!allowIncomplete && curve.nodes.length < 2) return 'Select at least two points.';
  const suppressed = suppressedFeatures(doc);
  const resolve = createPointResolver(doc);
  for (let i = 0; i < curve.nodes.length; i++) {
    const node = curve.nodes[i];
    if (!node.point) {
      if (allowIncomplete) continue;
      return `Select a point for row ${i + 1}.`;
    }
    if (!resolve(node.point)) return `Point ${i + 1} is no longer available.`;
    if (suppressed.has(node.point.setId)) return `Resume the source point set for point ${i + 1}.`;
    const previous = curve.nodes[i - 1]?.point;
    if (previous?.setId === node.point.setId && previous?.pointId === node.point.pointId)
      return 'Consecutive rows must use different points.';
  }
  return '';
}
