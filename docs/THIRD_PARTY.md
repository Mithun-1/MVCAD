# Third-party components

MVCAD dynamically links Qt 6.8.3 (Core, Gui, Widgets; Test only for tests) and Open CASCADE Technology 7.9.3. Packages include their license texts under `third_party/`. Compatible replacement shared libraries can be used with the application.

## Qt

- License texts: `third_party/qt/`, copied from the Qt 6.8.3 source tree.
- Sources: https://download.qt.io/archive/qt/6.8/6.8.3/
- Licensing: https://www.qt.io/licensing/open-source-lgpl-obligations

## Open CASCADE Technology

OCCT is used under LGPL 2.1 with the Open CASCADE exception. The full license and exception are included in `third_party/occt/`.

- Upstream source: https://github.com/Open-Cascade-SAS/OCCT/tree/V7_9_3
- Exact source commit: `a016080bf6738d6aeae020badee4e888ad1540a5`
- Source archive: https://github.com/Open-Cascade-SAS/OCCT/archive/refs/tags/V7_9_3.tar.gz
- Reproducible minimal shared build: `scripts/bootstrap-occt.py`; no local OCCT source modifications.
- Included modules: FoundationClasses, ModelingData and ModelingAlgorithms. Visualization and STEP/data-exchange modules are not yet included.

CMake and Ninja are build tools, not embedded application components. Microsoft Visual C++ runtime components retain Microsoft's redistribution terms. Before a stable release, confirm the MVCAD source license choice and complete the redistribution/source-availability audit.
