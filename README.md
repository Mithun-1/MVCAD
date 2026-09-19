# MVCAD

MVCAD is a focused C++ / Qt 6 Widgets desktop application for dimensionless microvascular geometry. Its workflow is point sets → editable centerlines → mirrored centerlines → automatic swept bodies. The current targets are Windows/MSVC 2022 and macOS Apple Silicon.

**Status: 0.4.0 development.** No 0.4.0 release has been published. Geometry builds use Open CASCADE 7.9.3, run asynchronously and coalesce queued edits. See the [local verification report](design/performance-verification-040.md) for measured workloads and their limits. STEP export and surface preparation are pending.

## Available workflow

- Import CSV point sets or create point sets by entering Cartesian coordinates.
- Build a curve through an ordered point selection, then edit its point references, coordinates, ordering, name and connection tolerance.
- Create dependent mirrored centerlines from an existing straight two-point centerline axis. Editing the source or axis regenerates the mirror.
- Assign branch diameters and setbacks in Auto Sweep. MVCAD creates exact swept bodies along the centerlines and joins supported junctions with rounded transitions.
- Hide, show, or make bodies transparent. Visibility is saved and undoable.
- Save native `.mvcad` parts with named point sets, centerline dependencies, visibility, diameters and setbacks. Default display precision is **0.001**; the finest setting is **0.0001**.

Classic sketching, extrusion, cuts, revolve, manual sweep, general CAD fillets and related classic modeling commands have been removed from the user interface. MVCAD is centered on centerlines and automatic sweeps.

## Point-first workflow

Import `examples/connected-points.csv`, create a centerline through P1, P2, P3, P4, P5, then another through P3, P6, P7. Reusing P3 creates a branch. Select each branch in Auto Sweep and assign its diameter; an unassigned branch remains visible as a centerline until it is assigned.

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

Interior shared points and endpoints within the connection tolerance establish junctions. Arbitrary spatial crossings do not connect. A projected connection inserts a shared interpolation point and regenerates the affected curve; imported source points remain preserved. Supported coplanar symmetric three-arm junctions use guided arms, one Boolean union, intersection-edge rounding, seam-normal checks and trimmed-surface symmetry validation. Unsupported or invalid junctions fail explicitly and leave the individual branch bodies visible.

`examples/centerline-guided-blend.mvcad` demonstrates a curved 8-to-6 transition. `examples/symmetric-bifurcation.mvcad` demonstrates a mirrored bifurcation. These examples exercise supported centerline geometry; they are not general CAD templates.

## Native files and compatibility

Centerline-based native parts remain compatible with the current schema and retain point sets, centerline dependencies, body visibility, diameters and setbacks. Legacy classic CAD parts that depend on removed sketch, extrusion, cut, revolve or manual-sweep features are rejected when opened; MVCAD does not rewrite or delete those files. Keep the original file if it must be opened by an older build.

## Build

Requires CMake 3.24+, Ninja, a C++20 compiler, Qt 6.8.3 (Core/Gui/Widgets/Concurrent/Test), and Open CASCADE 7.9.3. Build the pinned shared kernel first in an MSVC developer shell or an Xcode command-line-tools environment:

```sh
python scripts/bootstrap-occt.py --jobs 4
```

On Windows:

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

## Development packages

[GitHub Releases](https://github.com/Mithun-1/MVCAD/releases) will publish one Windows x64 installer EXE and a macOS Apple Silicon DMG. The DMG is intended to be opened and dragged to Applications; bundled runtime resources belong inside the app bundle. Packages are currently unsigned development builds. Intel macOS is not verified.

For command-line macOS installation, use the helper with the actual release URL and checksum supplied by the release page. The release workflow will attach `install-macos.sh` and print the complete one-line command; no 0.4.0 assets have been published yet:

```sh
curl --fail --location --proto '=https' URL_OF_INSTALL_MACOS_SH | bash -s -- --url URL_OF_MVCAD_DMG --sha256 SHA256_FROM_SHA256SUMS
```

The helper checks that it is running on macOS, verifies SHA-256 and application architecture, and refuses to overwrite an existing MVCAD.app. Replace the placeholder values with real release values; this repository does not invent live download URLs.

See [release gates](docs/ROADMAP.md) and [third-party notices](docs/THIRD_PARTY.md).

## Repository policy

Public source repository; no project source license has been selected yet. Publication does not grant an additional source license. Local build tools and user research reference imagery are excluded from Git.
