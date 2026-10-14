import { forwardRef, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';

const axes = [
  { name: 'X', color: '#c96765', direction: new THREE.Vector3(1, 0, 0) },
  { name: 'Y', color: '#669473', direction: new THREE.Vector3(0, 1, 0) },
  { name: 'Z', color: '#5984bd', direction: new THREE.Vector3(0, 0, 1) },
];
export type AxisIndicatorApi = { update: (camera: THREE.Camera) => void };

export const AxisIndicator = forwardRef<AxisIndicatorApi>(function AxisIndicator(_, ref) {
  const groups = useRef<(SVGGElement | null)[]>([]);
  const inverse = useRef(new THREE.Quaternion());
  const direction = useRef(new THREE.Vector3());

  useImperativeHandle(
    ref,
    () => ({
      update(camera) {
        // Use orientation only: pan and zoom must not move or resize the indicator.
        inverse.current.copy(camera.quaternion).invert();
        const depths: { group: SVGGElement; z: number }[] = [];
        axes.forEach((axis, index) => {
          const group = groups.current[index];
          if (!group) return;
          const v = direction.current.copy(axis.direction).applyQuaternion(inverse.current);
          const dx = v.x;
          const dy = -v.y;
          const length = Math.hypot(dx, dy);
          const endOn = length < 0.12;
          const x = 40 + dx * 24;
          const y = 40 + dy * 24;
          const line = group.querySelector('line')!;
          const head = group.querySelector('path')!;
          const ring = group.querySelector('circle')!;
          const label = group.querySelector('text')!;
          line.setAttribute('x2', String(x));
          line.setAttribute('y2', String(y));
          line.style.display = endOn ? 'none' : '';
          ring.style.display = endOn ? '' : 'none';
          if (endOn) {
            // A dot is an arrow coming toward the viewer; a cross is its tail going away.
            head.setAttribute('d', v.z > 0 ? 'M40 40h0' : 'M38 38l4 4m-4 0l4 -4');
            label.setAttribute('x', '52');
            label.setAttribute('y', '28');
          } else {
            const ux = dx / length;
            const uy = dy / length;
            head.setAttribute(
              'd',
              `M${x - ux * 4 - uy * 2.5} ${y - uy * 4 + ux * 2.5}L${x} ${y}L${x - ux * 4 + uy * 2.5} ${y - uy * 4 - ux * 2.5}`,
            );
            label.setAttribute('x', String(x + ux * 9));
            label.setAttribute('y', String(y + uy * 9));
          }
          group.querySelector('title')!.textContent =
            `Positive ${axis.name}${endOn ? (v.z > 0 ? ' toward viewer' : ' away from viewer') : ''}`;
          depths.push({ group, z: v.z });
        });
        // Draw the nearer axes last when their projected lines overlap.
        depths.sort((a, b) => a.z - b.z).forEach(({ group }) => group.parentNode?.appendChild(group));
      },
    }),
    [],
  );

  return (
    <svg
      className="axis-key"
      viewBox="0 0 80 80"
      role="img"
      aria-label="Camera orientation: positive X, Y, and Z axes"
    >
      <title>Positive axes follow the camera. Dot: toward you. Cross: away from you.</title>
      <circle cx="40" cy="40" r="2.5" fill="#718597" />
      {axes.map((axis, index) => (
        <g
          key={axis.name}
          data-axis={axis.name}
          ref={(group) => {
            groups.current[index] = group;
          }}
        >
          <title>Positive {axis.name}</title>
          <line x1="40" y1="40" stroke={axis.color} strokeWidth="1.5" />
          <circle
            cx="40"
            cy="40"
            r="5"
            fill="none"
            stroke={axis.color}
            strokeWidth="1.5"
            style={{ display: 'none' }}
          />
          <path
            fill="none"
            stroke={axis.color}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <text fill={axis.color}>{axis.name}</text>
        </g>
      ))}
    </svg>
  );
});
