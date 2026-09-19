# Local CAD polishing pass

This pass remains local until explicitly approved for publication.

The compact command panel follows the supplied SolidWorks Features/Sketch screenshots: small blue/gray geometric icons, grouped modeling commands, tabs below the command row, a white viewport and a narrow feature tree. A subsequent live SolidWorks inspection successfully opened BifGeom_Olesh.SLDPRT and inspected its loft definition without changing or saving the part; see performance-verification-031.md.

Point editing follows the Placement and Properties organization in [PTC's Curve through Points interface documentation](https://support.ptc.com/help/creo/creo_pma/r13/usascii/part_modeling/part_modeling/About_the_Curve_through_Points_User_Interface.html): an ordered reference list, a selected-point collector and insertion/reordering controls. MVCAD adds direct XYZ editing of its driving datums. Surface-constrained curves and endpoint constraint collectors are outside this pass.

Implemented modeling scope: separate bodies, targeted merge/cut, independent two-direction extrusion, start offset, body visibility/transparency/deletion, selected-edge fillets, feature-parent links, editable datums and regenerating centerline definitions. All document mutations are undoable. Hidden or transparent bodies retain their exact solid geometry.

Safety of edits: body IDs derive from their creating feature. Edge signatures include geometry and adjacent feature lineage, independent of display precision. Stale edge references fail regeneration. Datum edits rebuild the network from references; changed full source curves invalidate branch assignments. Failed geometry retains the previous document.
