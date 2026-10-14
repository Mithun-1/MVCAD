import * as THREE from 'three';
import type { EvaluatedPlane } from './model';
import type { ReferenceAsset } from './references';

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
  const resources: { dispose(): void }[] = [];
  const images = new Set(assets.flatMap((a) => (a.kind === 'image' ? [a.dataUrl] : [])));
  for (const [url, texture] of textures)
    if (!images.has(url)) {
      texture.dispose();
      textures.delete(url);
    }
  for (const asset of assets) {
    if (!asset.visible) continue;
    let geometry: THREE.BufferGeometry, material: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
    const matrix = new THREE.Matrix4();
    if (asset.kind === 'stl') {
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(asset.positions, 3));
      geometry.computeVertexNormals();
      material = new THREE.MeshStandardMaterial({ color: '#8daec0', roughness: 0.7, metalness: 0 });
    } else {
      const frame = planes.find((p) => p.id === asset.planeId)?.frame;
      if (
        !frame ||
        ![asset.width, asset.height, asset.centerU, asset.centerV].every(Number.isFinite) ||
        asset.width <= 0 ||
        asset.height <= 0
      )
        continue;
      geometry = new THREE.PlaneGeometry(asset.width, asset.height);
      material = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
      let texture = textures.get(asset.dataUrl);
      if (!texture) {
        texture = new THREE.TextureLoader().load(asset.dataUrl, () => {
          if (textures.has(asset.dataUrl)) render();
        });
        textures.set(asset.dataUrl, texture);
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      material.map = texture;
      const u = new THREE.Vector3(...frame.slice(3, 6)),
        v = new THREE.Vector3(...frame.slice(6, 9)),
        n = new THREE.Vector3(...frame.slice(9, 12));
      matrix.makeBasis(u, v, n);
      matrix.setPosition(
        new THREE.Vector3(...frame.slice(0, 3))
          .addScaledVector(u, asset.centerU)
          .addScaledVector(v, asset.centerV),
      );
      material.polygonOffset = true;
      material.polygonOffsetFactor = -2;
      material.polygonOffsetUnits = -2;
    }
    material.side = THREE.DoubleSide;
    material.transparent = true;
    material.opacity = asset.opacity;
    material.depthWrite = false;
    material.clippingPlanes = clips;
    const object = new THREE.Mesh(geometry, material);
    object.applyMatrix4(matrix);
    object.userData.id = asset.id;
    object.userData.reference = true;
    if (asset.kind === 'image') {
      object.userData.referenceImage = true;
      const outline = new THREE.EdgesGeometry(geometry);
      const lineMaterial = new THREE.LineBasicMaterial({ color: '#35a9d5', clippingPlanes: clips });
      object.add(new THREE.LineSegments(outline, lineMaterial));
      resources.push(outline, lineMaterial);
    } else if (showEdges) {
      const outline = new THREE.EdgesGeometry(geometry, 30);
      const lineMaterial = new THREE.LineBasicMaterial({
        color: darkMode ? '#dbe7ef' : '#253c49',
        transparent: true,
        opacity: asset.opacity,
        clippingPlanes: clips,
      });
      object.add(new THREE.LineSegments(outline, lineMaterial));
      resources.push(outline, lineMaterial);
    }
    group.add(object);
    resources.push(geometry, material);
  }
  render();
  return () => {
    group.clear();
    resources.forEach((r) => r.dispose());
  };
}
