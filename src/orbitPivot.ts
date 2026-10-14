import * as THREE from 'three';

// Keep the chosen point at its original screen position while OrbitControls
// rotates around it. Moving only controls.target would snap it to screen center.
export function setOrbitPivot(
  camera: THREE.OrthographicCamera,
  controls: { target: THREE.Vector3; update: () => unknown },
  pivot: THREE.Vector3,
) {
  camera.updateMatrixWorld();
  const screen = pivot.clone().project(camera);
  camera.position.add(pivot.clone().sub(controls.target));
  controls.target.copy(pivot);
  // Normalized view dimensions preserve the anchor through resize and zoom.
  camera.setViewOffset(2, 2, -screen.x, screen.y, 2, 2);
  controls.update();
  camera.updateMatrixWorld();
}
