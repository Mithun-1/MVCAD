# 0.4.0 release gates

0.4.0 is an unpublished development milestone. The product scope is centerline modeling and automatic swept bodies.

## Product scope

- CSV and manually entered point sets with editable coordinates, ordering and names.
- Curves through ordered centerline points with connection tolerance and branch detection.
- Dependent mirrored centerlines with source and axis regeneration.
- Auto Sweep bodies with editable diameters, junction-end setbacks and supported rounded junction transitions.
- Body hide/show/transparency, native part persistence, undo/redo and transactional failure handling.
- Default display precision of 0.001 and a finest setting of 0.0001.
- Native centerline part compatibility across the current schema.

Classic sketching, extrusion, cuts, revolve, manual sweep, general CAD fillets and related classic modeling features are outside the product scope and are removed from the UI. Legacy classic CAD parts are rejected on open and preserved as files; centerline parts remain supported.

## Geometry and performance

- Preserve exact centerline-guided bodies and supported rounded junctions while handling invalid or unsupported geometry explicitly.
- Keep dependent centerlines, point sets, diameters, setbacks and visibility stable through edits and save/load.
- Use asynchronous, coalesced geometry builds so repeated edits do not queue redundant work.
- Verify build and interaction performance on large point sets and large swept geometries before publishing performance numbers.
- Validate body connectivity, B-rep validity, seam normals and junction behavior across supported geometries.

Performance is under verification. No benchmark timing or maximum geometry size is a release claim until the large-geometry checks are complete.

## Interchange and distribution

- STEP export and surface preparation remain pending.
- Windows CI must produce one x64 installer EXE with runtime dependencies, uninstall support and shortcuts.
- macOS CI must produce an Apple Silicon DragNDrop DMG with resources inside the app bundle. Intel macOS is not verified.
- Release assets must include SHA256SUMS. Stable `vX.Y.Z` tags publish stable releases; development tags publish prereleases.
- Configure and test macOS Developer ID signing and notarization with real credentials before a signed release; this pipeline is not implemented yet. Local development does not require credentials.
- The macOS command-line helper must require an actual DMG URL and SHA-256 value, verify both the archive and architecture, and avoid overwriting an existing installation.

## Verification

- Automated tests cover point editing, centerline connections, mirrors, sweep bodies, supported junction rounding, persistence, viewport behavior and native UI smoke behavior.
- Run `MVCAD --verify-bifurcation <output-directory>` only for the supported junction verification fixture; its local measurements do not establish general performance.
- Complete a real Mac interactive test and clean Windows installer install/uninstall test before a public release.
- Audit redistributed dependency notices and select the project source license before publication.
