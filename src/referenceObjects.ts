import * as THREE from 'three';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';
import type { EvaluatedPlane } from './model';
import type { ReferenceAsset } from './references';
import { referenceTransformMatrix } from './referenceTransform.ts';

type ReferenceMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial | THREE.MeshBasicMaterial>;
type Entry = {
  source: ReferenceAsset;
  mesh: ReferenceMesh;
  edges?: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
};
const scenes = new WeakMap<THREE.Group, Map<string, Entry>>();

function release(entry: Entry) {
  entry.mesh.removeFromParent();
  entry.mesh.geometry.boundsTree = undefined;
  entry.mesh.geometry.dispose();
  entry.mesh.material.dispose();
  entry.edges?.geometry.dispose();
  entry.edges?.material.dispose();
}

export function disposeReferenceObjects(group: THREE.Group) {
  scenes.get(group)?.forEach(release);
  scenes.delete(group);
}

// Reference vertices are immutable. Keep GPU buffers, normals, bounds, picking
// acceleration and edge geometry until the source changes or the reference is removed.
export function referenceObjects(
  group: THREE.Group,
  assets: ReferenceAsset[],
  planes: EvaluatedPlane[],
  clips: THREE.Plane[],
  render: () => void,
  textures: Map<string, THREE.Texture>,
  showEdges: boolean,
  darkMode: boolean,
) {
  let entries = scenes.get(group);
  if (!entries) scenes.set(group, (entries = new Map()));
  const ids = new Set(assets.map((a) => a.id));
  for (const [id, entry] of entries)
    if (!ids.has(id)) {
      release(entry);
      entries.delete(id);
    }
  const images = new Set(assets.flatMap((a) => (a.kind === 'image' ? [a.dataUrl] : [])));
  for (const [url, texture] of textures)
    if (!images.has(url)) {
      texture.dispose();
      textures.delete(url);
    }
  for (const asset of assets) {
    let entry = entries.get(asset.id);
    if (
      entry &&
      (entry.source.kind !== asset.kind ||
        (asset.kind === 'stl' && entry.source.kind === 'stl' && entry.source.positions !== asset.positions))
    ) {
      release(entry);
      entries.delete(asset.id);
      entry = undefined;
    }
    const frame = asset.kind === 'image' ? planes.find((p) => p.id === asset.planeId)?.frame : undefined;
    if (
      !asset.visible ||
      (asset.kind === 'image' &&
        (!frame ||
          ![asset.width, asset.height, asset.centerU, asset.centerV].every(Number.isFinite) ||
          asset.width <= 0 ||
          asset.height <= 0))
    ) {
      entry?.mesh.removeFromParent();
      continue;
    }
    if (!entry) {
      let geometry: THREE.BufferGeometry;
      let material: ReferenceMesh['material'];
      if (asset.kind === 'stl') {
        geometry = new THREE.BufferGeometry();
        const positions =
          asset.positions instanceof Float32Array ? asset.positions : new Float32Array(asset.positions);
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        // Indirect indexing preserves imported vertex order and the original asset.
        geometry.boundsTree = new MeshBVH(geometry, { indirect: true });
        material = new THREE.MeshStandardMaterial({ color: '#8daec0', roughness: 0.7, metalness: 0 });
      } else {
        geometry = new THREE.PlaneGeometry(1, 1);
        material = new THREE.MeshBasicMaterial({
          color: '#ffffff',
          toneMapped: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        });
      }
      material.side = THREE.DoubleSide;
      material.transparent = true;
      material.depthWrite = false;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.matrixAutoUpdate = false;
      mesh.userData.id = asset.id;
      mesh.userData.reference = true;
      if (asset.kind === 'stl')
        mesh.raycast = function (ray, hits) {
          const previous = ray.firstHitOnly;
          // With sections, a clipped front hit must not conceal a visible rear hit.
          ray.firstHitOnly = !this.material.clippingPlanes?.length;
          try {
            acceleratedRaycast.call(this, ray, hits);
          } finally {
            ray.firstHitOnly = previous;
          }
        };
      else mesh.userData.referenceImage = true;
      entry = { source: asset, mesh };
      entries.set(asset.id, entry);
    }
    const { mesh } = entry;
    entry.source = asset;
    if (asset.kind === 'stl') mesh.matrix.copy(referenceTransformMatrix(asset.transform));
    else {
      let texture = textures.get(asset.dataUrl);
      if (!texture) {
        texture = new THREE.TextureLoader().load(asset.dataUrl, () => {
          if (textures.has(asset.dataUrl)) render();
        });
        textures.set(asset.dataUrl, texture);
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      mesh.material.map = texture;
      const u = new THREE.Vector3(...frame!.slice(3, 6));
      const v = new THREE.Vector3(...frame!.slice(6, 9));
      const n = new THREE.Vector3(...frame!.slice(9, 12));
      mesh.matrix.makeBasis(u, v, n);
      mesh.matrix.setPosition(
        new THREE.Vector3(...frame!.slice(0, 3))
          .addScaledVector(u, asset.centerU)
          .addScaledVector(v, asset.centerV),
      );
      mesh.matrix.scale(new THREE.Vector3(asset.width, asset.height, 1));
    }
    mesh.matrixWorldNeedsUpdate = true;
    mesh.material.opacity = asset.opacity;
    if (mesh.material.clippingPlanes?.length !== clips.length) mesh.material.needsUpdate = true;
    mesh.material.clippingPlanes = clips;
    if ((asset.kind === 'image' || showEdges) && !entry.edges) {
      entry.edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry, 30),
        new THREE.LineBasicMaterial({ transparent: true }),
      );
      mesh.add(entry.edges);
    }
    if (entry.edges) {
      entry.edges.visible = asset.kind === 'image' || showEdges;
      const material = entry.edges.material;
      material.color.set(asset.kind === 'image' ? '#35a9d5' : darkMode ? '#dbe7ef' : '#253c49');
      material.opacity = asset.kind === 'image' ? 1 : asset.opacity;
      if (material.clippingPlanes?.length !== clips.length) material.needsUpdate = true;
      material.clippingPlanes = clips;
    }
    if (mesh.parent !== group) group.add(mesh);
  }
  render();
}
