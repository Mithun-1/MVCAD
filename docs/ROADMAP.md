# v1.0 release gates

Version 0.2.0 is a development milestone. Do not tag v1.0 until the requirements below are implemented and validated.

## Foundation

- Native Qt Widgets application; compact Features / Sketch / Centerlines / Auto Sweep tabs.
- CSV import, point/branch graph, editable branch diameters/setbacks and native part persistence.
- Undo/redo, transactional error handling, clean default viewport and optional display overlays.
- Windows MSVC and macOS build/test/package automation.

## CAD geometry and interchange

- Evaluate Open CASCADE using real input curves plus synthetic Y/T junctions, mergers, loops, acute angles, short branches, unequal diameters and closely spaced junctions.
- OCCT 7.9.3 now supplies the initial exact extrusion, sweep and junction implementation. Validate its suitability for the full solid/surface and STEP requirements; keep document state separate from kernel objects.
- Constant-diameter branch solids with arc-length setbacks and free-end preservation.
- Provisional blends for partially assigned junctions, rebuilt as a single valid joined region when all incident diameters are assigned. A set of intersecting tubes is not an acceptable substitute.
- Editable round/fillet transitions, invalid-radius handling and last-valid-model preservation.
- Face removal to an open surface shell while retaining the solid representation.
- Solid, surface and centerline STEP export and reimport verification. Explicit STEP unit metadata policy must preserve the numeric coordinates users entered; the UI remains dimensionless.
- Real COMSOL import and downstream surface-meshing checks.

## General part modeling

- Extruded, revolved and swept boss/base; Swept Blend; matching four cut operations.
- Centerline-first sweep/blend with an automatically offered normal sketch plane.
- Body mirror, linear/circular body patterns and reference planes/axes/points/coordinate systems.
- Editable feature history, dependency regeneration, rollback and durable feature references.
- See `design/command-interface-v2.md` for complete sketch primitives, dimensions, relations, editing, mirroring and pattern requirements. Select and validate a constraint solver; disabled toolbar commands must become real operations.

## Robustness and distribution

- Endpoint-to-segment connection review, import adapter for actual research data, ambiguous connection handling.
- Large network and self-intersection diagnostics; adequate interactive performance.
- Native document migration/backward-compatibility policy and crash recovery.
- GUI interaction tests for sketching, modeling, undo/redo, save/load and all export targets.
- Windows and macOS CI pass, install/uninstall tests, and early interactive test on a real Mac.
- Choose source license, audit redistributed dependency notices, decide signing/notarization requirements.
- Publish v1.0 installers through GitHub Releases only after these gates are satisfied.

## Current geometry limitation

The viewport now tessellates Open CASCADE solids. Branches use interpolated B-splines and arc-length setbacks; junctions use variable-radius lofts and Boolean unions, with optional intersection-edge fillets. B-rep validity and connected-solid checks gate successful junctions. These checks do not prove global clearance, curvature continuity, physiological suitability or downstream meshing quality. Short setbacks and difficult angles can fail and are labeled explicitly. Software rendering can have depth-order artifacts and fine tessellation remains slow. General edge fillets and STEP round trips are still unimplemented.

## Display contract

No persistent branch IDs, diameter labels, section rings or junction annotations in the default geometry viewport. Relevant highlights and editing handles are contextual. Optional overlays never become geometry. Centerline STEP export, when implemented, intentionally exports the selected curve geometry separately from solid/surface exports.
