# Third-party components

MVCAD development builds dynamically link Qt 6 (Core, Gui, Widgets; Test only for tests). Qt is distributed under its applicable commercial or open-source license terms. Packages include the Qt license texts in `third_party/qt/`, copied from Qt's 6.8.3 source tree. Qt remains dynamically linked; compatible replacement libraries can be used with the application. Qt source archives for this version are linked below.

- Qt documentation and licensing: https://www.qt.io/licensing/open-source-lgpl-obligations
- Qt sources: https://download.qt.io/archive/qt/6.8/6.8.3/
- Qt 6 Windows/MSVC configuration: https://doc.qt.io/qt-6/windows.html
- CMake and Ninja are build tools, not embedded application components.
- Microsoft Visual C++ runtime components, where deployed, retain Microsoft's redistribution terms.

There is no CAD kernel or sketch solver dependency yet. Open CASCADE's sweep API is being evaluated: https://occt3d.com/dev/doc/refman/html/class_b_rep_offset_a_p_i___make_pipe_shell.html

Before a stable release, confirm the source license choice and complete the binary redistribution notice/source-availability audit. Do not mistake the existing design imagery for dependency licensing evidence.
