export type NurbsDefinition = {
  degree: number;
  controls: [number, number, number][];
  weights: number[];
  knots: number[];
  multiplicities: number[];
};
export type SourceNurbs = NurbsDefinition & {
  samples: { nodeId: string; parameter: number; position: [number, number, number] }[];
};

export function validateSourceNurbs(source: SourceNurbs): SourceNurbs {
  const vector = (p: number[]) =>
    Array.isArray(p) && p.length === 3 && p.every((v) => Number.isFinite(v) && Math.abs(v) <= 1000000);
  if (
    !source ||
    !Number.isInteger(source.degree) ||
    source.degree < 1 ||
    source.degree > 16 ||
    !Array.isArray(source.controls) ||
    source.controls.length <= source.degree ||
    source.controls.length > 10000 ||
    !source.controls.every(vector) ||
    !Array.isArray(source.weights) ||
    source.weights.length !== source.controls.length ||
    source.weights.some((w) => !Number.isFinite(w) || w <= 0) ||
    !Array.isArray(source.knots) ||
    source.knots.length < 2 ||
    source.knots.length > 10000 ||
    source.knots.some((k, i) => !Number.isFinite(k) || (i > 0 && k <= source.knots[i - 1])) ||
    !Array.isArray(source.multiplicities) ||
    source.multiplicities.length !== source.knots.length ||
    source.multiplicities.some((m) => !Number.isInteger(m) || m < 1 || m > source.degree + 1) ||
    source.multiplicities.reduce((a, b) => a + b, 0) !== source.controls.length + source.degree + 1 ||
    !Array.isArray(source.samples) ||
    source.samples.length < 2 ||
    source.samples.length > 10000 ||
    source.samples.some(
      (s) =>
        !s ||
        typeof s.nodeId !== 'string' ||
        s.nodeId.length > 100 ||
        !Number.isFinite(s.parameter) ||
        s.parameter < source.knots[0] ||
        s.parameter > source.knots.at(-1)! ||
        !vector(s.position),
    )
  )
    throw new Error('Invalid imported NURBS guide.');
  return structuredClone(source);
}
