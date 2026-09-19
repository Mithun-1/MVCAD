# Local performance and geometry verification

This 0.3.1 milestone is unpublished. No push or release is authorized.

## Findings and fixes

The previous complete-junction construction inserted a central sphere. It could create the visible swollen region the user reported. That construction was removed. Supported junctions now fuse the centerline-guided arms in one operation and round their intersection edges, validating the connected solid, branch seam normals and symmetry of the actual trimmed surfaces.

Fine fillet tessellation produces hundreds of thousands of triangles even in a small network. Repeated geometry builds, triangle copies, normal calculations and software rasterization amplified that cost. Geometry caches now retain up to two results within a two-million-triangle budget per cache. The viewport reuses mesh normals and unchanged raster images, and temporarily clusters display vertices during camera dragging. Fine geometry returns on release. No modeling feature was removed to achieve the rendering improvement.

## Reference inspection

Inspected `D:/Mithun_Files/CodeTraining_Geoms/BifGeom_Olesh.SLDPRT` in the open SolidWorks application on 2026-09-18. The final document has one surface body. Its history is Loft2, Mirror2, Sweep4, Sweep5, Sweep6, Fillet3, DeleteFace2, preceded by sketches and reference planes.

Loft2 uses profiles Sketch2 and Sketch3 and guide curves Sketch4 and Sketch8. Guide influence is “To Next Guide”; start and end constraints are both “None”; the centerline collector is empty. Merge tangent faces and Merge result are enabled. The displayed construction uses guide curves to shape a transition, mirrors it, adds the vessel sweeps, then rounds and removes faces. Inspection was canceled without applying or saving changes. This is evidence of that part's settings, not a claim that endpoint tangency follows automatically from those settings.

The `BifGeom_Clean` mesh reference contains 78,654 nodes, with a mother diameter near 9 and daughters near 7.5. Its projected outline informed the verification geometry. MVCAD's generated example is not an exact reconstruction of the original loft or its downstream mesh.

## Reproducible verification

Run `MVCAD --verify-bifurcation <output-directory>` with the application runtime available. This creates a mother centerline and an upper daughter from two named point sets, then invokes the actual dependent Mirror Centerline operation to construct the lower daughter. It assigns diameters 9 and 7.5/7.5 with 35% junction setbacks. The native part, clean and centerline screenshots, and JSON results are saved together.

Windows Release measurements at display tolerance 0.001, 1440 × 960 window:

| Check | Result |
| --- | --- |
| Mirrored centerline coordinate error | 0 |
| Maximum tested branch seam normal angle | 1.49e-8 radians |
| Initial exact build and tessellation | 7.57 seconds |
| Cached result retrieval | 5.15 milliseconds |
| Fine vessel mesh | 522,510 triangles |
| Full-detail rotating frame | 52.08 milliseconds |
| Orbit preview frame | 11.48 milliseconds, 88,502 triangles |
| Unchanged redraw | 0.38 milliseconds |

These are local measurements of this example, not guarantees for arbitrary networks. The initial build still blocks the UI. The current complete-junction construction accepts supported coplanar symmetric three-arm configurations; unequal daughters, noncoplanar branches, insufficient setbacks and invalid rounds remain explicit failures. Some older demo junctions now fail rather than claiming completion with a spherical core. Global curvature continuity and simulation mesh quality require further work.

All eight Windows Release CTest suites passed (73.47 seconds total), including 34 kernel checks and the UI workflow. A separate installed-runtime smoke run passed with development Qt/OCCT paths removed. The packaged UI check also covers the final screenshot-tab correction. The verification command passed again after the viewport fixes. This local run does not validate macOS; the existing two-platform CI is retained and real-Mac testing remains required.

## Editing additions

Multi-file CSV import creates named point sets. New Point Set supports manual entry. Point sets, individual points and curves have persistent visibility controls alongside existing body controls. Mirrored centerlines retain source/axis dependencies and update with their driving geometry; the current axis is a straight two-point line in XY, with Z preserved by reflection.

Sketch right-click menus offer drawing and Smart Dimension commands. Picking a circle selects diameter; picking a rectangle edge selects width/height; picking a polyline edge selects horizontal, vertical or aligned length. Numeric editing drives the profile and supports cancel/undo. This is not yet a general geometric constraint solver. Full profile coordinate editing remains under Profile Values.
