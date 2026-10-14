import { validateDocument, type Document } from './model.ts';
import { MAX_CURVES, MAX_CURVE_POINTS, curveSections, type CurveFeature } from './curves.ts';
import { COORDINATE_LIMIT, MAX_POINTS, type DatumPoint } from './points.ts';
import type { NurbsDefinition } from './nurbs.ts';

type Ref = { ref: number };
type Typed = { type: string; args: Value[] };
type Value = number | string | Ref | Typed | Value[];
type Entity = { id: number; parts: Typed[] };
type Vec = [number, number, number];
type Path = {
  id: number;
  at: (u: number) => Vec;
  breaks: number[];
  nurbs?: NurbsDefinition;
  parameter?: (u: number) => number;
};
type Sample = { u: number; p: Vec; junction?: number };
const distance = (a: Vec, b: Vec) => Math.hypot(...a.map((v, i) => v - b[i]));
const lerp = (a: Vec, b: Vec, t: number): Vec => a.map((v, i) => v + (b[i] - v) * t) as Vec;
const array = (v: Value): Value[] => {
  if (!Array.isArray(v)) throw new Error('Invalid STEP list.');
  return v;
};
const number = (v: Value): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('Invalid STEP number.');
  return v;
};
const reference = (v: Value): number => {
  if (!v || typeof v !== 'object' || !('ref' in v)) throw new Error('Invalid STEP reference.');
  return v.ref;
};

// Parse Part 21 values as data only, including complex instances and escaped strings.
function entities(text: string): Map<number, Entity> {
  if (text.length > 50_000_000) throw new Error('STEP files must be smaller than 50 MB.');
  const clean = text.replace(/'(?:[^']|'')*'|\/\*[\s\S]*?\*\//g, (s) => (s.startsWith("'") ? s : ' '));
  const body = /\bDATA\s*;([\s\S]*?)\bENDSEC\s*;/i.exec(clean)?.[1];
  if (!/^\s*ISO-10303-21\s*;/i.test(clean) || !body || !/END-ISO-10303-21\s*;/i.test(clean))
    throw new Error('This is not a complete STEP Part 21 file.');
  const tokens =
    body.match(
      /'(?:[^']|'')*'|#[0-9]+|\.[A-Z_]+\.|[+-]?(?:\d+\.?\d*|\.\d+)(?:[ED][+-]?\d+)?|[A-Z_][A-Z_0-9]*|[(),;=$*]|\S/gi,
    ) ?? [];
  let i = 0;
  const take = (expected: string) => {
    if (tokens[i++] !== expected) throw new Error(`Malformed STEP data; expected ${expected}.`);
  };
  const list = (depth: number): Value[] => {
    take('(');
    const values: Value[] = [];
    while (tokens[i] !== ')') {
      values.push(value(depth + 1));
      if (tokens[i] !== ')') take(',');
    }
    take(')');
    return values;
  };
  const value = (depth: number): Value => {
    if (depth > 32 || i >= tokens.length) throw new Error('Malformed or excessively nested STEP data.');
    const token = tokens[i];
    if (token === '(') return list(depth);
    i++;
    if (token.startsWith('#')) return { ref: Number(token.slice(1)) };
    if (token.startsWith("'")) return token.slice(1, -1).replaceAll("''", "'");
    if (/^[A-Z_]/i.test(token)) return { type: token.toUpperCase(), args: list(depth) };
    if (token === '$' || token === '*' || /^\.[A-Z_]+\.$/i.test(token)) return token.toUpperCase();
    const n = Number(token.replace(/[dD]/, 'E'));
    if (!Number.isFinite(n)) throw new Error(`Invalid STEP token: ${token}.`);
    return n;
  };
  const result = new Map<number, Entity>();
  while (i < tokens.length) {
    const id = reference(value(0));
    take('=');
    const complex = tokens[i] === '(';
    if (complex) take('(');
    const parts: Typed[] = [];
    do {
      const part = value(0);
      if (!part || typeof part !== 'object' || !('type' in part)) throw new Error('Invalid STEP entity.');
      parts.push(part);
    } while (complex && tokens[i] !== ')');
    if (complex) take(')');
    take(';');
    if (result.has(id) || result.size >= 200_000)
      throw new Error('Duplicate STEP ID or entity limit exceeded.');
    result.set(id, { id, parts });
  }
  return result;
}

function readPaths(text: string) {
  const data = entities(text);
  const get = (id: number): Entity => {
    const entity = data.get(id);
    if (!entity) throw new Error(`Missing STEP entity #${id}.`);
    return entity;
  };
  const part = (entity: Entity, name: string) => entity.parts.find((p) => p.type === name)?.args;
  // Wireframe files use one coordinate system. Reject placements/solids rather than importing misplaced edges.
  if (
    [...data.values()].some((e) =>
      e.parts.some((p) =>
        [
          'MAPPED_ITEM',
          'REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION',
          'MANIFOLD_SOLID_BREP',
          'SHELL_BASED_SURFACE_MODEL',
        ].includes(p.type),
      ),
    )
  )
    throw new Error('Import a STEP wireframe/centerline file, without solid bodies or assembly placements.');
  const lengthUnits = [...data.values()].filter((e) => part(e, 'LENGTH_UNIT'));
  const scales = lengthUnits.map((e) => {
    const si = part(e, 'SI_UNIT');
    const prefixes: Record<string, number> = {
      $: 1000,
      '.MILLI.': 1,
      '.CENTI.': 10,
      '.DECI.': 100,
      '.MICRO.': 0.001,
      '.KILO.': 1_000_000,
    };
    if (!si || si[1] !== '.METRE.' || prefixes[String(si[0])] === undefined)
      throw new Error('This STEP importer currently supports SI length units (metres, millimetres, etc.).');
    return prefixes[String(si[0])];
  });
  if (new Set(scales).size > 1) throw new Error('Mixed STEP length units are not supported.');
  const scale = scales[0] ?? 1;
  const point = (v: Value, type = 'CARTESIAN_POINT'): Vec => {
    const args = part(get(reference(v)), type);
    if (!args) throw new Error(`Expected a STEP ${type}.`);
    const coords = array(args[1]).map(number);
    if (coords.length !== 3) throw new Error('Only 3D STEP wireframes are supported.');
    return coords.map((n) => n * (type === 'CARTESIAN_POINT' ? scale : 1)) as Vec;
  };
  const path = (id: number, depth = 0): Path => {
    if (depth > 16) throw new Error('Cyclic STEP curve references.');
    const entity = get(id);
    const spline = part(entity, 'B_SPLINE_CURVE_WITH_KNOTS');
    if (spline) {
      const base = part(entity, 'B_SPLINE_CURVE');
      const degree = number(base ? base[0] : spline[1]);
      const controls = array(base ? base[1] : spline[2]).map((v) => point(v));
      const mult = array(spline[base ? 0 : 6]).map(number);
      const knots = array(spline[base ? 1 : 7]).map(number);
      const rational = part(entity, 'RATIONAL_B_SPLINE_CURVE');
      const weights = rational ? array(rational[0]).map(number) : controls.map(() => 1);
      if (
        !Number.isInteger(degree) ||
        degree < 1 ||
        degree > 16 ||
        controls.length <= degree ||
        mult.length !== knots.length ||
        weights.length !== controls.length ||
        weights.some((w) => w <= 0) ||
        mult.some((m) => !Number.isInteger(m) || m < 1 || m > degree + 1) ||
        knots.some((k, i) => i > 0 && k <= knots[i - 1])
      )
        throw new Error(`Invalid STEP spline #${id}.`);
      const expanded = knots.flatMap((k, i) => Array<number>(mult[i]).fill(k));
      if (expanded.length !== controls.length + degree + 1) throw new Error(`Invalid STEP knots #${id}.`);
      const low = expanded[degree],
        high = expanded[controls.length];
      if (!(high > low)) throw new Error(`Empty STEP spline #${id}.`);
      return {
        id,
        breaks: [...new Set([low, ...knots.filter((k) => k > low && k < high), high])],
        nurbs: { degree, controls, weights, knots, multiplicities: mult },
        parameter: (u) => u,
        at: (u) => {
          u = Math.max(low, Math.min(high, u));
          let span = controls.length - 1;
          if (u < high)
            for (let j = degree; j < controls.length; j++)
              if (u < expanded[j + 1]) {
                span = j;
                break;
              }
          const d = Array.from({ length: degree + 1 }, (_, j) => {
            const index = span - degree + j,
              w = weights[index];
            return [...controls[index].map((v) => v * w), w];
          });
          for (let r = 1; r <= degree; r++)
            for (let j = degree; j >= r; j--) {
              const index = span - degree + j;
              const denominator = expanded[index + degree - r + 1] - expanded[index];
              const a = denominator ? (u - expanded[index]) / denominator : 0;
              d[j] = d[j].map((v, axis) => (1 - a) * d[j - 1][axis] + a * v);
            }
          return d[degree].slice(0, 3).map((v) => v / d[degree][3]) as Vec;
        },
      };
    }
    const poly = part(entity, 'POLYLINE');
    if (poly) {
      const points = array(poly[1]).map((v) => point(v));
      if (points.length < 2) throw new Error(`Empty STEP polyline #${id}.`);
      return {
        id,
        breaks: points.map((_, i) => i),
        at: (u) => {
          const i = Math.min(points.length - 2, Math.max(0, Math.floor(u)));
          return lerp(points[i], points[i + 1], u - i);
        },
      };
    }
    const line = part(entity, 'LINE');
    if (line) {
      const origin = point(line[1]),
        vector = part(get(reference(line[2])), 'VECTOR');
      if (!vector) throw new Error(`Invalid STEP line #${id}.`);
      const direction = point(vector[1], 'DIRECTION'),
        norm = Math.hypot(...direction);
      if (!norm) throw new Error(`Invalid STEP direction #${id}.`);
      const magnitude = number(vector[2]) * scale;
      return {
        id,
        breaks: [],
        at: (u) => origin.map((v, i) => v + (direction[i] / norm) * magnitude * u) as Vec,
      };
    }
    const trim = part(entity, 'TRIMMED_CURVE');
    if (trim) {
      const basis = path(reference(trim[1]), depth + 1);
      const parameter = (v: Value) => {
        const parameter = array(v).find(
          (v): v is Typed => !!v && typeof v === 'object' && 'type' in v && v.type === 'PARAMETER_VALUE',
        );
        if (!parameter) throw new Error('STEP trimmed curves require parameter trims.');
        return number(parameter.args[0]);
      };
      const a = parameter(trim[2]),
        b = parameter(trim[3]);
      if (!(b > a)) throw new Error(`Unsupported reversed or periodic STEP trim #${id}.`);
      const reverse = trim[4] === '.F.';
      if (basis.breaks.length && (a < basis.breaks[0] - 1e-10 || b > basis.breaks.at(-1)! + 1e-10))
        throw new Error(`STEP trim #${id} lies outside its basis curve.`);
      return {
        id,
        breaks: [
          a,
          ...basis.breaks.filter((u) => u > a && u < b).map((u) => (reverse ? a + b - u : u)),
          b,
        ].sort((x, y) => x - y),
        at: (u) => basis.at(reverse ? a + b - u : u),
        nurbs: basis.nurbs,
        parameter: (u) => basis.parameter?.(reverse ? a + b - u : u) ?? u,
      };
    }
    throw new Error(
      `Unsupported STEP curve #${id}: ${entity.parts.map((p) => p.type).join(', ')}. Export B-spline or polyline wireframe curves.`,
    );
  };
  const sets = [...data.values()].filter((e) => part(e, 'GEOMETRIC_CURVE_SET'));
  if (!sets.length)
    throw new Error('No STEP wireframe curve set found. Export centerlines as wireframe curves.');
  const ids = [...new Set(sets.flatMap((e) => array(part(e, 'GEOMETRIC_CURVE_SET')![1]).map(reference)))];
  const paths = ids.filter((id) => !part(get(id), 'CARTESIAN_POINT')).map((id) => path(id));
  if (!paths.length || paths.length > MAX_CURVES)
    throw new Error(`Import between 1 and ${MAX_CURVES} curves at a time.`);
  if (paths.some((p) => p.breaks.length < 2))
    throw new Error('Unbounded STEP lines must be trimmed before import.');
  return paths;
}

// Adaptive chords preserve the source spline shape rather than refitting its control points.
export const STEP_CHORD_TOLERANCE = 0.002;
export const STEP_JOIN_TOLERANCE = 0.0001;
function sample(path: Path): Sample[] {
  const result: Sample[] = [{ u: path.breaks[0], p: path.at(path.breaks[0]) }];
  const subdivide = (a: Sample, b: Sample, depth: number) => {
    const probes = [0.25, 0.5, 0.75].map((t) => ({
      u: a.u + (b.u - a.u) * t,
      p: path.at(a.u + (b.u - a.u) * t),
    }));
    const error = Math.max(...probes.map((s, i) => distance(s.p, lerp(a.p, b.p, (i + 1) / 4))));
    if (error > STEP_CHORD_TOLERANCE) {
      if (depth > 20) throw new Error('STEP curve cannot be sampled within the accuracy limit.');
      subdivide(a, probes[1], depth + 1);
      subdivide(probes[1], b, depth + 1);
    } else result.push(b);
    if (result.length > MAX_CURVE_POINTS)
      throw new Error(`STEP curve #${path.id} exceeds ${MAX_CURVE_POINTS} samples at the required accuracy.`);
  };
  for (let i = 1; i < path.breaks.length; i++)
    subdivide(result.at(-1)!, { u: path.breaks[i], p: path.at(path.breaks[i]) }, 0);
  return result;
}

export function importStepCurves(doc: Document, text: string, filename: string) {
  const paths = readPaths(text),
    samples = paths.map(sample);
  if (doc.curves.length + paths.length > MAX_CURVES)
    throw new Error(`A document supports at most ${MAX_CURVES} curves.`);
  const endpoints: Vec[] = [];
  const junctionId = (p: Vec) => {
    const existing = endpoints.findIndex((q) => distance(p, q) <= STEP_JOIN_TOLERANCE);
    if (existing >= 0) return existing;
    endpoints.push(p);
    return endpoints.length - 1;
  };
  for (const points of samples) for (const s of [points[0], points.at(-1)!]) s.junction = junctionId(s.p);
  // An endpoint touching the interior of another curve is a branch, even when the STEP file has no topology.
  paths.forEach((path, index) => {
    const points = samples[index],
      inserts: Sample[] = [];
    endpoints.forEach((p, junction) => {
      if (points[0].junction === junction || points.at(-1)!.junction === junction) return;
      let best = { distance: Infinity, u: 0 };
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i];
        const delta = b.p.map((v, axis) => v - a.p[axis]);
        const length2 = delta.reduce((sum, v) => sum + v * v, 0);
        const t = length2
          ? Math.max(
              0,
              Math.min(1, delta.reduce((sum, v, axis) => sum + v * (p[axis] - a.p[axis]), 0) / length2),
            )
          : 0;
        if (distance(p, lerp(a.p, b.p, t)) > STEP_CHORD_TOLERANCE * 2 + STEP_JOIN_TOLERANCE) continue;
        let low = a.u,
          high = b.u;
        for (let iteration = 0; iteration < 45; iteration++) {
          const u = low + (high - low) / 3,
            v = high - (high - low) / 3;
          if (distance(p, path.at(u)) < distance(p, path.at(v))) high = v;
          else low = u;
        }
        const u = (low + high) / 2,
          d = distance(p, path.at(u));
        if (d < best.distance) best = { distance: d, u };
      }
      if (best.distance <= STEP_JOIN_TOLERANCE) inserts.push({ u: best.u, p, junction });
    });
    for (const inserted of inserts) {
      const existing = points.find((s) => distance(s.p, inserted.p) <= STEP_JOIN_TOLERANCE);
      if (existing) {
        existing.junction = inserted.junction;
        existing.p = inserted.p;
      } else points.push(inserted);
    }
    points.sort((a, b) => a.u - b.u);
  });
  const prefix = crypto.randomUUID(),
    setId = `step-points-${prefix}`;
  const pointData: DatumPoint[] = [],
    shared = new Map<number, string>();
  const names = new Set(
    [
      'origin',
      ...Object.values(doc.baseNames),
      ...doc.planes.map((p) => p.name),
      ...doc.pointSets.map((p) => p.name),
      ...doc.curves.map((p) => p.name),
      ...(doc.fillets ?? []).map((p) => p.name),
      ...(doc.references ?? []).map((p) => p.name),
      ...(doc.groups ?? []).map((p) => p.name),
    ].map((s) => s.toLowerCase()),
  );
  const uniqueName = (base: string) => {
    base = base.slice(0, 48) || 'STEP';
    let name = base,
      n = 2;
    while (names.has(name.toLowerCase())) name = `${base} ${n++}`;
    names.add(name.toLowerCase());
    return name;
  };
  const curves: CurveFeature[] = samples.map((samples, index) => ({
    id: `step-curve-${prefix}-${index}`,
    name: uniqueName(`Curve ${doc.curves.length + index + 1}`),
    visible: true,
    nodes: samples
      .map((s, i) => {
        let pointId = s.junction === undefined ? undefined : shared.get(s.junction);
        if (!pointId) {
          const p = s.junction === undefined ? s.p : endpoints[s.junction];
          if (p.some((v) => !Number.isFinite(v) || Math.abs(v) > COORDINATE_LIMIT))
            throw new Error('STEP coordinates exceed the supported range.');
          pointId = `p${pointData.length + 1}`;
          pointData.push({ id: pointId, name: `P${pointData.length + 1}`, x: p[0], y: p[1], z: p[2] });
          if (s.junction !== undefined) shared.set(s.junction, pointId);
        }
        return { id: `n${i}`, point: { setId, pointId }, connection: 'line' as const };
      })
      .filter((n, i, all) => i === 0 || n.point.pointId !== all[i - 1].point.pointId),
  }));
  curves.forEach((curve, index) => {
    const path = paths[index];
    if (!path.nurbs) return;
    curve.sourceNurbs = {
      ...path.nurbs,
      samples: curve.nodes.map((node) => {
        const sample = samples[index][Number(node.id.slice(1))];
        const point = pointData.find((p) => p.id === node.point!.pointId)!;
        return {
          nodeId: node.id,
          parameter: path.parameter!(sample.u),
          position: [point.x, point.y, point.z],
        };
      }),
    };
  });
  if (pointData.length > MAX_POINTS) throw new Error('STEP import exceeds the point limit.');
  const result = validateDocument({
    ...doc,
    pointSets: [
      ...doc.pointSets,
      {
        id: setId,
        name: uniqueName(`${filename.replace(/\.(stp|step)$/i, '')} points`),
        points: pointData,
        sourceFiles: [filename],
        visible: false,
      },
    ],
    curves: [...doc.curves, ...curves],
  });
  const ids = new Set(curves.map((c) => c.id));
  return {
    doc: result,
    curveIds: [...ids],
    sectionCount: curveSections(result).filter((s) => ids.has(s.curveId)).length,
  };
}
