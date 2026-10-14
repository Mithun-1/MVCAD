import { Fragment, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  FilePlus2,
  ImagePlus,
  Scan,
  ArrowRight,
  Box,
  Check,
  ChevronDown,
  CircleHelp,
  Crosshair,
  Eye,
  EyeOff,
  FileBox,
  FolderOpen,
  Folder,
  FolderPlus,
  Layers2,
  Link2,
  LocateFixed,
  Moon,
  Spline,
  CircleSlash,
  Pencil,
  Plus,
  Redo2,
  RefreshCw,
  Ruler,
  Slice,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import {
  BASE_PLANES,
  MAX_OFFSET,
  MAX_PLANES,
  descendants,
  newDocument,
  nextPlaneName,
  planeName,
  validateDocument,
  type Document,
  type FilletFeature,
  type EvaluatedPlane,
  type ReferencePlane,
} from './model';
import { Viewport, type ViewportApi } from './Viewport';
import { PlaneContextMenu } from './PlaneContextMenu';
import { PointTools } from './PointTools';
import { CurveTools } from './CurveTools';
import { ViewControls, SectionSliders, type ViewTool } from './ViewControls';
import { boxDimensions, measureBoxSpacing, type ActiveSectionView } from './viewTools';
import { PointEditor } from './PointEditor';
import { FilletEditor } from './FilletEditor';
import { DesktopUpdates } from './DesktopUpdates';
import { ReferenceEditor } from './ReferenceEditor';
import { readReference, type ReferenceAsset } from './references';
import { RoundingIcon } from './RoundingIcon';
import { ExportBody } from './ExportBody';
import { MeasurePanel } from './MeasurePanel';
import { pickedDistance, type MeasureSelection, type MeasureResult } from './measure';
import { PartTitle } from './PartTitle';
import { CurveEditor, type CurveDraft } from './CurveEditor';
import { PointActions } from './PointActions';
import { SubcurveDiameter } from './SubcurveDiameter';
import { SubcurveSweepSettings } from './SubcurveSweepSettings';
import type { SweepMesh } from './sweep';
import {
  groupDisplayDocument,
  groupFeatures,
  hiddenGroupMembers,
  pruneGroups,
  ungroupFeatures,
} from './featureGroups';
import {
  curveError,
  curveSections,
  curveJunctions,
  pointReferenceKey,
  sectionDiameter,
  assignSectionDiameter,
  sectionSweepSettings,
  assignSectionSweepSetting,
  suppressedFeatures,
  resolvePoint,
  MAX_CURVES,
  MAX_CURVE_POINTS,
  type PointReference,
  type EvaluatedCurve,
  type CurveFeature,
} from './curves';
import type { PointSet, EvaluatedPointSet } from './points';
import { importStepCurves } from './stepImport';
import { saveProject, requestPersistentStorage, type InitialWorkspace } from './projectStorage';
import { exportProjectFile, importProjectFile } from './projectFile';
import { StorageStatus } from './StorageStatus';

type History = { past: Document[]; present: Document; future: Document[] };
type Action = { type: 'commit'; doc: Document } | { type: 'undo' | 'redo' };
const SAVE_ERROR =
  'Browser storage could not save these changes. Your previous save is preserved. Export a backup or open Storage to retry.';
type Form = { mode: 'create' | 'edit'; id: string; name: string; parentId: string; offset: string };
function reducer(state: History, action: Action): History {
  if (action.type === 'commit')
    return { past: [...state.past.slice(-99), state.present], present: action.doc, future: [] };
  if (action.type === 'undo' && state.past.length)
    return {
      past: state.past.slice(0, -1),
      present: state.past.at(-1)!,
      future: [state.present, ...state.future],
    };
  if (action.type === 'redo' && state.future.length)
    return { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) };
  return state;
}
function PlaneIcon({ color = '#71869a' }: { color?: string }) {
  return (
    <svg className="plane-icon" width="19" height="21" viewBox="0 0 19 21" fill="none" aria-hidden="true">
      <path d="M4 6.5 14.5 2v13L4 19z" fill={color} fillOpacity=".12" stroke={color} strokeWidth="1.3" />
      <path d="M9.3 1v19M2 12l15-6" stroke={color} strokeOpacity=".38" strokeWidth=".8" />
    </svg>
  );
}
const format = (n: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(Object.is(n, -0) ? 0 : n);

export function App({ initial }: { initial: InitialWorkspace }) {
  const [showEdges, setShowEdges] = useState(() => {
    try {
      return localStorage.getItem('mvcad.showEdges') === 'true';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('mvcad.showEdges', String(showEdges));
    } catch {
      /* View toggle still works without storage. */
    }
  }, [showEdges]);
  const [darkMode, setDarkMode] = useState(() => {
    try {
      return localStorage.getItem('mvcad.theme') === 'dark';
    } catch {
      return false;
    }
  });
  useLayoutEffect(() => {
    const theme = darkMode ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('mvcad.theme', theme);
    } catch {
      // The toggle still works when browser storage is unavailable.
    }
  }, [darkMode]);
  const [history, dispatch] = useReducer(reducer, { past: [], present: initial.doc, future: [] });
  const doc = useMemo(
    () => ({
      ...history.present,
      pointSets: history.present.pointSets ?? [],
      curves: history.present.curves ?? [],
    }),
    [history.present],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const currentDocument = useRef(doc);
  currentDocument.current = doc;
  const [treeSelection, setTreeSelection] = useState<Set<string>>(() => new Set());
  const selectionAnchor = useRef<string | null>(null);
  const hiddenByGroup = useMemo(() => hiddenGroupMembers(doc), [doc]);
  const displayDoc = useMemo(() => groupDisplayDocument(doc), [doc]);
  const featureIds = useMemo(
    () => new Set([...doc.planes, ...doc.pointSets, ...doc.curves].map((p) => p.id)),
    [doc],
  );
  const selectedGroup = doc.groups?.find((group) => group.id === selected);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [expandedCurves, setExpandedCurves] = useState<Set<string>>(() => new Set());
  const sections = useMemo(() => curveSections(doc), [doc]);
  const junctions = useMemo(() => curveJunctions(doc, sections), [doc, sections]);
  const sectionLabels = useMemo(() => {
    const names = new Map(doc.curves.map((curve) => [curve.id, curve.name]));
    return new Map(
      sections.map((section) => [
        section.id,
        `${names.get(section.curveId)} / Subcurve ${section.index + 1}`,
      ]),
    );
  }, [doc.curves, sections]);
  const selectedSection = sections.find((s) => s.id === selectedSectionId && s.curveId === selected);
  const [form, setForm] = useState<Form | null>(null);
  const [pointForm, setPointForm] = useState<{ id: string; initial?: PointSet } | null>(null);
  const [curveForm, setCurveForm] = useState<CurveDraft | null>(null);
  const [curveGeometry, setCurveGeometry] = useState<EvaluatedCurve[]>([]);
  const [referenceForm, setReferenceForm] = useState<ReferenceAsset | null>(null);
  const [referenceSizing, setReferenceSizing] = useState(false);
  const referenceInput = useRef<HTMLInputElement>(null);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const referenceRequest = useRef(0);
  const [filletForm, setFilletForm] = useState<FilletFeature | null>(null);
  const [filletPreviewReady, setFilletPreviewReady] = useState(false);
  const selectedFillet = doc.fillets?.find((feature) => feature.id === selected);
  const [sweep, setSweep] = useState<SweepMesh>();
  const [sweepError, setSweepError] = useState('');
  const [viewTool, setViewTool] = useState<ViewTool>(null);
  const [measureActive, setMeasureActive] = useState(false);
  const [measureSelections, setMeasureSelections] = useState<MeasureSelection[]>([]);
  const [measureResult, setMeasureResult] = useState<MeasureResult>();
  const [measurePending, setMeasurePending] = useState(false);
  const [measureError, setMeasureError] = useState('');
  const measureRequest = useRef(0);
  const clearMeasurement = () => {
    measureRequest.current++;
    setMeasureSelections([]);
    setMeasureResult(undefined);
    setMeasurePending(false);
    setMeasureError('');
  };
  const [sectionViews, setSectionViews] = useState<ActiveSectionView[]>([]);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const sectionView = sectionViews.find((section) => section.id === editingSectionId);
  const updateSection = (value: ActiveSectionView) =>
    setSectionViews((items) => items.map((item) => (item.id === value.id ? value : item)));
  const removeSection = (id: string) => {
    setSectionViews((items) => items.filter((item) => item.id !== id));
    if (editingSectionId === id) {
      setEditingSectionId(null);
      if (viewTool === 'section') setViewTool(null);
    }
  };
  const addSection = () => {
    const section = {
      id: crypto.randomUUID(),
      planeId: selected && geometry.some((p) => p.id === selected) ? selected : 'front',
      offset: 0,
      keepAbove: true,
    };
    setSectionViews((items) => [...items, section]);
    setEditingSectionId(section.id);
    setViewTool('section');
  };
  const [pointActions, setPointActions] = useState<{ point: PointReference; x: number; y: number } | null>(
    null,
  );
  const [pickedPoint, setPickedPoint] = useState<PointReference | null>(null);
  const [pointPreview, setPointPreview] = useState<PointSet | undefined>();
  const [pointGeometry, setPointGeometry] = useState<EvaluatedPointSet[]>([]);
  const [rename, setRename] = useState<{ id: string; name: string; error?: string } | null>(null);
  const renaming = useRef(false);
  const treeButtons = useRef(new Map<string, HTMLButtonElement>());
  const [planeMenu, setPlaneMenu] = useState<{ id: string; x: number; y: number; viewport?: boolean } | null>(
    null,
  );
  const menuGroup = doc.groups?.find((group) => group.id === planeMenu?.id);
  const multipleMenu =
    !!planeMenu && !planeMenu.viewport && treeSelection.has(planeMenu.id) && treeSelection.size > 1;
  const [geometry, setGeometry] = useState<EvaluatedPlane[]>([]);
  const [engineError, setEngineError] = useState('');
  const [engineReady, setEngineReady] = useState(false);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    // Removing a reference plane removes its display-only cuts as well.
    const ids = new Set(['front', 'top', 'right', ...doc.planes.map((p) => p.id)]);
    setSectionViews((items) =>
      items.every((item) => ids.has(item.planeId)) ? items : items.filter((item) => ids.has(item.planeId)),
    );
  }, [doc.planes]);
  useEffect(() => {
    if (viewTool === 'section' && !sectionView) {
      setViewTool(null);
      setEditingSectionId(null);
    }
  }, [viewTool, sectionView]);
  const boundingDimensions = useMemo(() => boxDimensions(doc), [doc]);
  const spacing = useMemo(
    () =>
      viewTool === 'spacing' && boundingDimensions && sweep && doc.autoSweep && !busy
        ? measureBoxSpacing(sweep, boundingDimensions)
        : undefined,
    [viewTool, boundingDimensions, sweep, doc.autoSweep, busy],
  );
  const sectionPositions = useMemo(() => {
    const positions: ArrayLike<number>[] = [
      ...pointGeometry.map((p) => p.positions),
      ...curveGeometry.map((p) => p.positions),
    ];
    if (sweep && doc.autoSweep) {
      const world = new Float64Array(sweep.positions.length);
      for (let i = 0; i < world.length; i++) world[i] = sweep.positions[i] + sweep.origin[i % 3];
      positions.push(world);
    }
    return positions;
  }, [pointGeometry, curveGeometry, sweep, doc.autoSweep]);
  const [regeneration, setRegeneration] = useState(0);
  useEffect(() => {
    clearMeasurement();
  }, [doc, sweep, measureActive, busy]);
  useEffect(() => {
    if (viewTool || form || pointForm || curveForm || filletForm || referenceForm) setMeasureActive(false);
  }, [viewTool, !!form, !!pointForm, !!curveForm, !!filletForm, !!referenceForm]);
  const selectMeasure = (selection: MeasureSelection | null, shift: boolean) => {
    const next = selection
      ? shift && measureSelections.length
        ? [measureSelections[0], selection]
        : [selection]
      : [];
    const request = ++measureRequest.current;
    setMeasureSelections(next);
    setMeasureError('');
    setMeasureResult(undefined);
    const native = next.length === 2 && next.some((item) => item.face);
    setMeasurePending(native);
    if (native) worker.current?.postMessage({ measureRequest: request, selections: next });
    else if (next.length === 2) setMeasureResult(pickedDistance(next[0], next[1]));
  };
  const [generationProgress, setGenerationProgress] = useState(0);
  const [notice, setNotice] = useState(initial.warning);
  const [saveState, setSaveState] = useState({
    doc,
    status: initial.warning ? 'Restore failed' : 'Saving…',
  });
  // A previous save completing must never label a newer document as saved.
  const saveStatus = saveState.doc === doc ? saveState.status : 'Saving…';
  const [saveRetry, setSaveRetry] = useState(0);
  const persistenceRequested = useRef(false);
  const [help, setHelp] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [bodiesCollapsed, setBodiesCollapsed] = useState(false);
  const viewport = useRef<ViewportApi>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const curvesOnlyImport = useRef(false);
  const fitImported = useRef<string[]>([]);
  const resetPartView = useRef(false);
  const openRequest = useRef(0);
  const worker = useRef<Worker | null>(null);
  const sequence = useRef(0);
  const lastSaved = useRef<Document | undefined>(initial.warning ? doc : undefined);
  const selectedFeature = doc.planes.find((p) => p.id === selected);
  const selectedSet = doc.pointSets.find((p) => p.id === selected);
  const selectedCurve = doc.curves.find((p) => p.id === selected);
  const selectedBody = selected?.startsWith('__body__:') ? Number(selected.slice(9)) : undefined;
  const suppressed = useMemo(() => suppressedFeatures(doc), [doc]);
  const showProperties = Boolean(
    (selected && !selectedSet && !selectedGroup && treeSelection.size < 2) ||
      form ||
      pointForm ||
      curveForm ||
      filletForm ||
      referenceForm,
  );
  const selectedBase = BASE_PLANES.find((p) => p.id === selected);
  const selectedGeometry = geometry.find((p) => p.id === selected);
  const planeNames = [
    ...BASE_PLANES.map((p) => ({ id: p.id as string, name: planeName(doc, p.id) })),
    ...doc.planes,
  ];
  const allNames = [
    ...planeNames,
    ...doc.pointSets,
    ...doc.curves,
    ...(doc.fillets ?? []),
    ...(doc.references ?? []),
    ...(doc.groups ?? []),
    ...(doc.autoSweep
      ? (sweep?.bodyRanges ?? []).map((_, i) => ({ id: `__body__:${i}`, name: `Body ${i + 1}` }))
      : []),
  ];
  const parentOptions =
    form?.mode === 'edit'
      ? planeNames
          .slice(0, 3 + doc.planes.findIndex((p) => p.id === form.id))
          .filter((p) => !suppressed.has(p.id))
      : planeNames.filter((p) => !suppressed.has(p.id));
  const formError = !form
    ? ''
    : !form.name.trim()
      ? 'Enter a name for this plane.'
      : form.name.trim().toLowerCase() === 'origin' ||
          allNames.some((p) => p.id !== form.id && p.name.toLowerCase() === form.name.trim().toLowerCase())
        ? 'A feature with this name already exists.'
        : !form.offset.trim() || !Number.isFinite(Number(form.offset))
          ? 'Enter a valid offset distance.'
          : Math.abs(Number(form.offset)) > MAX_OFFSET
            ? 'Offset must be between −1,000,000 and 1,000,000.'
            : !parentOptions.some((p) => p.id === form.parentId)
              ? 'Select a reference plane.'
              : form.mode === 'create' && doc.planes.length >= MAX_PLANES
                ? 'This document has reached its plane limit.'
                : '';
  const preview = useMemo<ReferencePlane | undefined>(
    () =>
      form && !formError
        ? {
            id: '__preview__',
            name: form.name.trim(),
            parentId: form.parentId,
            offset: Number(form.offset),
            visible: true,
          }
        : undefined,
    [form, formError],
  );
  const curvePreview = useMemo(() => {
    if (!curveForm) return undefined;
    const feature = {
      ...curveForm.feature,
      nodes: curveForm.feature.nodes.filter((n) => n.point),
      visible: true,
      suppressed: false,
    };
    return curveError(doc, feature) ? undefined : feature;
  }, [curveForm, doc]);

  useEffect(() => {
    const instance = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    worker.current = instance;
    instance.onmessage = (
      event: MessageEvent<{
        sequence: number;
        geometry?: EvaluatedPlane[];
        points?: EvaluatedPointSet[];
        curves?: EvaluatedCurve[];
        error?: string;
        sweep?: SweepMesh;
        sweepError?: string;
        progress?: number;
        filletPreviewReady?: boolean;
        measureRequest?: number;
        result?: MeasureResult;
        measureError?: string;
      }>,
    ) => {
      if (event.data.measureRequest !== undefined) {
        if (event.data.measureRequest === measureRequest.current) {
          setMeasurePending(false);
          setMeasureResult(event.data.result);
          setMeasureError(event.data.measureError ?? '');
        }
        return;
      }
      if (event.data.sequence !== sequence.current) return;
      if (event.data.progress !== undefined) {
        setGenerationProgress(event.data.progress);
        return;
      }
      setBusy(false);
      setFilletPreviewReady(!!event.data.filletPreviewReady);
      if (event.data.error) {
        setEngineError(event.data.error);
        return;
      }
      setEngineError('');
      setEngineReady(true);
      setGeometry(event.data.geometry!);
      setPointGeometry(event.data.points ?? []);
      setCurveGeometry(event.data.curves ?? []);
      setSweep(event.data.sweep);
      setSweepError(event.data.sweepError ?? '');
    };
    instance.onerror = () => {
      setEngineError('The CAD engine could not start. Reload this page to retry.');
      setBusy(false);
    };
    return () => {
      instance.terminate();
      worker.current = null;
    };
  }, []);
  useEffect(() => {
    setBusy(true);
    setGenerationProgress(0);
    const request = ++sequence.current;
    // Debounce rounding edits so typing does not queue expensive kernel operations.
    // Outdated results are ignored by the sequence check above.
    const timer = window.setTimeout(
      () =>
        worker.current?.postMessage({
          sequence: request,
          planes: doc.planes,
          preview,
          pointSets: doc.pointSets,
          pointPreview,
          curves: doc.curves.filter((curve) => curve.id !== curveForm?.feature.id),
          curvePreview,
          autoSweep: doc.autoSweep && !form && !pointForm && !curveForm,
          fillets:
            filletForm && doc.fillets?.some((f) => f.id === filletForm.id)
              ? doc.fillets.slice(
                  0,
                  doc.fillets.findIndex((f) => f.id === filletForm.id),
                )
              : doc.fillets,
          filletPreview: filletForm ?? undefined,
          removeCaps: doc.removeCaps,
          regeneration,
        }),
      filletForm ? 200 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [
    doc.planes,
    preview,
    doc.pointSets,
    pointPreview,
    doc.curves,
    curvePreview,
    curveForm?.feature.id,
    doc.autoSweep,
    doc.removeCaps,
    doc.fillets,
    filletForm?.id,
    filletForm?.radius,
    filletForm?.edges,
    regeneration,
    !!form,
    !!pointForm,
    !!curveForm || !!filletForm,
  ]);
  useEffect(() => {
    if (
      !fitImported.current.length ||
      !fitImported.current.every((id) => curveGeometry.some((c) => c.id === id))
    )
      return;
    const frame = requestAnimationFrame(() => {
      viewport.current?.fit();
      fitImported.current = [];
    });
    return () => cancelAnimationFrame(frame);
  }, [curveGeometry]);
  useEffect(() => {
    if (!resetPartView.current || busy) return;
    const frame = requestAnimationFrame(() => {
      viewport.current?.view('isometric');
      viewport.current?.fit();
      resetPartView.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [geometry, busy]);
  useEffect(() => {
    if (lastSaved.current === doc) return;
    let cancelled = false;
    setSaveState({ doc, status: 'Saving…' });
    const timer = setTimeout(() => {
      void saveProject(doc)
        .then(() => {
          if (cancelled) return;
          lastSaved.current = doc;
          setSaveState({ doc, status: 'Saved locally' });
          setNotice((previous) => (previous === SAVE_ERROR || previous === initial.warning ? '' : previous));
        })
        .catch((error) => {
          if (cancelled) return;
          console.error('Project autosave failed:', error);
          setSaveState({ doc, status: 'Not saved' });
          setNotice(SAVE_ERROR);
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [doc, saveRetry]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (saveStatus === 'Saving…' || saveStatus === 'Not saved') {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [saveStatus]);
  useEffect(() => {
    if (selected && selected !== 'origin' && !allNames.some((p) => p.id === selected)) setSelected(null);
    if (selectedSectionId && !selectedSection) setSelectedSectionId(null);
  }, [doc, selected, selectedSectionId, selectedSection, sweep]);
  useEffect(() => {
    setTreeSelection((previous) => {
      const next = new Set([...previous].filter((id) => featureIds.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [featureIds]);

  const commit = (next: Document) => {
    if (!persistenceRequested.current) {
      persistenceRequested.current = true;
      void requestPersistentStorage();
    }
    if (next.boundingBox && !boxDimensions(next)) {
      next = { ...next };
      delete next.boundingBox;
    }
    dispatch({ type: 'commit', doc: validateDocument(pruneGroups(next), doc) });
  };
  const finishRename = (save: boolean, restoreFocus: boolean) => {
    if (!rename || !renaming.current) return;
    const plane = allNames.find((p) => p.id === rename.id);
    const name = rename.name.trim();
    if (save && plane) {
      const error = !name
        ? 'Enter a name for this feature.'
        : name.toLowerCase() === 'origin' ||
            allNames.some((p) => p.id !== plane.id && p.name.toLowerCase() === name.toLowerCase())
          ? 'A feature with this name already exists.'
          : '';
      if (error) {
        if (restoreFocus) {
          setRename({ ...rename, error });
          return;
        }
        // Invalid text never changes the document when clicking away.
        setNotice(`Plane name unchanged. ${error}`);
      } else if (name !== plane.name) {
        if (BASE_PLANES.some((p) => p.id === plane.id))
          commit({ ...doc, baseNames: { ...doc.baseNames, [plane.id]: name } });
        else if (doc.pointSets.some((p) => p.id === plane.id))
          commit({ ...doc, pointSets: doc.pointSets.map((p) => (p.id === plane.id ? { ...p, name } : p)) });
        else if (doc.curves.some((p) => p.id === plane.id))
          commit({ ...doc, curves: doc.curves.map((p) => (p.id === plane.id ? { ...p, name } : p)) });
        else if (doc.groups?.some((p) => p.id === plane.id))
          commit({ ...doc, groups: doc.groups.map((p) => (p.id === plane.id ? { ...p, name } : p)) });
        else commit({ ...doc, planes: doc.planes.map((p) => (p.id === plane.id ? { ...p, name } : p)) });
      }
    }
    renaming.current = false;
    setRename(null);
    if (restoreFocus) requestAnimationFrame(() => treeButtons.current.get(rename.id)?.focus());
  };
  const startRename = (id: string) => {
    if (id.startsWith('__body__:')) return;
    if (form || pointForm || curveForm || filletForm || referenceForm || !allNames.some((p) => p.id === id))
      return;
    if (doc.references?.some((r) => r.id === id)) {
      select(id);
      return;
    }
    const fillet = doc.fillets?.find((feature) => feature.id === id);
    if (fillet) {
      editFillet(fillet);
      return;
    }
    setPlaneMenu(null);
    setTreeSelection(new Set());
    setSelected(id);
    renaming.current = true;
    setCollapsed(false);
    setNotice('');
    setRename({ id, name: planeName(doc, id) });
  };
  const toggleVisibility = (id: string) => {
    if (doc.groups?.some((group) => group.id === id))
      commit({
        ...doc,
        groups: doc.groups.map((group) => (group.id === id ? { ...group, visible: !group.visible } : group)),
      });
    else if (BASE_PLANES.some((p) => p.id === id))
      commit({ ...doc, baseVisibility: { ...doc.baseVisibility, [id]: !doc.baseVisibility[id] } });
    else if (doc.pointSets.some((p) => p.id === id))
      commit({
        ...doc,
        pointSets: doc.pointSets.map((p) => (p.id === id ? { ...p, visible: !p.visible } : p)),
      });
    else if (doc.curves.some((p) => p.id === id))
      commit({ ...doc, curves: doc.curves.map((p) => (p.id === id ? { ...p, visible: !p.visible } : p)) });
    else commit({ ...doc, planes: doc.planes.map((p) => (p.id === id ? { ...p, visible: !p.visible } : p)) });
  };
  const toggleSuppression = (id: string) => {
    if (form || pointForm || curveForm || filletForm || referenceForm) return;
    commit({
      ...doc,
      planes: doc.planes.map((p) => (p.id === id ? { ...p, suppressed: !p.suppressed } : p)),
      pointSets: doc.pointSets.map((p) => (p.id === id ? { ...p, suppressed: !p.suppressed } : p)),
      curves: doc.curves.map((p) => (p.id === id ? { ...p, suppressed: !p.suppressed } : p)),
      fillets: doc.fillets?.map((p) => (p.id === id ? { ...p, suppressed: !p.suppressed } : p)),
    });
    setPlaneMenu(null);
    setPointActions(null);
    setPickedPoint(null);
  };
  const editCurve = (feature: CurveFeature) => {
    if (form || pointForm || curveForm || filletForm || referenceForm) return;
    setPlaneMenu(null);
    setPointActions(null);
    setSelected(feature.id);
    setSelectedSectionId(null);
    setCurveForm({
      feature: { ...feature, nodes: feature.nodes.map((n) => ({ ...n })) },
      active: 0,
      replace: false,
      editing: true,
    });
  };
  const startCurve = (point?: PointReference) => {
    if (form || pointForm || curveForm || filletForm || referenceForm || doc.curves.length >= MAX_CURVES)
      return;
    let n = 1;
    while (allNames.some((p) => p.name.toLowerCase() === `curve ${n}`)) n++;
    setPointActions(null);
    setPlaneMenu(null);
    setCurveForm({
      feature: {
        id: crypto.randomUUID(),
        name: `Curve ${n}`,
        visible: true,
        nodes: point ? [{ id: crypto.randomUUID(), point, connection: 'spline' }] : [],
      },
      active: 0,
      replace: false,
      editing: false,
    });
  };
  const pickPoint = (point: PointReference, x: number, y: number) => {
    if (form || pointForm || !resolvePoint(doc, point) || suppressed.has(point.setId)) return;
    setPickedPoint(point);
    setTreeSelection(new Set());
    if (!curveForm) {
      setSelected(point.setId);
      setPointActions({ point, x, y });
      setPlaneMenu(null);
      return;
    }
    const nodes = [...curveForm.feature.nodes];
    if (curveForm.replace && nodes[curveForm.active])
      nodes[curveForm.active] = { ...nodes[curveForm.active], point };
    else {
      if (nodes.length >= MAX_CURVE_POINTS) {
        setNotice(`A curve supports up to ${MAX_CURVE_POINTS} points.`);
        return;
      }
      const last = nodes.at(-1)?.point;
      if (last?.setId === point.setId && last?.pointId === point.pointId) return;
      nodes.push({ id: crypto.randomUUID(), point, connection: nodes.at(-1)?.connection ?? 'spline' });
    }
    setCurveForm({
      ...curveForm,
      feature: { ...curveForm.feature, nodes },
      active: curveForm.replace ? curveForm.active : nodes.length - 1,
      replace: false,
    });
  };
  const createFromPlane = (parentId: string) => {
    setPlaneMenu(null);
    setNotice('');
    setForm({
      mode: 'create',
      id: crypto.randomUUID(),
      name: nextPlaneName(doc),
      parentId,
      offset: '25',
    });
  };
  const startCreate = () =>
    createFromPlane(
      selected && !suppressed.has(selected) && planeNames.some((p) => p.id === selected) ? selected : 'front',
    );
  const openPlaneMenu = (id: string, x: number, y: number, inViewport = false) => {
    setSelectedSectionId(null);
    if (inViewport || !treeSelection.has(id)) setTreeSelection(new Set(featureIds.has(id) ? [id] : []));
    if (!form && !pointForm && !curveForm && !filletForm && !referenceForm) setSelected(id);
    setPlaneMenu({ id, x, y, viewport: inViewport });
  };
  const editPlane = (id: string) => {
    const feature = doc.planes.find((p) => p.id === id);
    if (!feature || form || pointForm || curveForm || filletForm || referenceForm) return;
    setPlaneMenu(null);
    setSelected(id);
    setForm({
      mode: 'edit',
      id,
      name: feature.name,
      parentId: feature.parentId,
      offset: String(feature.offset),
    });
  };
  const applyForm = () => {
    if (!form || formError || engineError || busy) return;
    const plane = {
      id: form.id,
      name: form.name.trim(),
      parentId: form.parentId,
      offset: Number(form.offset),
      visible: selectedFeature?.id === form.id ? selectedFeature.visible : true,
      suppressed: selectedFeature?.id === form.id ? selectedFeature.suppressed : undefined,
    };
    commit({
      ...doc,
      planes:
        form.mode === 'create'
          ? [...doc.planes, plane]
          : doc.planes.map((p) => (p.id === form.id ? plane : p)),
    });
    setSelected(plane.id);
    setForm(null);
    setCollapsed(false);
  };
  const deleteFeature = (id: string | null) => {
    if (!id || form || pointForm || curveForm || filletForm || referenceForm || renaming.current) return;
    if (id.startsWith('__body__:')) return;
    if (descendants(doc, id).size) {
      setNotice(
        doc.planes.some((p) => p.id === id)
          ? 'This plane is referenced by other planes or images. Delete its dependents first.'
          : 'This point set is referenced by curves. Delete its dependent curves first.',
      );
      return;
    }
    if (doc.references?.some((r) => r.id === id)) {
      commit({ ...doc, references: doc.references.filter((r) => r.id !== id) });
    } else if (doc.fillets?.some((f) => f.id === id)) {
      commit({ ...doc, fillets: doc.fillets.filter((f) => f.id !== id) });
    } else if (id === '__sweep__') {
      commit({ ...doc, autoSweep: false });
    } else if (doc.curves.some((p) => p.id === id)) {
      commit({ ...doc, curves: doc.curves.filter((p) => p.id !== id) });
    } else if (doc.pointSets.some((p) => p.id === id)) {
      commit({ ...doc, pointSets: doc.pointSets.filter((p) => p.id !== id) });
    } else {
      if (!doc.planes.some((p) => p.id === id)) return;
      if (descendants(doc, id).size) {
        setNotice('This plane is referenced by other planes. Delete its dependent planes first.');
        return;
      }
      commit({ ...doc, planes: doc.planes.filter((p) => p.id !== id) });
    }
    setPlaneMenu(null);
    setPointActions(null);
    setPickedPoint(null);
    setSelected(null);
  };
  const deleteSelected = () => {
    if (!selectedSection && treeSelection.size < 2) deleteFeature(selected);
  };
  const undo = () => {
    setTreeSelection(new Set());
    setPickedPoint(null);
    setCurveForm(null);
    setFilletForm(null);
    setReferenceForm(null);
    setReferenceSizing(false);
    referenceRequest.current++;
    setReferenceLoading(false);
    setPointActions(null);
    setPlaneMenu(null);
    setPointForm(null);
    setPointPreview(undefined);
    renaming.current = false;
    setRename(null);
    setForm(null);
    dispatch({ type: 'undo' });
  };
  const redo = () => {
    setTreeSelection(new Set());
    setPickedPoint(null);
    setCurveForm(null);
    setFilletForm(null);
    setReferenceForm(null);
    setReferenceSizing(false);
    referenceRequest.current++;
    setReferenceLoading(false);
    setPointActions(null);
    setPlaneMenu(null);
    setPointForm(null);
    setPointPreview(undefined);
    renaming.current = false;
    setRename(null);
    setForm(null);
    dispatch({ type: 'redo' });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMeasureActive(false);
        setTreeSelection(new Set());
        if (pointActions) {
          setPointActions(null);
          return;
        }
        setCurveForm(null);
        setFilletForm(null);
        setReferenceForm(null);
        setReferenceSizing(false);
        referenceRequest.current++;
        setReferenceLoading(false);
        setPointForm(null);
        setPointPreview(undefined);
        setForm(null);
        setHelp(false);
        return;
      }
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return;
      if (
        e.key === 'F2' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        selected &&
        treeSelection.size < 2 &&
        !selectedSection &&
        selected !== 'origin' &&
        !form &&
        !pointForm &&
        !curveForm
      ) {
        e.preventDefault();
        startRename(selected);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        viewport.current?.fit();
      } else if (e.key === 'Delete' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const chooseFile = (curvesOnly: boolean) => {
    curvesOnlyImport.current = curvesOnly;
    if (fileInput.current) {
      fileInput.current.accept = curvesOnly ? '.stp,.step' : '.json,.mvcad,.stp,.step';
      fileInput.current.click();
    }
  };
  const openFile = async (file: File, curvesOnly = false) => {
    const request = ++openRequest.current;
    try {
      if (curvesOnly && !/\.(stp|step)$/i.test(file.name))
        throw new Error('Only STEP files are supported as of now.');
      if (/\.(stp|step)$/i.test(file.name)) {
        if (file.size > 50_000_000) throw new Error('STEP curve files must be 50 MB or smaller.');
        const text = await file.text();
        if (request !== openRequest.current) return;
        const imported = importStepCurves(currentDocument.current, text, file.name);
        fitImported.current = imported.curveIds;
        commit(imported.doc);
        setExpandedCurves(new Set([imported.curveIds[0]]));
        setSelected(imported.curveIds[0]);
        setNotice(
          `Imported ${imported.curveIds.length} STEP curves with ${imported.sectionCount} subcurves (mm). Undo removes the import.`,
        );
      } else {
        const opened = await importProjectFile(file);
        if (request !== openRequest.current) return;
        commit(opened);
        setSelected(null);
        setNotice('Document opened. Undo restores the previous document.');
      }
      setForm(null);
      setPointForm(null);
      setPointPreview(undefined);
      setCurveForm(null);
      setFilletForm(null);
      setReferenceForm(null);
      setReferenceSizing(false);
      referenceRequest.current++;
      setReferenceLoading(false);
      setTreeSelection(new Set());
      setViewTool(null);
      setSectionViews([]);
      setEditingSectionId(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not open this document.');
    }
  };
  const createPart = () => {
    setViewTool(null);
    setSectionViews([]);
    setEditingSectionId(null);
    ++openRequest.current;
    fitImported.current = [];
    resetPartView.current = true;
    commit(newDocument());
    setSelected(null);
    setSelectedSectionId(null);
    setTreeSelection(new Set());
    selectionAnchor.current = null;
    setExpandedCurves(new Set());
    setCollapsed(false);
    setBodiesCollapsed(false);
    setForm(null);
    setPointForm(null);
    setPointPreview(undefined);
    setCurveForm(null);
    setFilletForm(null);
    setReferenceForm(null);
    setReferenceSizing(false);
    referenceRequest.current++;
    setReferenceLoading(false);
    setPickedPoint(null);
    setPointActions(null);
    setPlaneMenu(null);
    renaming.current = false;
    setRename(null);
    setSweep(undefined);
    setSweepError('');
    setHelp(false);
    setNotice('New part created. Undo restores the previous part.');
  };
  const download = async () => {
    const url = URL.createObjectURL(await exportProjectFile(doc));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${doc.name.replace(/[^a-zA-Z0-9 _-]/g, '_')}.mvcad`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  const editFillet = (feature?: FilletFeature) => {
    if (form || pointForm || curveForm || filletForm || referenceForm) return;
    let n = 1;
    while (allNames.some((item) => item.name.toLowerCase() === 'fillet ' + n)) n++;
    setFilletForm(
      feature
        ? { ...feature, edges: [...feature.edges] }
        : { id: crypto.randomUUID(), name: 'Fillet ' + n, radius: 1.5, edges: [] },
    );
    setPlaneMenu(null);
    setPointActions(null);
    setSelectedSectionId(null);
    setSelected(feature?.id ?? null);
  };
  const select = (id: string | null) => {
    if (referenceForm) return;
    const reference = doc.references?.find((r) => r.id === id);
    if (reference && !form && !pointForm && !curveForm && !filletForm) {
      setReferenceForm({ ...reference });
      setReferenceSizing(false);
      setSelected(id);
      setViewTool(null);
      return;
    }
    if (filletForm) {
      if (id?.startsWith('__edge__:')) {
        const key = id.slice(9);
        setFilletForm(
          (feature) =>
            feature && {
              ...feature,
              edges: feature.edges.includes(key)
                ? feature.edges.filter((edge) => edge !== key)
                : [...feature.edges, key],
            },
        );
      }
      return;
    }
    setTreeSelection(new Set());
    selectionAnchor.current = id;
    setPointActions(null);
    setPickedPoint(null);
    if (!form && !pointForm && !curveForm && !filletForm && !referenceForm) {
      const section = sections.find((s) => s.id === id);
      setSelectedSectionId(section?.id ?? null);
      setSelected(section?.curveId ?? id);
      if (section) setExpandedCurves((previous) => new Set([...previous, section.curveId]));
    }
  };
  const selectTree = (id: string, event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    if (form || pointForm || curveForm || filletForm || referenceForm) return;
    if (!featureIds.has(id) || !(event.ctrlKey || event.metaKey || event.shiftKey)) {
      select(id);
      setTreeSelection(new Set(featureIds.has(id) ? [id] : []));
      return;
    }
    setPointActions(null);
    setPickedPoint(null);
    setSelectedSectionId(null);
    const next = new Set(treeSelection);
    if (event.shiftKey && selectionAnchor.current) {
      const ids = [...document.querySelectorAll<HTMLElement>('[data-feature-id]')].map(
        (el) => el.dataset.featureId!,
      );
      const a = ids.indexOf(selectionAnchor.current),
        b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        if (!event.ctrlKey && !event.metaKey) next.clear();
        ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((value) => next.add(value));
      } else next.add(id);
    } else {
      if (next.has(id)) next.delete(id);
      else next.add(id);
      selectionAnchor.current = id;
    }
    setTreeSelection(next);
    setSelected(next.has(id) ? id : ([...next].at(-1) ?? null));
  };
  const createGroup = () => {
    if (form || pointForm || curveForm || filletForm || referenceForm || treeSelection.size < 2) return;
    let n = 1;
    while (allNames.some((p) => p.name.toLowerCase() === `group ${n}`)) n++;
    const id = crypto.randomUUID();
    commit(groupFeatures(doc, [...treeSelection], id, `Group ${n}`));
    setExpandedCurves((previous) => new Set([...previous, id]));
    setTreeSelection(new Set());
    setSelected(id);
    setSelectedSectionId(null);
    setPlaneMenu(null);
  };
  const ungroup = (id: string) => {
    commit(ungroupFeatures(doc, id));
    setPlaneMenu(null);
    setTreeSelection(new Set());
    setSelected(null);
  };
  const connectionMarker = (point: PointReference | null) => {
    const junction = point && junctions.get(pointReferenceKey(point));
    if (!junction) return null;
    const label = `Connected: ${junction.sectionIds.map((id) => sectionLabels.get(id)).join('; ')}`;
    return (
      <div className="subcurve-connection" role="img" aria-label={label} title={label} tabIndex={0}>
        <Link2 size={14} aria-hidden="true" />
      </div>
    );
  };
  const treeRow = (id: string, name: string, color: string, visible: boolean) => {
    const isGroup = !!doc.groups?.some((group) => group.id === id);
    const expandable = isGroup || doc.curves.some((curve) => curve.id === id);
    const shown = visible && !hiddenByGroup.has(id);
    const rowSelected = treeSelection.has(id) || (selected === id && !selectedSection);
    return (
      <div
        className={`tree-row ${rowSelected ? 'selected' : ''} ${!shown ? 'hidden-plane' : ''} ${suppressed.has(id) ? 'suppressed-feature' : ''}`}
        key={id}
        data-feature-id={featureIds.has(id) ? id : undefined}
        onContextMenu={(event) => {
          if ((event.target as HTMLElement).closest('input')) return;
          event.preventDefault();
          openPlaneMenu(id, event.clientX, event.clientY);
        }}
      >
        {rename?.id === id ? (
          <div className="tree-rename">
            {isGroup ? (
              <Folder size={18} />
            ) : doc.curves.some((p) => p.id === id) ? (
              <Spline size={18} />
            ) : doc.pointSets.some((p) => p.id === id) ? (
              <Crosshair size={18} />
            ) : (
              <PlaneIcon color={color} />
            )}
            <input
              aria-label={
                isGroup
                  ? 'Rename group'
                  : doc.curves.some((p) => p.id === id)
                    ? 'Rename curve'
                    : doc.pointSets.some((p) => p.id === id)
                      ? 'Rename point set'
                      : 'Rename plane'
              }
              aria-invalid={!!rename.error}
              aria-describedby={rename.error ? 'rename-error' : undefined}
              autoFocus
              maxLength={60}
              value={rename.name}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setRename({ id, name: e.target.value })}
              onBlur={() => finishRename(true, false)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter' || e.key === 'Escape') {
                  e.preventDefault();
                  finishRename(e.key === 'Enter', true);
                }
              }}
            />
            {rename.error && (
              <span id="rename-error" role="alert" className="rename-error">
                {rename.error}
              </span>
            )}
          </div>
        ) : (
          <button
            role="treeitem"
            aria-label={name}
            aria-selected={rowSelected}
            aria-level={doc.groups?.some((group) => group.members.includes(id)) ? 2 : 1}
            aria-haspopup="menu"
            aria-expanded={expandable ? expandedCurves.has(id) : planeMenu?.id === id}
            aria-owns={expandedCurves.has(id) ? `${isGroup ? 'group' : 'subcurves'}-${id}` : undefined}
            aria-keyshortcuts="F2"
            ref={(button) => {
              if (button) treeButtons.current.set(id, button);
              else treeButtons.current.delete(id);
            }}
            className="tree-item"
            onClick={(event) => {
              selectTree(id, event);
              if (expandable && !event.ctrlKey && !event.metaKey && !event.shiftKey)
                setExpandedCurves((previous) => {
                  const next = new Set(previous);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                });
            }}
            onDoubleClick={() => {
              if (isGroup) {
                startRename(id);
                return;
              }
              const curve = doc.curves.find((p) => p.id === id);
              if (curve) {
                editCurve(curve);
                return;
              }
              viewport.current?.normalTo(id);
            }}
            onKeyDown={(event) => {
              if (expandable && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                event.preventDefault();
                setExpandedCurves((previous) => {
                  const next = new Set(previous);
                  if (event.key === 'ArrowRight') next.add(id);
                  else next.delete(id);
                  return next;
                });
              }
              if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                event.preventDefault();
                event.stopPropagation();
                const bounds = event.currentTarget.getBoundingClientRect();
                openPlaneMenu(id, bounds.left + 20, bounds.bottom);
              }
            }}
            title={`${name} · F2 to rename`}
          >
            {expandable ? (
              <>
                <ChevronDown
                  size={12}
                  className={`curve-disclosure ${expandedCurves.has(id) ? '' : 'closed'}`}
                />
                {isGroup ? <Folder size={18} /> : <Spline size={18} />}
              </>
            ) : doc.pointSets.some((p) => p.id === id) ? (
              <Crosshair size={18} />
            ) : (
              <PlaneIcon color={color} />
            )}
            <span>{name}</span>
            {suppressed.has(id) && <CircleSlash size={12} aria-label="Suppressed" />}
          </button>
        )}
        <button
          className="visibility-button"
          aria-label={`${shown ? 'Hide' : 'Show'} ${name}`}
          title={
            hiddenByGroup.has(id)
              ? 'Show the group to change this member’s visibility'
              : `${shown ? 'Hide' : 'Show'} ${name}`
          }
          disabled={
            !!form || !!pointForm || !!curveForm || !!filletForm || !!referenceForm || hiddenByGroup.has(id)
          }
          onClick={() => toggleVisibility(id)}
        >
          {shown ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
      </div>
    );
  };

  const renderFeature = (id: string) => {
    const base = BASE_PLANES.find((p) => p.id === id);
    if (base) return treeRow(id, planeName(doc, id), base.color, doc.baseVisibility[id]);
    const plane = doc.planes.find((p) => p.id === id);
    if (plane) return treeRow(id, plane.name, '#7062c4', plane.visible);
    const set = doc.pointSets.find((p) => p.id === id);
    if (set) return treeRow(id, set.name, '#bc7938', set.visible);
    const curve = doc.curves.find((p) => p.id === id);
    if (!curve) return null;
    return (
      <div key={curve.id}>
        {treeRow(curve.id, curve.name, '#389987', curve.visible)}
        {expandedCurves.has(curve.id) && (
          <div
            role="group"
            id={`subcurves-${curve.id}`}
            aria-label={`${curve.name} subcurves`}
            className="subcurve-tree"
          >
            {sections
              .filter((s) => s.curveId === curve.id)
              .map((section, index) => (
                <Fragment key={section.id}>
                  {index > 0 && connectionMarker(curve.nodes[section.start].point)}
                  <div
                    className={`tree-row ${selectedSection?.id === section.id ? 'selected' : ''} ${curve.visible && !hiddenByGroup.has(curve.id) ? '' : 'hidden-plane'}`}
                  >
                    <button
                      role="treeitem"
                      aria-level={groupedIds.has(curve.id) ? 3 : 2}
                      aria-selected={selectedSection?.id === section.id}
                      className="tree-item"
                      onClick={() => select(section.id)}
                    >
                      <Spline size={16} />
                      <span>Subcurve {section.index + 1}</span>
                    </button>
                  </div>
                </Fragment>
              ))}
          </div>
        )}
      </div>
    );
  };
  const domainGroup = doc.groups?.find((group) => BASE_PLANES.every((p) => group.members.includes(p.id)));
  const renderGroup = (group: NonNullable<Document['groups']>[number]) => (
    <div key={group.id} className="feature-group">
      {treeRow(group.id, group.name, '#71869a', group.visible)}
      {expandedCurves.has(group.id) && (
        <div
          role="group"
          id={`group-${group.id}`}
          aria-label={`${group.name} members`}
          className="feature-group-members"
        >
          {group.members.map(renderFeature)}
        </div>
      )}
    </div>
  );
  const groupedIds = new Set((doc.groups ?? []).flatMap((group) => group.members));

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">
            <Box size={23} strokeWidth={1.5} />
          </div>
          <span>
            MV<span className="brand-light">CAD</span>
          </span>
          <span className="version-badge">EARLY ACCESS</span>
        </div>
        <PartTitle name={doc.name} onRename={(name) => commit({ ...doc, name })} />
        <DesktopUpdates
          canRestart={
            !busy &&
            !form &&
            !pointForm &&
            !curveForm &&
            !filletForm &&
            !referenceForm &&
            !referenceLoading &&
            saveStatus === 'Saved locally'
          }
        />
        <button className="header-help" aria-label="Help and shortcuts" onClick={() => setHelp((v) => !v)}>
          <CircleHelp size={18} />
        </button>
      </header>
      <input
        ref={referenceInput}
        hidden
        type="file"
        aria-label="Import reference file"
        accept=".stl,.png,.jpg,.jpeg,.webp,.gif,.bmp"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          const request = ++referenceRequest.current;
          setReferenceLoading(true);
          let name = file.name.replace(/\.[^.]+$/, '').slice(0, 48) || 'Reference';
          const base = name;
          let n = 2;
          while (
            allNames.some((p) => p.name.toLowerCase() === name.toLowerCase()) ||
            name.toLowerCase() === 'origin'
          )
            name = base + ' ' + n++;
          try {
            const asset = await readReference(file, name, selectedGeometry?.id ?? 'front');
            if (request !== referenceRequest.current) return;
            setReferenceForm(asset);
            setSelected(null);
            setViewTool(null);
            setReferenceSizing(asset.kind === 'image');
            if (asset.kind === 'image') viewport.current?.normalTo(asset.planeId);
          } catch (error) {
            if (request === referenceRequest.current) setNotice((error as Error).message);
          } finally {
            if (request === referenceRequest.current) setReferenceLoading(false);
          }
        }}
      />
      <div className="toolbar">
        <div className="file-tools" role="group" aria-label="File and history">
          <div className="file-actions">
            <button aria-label="New part" title="New part" onClick={createPart}>
              <FilePlus2 size={18} />
            </button>
            <button
              aria-label="Open document"
              title="Open MVCAD document or import STEP curves"
              onClick={() => chooseFile(false)}
            >
              <FolderOpen size={18} />
            </button>
            <ExportBody
              mesh={doc.autoSweep ? sweep : undefined}
              name={doc.name}
              disabled={
                busy ||
                !!sweepError ||
                !!engineError ||
                !!form ||
                !!pointForm ||
                !!curveForm ||
                !!filletForm ||
                !!referenceForm
              }
              onExport={setNotice}
              onExportDocument={download}
            />
          </div>
          <div className="history-actions">
            <button
              aria-label="Undo"
              title="Undo (Ctrl / ⌘ Z)"
              disabled={!history.past.length}
              onClick={undo}
            >
              <Undo2 size={18} />
            </button>
            <button
              aria-label="Redo"
              title="Redo (Ctrl / ⌘ Shift Z)"
              disabled={!history.future.length}
              onClick={redo}
            >
              <Redo2 size={18} />
            </button>
          </div>
        </div>
        <div className="toolbar-divider" />
        <div className="datum-group" role="group" aria-label="Datum">
          <div className="datum-tools">
            <button
              className="reference-button"
              aria-label="Reference plane"
              disabled={
                !engineReady ||
                !!engineError ||
                !!form ||
                !!pointForm ||
                !!curveForm ||
                !!filletForm ||
                !!referenceForm ||
                doc.planes.length >= MAX_PLANES
              }
              onClick={startCreate}
            >
              <PlaneIcon color="#a88035" />
              <span>Plane</span>
            </button>
            <div className="datum-secondary-tools">
              <PointTools
                disabled={
                  !engineReady ||
                  !!engineError ||
                  !!form ||
                  !!pointForm ||
                  !!curveForm ||
                  !!filletForm ||
                  !!referenceForm
                }
                onOffset={() => {
                  setPlaneMenu(null);
                  setNotice('');
                  setPointForm({ id: crypto.randomUUID() });
                }}
              />
              <CurveTools
                disabled={
                  !engineReady ||
                  !!engineError ||
                  !!form ||
                  !!pointForm ||
                  !!curveForm ||
                  !!filletForm ||
                  !!referenceForm ||
                  doc.curves.length >= MAX_CURVES
                }
                onCreate={() => startCurve()}
                onImport={() => chooseFile(true)}
              />
            </div>
          </div>
          <span className="datum-group-title">Datum</span>
        </div>
        <div className="datum-group features-group" role="group" aria-label="Features">
          <div className="datum-tools">
            <button
              className="reference-button auto-sweep-button"
              aria-label="Auto Sweep"
              aria-pressed={!!doc.autoSweep}
              title={doc.autoSweep ? 'Disable Auto Sweep' : 'Generate vessel solids from assigned diameters'}
              disabled={
                !engineReady || !!form || !!pointForm || !!curveForm || !!filletForm || !!referenceForm
              }
              onClick={() => {
                commit({ ...doc, autoSweep: !doc.autoSweep });
                setSelected(null);
                setSweep(undefined);
                setSweepError('');
              }}
            >
              <svg width="34" height="32" viewBox="0 0 36 34" fill="none" aria-hidden="true">
                <path
                  d="M2 14H8C13 14 16 10 20 5C22 2 24 2 28 2H34V8H28C25 8 24 9 22 12L19 16Q18 17 19 18L22 22C24 25 25 26 28 26H34V32H28C24 32 22 32 20 29C16 24 13 20 8 20H2Z"
                  fill="currentColor"
                  fillOpacity="0.14"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <ellipse cx="2" cy="17" rx="1" ry="3" stroke="currentColor" />
                <ellipse cx="34" cy="5" rx="1" ry="3" stroke="currentColor" />
                <ellipse cx="34" cy="29" rx="1" ry="3" stroke="currentColor" />
              </svg>
              <span>Auto Sweep</span>
            </button>
            <div className="datum-secondary-tools">
              <button
                className="point-tool-trigger remove-tool"
                aria-pressed={!!doc.autoSweep && !!doc.removeCaps}
                title={
                  doc.removeCaps
                    ? 'Restore flat end caps'
                    : 'Remove all flat end caps to create a surface shell'
                }
                disabled={
                  !engineReady ||
                  !doc.autoSweep ||
                  busy ||
                  !!form ||
                  !!pointForm ||
                  !!curveForm ||
                  !!filletForm ||
                  !!referenceForm ||
                  (!sweep?.bodies && !doc.removeCaps)
                }
                onClick={() => commit({ ...doc, removeCaps: !doc.removeCaps })}
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M4 5v10c0 3 12 3 12 0V5M4 5c0 3 12 3 12 0"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M4 5c0-3 12-3 12 0"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeDasharray="2 2"
                  />
                  <path d="M7 2h6" stroke="currentColor" strokeWidth="1.5" />
                </svg>
                <span>Remove</span>
              </button>
              <button
                className="point-tool-trigger regenerate-tool"
                title="Rebuild the vessel bodies from the current centerlines and settings"
                disabled={
                  !engineReady ||
                  !doc.autoSweep ||
                  busy ||
                  !!engineError ||
                  !!form ||
                  !!pointForm ||
                  !!curveForm ||
                  !!filletForm ||
                  !!referenceForm
                }
                onClick={() => {
                  setBusy(true);
                  setGenerationProgress(0);
                  setRegeneration((value) => value + 1);
                }}
              >
                <RefreshCw size={16} />
                <span>Regenerate</span>
              </button>
              <button
                className="point-tool-trigger"
                disabled={
                  !doc.autoSweep ||
                  !sweep?.cadEdges?.length ||
                  busy ||
                  !!form ||
                  !!pointForm ||
                  !!curveForm ||
                  !!filletForm ||
                  !!referenceForm
                }
                onClick={() => editFillet()}
              >
                <RoundingIcon size={16} />
                <span>Rounding</span>
              </button>
            </div>
          </div>
          <span className="datum-group-title">Features</span>
        </div>
        <div className="datum-group view-group" role="group" aria-label="View">
          <div className="datum-tools">
            <button
              className="reference-button"
              aria-label="Bounding Box"
              aria-pressed={viewTool === 'box'}
              disabled={!!form || !!pointForm || !!curveForm || !!filletForm || !!referenceForm}
              onClick={() => setViewTool((mode) => (mode === 'box' ? null : 'box'))}
            >
              <Box size={28} />
              <span>
                Bounding
                <br />
                Box
              </span>
            </button>
            <div className="datum-secondary-tools">
              <button
                className="point-tool-trigger"
                aria-pressed={viewTool === 'spacing'}
                onClick={() => setViewTool((mode) => (mode === 'spacing' ? null : 'spacing'))}
              >
                <Ruler size={16} />
                <span>Check Spacing</span>
              </button>
              <button
                className="point-tool-trigger"
                aria-pressed={viewTool === 'section'}
                disabled={!geometry.length}
                onClick={() => {
                  if (viewTool === 'section' && sectionView) removeSection(sectionView.id);
                  else addSection();
                }}
              >
                <Slice size={16} />
                <span>Section View</span>
              </button>
              <button
                className="point-tool-trigger"
                disabled={
                  referenceLoading ||
                  !!form ||
                  !!pointForm ||
                  !!curveForm ||
                  !!filletForm ||
                  !!referenceForm ||
                  !geometry.length
                }
                onClick={() => referenceInput.current?.click()}
              >
                <ImagePlus size={16} />
                <span>{referenceLoading ? 'Importing…' : 'Reference'}</span>
              </button>
            </div>
            <div className="datum-secondary-tools">
              <button
                className="point-tool-trigger show-edges-tool"
                aria-pressed={showEdges}
                onClick={() => setShowEdges((value) => !value)}
                title="Show or hide body edges"
              >
                <Scan size={16} />
                <span>Show Edges</span>
              </button>
              <button
                className="point-tool-trigger"
                aria-pressed={measureActive}
                disabled={!!form || !!pointForm || !!curveForm || !!filletForm || !!referenceForm}
                onClick={() => {
                  setViewTool(null);
                  setMeasureActive((value) => !value);
                }}
              >
                <Ruler size={16} />
                <span>Measure</span>
              </button>
            </div>
          </div>
          <span className="datum-group-title">View</span>
        </div>
      </div>
      <main
        className={`main-layout ${pointForm || curveForm ? 'with-point-panel' : ''} ${showProperties ? '' : 'without-properties'}`}
      >
        <aside className="design-sidebar">
          <div className="panel-heading">
            <h2>Design tree</h2>
          </div>
          {treeSelection.size > 1 && !form && !pointForm && !curveForm && !filletForm && !referenceForm && (
            <div className="tree-selection-tools">
              <span>{treeSelection.size} selected</span>
              <button onClick={createGroup}>
                <FolderPlus size={15} /> Group selected
              </button>
            </div>
          )}
          <section className="active-bodies" aria-label="Active bodies">
            <button
              className="tree-root"
              aria-expanded={!bodiesCollapsed}
              onClick={() => setBodiesCollapsed((v) => !v)}
            >
              <ChevronDown size={15} className={bodiesCollapsed ? 'collapsed' : ''} />
              <Layers2 size={19} />
              <span>Active bodies</span>
            </button>
            {!bodiesCollapsed && (
              <div className="tree" role="tree" aria-label="Active bodies">
                {doc.autoSweep &&
                  sweep?.bodyRanges.map((_, i) => {
                    const id = `__body__:${i}`;
                    return (
                      <div key={id} className={`tree-row ${selected === id ? 'selected' : ''}`}>
                        <button
                          className="tree-item"
                          role="treeitem"
                          aria-selected={selected === id}
                          onClick={() => select(id)}
                        >
                          <Layers2 size={18} />
                          <span>Body {i + 1}</span>
                        </button>
                      </div>
                    );
                  })}
                {(!doc.autoSweep || !sweep?.bodies) && (
                  <p className="bodies-empty">{doc.autoSweep && busy ? 'Updating…' : 'No active bodies'}</p>
                )}
              </div>
            )}
          </section>
          <button className="tree-root" aria-expanded={!collapsed} onClick={() => setCollapsed((v) => !v)}>
            <ChevronDown size={15} className={collapsed ? 'collapsed' : ''} />
            <FileBox size={19} />
            <span>{doc.name}</span>
          </button>
          {!collapsed && (
            <div
              className="tree"
              role="tree"
              aria-label="Design tree"
              aria-multiselectable="true"
              onKeyDown={(e) => {
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
                const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')];
                const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
                if (current < 0) return;
                e.preventDefault();
                const index =
                  e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? buttons.length - 1
                      : Math.max(0, Math.min(buttons.length - 1, current + (e.key === 'ArrowDown' ? 1 : -1)));
                buttons[index].focus();
                buttons[index].dispatchEvent(
                  new MouseEvent('click', {
                    bubbles: true,
                    shiftKey: e.shiftKey,
                    ctrlKey: e.ctrlKey,
                    metaKey: e.metaKey,
                  }),
                );
              }}
            >
              {domainGroup && renderGroup(domainGroup)}
              {BASE_PLANES.filter((p) => !groupedIds.has(p.id)).map((p) =>
                treeRow(p.id, planeName(doc, p.id), p.color, doc.baseVisibility[p.id]),
              )}
              <div className={`tree-row ${selected === 'origin' ? 'selected' : ''}`}>
                <button
                  role="treeitem"
                  aria-selected={selected === 'origin'}
                  className="tree-item"
                  onClick={() => select('origin')}
                >
                  <Crosshair size={18} />
                  <span>Origin</span>
                </button>
              </div>
              {doc.planes.some((p) => !groupedIds.has(p.id)) && <div className="tree-separator" />}
              {doc.planes
                .filter((p) => !groupedIds.has(p.id))
                .map((p) => treeRow(p.id, p.name, '#7062c4', p.visible))}
              {doc.pointSets.some((p) => !groupedIds.has(p.id)) && <div className="tree-separator" />}
              {doc.pointSets
                .filter((set) => !groupedIds.has(set.id))
                .map((set) => treeRow(set.id, set.name, '#bc7938', set.visible))}
              {doc.curves.some((p) => !groupedIds.has(p.id)) && <div className="tree-separator" />}
              {doc.curves
                .filter((curve) => !groupedIds.has(curve.id))
                .map((curve) => renderFeature(curve.id))}
              {!!doc.references?.length && <div className="tree-separator" />}
              {(doc.references ?? []).map((reference) => (
                <div
                  key={reference.id}
                  className={
                    'tree-row ' +
                    (selected === reference.id ? 'selected ' : '') +
                    (!reference.visible ? 'hidden-plane' : '')
                  }
                >
                  <button
                    className="tree-item"
                    role="treeitem"
                    aria-selected={selected === reference.id}
                    onClick={() => select(reference.id)}
                  >
                    <ImagePlus size={18} />
                    <span>{reference.name}</span>
                  </button>
                  <button
                    aria-label={(reference.visible ? 'Hide ' : 'Show ') + reference.name}
                    disabled={!!referenceForm}
                    onClick={() =>
                      commit({
                        ...doc,
                        references: doc.references!.map((r) =>
                          r.id === reference.id ? { ...r, visible: !r.visible } : r,
                        ),
                      })
                    }
                  >
                    {reference.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                  <button
                    aria-label={'Delete ' + reference.name}
                    disabled={!!referenceForm}
                    onClick={() => deleteFeature(reference.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {(doc.fillets ?? []).map((feature) => (
                <div
                  key={feature.id}
                  className={
                    'tree-row ' +
                    (selected === feature.id ? 'selected ' : '') +
                    (feature.suppressed ? 'suppressed-feature' : '')
                  }
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openPlaneMenu(feature.id, e.clientX, e.clientY);
                  }}
                >
                  <button
                    className="tree-item"
                    role="treeitem"
                    aria-selected={selected === feature.id}
                    onClick={() => select(feature.id)}
                    onDoubleClick={() => editFillet(feature)}
                  >
                    <RoundingIcon size={18} />
                    <span>{feature.name}</span>
                  </button>
                </div>
              ))}
              {doc.groups?.some((g) => g.id !== domainGroup?.id) && <div className="tree-separator" />}
              {(doc.groups ?? []).filter((group) => group.id !== domainGroup?.id).map(renderGroup)}
            </div>
          )}
        </aside>
        <Viewport
          ref={viewport}
          darkMode={darkMode}
          showEdges={showEdges}
          doc={displayDoc}
          sections={sectionViews}
          spacing={spacing}
          measureActive={measureActive}
          measureSelections={measureActive ? measureSelections : []}
          measureResult={measureActive ? measureResult : undefined}
          onMeasure={selectMeasure}
          viewControls={
            <>
              {measureActive && (
                <MeasurePanel
                  selections={measureSelections}
                  result={measureResult}
                  pending={measurePending}
                  error={measureError}
                  onClear={clearMeasurement}
                  onClose={() => setMeasureActive(false)}
                />
              )}
              <ViewControls
                key={`${viewTool}-${doc.boundingBox?.planeIds.join()}`}
                mode={viewTool}
                doc={doc}
                geometry={geometry}
                positions={sectionPositions}
                section={sectionView}
                spacing={spacing}
                busy={busy}
                onSection={(value) => sectionView && updateSection({ ...value, id: sectionView.id })}
                onKeepSection={() => {
                  setViewTool(null);
                  setEditingSectionId(null);
                }}
                onAddSection={addSection}
                onCommit={(next) => {
                  commit(next);
                  const domain = next.groups?.find((g) => BASE_PLANES.every((p) => g.members.includes(p.id)));
                  if (domain) setExpandedCurves((previous) => new Set([...previous, domain.id]));
                }}
                onClose={() => {
                  if (viewTool === 'section' && sectionView) removeSection(sectionView.id);
                  setViewTool(null);
                }}
              />
              <SectionSliders
                sections={sectionViews.filter(
                  (item) => viewTool !== 'section' || item.id !== editingSectionId,
                )}
                doc={doc}
                geometry={geometry}
                positions={sectionPositions}
                onSection={updateSection}
                onRemove={removeSection}
                onEdit={(id) => {
                  setEditingSectionId(id);
                  setViewTool('section');
                }}
              />
            </>
          }
          sweep={doc.autoSweep && !busy ? sweep : undefined}
          referenceDraft={referenceForm ?? undefined}
          referenceSizing={referenceSizing}
          onReferenceSize={(size) =>
            setReferenceForm((r) =>
              r?.kind === 'image'
                ? {
                    ...r,
                    ...Object.fromEntries(
                      Object.entries(size).map(([k, v]) => [k, Number(v.toPrecision(6))]),
                    ),
                  }
                : r,
            )
          }
          filletPicking={!!filletForm}
          filletEdges={filletForm?.edges}
          generationProgress={
            busy && doc.autoSweep && !form && !pointForm && !curveForm && !filletForm && !referenceForm
              ? generationProgress
              : undefined
          }
          geometry={geometry}
          selected={selectedSection?.id ?? selected}
          onSelect={select}
          onPlaneContextMenu={(id, x, y) => {
            if (filletForm) return;
            if (doc.references?.some((r) => r.id === id)) {
              select(id);
              return;
            }
            if (id.startsWith('__body__:')) {
              select(id);
              return;
            }
            const section = sections.find((s) => s.id === id);
            setSelectedSectionId(null);
            openPlaneMenu(section?.curveId ?? id, x, y, true);
          }}
          pointGeometry={pointGeometry}
          pointPreview={pointPreview}
          curveGeometry={curveGeometry}
          curvePreview={curvePreview}
          curveEditingId={curveForm?.feature.id}
          onPointPick={pickPoint}
          pickedPoint={curveForm ? (curveForm.feature.nodes[curveForm.active]?.point ?? null) : pickedPoint}
          curveNodes={curveForm?.feature.nodes}
        />
        {showProperties && (
          <aside className="properties-sidebar">
            {referenceForm ? (
              <ReferenceEditor
                asset={referenceForm}
                doc={doc}
                geometry={geometry}
                sizing={referenceSizing}
                onSizing={setReferenceSizing}
                onChange={setReferenceForm}
                onPlane={(id) => viewport.current?.normalTo(id)}
                onCancel={() => {
                  setReferenceForm(null);
                  setReferenceSizing(false);
                  setSelected(null);
                }}
                onApply={() => {
                  commit({
                    ...doc,
                    references: [
                      ...(doc.references ?? []).filter((r) => r.id !== referenceForm.id),
                      referenceForm,
                    ],
                  });
                  setReferenceForm(null);
                  setReferenceSizing(false);
                  setSelected(null);
                }}
              />
            ) : filletForm ? (
              <FilletEditor
                feature={filletForm}
                onChange={setFilletForm}
                busy={busy}
                previewReady={filletPreviewReady}
                error={engineError || sweepError}
                edges={sweep?.cadEdges ?? []}
                names={allNames
                  .filter((f) => f.id !== filletForm.id)
                  .map((f) => f.name.toLowerCase())
                  .concat('origin')}
                onCancel={() => setFilletForm(null)}
                onApply={() => {
                  const feature = { ...filletForm, name: filletForm.name.trim() };
                  commit({
                    ...doc,
                    fillets: doc.fillets?.some((f) => f.id === filletForm.id)
                      ? doc.fillets.map((f) => (f.id === filletForm.id ? feature : f))
                      : [...(doc.fillets ?? []), feature],
                  });
                  setSelected(filletForm.id);
                  setFilletForm(null);
                  setReferenceForm(null);
                  setReferenceSizing(false);
                  referenceRequest.current++;
                  setReferenceLoading(false);
                }}
              />
            ) : selectedFillet ? (
              <>
                <div className="panel-heading">
                  <h2>Rounding</h2>
                  <RoundingIcon size={16} />
                </div>
                <div className="properties-body">
                  <h1>{selectedFillet.name}</h1>
                  <p>Radius: {selectedFillet.radius}</p>
                  <p>
                    {selectedFillet.edges.length} selected edges ·{' '}
                    {selectedFillet.suppressed ? 'Suppressed' : 'Active'}
                  </p>
                  {sweepError && (
                    <p className="form-error" role="alert">
                      {sweepError}
                    </p>
                  )}
                  <button className="wide-button" onClick={() => editFillet(selectedFillet)}>
                    <Pencil size={15} />
                    Edit feature
                  </button>
                  <button className="wide-button" onClick={() => toggleSuppression(selectedFillet.id)}>
                    <CircleSlash size={15} />
                    {selectedFillet.suppressed ? 'Resume' : 'Suppress'}
                  </button>
                  <button className="wide-button" onClick={() => deleteFeature(selectedFillet.id)}>
                    <Trash2 size={15} />
                    Delete fillet
                  </button>
                </div>
              </>
            ) : curveForm ? (
              <CurveEditor
                doc={doc}
                draft={curveForm}
                onChange={setCurveForm}
                busy={busy}
                engineError={engineError}
                onCancel={() => {
                  setCurveForm(null);
                  setFilletForm(null);
                  setReferenceForm(null);
                  setReferenceSizing(false);
                  referenceRequest.current++;
                  setReferenceLoading(false);
                  setPickedPoint(null);
                }}
                onSave={() => {
                  const feature = { ...curveForm.feature, name: curveForm.feature.name.trim() };
                  commit({
                    ...doc,
                    curves: curveForm.editing
                      ? doc.curves.map((c) => (c.id === feature.id ? feature : c))
                      : [...doc.curves, feature],
                  });
                  setSelected(feature.id);
                  setCurveForm(null);
                  setFilletForm(null);
                  setReferenceForm(null);
                  setReferenceSizing(false);
                  referenceRequest.current++;
                  setReferenceLoading(false);
                  setPickedPoint(null);
                  setCollapsed(false);
                }}
              />
            ) : selectedBody !== undefined && !form && !pointForm ? (
              <>
                <div className="panel-heading">
                  <h2>Properties</h2>
                  <Layers2 size={16} />
                </div>
                <div className="properties-body">
                  <h1
                    data-testid="selected-body"
                    data-triangles={(sweep?.bodyRanges[selectedBody]?.count ?? 0) / 3}
                    data-body-kind={sweep?.surfaceShell ? 'surface' : 'solid'}
                  >
                    Body {selectedBody + 1}
                  </h1>
                  <p className="selection-type">
                    {busy
                      ? 'Updating bodies…'
                      : sweep?.surfaceShell
                        ? 'Surface shell · end caps removed'
                        : 'Circular sweeps with smooth transitions'}
                  </p>
                  {sweepError ? (
                    <p role="alert">{sweepError}</p>
                  ) : (
                    <dl>
                      <dt>Joined bodies</dt>
                      <dd data-testid="sweep-body-count">{sweep?.bodies ?? 0}</dd>
                      <dt>Transition</dt>
                      <dd>Per-subcurve cutoffs</dd>
                      <dt>Unassigned sections</dt>
                      <dd>{sweep?.skipped ?? 0}</dd>
                    </dl>
                  )}
                  <button className="wide-button" onClick={() => viewport.current?.fit()}>
                    <LocateFixed size={16} /> Fit geometry
                  </button>
                  <button className="wide-button" onClick={() => commit({ ...doc, autoSweep: false })}>
                    <EyeOff size={16} /> Disable Auto Sweep
                  </button>
                </div>
              </>
            ) : selectedCurve && !form && !pointForm ? (
              <>
                <div className="panel-heading">
                  <h2>Properties</h2>
                  <Spline size={16} />
                </div>
                <div className="properties-body">
                  <div className="selection-icon">
                    <Spline size={26} />
                  </div>
                  <h1>{selectedSection ? `Subcurve ${selectedSection.index + 1}` : selectedCurve.name}</h1>
                  <p className="selection-type">
                    {selectedSection ? `${selectedCurve.name} · Curve section` : 'Curve through points'}
                  </p>
                  {selectedSection ? (
                    <>
                      <SubcurveDiameter
                        key={selectedSection.id}
                        value={sectionDiameter(selectedCurve, selectedSection)}
                        onAssign={(diameter) =>
                          commit({
                            ...doc,
                            curves: doc.curves.map((curve) =>
                              curve.id === selectedCurve.id
                                ? assignSectionDiameter(curve, selectedSection, diameter)
                                : curve,
                            ),
                          })
                        }
                      />
                      <SubcurveSweepSettings
                        key={`sweep-${selectedSection.id}`}
                        settings={sectionSweepSettings(doc, sections, selectedSection)}
                        onApply={(property, value) =>
                          commit(assignSectionSweepSetting(doc, selectedSection, property, value))
                        }
                      />
                    </>
                  ) : (
                    <dl>
                      <dt>Points</dt>
                      <dd data-testid="curve-point-count">{selectedCurve.nodes.length}</dd>
                      <dt>Status</dt>
                      <dd>{suppressed.has(selectedCurve.id) ? 'Suppressed' : 'Active'}</dd>
                    </dl>
                  )}
                  <button className="wide-button" onClick={() => editCurve(selectedCurve)}>
                    <Pencil size={15} /> {selectedSection ? 'Edit master curve' : 'Edit feature'}
                  </button>
                  {!selectedSection && (
                    <>
                      <button className="wide-button" onClick={() => toggleSuppression(selectedCurve.id)}>
                        <CircleSlash size={15} />
                        {selectedCurve.suppressed ? 'Resume' : 'Suppress'}
                      </button>
                      <button className="wide-button" onClick={deleteSelected}>
                        <Trash2 size={15} /> Delete curve
                      </button>
                    </>
                  )}
                  <ol className="curve-summary">
                    {selectedCurve.nodes
                      .slice(
                        selectedSection?.start ?? 0,
                        selectedSection ? selectedSection.end + 1 : undefined,
                      )
                      .map((node) => (
                        <li key={node.id}>
                          {resolvePoint(doc, node.point)?.name}{' '}
                          <small>{node.connection === 'line' ? 'Straight line' : 'Spline'}</small>
                        </li>
                      ))}
                  </ol>
                </div>
              </>
            ) : pointForm ? (
              <PointEditor
                key={pointForm.id}
                doc={doc}
                id={pointForm.id}
                initial={pointForm.initial}
                busy={busy}
                engineError={engineError}
                onPreview={setPointPreview}
                onCancel={() => {
                  setPointForm(null);
                  setPointPreview(undefined);
                }}
                onSave={(set) => {
                  commit({
                    ...doc,
                    pointSets: pointForm.initial
                      ? doc.pointSets.map((p) => (p.id === set.id ? set : p))
                      : [...doc.pointSets, set],
                  });
                  setSelected(set.id);
                  setCollapsed(false);
                  setPointForm(null);
                  setPointPreview(undefined);
                }}
              />
            ) : form ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  applyForm();
                }}
                className="plane-form"
              >
                <div className="panel-heading">
                  <h2>{form.mode === 'create' ? 'New reference plane' : 'Edit reference plane'}</h2>
                  <button
                    className="icon-button"
                    aria-label="Cancel plane"
                    type="button"
                    onClick={() => setForm(null)}
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="form-body">
                  <div className="feature-type">
                    <Layers2 size={19} />
                    <span>Offset plane</span>
                    <span className="tiny-badge">PARALLEL</span>
                  </div>
                  <p className="muted form-intro">Create a plane parallel to an existing reference.</p>
                  <label htmlFor="plane-name">Name</label>
                  <input
                    id="plane-name"
                    maxLength={60}
                    value={form.name}
                    autoFocus
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                  <label htmlFor="parent-plane">Reference plane</label>
                  <select
                    id="parent-plane"
                    value={form.parentId}
                    onChange={(e) => setForm({ ...form, parentId: e.target.value })}
                  >
                    {parentOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <label htmlFor="plane-offset">Offset distance</label>
                  <input
                    id="plane-offset"
                    type="number"
                    step="any"
                    min={-MAX_OFFSET}
                    max={MAX_OFFSET}
                    value={form.offset}
                    onChange={(e) => setForm({ ...form, offset: e.target.value })}
                  />
                  <button
                    className="flip-button"
                    type="button"
                    disabled={!form.offset.trim() || !Number.isFinite(Number(form.offset))}
                    onClick={() => setForm({ ...form, offset: String(-Number(form.offset)) })}
                  >
                    <ArrowRight size={14} />
                    Flip direction
                  </button>
                  <p className="field-hint">
                    Positive offsets follow the reference plane’s normal. Use a negative value for the
                    opposite side.
                  </p>
                  <div className="preview-note">
                    <span className="preview-dot" />
                    Live preview<span>{busy ? 'Updating…' : formError ? 'Unavailable' : 'Active'}</span>
                  </div>
                  {formError && (
                    <p role="alert" className="form-error">
                      {formError}
                    </p>
                  )}
                </div>
                <div className="form-actions">
                  <button type="button" className="secondary-button" onClick={() => setForm(null)}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={!!formError || !!engineError || busy}
                  >
                    <Check size={16} />
                    {form.mode === 'create' ? 'Create plane' : 'Apply changes'}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="panel-heading">
                  <h2>Properties</h2>
                  <span className="property-indicator" />
                </div>
                {selected ? (
                  <div className="properties-body">
                    <div className="selection-icon">
                      {selected === 'origin' ? (
                        <Crosshair size={28} />
                      ) : (
                        <PlaneIcon color={selectedBase?.color ?? '#7062c4'} />
                      )}
                    </div>
                    <h1>{selected === 'origin' ? 'Origin' : planeName(doc, selected)}</h1>
                    <p className="selection-type">
                      {selected === 'origin'
                        ? 'Coordinate system'
                        : selectedBase
                          ? 'Default reference plane'
                          : 'Offset reference plane'}
                    </p>
                    <div className="property-section-title">DEFINITION</div>
                    {selected === 'origin' ? (
                      <dl>
                        <dt>Position</dt>
                        <dd>0, 0, 0</dd>
                        <dt>Coordinates</dt>
                        <dd>World</dd>
                      </dl>
                    ) : (
                      <>
                        <dl>
                          <dt>Type</dt>
                          <dd>{selectedBase ? 'Principal plane' : 'Offset plane'}</dd>
                          {selectedBase && (
                            <>
                              <dt>Orientation</dt>
                              <dd>{selectedBase.orientation}</dd>
                              <dt>Normal</dt>
                              <dd>{selectedBase.normal}</dd>
                            </>
                          )}
                          {selectedFeature && (
                            <>
                              <dt>Reference</dt>
                              <dd>{planeName(doc, selectedFeature.parentId)}</dd>
                              <dt>Offset</dt>
                              <dd data-testid="selected-offset">{format(selectedFeature.offset)}</dd>
                            </>
                          )}
                          <dt>Position</dt>
                          <dd data-testid="selected-position">
                            {selectedGeometry
                              ? selectedGeometry.frame.slice(0, 3).map(format).join(', ')
                              : suppressed.has(selected)
                                ? 'Suppressed'
                                : '…'}
                          </dd>
                          <dt>Visibility</dt>
                          <dd>
                            {suppressed.has(selected)
                              ? 'Suppressed'
                              : (selectedBase ? doc.baseVisibility[selected] : selectedFeature?.visible)
                                ? 'Shown'
                                : 'Hidden'}
                          </dd>
                        </dl>
                        <button
                          className="wide-button"
                          disabled={suppressed.has(selected)}
                          onClick={() => viewport.current?.normalTo(selected)}
                        >
                          <LocateFixed size={16} />
                          View normal to plane
                        </button>
                        <button
                          className="wide-button"
                          disabled={!engineReady || !!engineError || suppressed.has(selected)}
                          onClick={startCreate}
                        >
                          <Plus size={16} />
                          Create offset from this plane
                        </button>
                        {selectedFeature && (
                          <div className="edit-actions">
                            <button className="wide-button" onClick={() => editPlane(selectedFeature.id)}>
                              <Pencil size={15} />
                              Edit plane
                            </button>
                            <button
                              className="delete-button"
                              aria-label="Delete plane"
                              title={
                                descendants(doc, selectedFeature.id).size
                                  ? 'Delete dependent planes first'
                                  : 'Delete plane'
                              }
                              disabled={descendants(doc, selectedFeature.id).size > 0}
                              onClick={deleteSelected}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        )}
                        {selectedFeature && descendants(doc, selectedFeature.id).size > 0 && (
                          <p className="field-hint">
                            Used by {descendants(doc, selectedFeature.id).size} other plane(s). Editing this
                            plane also updates its dependents.
                          </p>
                        )}
                      </>
                    )}
                    <div className="property-note">
                      {selectedBase
                        ? 'Default planes are fixed at the origin and cannot be deleted.'
                        : selected === 'origin'
                          ? 'The fixed reference point for your design.'
                          : 'This plane remains linked to its reference.'}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </aside>
        )}
      </main>
      <footer className="statusbar">
        <span className={`engine-status ${engineError ? 'failed' : ''}`}>
          <i />
          {engineError ? 'Engine error' : engineReady ? 'Engine ready' : 'Starting engine…'}
        </span>
        <span className="status-divider" />
        <span>
          {curveForm
            ? 'Defining curve through points'
            : pointForm
              ? 'Defining datum points'
              : form
                ? 'Defining reference plane'
                : selected
                  ? selected === 'origin'
                    ? 'Origin selected'
                    : `${planeName(doc, selected)}${selectedSection ? ` · Subcurve ${selectedSection.index + 1}` : ''} selected`
                  : 'Select a reference or create a new plane'}
        </span>
        <div className="status-right">
          <StorageStatus
            saveStatus={saveStatus}
            onRetry={() => {
              lastSaved.current = undefined;
              setSaveState({ doc, status: 'Saving…' });
              setSaveRetry((value) => value + 1);
            }}
          />
          <span>
            {saveStatus === 'Saved locally' && <Check size={13} />}
            {saveStatus}
          </span>
          <span className="status-divider" />
          <button
            className="theme-toggle"
            aria-label="Dark mode"
            aria-pressed={darkMode}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setDarkMode((value) => !value)}
          >
            <Moon size={15} />
          </button>
        </div>
      </footer>
      {(notice || engineError || (sweepError && selectedBody === undefined)) && (
        <div className="notice" role="alert">
          <span>{engineError || sweepError || notice}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => {
              setNotice('');
              setSweepError('');
            }}
            disabled={!!engineError}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {planeMenu && (
        <PlaneContextMenu
          name={multipleMenu ? `${treeSelection.size} selected` : planeName(doc, planeMenu.id)}
          multiple={multipleMenu}
          onGroup={multipleMenu ? createGroup : undefined}
          onUngroup={menuGroup ? () => ungroup(menuGroup.id) : undefined}
          onToggleVisibility={
            menuGroup
              ? () => {
                  toggleVisibility(menuGroup.id);
                  setPlaneMenu(null);
                }
              : undefined
          }
          visible={menuGroup?.visible}
          x={planeMenu.x}
          y={planeMenu.y}
          disabled={
            !engineReady ||
            !!engineError ||
            !!form ||
            !!pointForm ||
            !!curveForm ||
            !!filletForm ||
            !!referenceForm ||
            (!menuGroup &&
              !multipleMenu &&
              !planeMenu.viewport &&
              !doc.pointSets.some((p) => p.id === planeMenu.id) &&
              doc.planes.length >= MAX_PLANES)
          }
          onCreate={
            menuGroup ||
            planeMenu.viewport ||
            doc.pointSets.some((p) => p.id === planeMenu.id) ||
            doc.curves.some((p) => p.id === planeMenu.id) ||
            doc.fillets?.some((p) => p.id === planeMenu.id) ||
            suppressed.has(planeMenu.id)
              ? undefined
              : () => createFromPlane(planeMenu.id)
          }
          onEdit={
            doc.fillets?.some((f) => f.id === planeMenu.id)
              ? () => editFillet(doc.fillets!.find((f) => f.id === planeMenu.id))
              : doc.curves.some((p) => p.id === planeMenu.id)
                ? () => editCurve(doc.curves.find((p) => p.id === planeMenu.id)!)
                : doc.pointSets.some((p) => p.id === planeMenu.id)
                  ? () => {
                      const initial = doc.pointSets.find((p) => p.id === planeMenu.id)!;
                      setPointForm({ id: initial.id, initial });
                      setPlaneMenu(null);
                    }
                  : planeMenu.viewport && doc.planes.some((p) => p.id === planeMenu.id)
                    ? () => editPlane(planeMenu.id)
                    : undefined
          }
          onNormal={
            planeMenu.viewport &&
            !doc.curves.some((p) => p.id === planeMenu.id) &&
            !doc.pointSets.some((p) => p.id === planeMenu.id)
              ? () => {
                  viewport.current?.normalTo(planeMenu.id);
                  setPlaneMenu(null);
                }
              : undefined
          }
          renameDisabled={
            multipleMenu || !!form || !!pointForm || !!curveForm || !!filletForm || !!referenceForm
          }
          onRename={() =>
            doc.fillets?.some((f) => f.id === planeMenu.id)
              ? editFillet(doc.fillets.find((f) => f.id === planeMenu.id))
              : startRename(planeMenu.id)
          }
          onDelete={
            doc.planes.some((p) => p.id === planeMenu.id) ||
            doc.pointSets.some((p) => p.id === planeMenu.id) ||
            doc.curves.some((p) => p.id === planeMenu.id) ||
            doc.fillets?.some((p) => p.id === planeMenu.id)
              ? () => deleteFeature(planeMenu.id)
              : undefined
          }
          deleteDisabled={
            multipleMenu ||
            !!form ||
            !!pointForm ||
            !!curveForm ||
            !!filletForm ||
            !!referenceForm ||
            descendants(doc, planeMenu.id).size > 0
          }
          deleteHint={descendants(doc, planeMenu.id).size ? 'Delete dependent planes first' : undefined}
          onSuppress={
            !menuGroup &&
            allNames.some((p) => p.id === planeMenu.id) &&
            !BASE_PLANES.some((p) => p.id === planeMenu.id)
              ? () => toggleSuppression(planeMenu.id)
              : undefined
          }
          suppressed={
            !![...doc.planes, ...doc.pointSets, ...doc.curves, ...(doc.fillets ?? [])].find(
              (p) => p.id === planeMenu.id,
            )?.suppressed
          }
          onClose={(restoreFocus) => {
            const id = planeMenu.id;
            setPlaneMenu(null);
            if (restoreFocus) {
              if (planeMenu.viewport)
                document.querySelector<HTMLCanvasElement>('.canvas-host canvas')?.focus();
              else treeButtons.current.get(id)?.focus();
            }
          }}
        />
      )}
      {pointActions && (
        <PointActions
          x={pointActions.x}
          y={pointActions.y}
          onClose={() => setPointActions(null)}
          onEdit={() => {
            const initial = doc.pointSets.find((s) => s.id === pointActions.point.setId)!;
            setPointForm({ id: initial.id, initial });
            setPointActions(null);
            setPickedPoint(null);
          }}
          onSuppress={() => toggleSuppression(pointActions.point.setId)}
          onCurve={() => startCurve(pointActions.point)}
        />
      )}
      {help && (
        <div className="help-popover">
          <div>
            <strong>Workspace controls</strong>
            <button aria-label="Close help" onClick={() => setHelp(false)}>
              <X size={16} />
            </button>
          </div>
          <dl>
            <dt>Orbit</dt>
            <dd>Left drag</dd>
            <dt>Pan</dt>
            <dd>Right drag / two-finger drag</dd>
            <dt>Zoom</dt>
            <dd>Scroll / pinch</dd>
            <dt>Fit all geometry</dt>
            <dd>F</dd>
            <dt>Normal to plane</dt>
            <dd>Double-click a plane</dd>
            <dt>Undo / redo</dt>
            <dd>Ctrl / ⌘ Z / Shift Z</dd>
            <dt>Cancel creation</dt>
            <dd>Esc</dd>
            <dt>Rename feature</dt>
            <dd>F2 · Enter to save</dd>
            <dt>Select multiple features</dt>
            <dd>Ctrl / ⌘ click · Shift-click for a range</dd>
            <dt>Group features</dt>
            <dd>Right-click the selection → Group selected</dd>
            <dt>Delete feature</dt>
            <dd>Del</dd>
          </dl>
          <p>
            Planes are infinite references; their displayed boundaries adapt to visible model geometry. All
            coordinates are dimensionless; exported values can be interpreted in any units. Work is saved in
            this browser. Download a document to move it between computers.
          </p>
        </div>
      )}
      <input
        type="file"
        accept=".json,.mvcad,.stp,.step"
        aria-label="Open or import file"
        hidden
        ref={fileInput}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void openFile(file, curvesOnlyImport.current);
        }}
      />
    </div>
  );
}
