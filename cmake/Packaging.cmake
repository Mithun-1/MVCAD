# CPack configuration for distributable desktop packages.
# Include this file after the install() rules in the root project.

set(CPACK_PACKAGE_NAME "MVCAD")
set(CPACK_PACKAGE_VENDOR "MVCAD")
set(CPACK_PACKAGE_VERSION "${PROJECT_VERSION}")
set(CPACK_PACKAGE_DESCRIPTION_SUMMARY "MVCAD centerline and autosweep modeller")
set(CPACK_PACKAGE_INSTALL_DIRECTORY "MVCAD")
set(CPACK_VERBATIM_VARIABLES YES)
set(CPACK_PACKAGE_RELOCATABLE TRUE)

if(WIN32)
  set(CPACK_GENERATOR "NSIS")
  set(CPACK_PACKAGE_FILE_NAME "MVCAD-${PROJECT_VERSION}-Windows-x64-Setup")
  set(CPACK_NSIS_DISPLAY_NAME "MVCAD")
  set(CPACK_NSIS_PACKAGE_NAME "MVCAD")
  set(CPACK_NSIS_INSTALL_ROOT "$PROGRAMFILES64")
  set(CPACK_NSIS_EXECUTABLES_DIRECTORY "bin")
  set(CPACK_PACKAGE_EXECUTABLES "MVCAD;MVCAD")
  set(CPACK_CREATE_DESKTOP_LINKS "MVCAD")
  set(CPACK_NSIS_ENABLE_UNINSTALL_BEFORE_INSTALL ON)
  set(CPACK_NSIS_MODIFY_PATH OFF)
  # Do not present CPack's own license as the project license. Notices ship in the app.
  set(CPACK_NSIS_IGNORE_LICENSE_PAGE ON)

  # Qt deploys this installer with MSVC builds. An explicit path can override it.
  set(MVCAD_VC_REDIST "" CACHE FILEPATH "Optional vc_redist.x64.exe override")
  if(MVCAD_VC_REDIST)
    if(NOT EXISTS "${MVCAD_VC_REDIST}")
      message(FATAL_ERROR "MVCAD_VC_REDIST does not exist: ${MVCAD_VC_REDIST}")
    endif()
    install(FILES "${MVCAD_VC_REDIST}" DESTINATION bin RENAME vc_redist.x64.exe)
  endif()
  # Bracket quoting preserves NSIS dollar variables and real newlines.
  set(CPACK_NSIS_EXTRA_INSTALL_COMMANDS [=[
    IfFileExists "$INSTDIR\bin\vc_redist.x64.exe" mvcad_vc_install
      MessageBox MB_ICONSTOP "The bundled Microsoft runtime installer is missing." /SD IDOK
      SetErrorLevel 2
      Abort
    mvcad_vc_install:
      ExecWait '"$INSTDIR\bin\vc_redist.x64.exe" /install /quiet /norestart' $0
      StrCmp $0 "0" mvcad_vc_done
      StrCmp $0 "3010" mvcad_vc_reboot
      StrCmp $0 "1638" mvcad_vc_done
      MessageBox MB_ICONSTOP "Microsoft Visual C++ runtime installation failed (code $0)." /SD IDOK
      SetErrorLevel $0
      Abort
    mvcad_vc_reboot:
      SetRebootFlag true
    mvcad_vc_done:
  ]=])
elseif(APPLE)
  set(CPACK_GENERATOR "DragNDrop")
  set(CPACK_PACKAGE_FILE_NAME "MVCAD-${PROJECT_VERSION}-macOS-${CMAKE_SYSTEM_PROCESSOR}")
  set(CPACK_DMG_VOLUME_NAME "MVCAD ${PROJECT_VERSION}")
  set(CPACK_DMG_FORMAT "UDZO")
  set(CPACK_DMG_DISABLE_APPLICATIONS_SYMLINK OFF)
  # Signing/notarization is a separate release gate; Bundle-generator signing
  # variables do not sign a DragNDrop package.

else()
  set(CPACK_GENERATOR "TGZ")
  set(CPACK_PACKAGE_FILE_NAME "MVCAD-${PROJECT_VERSION}-${CMAKE_SYSTEM_NAME}-${CMAKE_SYSTEM_PROCESSOR}")
endif()

include(CPack)
