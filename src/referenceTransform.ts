import { Euler, MathUtils, Matrix4 } from 'three';
import { validReferenceTransform, type ReferenceTransform } from './references.ts';

// Imported-axis permutation, then world X/Y/Z rotations about the origin, then translation.
export function referenceTransformMatrix(transform?: ReferenceTransform): Matrix4 {
  if (!transform || !validReferenceTransform(transform)) return new Matrix4();
  const { axes, rotation, translation } = transform;
  const permutation = new Matrix4().set(
    +(axes[0] === 0),
    +(axes[0] === 1),
    +(axes[0] === 2),
    0,
    +(axes[1] === 0),
    +(axes[1] === 1),
    +(axes[1] === 2),
    0,
    +(axes[2] === 0),
    +(axes[2] === 1),
    +(axes[2] === 2),
    0,
    0,
    0,
    0,
    1,
  );
  const matrix = new Matrix4()
    .makeRotationFromEuler(
      new Euler(
        MathUtils.degToRad(rotation[0] % 360),
        MathUtils.degToRad(rotation[1] % 360),
        MathUtils.degToRad(rotation[2] % 360),
        'ZYX',
      ),
    )
    .multiply(permutation);
  return matrix.setPosition(...translation);
}
