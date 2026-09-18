# MVCAD

A standalone C++ / Qt 6 Widgets desktop application for building microvascular network geometry. Windows (MSVC 2022) and macOS are the initial targets. The interface follows a compact, white CAD workbench with Features, Sketch, Centerlines and Auto Sweep tabs.

**Status: 0.1.0 development preview, working toward v1.0.** This is not yet a simulation-ready CAD modeler. Unsupported modeling commands are visibly disabled; sweep previews are display meshes, not validated solids. No v1.0 release is claimed.

## Available now

- CSV point import with explicit curve identity and shared-point connection tolerance.
- Network graph construction and splitting at junctions; disconnected components and closed loops are supported.
- Interpolated centerline preview; branch selection in the tree or viewport.
- Positive branch diameters and independently editable junction-end setbacks (10% default); free ends extend fully.
- Shaded, rotatable branch sweep previews; fit, orbit, pan and zoom.
- Clean geometry view by default. Optional labels/centerlines, with selection highlighting while editing.
- Versioned, dimensionless `.mvcad` part files with atomic saves and full source-point precision.
- Undo/redo for imports and diameter edits; save prompts protect unsaved work.
- Automated core tests and an offscreen native UI smoke test.

## Build

Requires CMake 3.24+, Ninja, Qt 6.8+ Core/Gui/Widgets/Test, and a C++20 compiler. Development is pinned to Qt 6.8.3.

On Windows with Visual Studio 2022 C++ Build Tools installed:

```powershell
# If Qt is installed elsewhere, set CMAKE_PREFIX_PATH and add its bin to PATH.
./scripts/build-windows.ps1 -Preset release -Launch
```

On macOS with Xcode command-line tools and Qt available:

```sh
export CMAKE_PREFIX_PATH=/path/to/Qt/6.8.3/macos
export PATH="$CMAKE_PREFIX_PATH/bin:$PATH"
cmake --preset release
cmake --build --preset release --parallel
ctest --preset release
open build/release/MVCAD.app
```

Use **File → Open Example** to explore a bifurcation, or import `examples/bifurcation.csv`. Click a branch and apply its diameter. Left-drag orbits; right/middle-drag pans; the wheel zooms; F fits the model; Escape clears selection.

## Development packages

GitHub Actions produces a Windows x64 installer and portable ZIP, and a macOS Apple Silicon disk image. Downloadable prereleases are published under [GitHub Releases](https://github.com/Mithun-1/MVCAD/releases). These are development builds, not v1.0.

The Windows installer installs the required Microsoft Visual C++ runtime. For the portable ZIP, extract the complete archive, install `bin/vc_redist.x64.exe` if the runtime is missing, then run `bin/MVCAD.exe`. Keep the adjacent libraries and plugins with the executable. For macOS, open the disk image and copy MVCAD.app to Applications. Packages are unsigned; signing and real-Mac interactive validation are tracked in the release roadmap.

## Input format

```csv
curve_id,x,y,z
mother,-10,0,0
mother,0,0,0
daughter,0,0,0
daughter,10,8,0
```

Rows are ordered within each curve. Every connection must be represented by a shared sampled point in all incident curves. This first import adapter does not infer endpoint-to-segment connections or join arbitrary spline crossings. Include an explicit shared sample at such junctions. Connections are reviewed through branch/component counts; the importer rejects degenerate or duplicate sampled edges.

Tolerances are dimensionless. Nearby sampled points are clustered deterministically to the first point within tolerance; source points are retained unchanged in the part file. Changing input order can change branch IDs. Reimport replaces the current network and clears diameter assignments; Undo restores the previous network. Limits: 16 MB CSV, 50,000 points, 32 MB native part. Large-network interaction performance remains a release gate.

## v1.0 scope

See [the release roadmap](docs/ROADMAP.md) and [the interface specification](design/command-interface-v2.md). The next major gate is evaluating a CAD kernel for joined bifurcations/mergers, round/fillet operations and STEP round-trip integrity. Open CASCADE remains a candidate, not a finalized dependency. General solid modeling, constrained sketches, mirrors/patterns, reference geometry and face removal are not implemented yet.

CI builds and tests Windows and macOS and produces development packages. A real Mac interactive test is still required before v1.0. Packages are unsigned development builds. See [third-party notices](docs/THIRD_PARTY.md).

## Repository policy

Public source repository; no project source license has been selected yet. Publication does not grant an additional source license. Build tools, local research reference frames and draft imagery are excluded from Git. Generated visual targets are in `design/`.
