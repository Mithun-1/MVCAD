// Reproducible CPU benchmark: unchanged geometry, native vs accelerated picking,
// then metadata-only edits against the same large reference.
import { performance } from 'node:perf_hooks';
import { Group, Mesh, Raycaster, TorusKnotGeometry, Vector3 } from 'three';
import { referenceObjects, disposeReferenceObjects } from '../src/referenceObjects.ts';

const source = new TorusKnotGeometry(30, 8, 1000, 250).toNonIndexed();
const group = new Group();
const asset = {
  id: 'reference',
  name: 'Large reference',
  kind: 'stl',
  visible: true,
  opacity: 0.6,
  positions: source.attributes.position.array,
};
const textures = new Map();
const start = performance.now();
referenceObjects(group, [asset], [], [], () => {}, textures, false, false);
group.updateMatrixWorld(true);
const preparationMs = performance.now() - start;
const mesh = group.children[0];
const rays = Array.from(
  { length: 100 },
  (_, i) => new Raycaster(new Vector3(-45 + i * 0.9, 3, 100), new Vector3(0, 0, -1)),
);
function measure(raycast) {
  const start = performance.now();
  let hitCount = 0;
  for (const ray of rays) {
    const hits = [];
    raycast.call(mesh, ray, hits);
    if (hits.length) hitCount++;
  }
  return { milliseconds: performance.now() - start, hitCount };
}
const native = measure(Mesh.prototype.raycast);
const accelerated = measure(mesh.raycast);
if (native.hitCount !== accelerated.hitCount) throw new Error('Picking results differ.');
const editStart = performance.now();
for (let i = 0; i < 100; i++)
  referenceObjects(
    group,
    [
      {
        ...asset,
        opacity: i / 100,
        transform: { axes: [0, 1, 2], rotation: [0, i, 0], translation: [i, 0, 0] },
      },
    ],
    [],
    [],
    () => {},
    textures,
    false,
    false,
  );
console.log(
  JSON.stringify(
    {
      triangles: asset.positions.length / 9,
      preparationMs,
      native,
      accelerated,
      pickingSpeedup: native.milliseconds / accelerated.milliseconds,
      metadataEdits100Ms: performance.now() - editStart,
    },
    null,
    2,
  ),
);
disposeReferenceObjects(group);
source.dispose();
