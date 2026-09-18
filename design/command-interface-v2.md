# MVCAD compact command interface — revision 2

## Visual target

- [Features state](mvcad-features-v2.png)
- [Sketch state](mvcad-sketch-v2.png)

These are two states of the same preferred white desktop application. The supplied SolidWorks screenshots establish compact command grouping, small tabs below the toolbar, and familiar feature/sketch organization. They do not implicitly add every pictured SolidWorks capability. The written user requirements control scope.

Preserve MVCAD branding, a chronological feature tree with rollback, and the specialized Centerlines / Auto Sweep workflows. Use light controls, fine separators and small icons. The Features viewport remains dark with crimson vessels; a pale sketch canvas improves contrast for dimensions and constraint markers.

At the intended 1440 × 1024 logical layout, target a 30px quick-access/title area, approximately 75px command area, 22px tabs, a resizable 230px initial left dock and 20px tree rows. These are implementation density targets; Image Gen illustrations are not pixel-exact. Scale with operating-system DPI and retain usable hit targets. On smaller windows use command-group overflow rather than clipping labels. Property editing uses the left dock without adding an always-visible right panel.

## Features commands

| Group | Commands | Intended behavior |
| --- | --- | --- |
| Additive | Extruded Boss/Base; Revolved Boss/Base; Swept Boss/Base; Swept Blend | Create material from a sketch/profile; revolve around a chosen axis; sweep along a centerline; blend section profiles along a centerline. |
| Subtractive | Extruded Cut; Revolved Cut; Swept Cut; Swept Blend Cut | Remove material using the corresponding operation and a selected target body. |
| Finish/surface | Round / Fillet; Remove Face | Round selected edges/junctions with an editable radius and preview; remove selected faces to obtain a surface shell while retaining the solid version. |
| Body transforms | Mirror Bodies; Linear Pattern; Circular Pattern | Mirror selected bodies about a plane; repeat bodies with count and spacing or count and angular distribution. |
| References | Reference Geometry flyout | Create reference planes, axes, points and coordinate systems, including a plane normal to a selected centerline at a chosen location. |

Swept Blend replaces the proposed loft command. Both additive and subtractive sweep/blend workflows retain centerline-first selection and the offer to create a normal sketch plane.

Body mirror and body patterns are part-level operations; they do not introduce assemblies. Keep body selection and the mirror plane/pattern direction or axis explicit. Bodies and construction references appear in feature history. Pattern/mirror preview and parameters remain editable after creation.

Rounding supports ordinary selected model edges as well as bifurcation/merger regions. Reject invalid rounding without replacing the last valid geometry. A radius shown in a mockup is illustrative, not a guaranteed kernel capability or a product default.

## Sketch commands

The following is the baseline interpretation of “basic sketch tools,” not a claim of complete SolidWorks feature parity.

| Group | Commands/capabilities |
| --- | --- |
| Sketch lifecycle | New Sketch on a chosen planar face/reference plane; edit existing sketch; Exit Sketch; normal-to-plane view. |
| Dimensions | Smart Dimension: horizontal/vertical/aligned distance, angle, radius and diameter; editable values without unit suffixes; driven/reference dimensions distinguished from driving dimensions. |
| Basic entities | Line/polyline, construction centerline, rectangle, circle, arc, ellipse, spline, polygon, slot and point; variants in flyouts. |
| Edit entities | Trim, Extend, Convert Entities, Offset Entities, Move/Copy, Rotate, Scale, Sketch Fillet and Sketch Chamfer. |
| Mirror and repeat | Mirror Entities about a selected line/centerline; copy option and retained symmetry relation; Linear Sketch Pattern and Circular Sketch Pattern. |
| Relations | Add/display/delete relations; coincident, horizontal, vertical, parallel, perpendicular, tangent, concentric, equal, midpoint, symmetry and fixed. |
| Construction/status | Toggle construction geometry; snaps to relevant entities; indicate under-defined, fully defined and conflicting/over-defined sketches. |

Sketch mirroring must create editable sketch entities, with retained symmetry when requested; it is separate from body mirroring. Sketch patterns likewise operate on sketch entities, while Features patterns operate on bodies.

The sketch mockup demonstrates dimensions and mirror selection using a symmetric profile and reference circle. The generated curve shapes, dimension leaders and radius/angle annotations are illustrative; they are not numerically verified solver output. The “4 selected” mock value is illustrative.

## Preserved vascular workflow

Point import → fitted splines → reviewed connections → branch splitting → branch diameter assignment → constant-diameter branch solids → provisional/complete junction blends → optional rounding → solid or surface preparation and export.

Junction setbacks default to 10% independently per branch end and remain editable. Free inlet/outlet endpoints extend fully. Unassigned branches remain centerlines. A partially assigned junction stays provisional until all incident diameters are known; show failures explicitly.

Native part saving remains separate from STEP export of solid geometry, surface geometry, or centerlines. All numeric geometry is dimensionless with no automatic export scaling. This remains a standalone C++ / Qt 6 Widgets / CMake application for Windows and macOS, with the kernel and sketch solver still to be evaluated.

## Verification and next implementation boundary

Both generated PNGs are 1487 × 1058 and passed image-file integrity checks. Visual inspection confirmed all eight requested additive/subtractive toolbar labels, Round / Fillet, Remove Face, Mirror Bodies, both body patterns, Reference Geometry, compact tab placement, and a chronological history. The Sketch state visibly includes New/Exit Sketch, Smart Dimension, entity tools, Mirror Entities, both sketch patterns, editing/relation commands and mirror parameters.

Not every flyout item is expanded in the screenshots. The tables above are the source of truth for required capabilities. These mockups do not implement commands, a constraint solver, history regeneration, solid/surface operations or file export. Those remain the application development milestone after visual design.
