# MVCAD 0.4.0 local verification

Verified on this Windows/MSVC 2022 workstation on 2026-09-19, Release, Qt 6.8.3, OCCT 7.9.3. These are controlled fixture measurements, not a guarantee for arbitrary vascular networks. Measurements were recorded locally before committing and pushing the implementation; this report does not establish release readiness.

## Product and performance changes

- Three command tabs: Points, Centerlines and Auto Sweep. Classic sketch, extrusion, cut, manual sweep and general modeling commands are removed from the UI. Legacy CAD parsing remains for explicit compatibility rejection rather than silently dropping features.
- Exact spline connection discovery uses cached interpolants, conservative B-spline pole bounds, deterministic endpoint insertion and one graph build. Arbitrary crossings do not connect.
- Geometry construction runs on one background worker. Queued edits coalesce; stale results cannot replace the current model.
- Unchanged branch and junction artifacts are reused. Straight two-point branches use exact cylinders. The cache is bounded by entry counts and conservative mesh accounting; this is not a strict byte limit.
- Point-tree entries populate on expansion; visibility uses indexed source ownership; icons are reused. Body hide/show/transparency has lightweight undo and never rebuilds the kernel.
- Default display tolerance remains 0.001, finest 0.0001. Interactive drawing uses a reduced preview mesh and restores full detail afterward. Exact geometry is retained.

## Measurements

| Workload | Result |
| --- | --- |
| 1,000 independent straight vessels, baseline cold build | 18,831.7 ms |
| Same baseline, one diameter edit | 18,841.8 ms |
| Optimized kernel, final CAD test cold build | 2,581.5 ms |
| Optimized kernel, one diameter / point edit | 54.7 / 56.7 ms |
| 1,000-curve batch topology, final CAD test | 16.4 ms |
| 50,000 points + 1,000 vessels, topology | 49.5 ms |
| Same full UI fixture, cold kernel / UI ready | 2839.2 / 2901.8 ms |
| Same fixture, diameter edit kernel / UI ready | 54.9 / 160.9 ms |
| Same fixture, hide + show state updates (excluding paint) | 0.52 ms |
| Two connected validated Y junctions, cold / edit both daughters at one end | 2,844.0 / 1,926.1 ms |
| Reference-inspired curved mirrored bifurcation, cold / cached | 5145.3 / 3.78 ms |

Large UI rendering: Full detail: 24.56 ms/frame; orbit preview: 2.16 ms/frame (10400 triangles); unchanged redraw: 0.26 ms/frame; vessel fine triangles: 396088.
The UI processed 285 timer heartbeats during the background build, with a maximum measured gap of 19.7 ms. Only 2008 tree items were populated for 50,000 points and 1,000 curves.

The curved reference fixture uses mother diameter 9 and mirrored daughter diameters 7.5. Centerline symmetry error is zero; one junction is Built, none provisional/failed. Maximum checked seam angle is 1.49e-08 radians. It is inspired by the supplied reference, not an exact reconstruction.

## Checks and artifacts

- All 8 CTest suites passed; the CAD suite reports 39 cases including setup/cleanup. Coverage includes geometry validity, guided/tangent transitions, mirrors, connection detection, incremental edits, stale build rejection, persistence, visibility and native UI behavior.
- The macOS helper passed mocked checksum, architecture, installation and existing-app preservation tests under Git Bash. This does not replace a Mac test.
- The Windows staged app passes `scripts/verify-deployment.py` with development runtime paths removed, exercising the native Windows Qt plugin.
- Windows NSIS packaging produces a single Setup.exe including the Microsoft runtime installer, shortcuts and uninstaller. Local package signing is not configured.
- GitHub release packaging is configured for one Windows EXE, an Apple Silicon macOS DMG with Applications shortcut, a terminal helper and SHA256SUMS. Windows installer install/uninstall checks and Mac helper/deployment checks are added to CI.

Reproduce locally after building:

```text
MVCAD --benchmark-network build/verification-040
MVCAD --verify-bifurcation build/verification-040
bash tests/MacosInstallerTests.sh
```

Reports, native verification part and actual app screenshots are in `build/verification-040/`. The local installer and checksum are in `build/packages/`.

## Remaining release gates

Real-Mac interactive testing, actual macOS DMG generation, Mac signing/notarization, clean Windows installer install/uninstall testing, and public release publication have not been performed in this local run. Consult the GitHub Actions run for subsequent CI results. Intel macOS is unverified. STEP export and surface preparation remain pending. Very complex/unsupported junctions still fail explicitly; large connected networks with many rounded junctions are more expensive than the independent-body fixture.
