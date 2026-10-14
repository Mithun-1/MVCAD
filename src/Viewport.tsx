import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import rbcAnimation from './assets/regenerating-rbc.webp';
import rbcStill from './assets/regenerating-rbc-still.png';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { Box, Expand, MousePointer2 } from 'lucide-react';
import { BASE_PLANES, type Document, type EvaluatedPlane } from './model';
import type { PointSet, EvaluatedPointSet } from './points';
import { AxisIndicator, type AxisIndicatorApi } from './AxisIndicator';
import { planeDisplayBounds, pointContentBounds } from './displayBounds';
import type { SweepMesh } from './sweep';
import { setOrbitPivot } from './orbitPivot';
import type { ReferenceAsset } from './references';
import { referenceObjects } from './referenceObjects';
import { boundingPlanePatch, sectionPlanes, type BoxSpacing, type SectionView } from './viewTools';
import {
  createPointResolver,
  curveSections,
  type CurveFeature,
  type CurveNode,
  type PointReference,
  type EvaluatedCurve,
} from './curves';

export type View = 'isometric' | 'front' | 'top' | 'right';
export type ViewportApi = { view: (view: View) => void; fit: () => void; normalTo: (id: string) => void };
type Props = {
  darkMode: boolean;
  showEdges?: boolean;
  doc: Document;
  geometry: EvaluatedPlane[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onPlaneContextMenu: (id: string, x: number, y: number) => void;
  pointGeometry: EvaluatedPointSet[];
  pointPreview?: PointSet;
  curveGeometry: EvaluatedCurve[];
  curvePreview?: CurveFeature;
  curveEditingId?: string;
  curveNodes?: CurveNode[];
  onPointPick: (point: PointReference, x: number, y: number) => void;
  pickedPoint: PointReference | null;
  sweep?: SweepMesh;
  filletPicking?: boolean;
  filletEdges?: string[];
  generationProgress?: number;
  sections: SectionView[];
  spacing?: BoxSpacing;
  viewControls?: ReactNode;
  referenceDraft?: ReferenceAsset;
  referenceSizing?: boolean;
  onReferenceSize?: (size: { width: number; height: number; centerU: number; centerV: number }) => void;
};
type Runtime = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  controls: OrbitControls;
  resetOrbitFrame: () => void;
  planes: THREE.Group;
  points: THREE.Group;
  curves: THREE.Group;
  solids: THREE.Group;
  bodyEdges: THREE.Group;
  references: THREE.Group;
  referenceTextures: Map<string, THREE.Texture>;
  pointTexture: THREE.CanvasTexture;
  render: () => void;
  fit: () => void;
  clearHover: () => void;
};
const vector = (a: number[]) => new THREE.Vector3(a[0], a[1], a[2]);
function disposeObject(group: THREE.Object3D) {
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
    else mesh.material?.dispose();
  });
}

export const Viewport = forwardRef<ViewportApi, Props>(function Viewport(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const dimensionOverlay = useRef<SVGSVGElement>(null);
  const axisIndicator = useRef<AxisIndicatorApi>(null);
  const runtime = useRef<Runtime | null>(null);
  const lastReferenceDraft = useRef<string | undefined>(undefined);
  const latest = useRef(props);
  latest.current = props;
  const [error, setError] = useState('');
  const [activeView, setActiveView] = useState<string>('isometric');

  const normalTo = (id: string) => {
    const r = runtime.current;
    const plane = latest.current.geometry.find((p) => p.id === id);
    if (!r || !plane) return;
    r.camera.clearViewOffset();
    const center = vector(plane.frame.slice(0, 3));
    r.controls.target.copy(center);
    r.camera.position.copy(center).addScaledVector(vector(plane.frame.slice(9, 12)), 500);
    r.camera.up.copy(vector(plane.frame.slice(6, 9)));
    r.resetOrbitFrame();
    r.camera.far = 10000;
    r.camera.updateProjectionMatrix();
    r.controls.update();
    setActiveView(id);
    r.render();
  };
  const view = (name: View) => {
    const r = runtime.current;
    if (!r) return;
    if (name === 'isometric') {
      r.camera.clearViewOffset();
      r.camera.up.set(0, 1, 0);
      r.camera.position.copy(r.controls.target).add(new THREE.Vector3(280, 220, 280));
      r.resetOrbitFrame();
      r.controls.update();
      r.render();
      setActiveView(name);
    } else normalTo(name);
  };
  useImperativeHandle(ref, () => ({ view, normalTo, fit: () => runtime.current?.fit() }));

  useEffect(() => {
    const container = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.localClippingEnabled = true;
    } catch {
      setError('The 3D viewport needs WebGL2. Enable hardware acceleration or try another browser.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute(
      'aria-label',
      '3D CAD viewport. Drag to orbit, right-drag to pan, scroll to zoom.',
    );
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.tabIndex = -1;
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-200, 200, 200, -200, 0.1, 10000);
    camera.position.set(280, 220, 280);
    const makeControls = (target = new THREE.Vector3()) => {
      const position = camera.position.clone();
      const next = new OrbitControls(camera, renderer.domElement);
      next.enableDamping = false;
      next.minZoom = 0.000001;
      next.maxZoom = 100;
      next.zoomSpeed = 1.15;
      camera.position.copy(position);
      next.target.copy(target);
      next.update();
      return next;
    };
    let controls = makeControls();
    const planes = new THREE.Group();
    scene.add(planes);
    const points = new THREE.Group();
    scene.add(points);
    const curves = new THREE.Group();
    scene.add(curves);
    const solids = new THREE.Group();
    scene.add(solids);
    const bodyEdges = new THREE.Group();
    scene.add(bodyEdges);
    const references = new THREE.Group();
    const referenceTextures = new Map<string, THREE.Texture>();
    scene.add(references);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x52647d, 2));
    const light = new THREE.DirectionalLight(0xffffff, 2.2);
    light.position.set(1, 2, 3);
    scene.add(light);
    const marker = document.createElement('canvas');
    marker.width = marker.height = 32;
    const context = marker.getContext('2d')!;
    context.strokeStyle = '#fff';
    context.lineWidth = 9;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(6, 6);
    context.lineTo(26, 26);
    context.moveTo(26, 6);
    context.lineTo(6, 26);
    context.stroke();
    const pointTexture = new THREE.CanvasTexture(marker);
    const axes = new THREE.AxesHelper(25);
    axes.setColors(0xc96765, 0x669473, 0x5984bd);
    scene.add(axes);
    const origin = new THREE.Mesh(
      new THREE.SphereGeometry(1.8, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x334b60, depthTest: false }),
    );
    origin.renderOrder = 10;
    origin.userData.id = 'origin';
    scene.add(origin);
    // A single reusable marker highlights an individual point without rebuilding its cloud.
    const hoverGeometry = new THREE.BufferGeometry();
    hoverGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    const hoverMarker = new THREE.Group();
    for (const [size, color] of [
      [24, '#ffffff'],
      [19, '#ff8a24'],
    ] as const) {
      const marker = new THREE.Points(
        hoverGeometry,
        new THREE.PointsMaterial({
          color,
          size,
          sizeAttenuation: false,
          map: pointTexture,
          alphaTest: 0.5,
          depthTest: false,
          depthWrite: false,
        }),
      );
      marker.renderOrder = size === 24 ? 20 : 21;
      hoverMarker.add(marker);
    }
    hoverMarker.visible = false;
    scene.add(hoverMarker);
    type Pick = {
      id: string;
      object: THREE.Object3D;
      index?: number;
      point?: PointReference;
      position: THREE.Vector3;
    };
    let pointer: { clientX: number; clientY: number } | null = null;
    let hovered: Pick | undefined;
    let restoreHover = () => {};
    const clearHover = () => {
      restoreHover();
      restoreHover = () => {};
      hovered = undefined;
      hoverMarker.visible = false;
      renderer.domElement.style.cursor = '';
      delete renderer.domElement.dataset.hoverFeature;
      delete renderer.domElement.dataset.hoverPoint;
    };
    const updateHover = () => {
      const hit = pointer ? pick(pointer) : undefined;
      if (hit?.object === hovered?.object && hit?.index === hovered?.index) return;
      clearHover();
      if (!hit) return;
      hovered = hit;
      renderer.domElement.style.cursor = 'pointer';
      renderer.domElement.dataset.hoverFeature = hit.id;
      if (hit.point) {
        const cloud = hit.object as THREE.Points;
        const position = new THREE.Vector3().fromBufferAttribute(
          cloud.geometry.getAttribute('position'),
          hit.index!,
        );
        hoverMarker.position.copy(cloud.localToWorld(position));
        hoverMarker.visible = true;
        renderer.domElement.dataset.hoverPoint = hit.point.pointId;
      } else {
        // Save exact material values so hover never replaces selection styling.
        const objects = hit.object.userData.referenceImage
          ? hit.object.children
          : hit.object.parent === planes || hit.object.parent?.parent === planes
            ? hit.object.parent!.children
            : [hit.object];
        const restores: (() => void)[] = [];
        for (const object of objects) {
          const material = (object as THREE.Mesh).material as
            | THREE.MeshBasicMaterial
            | THREE.LineBasicMaterial;
          if (!material?.color) continue;
          const color = material.color.clone();
          const opacity = material.opacity;
          material.color.set(latest.current.darkMode ? '#ffbd69' : '#d36b09');
          if (!object.userData.reference)
            material.opacity = object instanceof THREE.Mesh && hit.object.parent?.parent === planes ? 0.3 : 1;
          restores.push(() => {
            material.color.copy(color);
            material.opacity = opacity;
          });
        }
        restoreHover = () => restores.forEach((restore) => restore());
      }
    };
    let scheduled = 0;
    const render = () => {
      if (scheduled) return;
      scheduled = requestAnimationFrame(() => {
        scheduled = 0;
        updateHover();
        renderer.render(scene, camera);
        const overlay = dimensionOverlay.current,
          spacing = latest.current.spacing;
        if (overlay && spacing) {
          const rect = renderer.domElement.getBoundingClientRect();
          const project = (point: number[]) => {
            const p = new THREE.Vector3(...point).project(camera);
            return [((p.x + 1) * rect.width) / 2, ((1 - p.y) * rect.height) / 2];
          };
          const a = project(spacing.bodyPoint),
            b = project(spacing.boxPoint);
          const line = overlay.querySelector('[data-dimension-line]')!;
          for (const [key, value] of Object.entries({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] }))
            line.setAttribute(key, String(value));
          overlay.querySelectorAll('circle').forEach((circle, i) => {
            circle.setAttribute('cx', String((i ? b : a)[0]));
            circle.setAttribute('cy', String((i ? b : a)[1]));
          });
          const mx = (a[0] + b[0]) / 2,
            my = (a[1] + b[1]) / 2;
          const x = Math.max(85, Math.min(rect.width - 85, mx + 60)),
            y = Math.max(25, Math.min(rect.height - 25, my - 40));
          overlay.querySelector('g')!.setAttribute('transform', `translate(${x},${y})`);
          const leader = overlay.querySelector('[data-dimension-leader]')!;
          for (const [key, value] of Object.entries({ x1: mx, y1: my, x2: x, y2: y }))
            leader.setAttribute(key, String(value));
        }
        axisIndicator.current?.update(camera);
      });
    };
    const fit = () => {
      camera.clearViewOffset();
      const bounds = new THREE.Box3().setFromObject(planes);
      bounds.union(new THREE.Box3().setFromObject(points));
      bounds.union(new THREE.Box3().setFromObject(curves));
      bounds.union(new THREE.Box3().setFromObject(solids));
      bounds.union(new THREE.Box3().setFromObject(references));
      const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
      const diameter = bounds.isEmpty() ? 200 : Math.max(bounds.getSize(new THREE.Vector3()).length(), 1e-6);
      const direction = camera.position.clone().sub(controls.target).normalize();
      controls.target.copy(center);
      camera.position.copy(center).addScaledVector(direction, Math.max(diameter * 2, 500));
      camera.far = Math.max(10000, diameter * 4);
      camera.zoom = Math.min(
        controls.maxZoom,
        Math.max(
          controls.minZoom,
          Math.min(camera.right - camera.left, camera.top - camera.bottom) / (diameter * 1.2),
        ),
      );
      camera.updateProjectionMatrix();
      controls.update();
      render();
    };
    runtime.current = {
      renderer,
      scene,
      camera,
      controls,
      resetOrbitFrame: () => {
        // OrbitControls captures camera.up at construction. Recreate it when a
        // standard/plane view changes that axis, rather than retaining a stale frame.
        const target = controls.target.clone();
        controls.removeEventListener('change', render);
        controls.removeEventListener('start', onStart);
        controls.dispose();
        controls = makeControls(target);
        controls.addEventListener('change', render);
        controls.addEventListener('start', onStart);
        if (runtime.current) runtime.current.controls = controls;
      },
      planes,
      points,
      curves,
      solids,
      bodyEdges,
      references,
      referenceTextures,
      pointTexture,
      render,
      fit,
      clearHover,
    };
    controls.addEventListener('change', render);
    const onStart = () => setActiveView('custom');
    controls.addEventListener('start', onStart);
    const resize = new ResizeObserver(() => {
      const { clientWidth: w, clientHeight: h } = container;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.left = (-180 * w) / h;
      camera.right = (180 * w) / h;
      camera.top = 180;
      camera.bottom = -180;
      camera.updateProjectionMatrix();
      render();
    });
    resize.observe(container);
    let down = { x: 0, y: 0 };
    let dragged = false;
    let pendingPivot: THREE.Vector3 | null = null;
    let imageAnchor: THREE.Vector2 | null = null;
    const imagePoint = (e: { clientX: number; clientY: number }) => {
      const asset = latest.current.referenceDraft;
      if (asset?.kind !== 'image') return null;
      const frame = latest.current.geometry.find((p) => p.id === asset.planeId)?.frame;
      if (!frame) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      camera.updateMatrixWorld();
      ray.setFromCamera(
        new THREE.Vector2(
          (2 * (e.clientX - rect.left)) / rect.width - 1,
          1 - (2 * (e.clientY - rect.top)) / rect.height,
        ),
        camera,
      );
      const origin = vector(frame.slice(0, 3)),
        normal = vector(frame.slice(9, 12));
      const hit = ray.ray.intersectPlane(
        new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin),
        new THREE.Vector3(),
      );
      if (!hit) return null;
      hit.sub(origin);
      return new THREE.Vector2(hit.dot(vector(frame.slice(3, 6))), hit.dot(vector(frame.slice(6, 9))));
    };
    const onDown = (e: PointerEvent) => {
      pendingPivot = null;
      if (
        e.button === 0 &&
        latest.current.referenceSizing &&
        latest.current.referenceDraft?.kind === 'image'
      ) {
        imageAnchor = imagePoint(e);
        if (imageAnchor) {
          controls.enabled = false;
          renderer.domElement.setPointerCapture(e.pointerId);
          e.stopImmediatePropagation();
          clearHover();
          return;
        }
      }
      if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.isPrimary) {
        const hit = pick(e);
        // Empty space uses the current focus depth, so every drag can choose
        // a useful pivot even when no surface lies beneath the cursor.
        const pivot =
          hit?.position ??
          ray.ray.intersectPlane(
            new THREE.Plane().setFromNormalAndCoplanarPoint(
              camera.getWorldDirection(new THREE.Vector3()),
              controls.target,
            ),
            new THREE.Vector3(),
          );
        pendingPivot = pivot ?? null;
      }
      down = { x: e.clientX, y: e.clientY };
      dragged = false;
      pointer = null;
      clearHover();
      render();
    };
    const onMove = (e: PointerEvent) => {
      if (imageAnchor) {
        const p = imagePoint(e);
        if (p) {
          const width = Math.abs(p.x - imageAnchor.x),
            height = Math.abs(p.y - imageAnchor.y);
          const centerU = (p.x + imageAnchor.x) / 2,
            centerV = (p.y + imageAnchor.y) / 2;
          if (
            width > 0.000001 &&
            height > 0.000001 &&
            [width, height, centerU, centerV].every((v) => Math.abs(v) <= 1000000)
          )
            latest.current.onReferenceSize?.({ width, height, centerU, centerV });
        }
        e.stopImmediatePropagation();
        return;
      }
      if (pendingPivot && e.buttons & 1 && (e.clientX !== down.x || e.clientY !== down.y)) {
        setOrbitPivot(camera, controls, pendingPivot);
        pendingPivot = null;
      }
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) dragged = true;
      pointer = e.buttons || e.pointerType === 'touch' ? null : { clientX: e.clientX, clientY: e.clientY };
      render();
    };
    const onLeave = () => {
      pointer = null;
      clearHover();
      render();
    };
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    const ray = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const pick = (e: { clientX: number; clientY: number }): Pick | undefined => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      // Update matrices before picking when geometry or camera changed this frame.
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld();
      ray.setFromCamera(
        mouse.set(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      ray.params.Points.threshold = ((camera.top - camera.bottom) / camera.zoom / rect.height) * 6;
      const clips = sectionPlanes(latest.current.sections, latest.current.geometry);
      const visible = (point: THREE.Vector3) => clips.every((clip) => clip.distanceToPoint(point) >= 0);
      if (latest.current.filletPicking) {
        ray.params.Line.threshold = ray.params.Points.threshold;
        const front = ray.intersectObjects(solids.children, false).find((hit) => visible(hit.point));
        const edge = ray
          .intersectObjects(bodyEdges.children, false)
          .find(
            (hit) =>
              visible(hit.point) &&
              (!front ||
                latest.current.filletEdges?.includes(hit.object.userData.id.slice(9)) ||
                hit.distance <= front.distance + ray.params.Line.threshold! * 2),
          );
        return edge
          ? { id: edge.object.userData.id, object: edge.object, position: edge.point.clone() }
          : undefined;
      }
      const pointHit = ray
        .intersectObjects(
          points.children.filter((o) => o.userData.id && !o.userData.preview),
          false,
        )
        .filter((hit) => {
          const cloud = hit.object as THREE.Points;
          return visible(
            cloud.localToWorld(
              new THREE.Vector3().fromBufferAttribute(cloud.geometry.getAttribute('position'), hit.index!),
            ),
          );
        })
        .sort((a, b) => a.distanceToRay! - b.distanceToRay! || a.distance - b.distance)[0];
      if (pointHit) {
        const id = pointHit.object.userData.id as string;
        const pointId = pointHit.object.userData.pointIds[pointHit.index!];
        const cloud = pointHit.object as THREE.Points;
        const position = cloud.localToWorld(
          new THREE.Vector3().fromBufferAttribute(cloud.geometry.getAttribute('position'), pointHit.index!),
        );
        return {
          id,
          object: pointHit.object,
          index: pointHit.index,
          point: { setId: id, pointId },
          position,
        };
      }
      ray.params.Line.threshold = ray.params.Points.threshold;
      // Keep the same six-pixel pick radius with two-pixel screen-space curves.
      ray.params.Line2 = { threshold: 10 };
      const curveHit = ray
        .intersectObjects(curves.children, true)
        .map((hit) => ({ ...hit, point: hit.pointOnLine ?? hit.point }))
        .find((hit) => hit.object.userData.id && !hit.object.userData.preview && visible(hit.point));
      if (curveHit)
        return { id: curveHit.object.userData.id, object: curveHit.object, position: curveHit.point.clone() };
      const solidHit = ray.intersectObjects(solids.children, false).find((hit) => visible(hit.point));
      const referenceHit = ray.intersectObjects(references.children, false).find((hit) => visible(hit.point));
      if (referenceHit && (!solidHit || referenceHit.distance < solidHit.distance))
        return {
          id: referenceHit.object.userData.id,
          object: referenceHit.object,
          position: referenceHit.point.clone(),
        };
      if (solidHit)
        return { id: solidHit.object.userData.id, object: solidHit.object, position: solidHit.point.clone() };
      const hits = ray.intersectObjects([...planes.children, origin], true);
      const hit = hits.find(
        (h) =>
          h.object instanceof THREE.Mesh && h.object.userData.id && h.object.userData.id !== '__preview__',
      );
      return hit
        ? { id: hit.object.userData.id, object: hit.object, position: hit.point.clone() }
        : undefined;
    };
    const onUp = (e: PointerEvent) => {
      if (imageAnchor) {
        imageAnchor = null;
        controls.enabled = true;
        renderer.domElement.releasePointerCapture(e.pointerId);
        pendingPivot = null;
        dragged = true;
        return;
      }
      pendingPivot = null;
      if (dragged || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const hit = pick(e);
      if (e.button === 0) {
        if (hit?.point) latest.current.onPointPick(hit.point, e.clientX, e.clientY);
        else latest.current.onSelect(hit?.id ?? null);
      } else if (e.button === 2) {
        if (hit && hit.id !== 'origin') latest.current.onPlaneContextMenu(hit.id, e.clientX, e.clientY);
      }
    };
    const onDouble = (e: MouseEvent) => {
      const id = pick(e);
      if (id) normalTo(id.id);
    };
    renderer.domElement.addEventListener('pointerdown', onDown, true);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointermove', onMove, true);
    renderer.domElement.addEventListener('pointerleave', onLeave);
    renderer.domElement.addEventListener('pointercancel', onLeave);
    const cancelImageDrag = () => {
      imageAnchor = null;
      controls.enabled = true;
    };
    renderer.domElement.addEventListener('pointercancel', cancelImageDrag);
    renderer.domElement.addEventListener('contextmenu', onContextMenu);
    renderer.domElement.addEventListener('dblclick', onDouble);
    controls.update();
    render();
    return () => {
      cancelAnimationFrame(scheduled);
      resize.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onDown, true);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointermove', onMove, true);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      renderer.domElement.removeEventListener('pointercancel', onLeave);
      renderer.domElement.removeEventListener('pointercancel', cancelImageDrag);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      renderer.domElement.removeEventListener('dblclick', onDouble);
      disposeObject(scene);
      referenceTextures.forEach((texture) => texture.dispose());
      referenceTextures.clear();
      pointTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      runtime.current = null;
    };
  }, []);

  useEffect(() => {
    const r = runtime.current;
    if (!r) return;
    r.clearHover();
    disposeObject(r.planes);
    r.planes.clear();
    disposeObject(r.points);
    r.points.clear();
    disposeObject(r.curves);
    r.curves.clear();
    disposeObject(r.solids);
    r.solids.clear();
    disposeObject(r.bodyEdges);
    r.bodyEdges.clear();
    if (props.filletPicking || props.showEdges)
      for (const edge of props.sweep?.cadEdges ?? []) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(edge.positions, 3));
        const selected = props.filletEdges?.includes(edge.key);
        const line = new THREE.Line(
          geometry,
          new THREE.LineBasicMaterial({
            color: selected ? '#ffe600' : props.darkMode ? '#c7d0d8' : '#3f2222',
            depthTest: !selected,
          }),
        );
        line.userData.id = '__edge__:' + edge.key;
        line.renderOrder = selected ? 2 : 0;
        r.bodyEdges.add(line);
      }
    const solidBounds: Float64Array[] = [];
    if (props.sweep?.indices.length) {
      const position = new THREE.BufferAttribute(props.sweep.renderPositions, 3);
      const normal = new THREE.BufferAttribute(props.sweep.renderNormals, 3);
      props.sweep.bodyRanges.forEach((range, index) => {
        const id = `__body__:${index}`;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', position);
        geometry.setAttribute('normal', normal);
        const indices = props.sweep!.renderIndices.subarray(range.start, range.start + range.count);
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        geometry.boundingBox = new THREE.Box3();
        const vertex = new THREE.Vector3();
        for (const i of indices) geometry.boundingBox.expandByPoint(vertex.fromBufferAttribute(position, i));
        geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: props.selected === id ? '#da463d' : '#ae292e',
            roughness: 0.72,
            metalness: 0,
            side: props.sweep!.surfaceShell ? THREE.DoubleSide : THREE.FrontSide,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
          }),
        );
        mesh.position.fromArray(props.sweep!.origin);
        mesh.userData.id = id;
        if (props.showEdges && range.creaseCount) {
          const boundary = new THREE.BufferGeometry();
          boundary.setAttribute(
            'position',
            new THREE.BufferAttribute(
              props.sweep!.creases.subarray(
                range.creaseStart * 3,
                (range.creaseStart + range.creaseCount) * 3,
              ),
              3,
            ),
          );
          mesh.add(new THREE.LineSegments(boundary, new THREE.LineBasicMaterial({ color: '#50191c' })));
        }
        r.solids.add(mesh);
        const bounds = geometry.boundingBox.clone().translate(mesh.position);
        solidBounds.push(new Float64Array([...bounds.min.toArray(), ...bounds.max.toArray()]));
      });
    }
    const visibleSetIds = new Set(props.doc.pointSets.filter((set) => set.visible).map((set) => set.id));
    if (props.pointPreview) visibleSetIds.add(props.pointPreview.id);
    // Reference planes are excluded so their display sizes cannot feed back into these bounds.
    const visibleCurves = props.curveGeometry.filter(
      (curve) =>
        curve.id === props.curvePreview?.id ||
        (curve.id !== props.curveEditingId && props.doc.curves.find((c) => c.id === curve.id)?.visible),
    );
    const contentBounds = pointContentBounds([
      ...solidBounds,
      ...props.pointGeometry.filter((set) => visibleSetIds.has(set.id)).map((set) => set.positions),
      ...visibleCurves.map((curve) => curve.positions),
    ]);
    for (const plane of props.geometry) {
      const base = BASE_PLANES.find((p) => p.id === plane.id);
      const feature = props.doc.planes.find((p) => p.id === plane.id);
      const preview = plane.id === '__preview__';
      if (!preview && !(base ? props.doc.baseVisibility[plane.id] : feature?.visible)) continue;
      const selected = props.selected === plane.id;
      const color = props.darkMode
        ? base
          ? { front: '#65c2cf', top: '#81aff0', right: '#dfb16d' }[base.id]
          : '#b4a0f5'
        : preview
          ? '#7062c4'
          : (base?.color ?? '#7062c4');
      const group = new THREE.Group();
      group.matrixAutoUpdate = false;
      group.matrix.makeBasis(
        vector(plane.frame.slice(3, 6)),
        vector(plane.frame.slice(6, 9)),
        vector(plane.frame.slice(9, 12)),
      );
      group.matrix.setPosition(vector(plane.frame.slice(0, 3)));
      const patch = boundingPlanePatch(props.doc, plane) ?? planeDisplayBounds(plane.frame, contentBounds);
      const geometry = new THREE.PlaneGeometry(patch.width, patch.height);
      geometry.translate(patch.centerU, patch.centerV, 0);
      const fill = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: preview ? 0.2 : selected ? 0.23 : 0.085,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        }),
      );
      fill.userData.id = plane.id;
      group.add(fill);
      const edgeGeometry = new THREE.EdgesGeometry(geometry);
      const edges = new THREE.LineSegments(
        edgeGeometry,
        preview
          ? new THREE.LineDashedMaterial({
              color,
              dashSize: Math.max(patch.width, patch.height) / 35,
              gapSize: Math.max(patch.width, patch.height) / 70,
              depthTest: false,
              transparent: true,
              opacity: 0.9,
            })
          : new THREE.LineBasicMaterial({ color, transparent: true, opacity: selected ? 1 : 0.55 }),
      );
      edges.computeLineDistances();
      group.add(edges);
      r.planes.add(group);
    }
    for (const evaluated of props.pointGeometry) {
      const preview = props.pointPreview?.id === evaluated.id;
      const set = preview ? props.pointPreview : props.doc.pointSets?.find((p) => p.id === evaluated.id);
      if (!set || (!preview && !set.visible) || !evaluated.positions.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(evaluated.positions, 3));
      if (set.skipPoints) {
        const stride = set.skipPoints + 1;
        // Keep original vertex indices so picking still resolves the exact source point ID.
        geometry.setIndex(
          Array.from({ length: Math.ceil(evaluated.positions.length / 3 / stride) }, (_, i) => i * stride),
        );
      }
      const cloud = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          color: props.darkMode ? '#ffe600' : '#a84900',
          size: props.selected === set.id || preview ? 15 : 12,
          sizeAttenuation: false,
          map: r.pointTexture,
          alphaTest: 0.5,
          depthTest: false,
        }),
      );
      cloud.renderOrder = 12;
      cloud.userData.id = set.id;
      cloud.userData.pointIds = set.points.map((p) => p.id);
      cloud.userData.preview = preview;
      r.points.add(cloud);
    }
    const allSections = curveSections(props.doc);
    for (const curve of visibleCurves) {
      const preview = curve.id === props.curvePreview?.id;
      const sections = preview
        ? []
        : allSections.filter((s) => s.curveId === curve.id && curve.nodeOffsets[s.end] !== undefined);
      const pieces = preview
        ? [{ id: curve.id, positions: curve.positions }]
        : sections.map((s) => ({
            id: s.id,
            positions: curve.positions.subarray(
              curve.nodeOffsets[s.start] * 3,
              (curve.nodeOffsets[s.end] + 1) * 3,
            ),
          }));
      for (const piece of pieces) {
        const geometry = new LineGeometry();
        geometry.setPositions(new Float32Array(piece.positions));
        const line = new Line2(
          geometry,
          new LineMaterial({
            color: props.selected === piece.id ? '#e38a27' : props.darkMode ? '#5cffe0' : '#006b55',
            linewidth: 2,
            resolution: r.renderer.getSize(new THREE.Vector2()),
            depthTest: false,
            depthWrite: false,
          }),
        );
        line.renderOrder = 11;
        line.userData.id = piece.id;
        line.userData.preview = preview;
        r.curves.add(line);
      }
    }
    const resolve = createPointResolver(props.doc);
    const highlight = [...(props.curveNodes ?? []).map((n) => n.point), props.pickedPoint]
      .filter(
        (ref) =>
          ref && visibleSetIds.has(ref.setId) && props.pointGeometry.some((set) => set.id === ref.setId),
      )
      .map((ref) => resolve(ref))
      .filter((p) => p !== undefined);
    if (highlight.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          highlight.flatMap((p) => [p.x, p.y, p.z]),
          3,
        ),
      );
      const markers = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          color: props.darkMode ? '#ffe600' : '#a84900',
          size: 17,
          sizeAttenuation: false,
          map: r.pointTexture,
          alphaTest: 0.5,
          depthTest: false,
        }),
      );
      markers.renderOrder = 13;
      r.points.add(markers);
    }
    const origin = r.scene.children.find((o) => o.userData.id === 'origin') as THREE.Mesh;
    (origin.material as THREE.MeshBasicMaterial).color.set(
      props.darkMode
        ? props.selected === 'origin'
          ? '#8abbff'
          : '#b2c3d4'
        : props.selected === 'origin'
          ? '#286ae7'
          : '#334b60',
    );
    r.render();
  }, [
    props.doc,
    props.geometry,
    props.selected,
    props.pointGeometry,
    props.pointPreview,
    props.darkMode,
    props.curveGeometry,
    props.curvePreview,
    props.curveEditingId,
    props.curveNodes,
    props.pickedPoint,
    props.sweep,
    props.filletPicking,
    props.showEdges,
    props.filletEdges,
  ]);
  useEffect(() => {
    const r = runtime.current;
    if (!r) return;
    const clips = sectionPlanes(props.sections, props.geometry);
    for (const group of [r.points, r.curves, r.solids, r.bodyEdges])
      group.traverse((object) => {
        const material = (object as THREE.Mesh).material;
        for (const m of Array.isArray(material) ? material : material ? [material] : []) {
          const previousCount = m.clippingPlanes?.length ?? 0;
          m.clippingPlanes = clips;
          if (previousCount !== clips.length) m.needsUpdate = true;
        }
      });
    r.clearHover();
    r.render();
  }, [
    props.sections,
    props.geometry,
    props.doc,
    props.pointGeometry,
    props.pointPreview,
    props.curveGeometry,
    props.curvePreview,
    props.curveEditingId,
    props.curveNodes,
    props.pickedPoint,
    props.selected,
    props.darkMode,
    props.sweep,
    props.spacing,
    props.filletPicking,
    props.showEdges,
    props.filletEdges,
  ]);

  useEffect(() => {
    const r = runtime.current;
    if (!r) return;
    r.clearHover();
    const assets = [
      ...(props.doc.references ?? []).filter((a) => a.id !== props.referenceDraft?.id),
      ...(props.referenceDraft ? [props.referenceDraft] : []),
    ];
    const dispose = referenceObjects(
      r.references,
      assets,
      props.geometry,
      sectionPlanes(props.sections, props.geometry),
      r.render,
      r.referenceTextures,
      !!props.showEdges,
      props.darkMode,
    );
    if (
      props.referenceDraft?.kind === 'stl' &&
      lastReferenceDraft.current !== props.referenceDraft.id &&
      !props.doc.references?.some((a) => a.id === props.referenceDraft?.id)
    )
      r.fit();
    lastReferenceDraft.current = props.referenceDraft?.id;
    return () => {
      r.clearHover();
      dispose();
      if (runtime.current === r) r.render();
    };
  }, [
    props.doc.references,
    props.referenceDraft,
    props.geometry,
    props.sections,
    props.showEdges,
    props.darkMode,
  ]);

  return (
    <section
      className="viewport"
      aria-label="Model workspace"
      aria-busy={props.generationProgress !== undefined}
    >
      <div className="canvas-host" ref={host} />
      {props.viewControls}
      {props.spacing && (
        <svg
          className="spacing-dimension"
          ref={dimensionOverlay}
          role="img"
          aria-label={`Closest body to bounding box distance ${props.spacing.distance.toPrecision(6)}`}
        >
          <line data-dimension-line="" />
          <line data-dimension-leader="" />
          <circle r="4" />
          <circle r="4" />
          <g>
            <rect x="-80" y="-14" width="160" height="28" rx="3" />
            <text textAnchor="middle" dominantBaseline="central">
              Min distance: {Number(props.spacing.distance.toPrecision(6))}
            </text>
          </g>
        </svg>
      )}
      <div className="viewport-heading">
        <span className="workspace-dot" /> DESIGN SPACE <span className="viewport-heading-divider">/</span>{' '}
        <span>Orthographic</span>
      </div>
      <div className="view-switcher" aria-label="Standard views">
        <button
          className={activeView === 'isometric' ? 'active' : ''}
          title="Isometric view"
          aria-label="Isometric view"
          onClick={() => view('isometric')}
        >
          <Box size={16} />
        </button>
        {(['top', 'front', 'right'] as const).map((name) => (
          <button key={name} className={activeView === name ? 'active' : ''} onClick={() => view(name)}>
            {name[0].toUpperCase() + name.slice(1)}
          </button>
        ))}
      </div>
      <div className="viewport-tools">
        <button
          aria-label="Fit all geometry"
          title="Fit all geometry (F)"
          onClick={() => runtime.current?.fit()}
        >
          <Expand size={18} />
        </button>
      </div>
      <div className="viewport-help">
        <MousePointer2 size={14} />
        <span>{props.referenceSizing ? 'Drag to size image' : 'Drag to orbit'}</span>
        <i /> <span>Right-drag to pan</span>
        <i />
        <span>Scroll to zoom</span>
      </div>
      <AxisIndicator ref={axisIndicator} />
      {props.generationProgress !== undefined && (
        <div className="regeneration-overlay">
          <div className="regeneration-card" role="status" aria-live="polite">
            <span>Regenerating</span>
            <div
              className="rbc-progress"
              role="progressbar"
              aria-label="Regenerating"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(props.generationProgress)}
            >
              <picture
                style={{
                  clipPath: `inset(0 ${100 - Math.min(100, Math.max(0, props.generationProgress))}% 0 0)`,
                }}
              >
                <source media="(prefers-reduced-motion: reduce)" srcSet={rbcStill} />
                <img src={rbcAnimation} width={640} height={75} alt="" draggable={false} />
              </picture>
            </div>
          </div>
        </div>
      )}
      {error && (
        <div className="viewport-error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
});
