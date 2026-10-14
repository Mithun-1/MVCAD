import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { setOrbitPivot } from '../src/orbitPivot.ts';

test('cursor orbit keeps the model still when choosing a pivot and anchors that point through rotation', () => {
  const camera = new THREE.OrthographicCamera(-250, 250, 180, -180, 0.1, 10000);
  camera.position.set(280, 220, 280);
  const controls = new OrbitControls(camera);
  camera.zoom = 2.3;
  camera.updateProjectionMatrix();
  const points = [new THREE.Vector3(52, 23, -17), new THREE.Vector3(-35, 11, 73), new THREE.Vector3()];
  const screen = (p) => {
    camera.updateMatrixWorld();
    const v = p.clone().project(camera);
    return new THREE.Vector2(v.x, v.y);
  };
  for (const pivot of points.slice(0, 2)) {
    const before = points.map(screen),
      rotation = camera.quaternion.clone();
    setOrbitPivot(camera, controls, pivot);
    points.forEach((p, i) => assert.ok(screen(p).distanceTo(before[i]) < 1e-10, 'no jump on pointer down'));
    assert.ok(camera.quaternion.angleTo(rotation) < 1e-7);
    const anchor = screen(pivot),
      other = screen(points[2]);
    controls.rotateLeft(0.5);
    controls.rotateUp(0.2);
    assert.ok(screen(pivot).distanceTo(anchor) < 1e-10, 'chosen point stays at its original pixel');
    assert.ok(screen(points[2]).distanceTo(other) > 0.01, 'model rotates around that point');
    controls.dollyIn(1.2);
    assert.ok(screen(pivot).distanceTo(anchor) < 1e-10, 'zoom keeps the pivot stable');
  }
  camera.clearViewOffset();
  assert.ok(screen(controls.target).length() < 1e-10, 'fit and standard views can restore a centered target');
});
