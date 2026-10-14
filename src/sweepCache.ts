import type { Document } from './model.ts';
import type { EvaluatedCurve } from './curves.ts';
import type { SweepMesh } from './sweep.ts';
import { removeEndCaps } from './removeCaps.ts';

// A worker-local cache of one evaluated solid. Changing display properties or
// removing/restoring caps does not require recomputing the vessel geometry.
export class SweepCache {
  private key = '';
  private solid?: SweepMesh;
  private shell?: SweepMesh;
  private pending?: { key: string; promise: Promise<SweepMesh> };
  clear() {
    this.key = '';
    this.solid = this.shell = undefined;
    this.pending = undefined;
  }
  private geometryKey(doc: Pick<Document, 'curves'>, evaluated: EvaluatedCurve[]) {
    // Include every definition: shared rounding settings can come from a
    // suppressed curve, and unassigned curves still define junction topology.
    // Names/visibility are display state and do not change the resulting solid.
    return JSON.stringify([
      doc.curves.map(({ id, suppressed, nodes }) => [id, suppressed, nodes]),
      evaluated.map(({ id, nodeOffsets, positions }) => [id, nodeOffsets, Array.from(positions)]),
    ]);
  }

  get(
    doc: Pick<Document, 'curves'>,
    evaluated: EvaluatedCurve[],
    generate: () => SweepMesh,
    removeCaps: boolean,
  ): SweepMesh {
    const key = this.geometryKey(doc, evaluated);
    if (key !== this.key || !this.solid) {
      const solid = generate();
      this.key = key;
      this.solid = solid;
      this.shell = undefined;
    }
    return removeCaps ? (this.shell ??= removeEndCaps(this.solid)) : this.solid;
  }
  async getAsync(
    doc: Pick<Document, 'curves'>,
    evaluated: EvaluatedCurve[],
    generate: () => Promise<SweepMesh>,
    removeCaps: boolean,
  ): Promise<SweepMesh> {
    const key = this.geometryKey(doc, evaluated);
    if (key === this.key && this.solid)
      return removeCaps ? (this.shell ??= removeEndCaps(this.solid)) : this.solid;
    if (this.pending?.key !== key) this.pending = { key, promise: generate() };
    const pending = this.pending;
    try {
      const solid = await pending.promise;
      if (this.pending === pending) {
        this.key = key;
        this.solid = solid;
        this.shell = undefined;
        this.pending = undefined;
      }
      if (this.key === key && this.solid === solid)
        return removeCaps ? (this.shell ??= removeEndCaps(solid)) : solid;
      return removeCaps ? removeEndCaps(solid) : solid;
    } catch (error) {
      if (this.pending === pending) this.pending = undefined;
      throw error;
    }
  }
}
