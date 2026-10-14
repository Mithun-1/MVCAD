import * as cad from 'replicad';
export type ExportUnit = 'mm' | 'cm' | 'm';

// Export the unchanged native B-Rep used to generate the display triangulation.
// OpenCascade writes topology, trimming curves, analytic/NURBS surfaces and units.
export function exportCadStep(breps: string[], name: string, unit: ExportUnit): Blob {
  if (!breps.length) throw new Error('Generate a body before exporting.');
  if (!['mm', 'cm', 'm'].includes(unit)) throw new Error('Choose a supported model unit.');
  const shapes: cad.AnyShape[] = [];
  try {
    for (const brep of breps) shapes.push(cad.deserializeShape(brep));
    return cad.exportSTEP(
      shapes.map((shape, i) => ({ shape, name: `${name} - Body ${i + 1}`, color: '#b52636' })),
      { unit, modelUnit: unit },
    );
  } finally {
    shapes.forEach((shape) => shape.delete());
  }
}
