# MVCAD

A standalone C++ / Qt 6 Widgets desktop application for creating dimensionless microvascular geometry. Windows/MSVC 2022 and macOS are the initial targets. The compact white workbench has Features, Sketch, Centerlines and Auto Sweep tabs.

**Status: 0.2.0 development preview, working toward v1.0.** Exact solid modeling now uses Open CASCADE 7.9.3. Unsupported commands remain disabled. This release is not yet ready for simulation interchange: STEP export and surface preparation are still pending.

## Available now

- New parts show selectable Front, Top and Right reference planes and an origin.
- Plane-based rectangle, circle and closed-polyline sketches, drawn with the mouse and edited with exact numeric profile dimensions.
- Extruded Boss/Base and Extruded Cut with blind, reversed and mid-plane directions; cuts also support Through All. Preview, editable feature history, regeneration and undo/redo are included.
- Settings: display precision defaults to **0.001**, with finer values down to **0.0001**. This controls mesh chord deviation; analytic circles and solid geometry remain exact.
- CSV imports points only. Curve Through Points constructs an interpolated centerline from an ordered selection. Connections split the network into independently selectable branches.
- Circular branch solids with independent junction-end setbacks (10% default), measured along centerline arc length. Free ends extend to their endpoints.
- Unequal-diameter provisional transitions follow the exact centerline when two assigned branches form a tangent-continuous guide. Radius changes have zero slope at both ends; surface normals are checked around both seams. Fully assigned supported junctions are fused and checked as joined solids. Failed junctions are reported explicitly.
- Round Junctions applies a radius to supported junction intersection edges; invalid rounding preserves the previous model.
- Schema-2 `.mvcad` part files retain points, network parameters, sketches and extrusion history. Schema-1 files remain readable.
- Clean geometry viewport, optional centerlines/labels, orbit, pan, zoom and fit.

## First solid

1. New Part, select a reference plane in the tree or viewport, then Sketch → New Sketch.
2. Draw a Rectangle or Circle with two clicks, or draw a Closed Polyline and press Enter. Escape cancels an unfinished drawing.
3. Smart Dimension edits exact profile coordinates and dimensions. Exit Sketch returns to Features.
4. Extruded Boss/Base builds the solid. Create another profile and choose Extruded Cut to remove material.
5. Double-click a sketch or feature in the history to edit it. Save creates a native `.mvcad` part.

Open `examples/extrusion-and-cut.mvcad` for a saved block with a through-hole. One closed profile per sketch is supported at this stage. These numeric profile dimensions are not a general geometric constraint solver. Nested profiles, general edge fillets, revolve, manual sweep/blend, mirrors, patterns, face removal and STEP export remain future work.

## Point-first vessel workflow

Import `examples/connected-points.csv`. Create a main centerline using P1, P2, P3, P4, P5, then a connecting vessel using P3, P6, P7. Reusing P3 splits the main centerline into two branches. Select each branch in Auto Sweep and assign its diameter. The unassigned third branch stays visible as a centerline; partial junction transitions are purple and marked provisional.

```csv
point_id,x,y,z
P1,-30,0,0
P2,-15,0,0
P3,0,0,0
P4,15,4,0
P5,30,10,0
P6,6,-15,0
P7,10,-30,0
```

The header `x,y,z` is also accepted; IDs are then generated. Legacy `curve_id,x,y,z` files import as points, without automatically constructing their old curves. Import appends points; Curve Through Points provides explicit point ordering and a connection tolerance. Interior shared points and endpoints within tolerance of the actual interpolated centerline establish junctions, including when the main centerline is created later. Arbitrary spatial crossings do not connect. A projected connection inserts a shared interpolation point and regenerates the affected curve; its shape can change slightly. Imported source points remain separately preserved. Unchanged branches retain their diameter assignments when another curve is added; newly split branches require assignment.

Open `examples/centerline-guided-blend.mvcad` for the curved 8-to-6 provisional transition, or `examples/rounded-junction.mvcad` for a joined Y-junction with a 0.1 round and 30% setbacks. A partial transition across separate centerlines with a tangent discontinuity is rejected. Fully assigned junctions use guided arms meeting a central Boolean union; Round Junctions smooths supported intersection edges. Tangency is checked at the branch seams, but global smoothness of the central union is not guaranteed. Junction feasibility depends on curvature, angles, radii and available setback. Increase setbacks when a junction reports insufficient room. A failed junction leaves individual branch solids visible and is never marked complete. Round Junctions currently uses one radius for all fully assigned junctions. Fine tessellation can take several seconds and large-network performance remains under development.

Dimensions have no unit suffix. Source numeric values are retained in the part file. CSV limits are 16 MB / 50,000 points; native files are limited to 32 MB.

## Build

Requires CMake 3.24+, Ninja, a C++20 compiler, Qt 6.8.3 (Core/Gui/Widgets/Test), and Open CASCADE 7.9.3. Build the pinned minimal shared kernel first in an MSVC developer shell or an Xcode command-line-tools environment:

```sh
python scripts/bootstrap-occt.py --jobs 4
```

The script verifies the upstream source commit and installs the kernel under `.tools/occt`. CMake discovers this prefix automatically. Qt can be supplied through `CMAKE_PREFIX_PATH`.

On Windows with Visual Studio 2022 C++ Build Tools:

```powershell
./scripts/build-windows.ps1 -Preset release -Launch
```

On macOS:

```sh
export CMAKE_PREFIX_PATH=/path/to/Qt/6.8.3/macos
export PATH="$CMAKE_PREFIX_PATH/bin:$PATH"
cmake --preset release
cmake --build --preset release --parallel
ctest --preset release
open build/release/MVCAD.app
```

Automated checks cover analytic extrusion/cut volumes, invalid operations, vessel solids, curved-guide transitions and seam tangency, junction fillets, point connections, persistence, viewport depth/lighting and a native UI smoke workflow. A real Mac interactive test remains required before v1.0.

## Development packages

[GitHub Releases](https://github.com/Mithun-1/MVCAD/releases) distributes Windows x64 installers/portable ZIPs and macOS Apple Silicon disk images. Packages are unsigned development builds.

For the Windows ZIP, extract everything, install `bin/vc_redist.x64.exe` if needed, and run `bin/MVCAD.exe`. Keep adjacent libraries/plugins with the executable. The installer includes the runtime. On macOS, copy MVCAD.app from the disk image to Applications.

See [release gates](docs/ROADMAP.md), [interface specification](design/command-interface-v2.md), and [third-party notices](docs/THIRD_PARTY.md).

## Repository policy

Public source repository; no project source license has been selected yet. Publication does not grant an additional source license. Local build tools and user research reference imagery are excluded from Git. Generated design targets are in `design/`.
