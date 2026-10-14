export type MeasurePoint = [number, number, number];
export type CadFaceMeasurement = {
  body: number;
  id: number;
  index: number;
  area: number;
  diameter?: number;
  sweepDiameter?: boolean;
  surface: string;
};
export type MeasureSelection = {
  key: string;
  label: string;
  position: MeasurePoint;
  face?: CadFaceMeasurement;
};
export type MeasureResult = { distance: number; from: MeasurePoint; to: MeasurePoint; minimum: boolean };
export function pickedDistance(a: MeasureSelection, b: MeasureSelection): MeasureResult {
  return {
    distance: Math.hypot(...a.position.map((v, i) => v - b.position[i])),
    from: a.position,
    to: b.position,
    minimum: false,
  };
}
export function measureNumber(value: number) {
  return Number(value.toPrecision(12)).toString();
}
