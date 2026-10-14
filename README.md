# MVCAD

A desktop and browser CAD workspace for vascular geometry, using TypeScript, React, Three.js, and C++ WebAssembly geometry kernels.

## Install on Windows or macOS

Download an installer from [GitHub Releases](https://github.com/Mithun-1/MVCAD/releases).

- Windows: run the `MVCAD-…-win-x64.exe` installer. Choose an installation directory and launch MVCAD from the Start menu or desktop shortcut.
- Apple Silicon Mac: open the `MVCAD-…-mac-arm64.dmg` and drag MVCAD into Applications.

The Electron desktop app includes the UI, reference kernel, and OpenCascade kernel; it runs offline without Node.js, a browser, or the Vite server installed. File import and export use the existing toolbar. Desktop autosave is separate from browser autosave: export your current browser document as MVCAD, then open it in the desktop app. Preview installers are unsigned and macOS builds are not notarized, so OS security prompts/restrictions apply. Trusted distribution requires Windows code signing and Apple Developer ID signing/notarization.

### Build desktop installers

With Node.js 24 and dependencies installed:

```sh
npm run desktop       # Build and launch the desktop app
npm run desktop:win   # Windows x64 .exe installer (run on Windows)
npm run desktop:mac   # Apple Silicon .dmg installer (run on macOS)
npm run desktop:pack  # Unpacked application for testing
npm run test:desktop  # Test built UI: CAD generation, imports, STEP export, restart
```

Outputs are in `release/`. `npm run test:desktop` requires `npm run build` first. The desktop serves only bundled files through `mvcad://app/`, with renderer sandboxing, context isolation, and no Node access. The checked-in GitHub Actions workflow builds each OS on its own runner. Run **Desktop installers** manually for artifacts; pushing a `v*` tag builds and publishes a preview GitHub Release after both targets succeed. Supported desktop targets are Windows x64 and macOS Apple Silicon (arm64). Signing is not configured yet. Source uploads omit personal sample models, generated output, dependencies, installers, and local tool caches; the small STEP test fixture is included.

## Run locally

Install Node.js 24 LTS, then run these commands from this directory on Windows or macOS:

```sh
npm ci
npm run dev
```

Open the address printed by Vite (normally http://127.0.0.1:5173).
The compiled `engine/planes.wasm` and `engine/sweep.wasm` are included, so a C++ toolchain is **not** required to run the app.

```sh
npm run build       # Type-check and create a deployable dist/ directory
npm run preview     # Serve the production build locally
npm run test:engine # Test the actual Wasm binary and document validation
npm run test:e2e    # Browser integration tests; Google Chrome must be installed
```

Serve `dist/` from a static HTTP(S) server. Do not open `index.html` through `file://`.
The development and preview servers bind to loopback by default. This project is not deployed publicly.

## Reference geometry tools

- Design tree with Front Plane, Top Plane, Right Plane, and Origin.
- Click the part name beside MVCAD to rename the document. Enter or clicking away saves a valid name, Escape cancels, and changes support undo/redo, autosave, and export filenames.
- GPU-rendered orthographic viewport with orbit, pan, zoom, fit, and standard views.
- Moon button at the bottom right switches between light and dark mode. The preference is saved locally, independently of the CAD document.
- The viewport axis indicator follows camera rotation and shows positive X/Y/Z directions. An end-on axis uses a dot toward the viewer and a cross away from the viewer; panning and zooming leave the indicator fixed in place.
- Drag-to-orbit anchors rotation at the point, curve, or surface under the mouse when the drag starts, without snapping it to the screen center. Starting over empty space uses the cursor at the current focus depth. Right-drag and modifier-key panning retain their usual behavior; Fit and standard views restore a centered view.
- Selection from either the tree or viewport; double-click a plane for a normal view.
- Hover a workspace point, plane, curve, or origin for a visual preview of the click target, without text labels. Points use a larger bright orange X with a white outline; nearby points are picked by distance from the cursor. Hover clears while dragging and when leaving the workspace.
- Right-click any plane in the tree to **Create reference plane** or **Rename**. The menu also opens with Shift+F10 or the context-menu key.
- Right-click a plane in the 3D workspace to **Rename** or **View normal**; reference planes also offer **Edit feature**. Right-drag continues to pan without opening the menu.
- Press F2 to rename any selected plane, including the default planes. Enter saves, Escape cancels, and clicking away saves a valid name. Renames support undo/redo, autosave, and document export. Default planes retain their geometry and stable reference IDs; older documents retain their original labels.
- Create named reference planes with signed offsets from a principal or previously created reference plane.
- Live geometry preview; edit offsets/references/names, with dependent planes recomputed.
- Toggle visibility, delete unreferenced custom planes, and undo/redo (100 edit history entries).
- Reference planes and point sets offer **Delete** in their context menus; **Del** also deletes the selected feature. Default geometry and planes with dependents are protected, and Delete does not remove features while editing text or an open feature draft.
- Local browser persistence and portable `.mvcad` export/open (older `.mvcad.json` files remain supported). Opening a document can be undone.
- **Curve ▾ → Import Curves** appends `.stp` / `.step` wireframe centerlines to the current part; Open also accepts these files. Clicking Curve itself still starts a curve through points. Each source curve appears as a master curve with expandable subcurves. Matching endpoints share a junction, and endpoints landing inside another curve split that curve automatically. Import supports undo/redo, persistence, individual subcurve diameters and Auto Sweep. Sampled source points are kept in a hidden point set, which can be shown when needed.
- STEP support currently covers `GEOMETRIC_CURVE_SET` wireframes with non-rational/rational B-splines with knots, polylines, and parameter-trimmed straight lines or splines. SI lengths are converted to millimetres. The viewport adaptively samples curves with a **0.002 mm chord-error target**, without refitting their control points; newly imported B-splines also retain their original poles, knots, weights, and parameter trims as the native sweep guide. Editing their sampled coordinates/order/modes switches the guide to those edited point spans. Documents imported before native guide storage require reimporting their STEP centerlines to recover the original NURBS; endpoint joins use **0.0001 mm** tolerance. Interior crossings alone do not create junctions. Unsupported curve types, solid/assembly files, and imports exceeding the document limits report an error without changing the part. This is a centerline importer, not a general solid STEP translator. STEP entity definitions follow the [STEP Tools schema reference](https://downloads.steptools.com/docs/stp_aim/html/t_b_spline_curve_with_knots.html).
- Input and document-graph validation. Fixed principal planes cannot be deleted.
- Datum ribbon with a tall Plane tool and Point dropdown. **Point → Offset Coordinate System** opens the Cartesian point editor in the right sidebar.
- Multiple independent point sets, each containing manually entered and/or CSV-imported XYZ points relative to the origin. Point selection shows only the nearby shortcut menu, without opening a properties panel. Choose **Edit feature** from the shortcuts or the tree context menu to open the point editor and change coordinates, add/remove rows, or append another CSV. Saving or canceling closes the editor.
- Live point previews, visibility, F2 rename, undo/redo, deletion, local persistence and document roundtrip. Source filenames remain attached to each set. One GPU point cloud is rendered per visible set; tables display 50 editable rows per page.
- Click an individual point in the workspace for an icon-only shortcut popup: **Edit feature**, **Suppress**, and **Curve through points**. The first two act on its owning point set.
- You can also start an empty curve with **Curve**, directly below **Point** in the Datum toolbar, then pick its points in the workspace.
- Curve through points opens the right-side editor. Click additional points to extend the live curve; each row controls its incoming **Spline** or **Straight line** connection. Use the arrows to reorder rows, **Add point** to append a slot, or right-click a row for **Delete**, **Insert point above**, and **Insert point below**. Pick a workspace point to fill an inserted slot; **Select point** replaces an existing row's reference.
- Curves are linked to stable point IDs and recompute after coordinate edits. They appear in the design tree, support editing, F2 rename, visibility, Delete, undo/redo, autosave, and JSON export/import. Referenced points and sets cannot be deleted until their curves are updated or removed.
- Curves sharing a datum point form a junction. Each master splits at its interior junctions into subcurves, preserving its original spline samples and shape. Click a master in the tree to expand/collapse its subcurves (or use Left/Right arrows). Workspace hover and selection target individual sections; selecting one reveals its tree row and endpoints/points in Properties. Edit the master to change its path. Junctions update after edits, deletion, suppression, undo, and document loading; hiding a curve preserves junctions. Separate points with identical coordinates or visual crossings do not create junctions.
- Select a subcurve to assign a positive, dimensionless **Diameter** above **Edit master curve**. Only that section is updated. Diameters are saved on its incoming spans, survive undo/redo and document export/import, and follow sections when junctions split them. A merged section with differing values shows **Mixed diameters** until assigned a uniform value.
- Below Diameter, **Start cutoff** and **End cutoff** set the percentage of each adjoining section's arc length available for its diameter transition. Each defaults to **10%**, accepts **0–50%**, and is disabled at an unconnected end. Start/end follow the master's point order. Both adjoining cutoffs at zero produce an abrupt diameter step; 50% at both ends allows the transition windows to meet. Cutoffs stay attached to the corresponding boundary points through topology changes.
- Junction rounding is an explicit **Features → Rounding** feature. Auto Sweep ignores legacy per-subcurve rounding values; existing documents open with sharp junctions until a fillet feature is applied.
- **Features → Auto Sweep** toggles native B-Rep vessel solids from assigned centerline diameters. Committed diameter, cutoff, and centerline edits regenerate the bodies. Unassigned spans produce no solids. Circular profiles follow the master centerline, with diameter transitions governed by the cutoff settings. Intersecting sweeps are joined using CAD boolean union. Boundary end caps are flat, and rims and junction edges remain sharp. A separate, collapsible **Active bodies** tree lists each connected body.
- **Features → Remove**, beside Auto Sweep, removes all original flat end-cap faces to leave open B-Rep surface shells. It preserves vessel walls and joined junctions without adding thickness. Click again to restore caps. The setting supports regeneration, undo/redo, autosave, and document save/open.
- Chain symbols appear only between connected subcurve rows under a master, never above the first or below the last row. A master with one subcurve has no chain symbols. Hover a chain to see all connected master/subcurve names, including branches under other masters. The endpoint connection graph still tracks all connections and updates with editing, suppression, deletion, undo/redo, and loading a document. Hiding geometry preserves its connections.
- Custom feature context menus offer **Suppress** / **Resume**. Suppressed features remain in the document but are excluded from geometry evaluation. Suppression propagates to dependent planes and curves; visibility alone does not suppress dependents. Default planes cannot be suppressed.

Curve geometry is evaluated in the C++ WebAssembly worker. Spline runs use interpolating cubic Hermite segments with Catmull–Rom tangents, sampled at 24 intervals per segment; straight segments break spline tangent continuity. Current limits are 128 curves and 1,000 references per curve. Connections are to existing datum points; surface-constrained and geodesic curves are not implemented.

Plane creation currently supports **parallel offset**. Point creation supports **Cartesian coordinates from Origin**. The generic Point placement menu entry is reserved for future placement methods. Angled planes, planes through points, sketches, constraints, general solid features, assemblies, and CAD-format import/export are not implemented yet.

Auto Sweep uses OpenCascade through Replicad. CAD surfaces and topology are authoritative; Three.js displays a tessellation derived from those same bodies. Straight constant-radius walls remain analytic cylinders, caps remain planes, and curved sweeps use smooth CAD surfaces, including B-splines. Spline centerlines use the exact cubic spans from the reference kernel. Variable-radius laws interpolate the sampled transition profile along the spine. No global mesh smoothing or automatic junction fillets are applied. Display chordal deflection is at most 0.02 model units, with angular tolerance 0.12 radians. This does not limit the native STEP surface representation.

**Features → Rounding** opens a separate feature editor. Click body edges in the viewport, enter a **radius** (default 1.5, equivalent to diameter 3), and apply. Selecting edges or changing the radius generates a live CAD preview without saving the draft. Selected original edges remain highlighted and selectable while previewing. Apply commits the result; Cancel restores the committed body. The named feature appears in the design tree and supports editing, suppression, deletion, undo/redo, and save/open. Fillets are evaluated in feature order, before Remove. Editing a fillet uses the topology immediately before that feature for edge selection and previews the edited rounding. Geometric edge references survive unchanged regeneration; upstream edits that change an edge report a missing reference and require reselection. Invalid radii or unsupported geometry show an error and the unrounded body for correction, rather than silently falling back to a mesh approximation.

**Features → Regenerate**, directly below Remove, rebuilds the current solid or shell, bypassing the cache. A centered **Regenerating** progress indicator also appears after reload. Progress follows CAD stages, not elapsed time. The OpenCascade Wasm module loads lazily in a dedicated worker and is reused. The production build includes approximately 23 MB of kernel Wasm (about 7.3 MB compressed); no CAD backend or native installation is required.

### Export final bodies

Use the single **Export** button beside New/Open: choose **MVCAD (.mvcad)** to save the complete editable part, or **STEP (.step)** to save generated bodies as STEP AP214. Undo and Redo sit below these file buttons. Parasolid is listed as unavailable. Select mm, cm, or m: one model unit becomes one selected unit. Export uses the native B-Rep, with analytic or B-spline surfaces and trimmed faces, rather than triangle faces. Solids export as solids; Remove exports open shells. Reference geometry and temporary section cuts are excluded. This is the same class of CAD surface representation as the supplied Creo/SolidWorks examples, not a byte-identical file or a reconstruction of their feature histories.

Native Parasolid (.x_t/.x_b) export is not available: it requires a separate compatible writer. STEP is the supported native CAD interchange format. Tests reimport exported files using an independent OpenCascade STEP reader.

## View tools

- **View → Bounding Box** sets positive Lx, Ly, and Lz dimensions (up to 1,000,000 model units). It creates three ordinary reference planes at those coordinates and renames the zero planes Right → Lx_0, Top → Ly_0, Front → Lz_0. All six planes appear in the collapsible **Computational Domain** group first in the part tree, with group hide/show support. Their displayed patches meet exactly at the box edges. Reapplying updates the same planes and group; dimensions and references support undo/redo and document save/load. Removing a box plane releases the box definition, retaining the remaining reference planes.
- **View → Check Spacing** shows the closest distance between the current solid/surface mesh and the six finite box faces. A viewport dimension line links the nearest surface point to the box; touching or crossing a face gives zero. Values use model units and the generated mesh accuracy. The measurement uses full geometry, regardless of section clipping.
- **View → Section View** selects any reference plane and provides a viewport slider, numeric offset, and above/below side selection. **Keep slider in view** closes the settings and leaves a compact slider accessible while editing geometry. **Add section view** (or opening Section View again with sliders pinned) adds an independent cut; all cuts apply together. Each compact slider can reopen its settings or remove its cut. Closing a section's settings removes only that cut. Cuts are temporary, uncapped visualization cuts that affect bodies, points, curves, and picking without changing saved geometry; reference planes remain visible.

### Reference imports

**View → Reference** imports ASCII/binary STL geometry or PNG, JPEG, WebP, GIF, and BMP images. Select an imported reference in the design space or tree to adjust its opacity, then Apply to save or Cancel to revert. References have tree hide/show and delete controls, undo/redo, and are embedded in MVCAD files. They remain separate from generated bodies and STEP exports.

Images attach to any evaluated reference plane. Set width/height in model units and the center U/V relative to that plane's origin; the world XYZ center is shown below. **Drag to size image** lets you draw between opposite corners on the selected plane and updates size and center together. Placement follows later plane edits. Reference files may be up to 1 GB (1,073,741,824 bytes); STL coordinate validation allows the triangle count of a binary STL of that size, replacing the old 100,000-triangle cap. Images retain the 32-million-pixel decoded resolution limit. The file-size limit is an acceptance limit, not a guarantee that every 1 GB asset fits browser/GPU memory. Large references can exceed browser autosave capacity. MVCAD embeds reference data in JSON; its separate 50 MB document-open limit and browser JSON/memory limits still apply.

## Point CSV / PTS import

Open **Point → Offset Coordinate System**, then use **Import Points** at the bottom left of the editor to choose a `.csv` or `.pts` file. A fresh editor replaces its untouched placeholder row; subsequent imports append to the current set. Save, then open the tool again to create a separate point set. Imported data is copied into the document and does not depend on the original file remaining on disk.

PTS centerlines use three space- or tab-separated coordinates (`x y z`) per line, without column headers. Blank lines, scientific notation, and an optional first-line point count are supported. A declared count must match the data rows. Points receive names P1, P2, and so on; additional columns are rejected. Like CSV, PTS retains the original coordinate values and uses the 20 MB file and 100,000-point document limits.

Accepted formats are three numeric columns without headers, or headers `x,y,z` with an optional `name` column. Header order is flexible, case is ignored, and decimal/scientific notation, UTF-8 BOM, CRLF, and quoted CSV fields are supported.

```csv
name,x,y,z
P1,10,20,30
P2,-5.5,0,12.25
```

Coordinates are dimensionless, always relative to Origin. Empty, nonnumeric, nonfinite or out-of-range coordinates reject the entire import without changing the draft. Colliding point names receive suffixes such as `_2`. CSV imports are limited to 20 MB and documents to 100,000 points across all sets, with coordinates within ±1,000,000. Large documents may exceed browser storage; use document download if autosave reports a storage error. Document imports allow up to 50 MB. These limits are resource guards, not a performance guarantee.

## Coordinates and geometry

All coordinates and offsets are dimensionless. CSV imports and document exports preserve the raw numbers without scaling or unit metadata. Existing saved values are unchanged. The receiving software may interpret exported numbers in any desired units. The world is right-handed and Y-up:

| Plane | Contains | Positive normal |
| ----- | -------- | --------------- |
| Front | X and Y  | +Z              |
| Top   | X and Z  | +Y              |
| Right | Y and Z  | +X              |

Planes are infinite mathematical references. Their displayed patches project the bounds of visible point sets (including previews) onto each plane, with an 8% margin on each side. These bounds update after imports, edits, visibility changes, deletion, and undo/redo. Empty models use 140 × 140 patches. Display sizing does not change plane frames, reference offsets, or exported data. `displayBounds.ts` accepts world-space bounding boxes so future curves and solids can contribute to the same sizing. Zero offsets are valid coincident planes. Offset limits are ±1,000,000 per feature. Each document supports up to 4,093 custom planes; this is a safety limit, not a large-model performance guarantee.

## Architecture

Created planes, point sets, and master curves support multi-selection in the design tree: Ctrl/⌘-click toggles individual features and Shift-click selects a visible range. Choose **Group selected** from the selection toolbar or right-click menu to create a collapsible folder. Rename folders with F2 or their context menu, and use the eye button or **Hide group / Show group** to control all members together. Group visibility preserves each feature's individual visibility setting. **Ungroup** removes the folder and retains the members and their current effective visibility. Groups are flat, each feature belongs to at most one group, and generated bodies/default reference geometry remain in their existing sections. Group changes support undo/redo and document save/open; deleting features removes stale memberships and empty folders automatically.

The Regenerating indicator uses a cropped, transparent RBC animation derived from `Media/RegenAnimation.mp4`. The track starts empty and reveals moving RBCs from left to right as progress advances; the leading visible edge marks completion progress, with no cells ahead of it. Reduced-motion preferences use a still frame with the same reveal. Rebuild the included assets with `node scripts/build-rbc-animation.mjs` using FFmpeg on PATH (or the `FFMPEG` environment variable). The original video is preserved, and FFmpeg is not required to run the app.

- `engine/planes.cpp`: freestanding C++17 kernel, using float64 plane frames. No generated JavaScript geometry substitute.
- `engine/planes.wasm`: compiled kernel loaded as a versioned build asset.
- `src/cadKernel.ts`, `src/cadBody.ts`: lazy OpenCascade initialization, exact centerline sweeps, boolean unions, explicit edge fillets, cap removal, B-Rep serialization, and display tessellation.
- `src/stepExport.ts`, `src/stepExport.worker.ts`, `src/ExportBody.tsx`: native AP214 STEP writer and export dialog.
- `src/FilletEditor.tsx`: edge selection and radius settings for separate fillet features.
- `src/sweep.ts`: centerline span and diameter-transition preparation, plus retained legacy mesh helpers.
- `engine/sweep.*`, `src/sweepPool.ts`, `src/sweepChunk.ts`, `src/sweepGeometry.worker.ts`, `src/cylinderSweep.ts`, `src/sweepCache.ts`: historical mesh implementation, retained for regression/benchmark comparison and not used for current body generation.
- `src/engine.worker.ts`: instantiates Wasm in a dedicated Web Worker; reconstructs the ordered dependency graph and returns evaluated frames. Stale responses are discarded by the UI.
- `src/model.ts`: serializable feature definitions, validation, and dependency helpers. Documents store references and dimensions instead of display meshes.
- `src/App.tsx`: design tree, inspector, commands, history, persistence, and creation/edit workflow.
- `src/Viewport.tsx`: Three.js WebGL2 viewport. Rendering happens on changes rather than in a continuous animation loop; geometry resources are disposed when replaced.
- `src/PointEditor.tsx`, `src/points.ts`, `src/pointCsv.worker.ts`: paginated point editing and strict CSV parsing in a separate worker; point batches are validated as float64 coordinates by C++ in the geometry worker before rendering. Display buffers use float32 GPU coordinates while saved coordinates retain JavaScript/float64 precision.

There is no backend or account system. Documents stay in the browser unless downloaded. A successful local save is reported; storage failures produce an explicit download recommendation. Invalid saved documents are preserved until the next user edit. Imported documents are validated before replacing the current document.

Reference geometry is evaluated by the small C++ kernel; generated bodies are evaluated by OpenCascade in the same worker. Feature evaluation rebuilds in order, with a body cache for unchanged geometry. Complex networks, tight bends, or large fillets can fail kernel validation and report an error for correction.

## Rebuild the C++ engine

The tested build uses Zig 0.14.1's Clang C++ frontend to emit freestanding WebAssembly. The source is C++, not Zig. Install a portable Zig toolchain, put `zig` on PATH, or set `ZIG` to its executable. A `zig-*` directory under `.tools/` is detected automatically.

```sh
npm run build:engine
npm run test:engine
npm run build
```

Alternatively, with an activated Emscripten SDK, set `EMXX` to its `em++` executable before running `build:engine`. The Emscripten path is provided but has not been exercised in this workspace. The included Wasm binary was built from the checked-in C++ source with Zig/Clang.

For PowerShell, set an explicit compiler with `$env:ZIG = 'C:\path\to\zig.exe'`.
For macOS, use `ZIG=/path/to/zig npm run build:engine`.

## Validation and compatibility

**Historical mesh benchmarks (not the current B-Rep engine):** `npm run bench:sweep` measures fresh geometry generation and cap removal, without the document cache. PowerShell can select parallel execution with `$env:BENCH_PARALLEL='11'`, fixtures with `$env:BENCH_CASES='minor,medium,network,cylinder'`, and sample count with `$env:BENCH_SAMPLES='11'`. `BENCH_VALIDATE=1` checks closed edge incidence and orientation outside the timed generation. The small fixture contains two rounded junctions and differing vessel diameters.

On this Windows machine (12 available logical processors), ten fresh generations after the first run had median solid/shell times of **84.7/88.5 ms** for the small rounded fixture, versus **4.684/4.696 s** before optimization: **55.3×/53.1×** faster. The medium fixture took **207/210 ms** and a 12-branch network took **724/731 ms**. The old network exceeded the mesh limit, so no speedup ratio is claimed for it. First-use worker startup increased the small fixture to **269 ms** in the final run. These are generation timings, excluding module fetch/compile, browser mesh upload, and rendering; cold reload is not a 50× claim. Raw results and methodology are in `output/sweep-optimization/final.json`, `baseline.json`, and `summary.json`. The grid resolution and fillet protections are unchanged; ordinary cells use fewer redundant interior triangles.

Engine tests cover orthonormal principal frames, positive/negative/chained/zero offsets, invalid parameters, capacity bounds, and reset. Document tests cover malformed dependency graphs and invalid fields. Browser tests cover the creation/edit/deletion flow, descendant updates, undo/redo, persistence, visibility, JSON roundtrip, validation, and a smaller desktop viewport.

Validated on Windows using Chrome, including a production-build browser smoke test. macOS/Safari has not been exercised on actual hardware in this workspace. The runtime uses standard WebAssembly, Web Workers, and WebGL2 and requires those browser features. No platform-specific plugin or native installation is required for users.
