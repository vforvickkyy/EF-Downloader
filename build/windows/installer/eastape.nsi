; Eastape Downloader installer (NSIS 3).
;
; Build after `wails build` (see scripts/build-windows.sh):
;   makensis -DVERSION=1.0.2 -DAPP_EXE_SRC=..\..\bin\EastapeDownloader.exe \
;            -DWEBVIEW2_BOOTSTRAPPER=path\to\MicrosoftEdgeWebview2Setup.exe eastape.nsi
; Optional: -DSIGN_CMD=path\to\sign.cmd signs the installer and uninstaller.
;
; Installs for the current user, without administrator rights, so the app can
; update itself: it runs a new Setup with /S /UPDATE, which waits for the app
; to close, installs silently and opens the app again.
; Version 1.1 was installed for all users; Setup moves such an installation
; to the current user (keeping its install ID and settings).

Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!ifndef VERSION
  !define VERSION "1.0.0"
!endif
!ifndef APP_EXE_SRC
  !error "Pass -DAPP_EXE_SRC=<path to EastapeDownloader.exe>"
!endif
!ifndef OUT_DIR
  !define OUT_DIR "..\..\bin"
!endif
!ifndef LICENSE_FILE
  !define LICENSE_FILE "license.txt"
!endif

!define APP_NAME      "Eastape Downloader"
!define APP_EXE       "EastapeDownloader.exe"
!define COMPANY       "Eastape Tech"
!define SLOGAN        "Made by Creators, for Creators"
!define UNINST_KEY    "Software\Microsoft\Windows\CurrentVersion\Uninstall\EastapeDownloader"
!define APP_REG_KEY   "Software\Eastape Tech\Eastape Downloader"
; Mutex Wails holds while the app runs (its single-instance lock, from the
; SingleInstanceLock UniqueId in main.go).
!define RUNNING_MUTEX "wails-app-eastape-downloader-5f3c9a1esim"

Name "${APP_NAME}"
Caption "${APP_NAME} ${VERSION} Setup"
UninstallCaption "${APP_NAME} Uninstall"
BrandingText "${APP_NAME} ${VERSION}"
OutFile "${OUT_DIR}\EastapeDownloader-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\${APP_NAME}"
ShowInstDetails hide
ShowUninstDetails hide

VIProductVersion "${VERSION}.0"
VIFileVersion    "${VERSION}.0"
VIAddVersionKey "ProductName"     "${APP_NAME}"
VIAddVersionKey "CompanyName"     "${COMPANY}"
VIAddVersionKey "FileDescription" "${APP_NAME} Setup"
VIAddVersionKey "FileVersion"     "${VERSION}"
VIAddVersionKey "ProductVersion"  "${VERSION}"
VIAddVersionKey "LegalCopyright"  "© 2026 ${COMPANY}. All rights reserved."
VIAddVersionKey "Comments"        "${SLOGAN}"

!ifdef SIGN_CMD
  !finalize '"${SIGN_CMD}" "%1"'
  !uninstfinalize '"${SIGN_CMD}" "%1"'
!endif

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "WinVer.nsh"
!include "FileFunc.nsh"

Var IsUpdate   ; 1 when started by the app's updater (/UPDATE)
Var OldDir     ; folder of a version 1.1 installation for all users

; ---------------------------------------------------------------- look
!define MUI_ICON   "..\icon.ico"
!define MUI_UNICON "..\icon.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP   "assets\sidebar.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "assets\sidebar.bmp"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP   "assets\header.bmp"
!define MUI_HEADERIMAGE_UNBITMAP "assets\header.bmp"
!define MUI_ABORTWARNING
!define MUI_UNABORTWARNING
!define MUI_COMPONENTSPAGE_SMALLDESC

; ---------------------------------------------------------------- pages
!define MUI_WELCOMEPAGE_TITLE "Welcome to ${APP_NAME} ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "This will install ${APP_NAME} ${VERSION} on your computer.$\r$\n$\r$\nDownload whole public Google Drive folders with the same folder structure, a speed limit you choose, and pause / resume.$\r$\n$\r$\n${SLOGAN}.$\r$\n$\r$\nFor personal, non-commercial use. Click Next to continue."
!insertmacro MUI_PAGE_WELCOME

!define MUI_LICENSEPAGE_RADIOBUTTONS
!define MUI_PAGE_HEADER_TEXT "Terms and Conditions"
!define MUI_PAGE_HEADER_SUBTEXT "Please read the Terms and Conditions, Privacy Policy and Disclaimer."
!insertmacro MUI_PAGE_LICENSE "${LICENSE_FILE}"

!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_TITLE "${APP_NAME} is installed"
!define MUI_FINISHPAGE_TEXT "${APP_NAME} ${VERSION} is ready. You'll find it in the Start menu.$\r$\n$\r$\n${SLOGAN}.$\r$\n$\r$\nClick Finish to close Setup."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${APP_NAME}"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchApp
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "English"

; ---------------------------------------------------------------- helpers
!macro DEFINE_CLOSE_APP UN
Function ${UN}CloseApp
  ; The updater closes the app right after starting Setup: give it up to
  ; 30 seconds.
  StrCpy $1 0
  wait:
    System::Call 'kernel32::OpenMutexW(i 0x00100000, i 0, w "${RUNNING_MUTEX}") i .r0'
    ${If} $0 = 0
      Return
    ${EndIf}
    System::Call 'kernel32::CloseHandle(i r0)'
    ${If} $IsUpdate == 1
    ${AndIf} $1 < 60
      IntOp $1 $1 + 1
      Sleep 500
      Goto wait
    ${EndIf}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${APP_NAME} is running.$\r$\n$\r$\nPlease close it (if it is downloading, stop the download first), then click Retry." /SD IDCANCEL IDRETRY wait
    Abort
FunctionEnd
!macroend
!insertmacro DEFINE_CLOSE_APP ""
!insertmacro DEFINE_CLOSE_APP "un."

Function .onInit
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "${APP_NAME} needs Windows 10 or Windows 11." /SD IDOK
    Abort
  ${EndIf}
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "${APP_NAME} needs 64-bit Windows." /SD IDOK
    Abort
  ${EndIf}
  StrCpy $IsUpdate 0
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/UPDATE" $1
  ${IfNot} ${Errors}
    StrCpy $IsUpdate 1
  ${EndIf}

  ; Upgrading: keep the folder of the existing installation.
  ReadRegStr $0 HKCU "${UNINST_KEY}" "InstallLocation"
  ${If} $0 != ""
    StrCpy $INSTDIR $0
  ${EndIf}

  ; A version 1.1 installation for all users is moved to this user.
  SetRegView 64
  ReadRegStr $OldDir HKLM "${UNINST_KEY}" "InstallLocation"
  SetRegView default
FunctionEnd

Function LaunchApp
  Exec '"$INSTDIR\${APP_EXE}"'
FunctionEnd

; After an in-app update, open the app again.
Function .onInstSuccess
  ${If} $IsUpdate == 1
    Call LaunchApp
  ${EndIf}
FunctionEnd

; Removes the version 1.1 installation (for all users). Its uninstaller needs
; administrator rights, so Windows asks once. Settings and the install ID are
; kept. Skipped during silent updates.
Function RemoveOldInstall
  ${If} $OldDir == ""
  ${OrIf} $IsUpdate == 1
  ${OrIfNot} ${FileExists} "$OldDir\Uninstall.exe"
    Return
  ${EndIf}
  DetailPrint "Removing the previous version (installed for all users)..."
  MessageBox MB_OK|MB_ICONINFORMATION "Setup will now remove the previous version of ${APP_NAME}, which was installed for all users of this PC.$\r$\n$\r$\nWindows will ask for permission. Your settings and downloads are kept." /SD IDOK
  ExecShellWait "runas" "$OldDir\Uninstall.exe" "/S"
  ; The uninstaller continues from a temporary copy: wait until it's done.
  SetRegView 64
  StrCpy $1 0
  ${Do}
    ReadRegStr $0 HKLM "${UNINST_KEY}" "DisplayName"
    ${If} $0 == ""
    ${OrIf} $1 >= 120
      ${Break}
    ${EndIf}
    IntOp $1 $1 + 1
    Sleep 500
  ${Loop}
  SetRegView default
  ${If} $0 != ""
    MessageBox MB_OK|MB_ICONEXCLAMATION "The previous version couldn't be removed. You can remove it later in Windows Settings > Apps > Installed apps: it is the ${APP_NAME} entry with version 1.1." /SD IDOK
  ${EndIf}
FunctionEnd

; ---------------------------------------------------------------- install
Section "${APP_NAME} (required)" SecApp
  SectionIn RO
  SetShellVarContext current
  Call CloseApp

  ; The window is drawn by Microsoft Edge WebView2. Windows 11 and updated
  ; Windows 10 include it; install it if it is missing.
  SetRegView 64
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} $0 == ""
    ReadRegStr $0 HKCU "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}
  ${If} $0 == ""
  ${OrIf} $0 == "0.0.0.0"
    !ifdef WEBVIEW2_BOOTSTRAPPER
      DetailPrint "Installing Microsoft Edge WebView2 Runtime..."
      InitPluginsDir
      File "/oname=$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe" "${WEBVIEW2_BOOTSTRAPPER}"
      ExecWait '"$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe" /silent /install' $1
      DetailPrint "Microsoft Edge WebView2 Runtime installed"
    !else
      DetailPrint "WebView2 Runtime not found; the app will offer to install it on first start."
    !endif
  ${EndIf}

  SetOutPath "$INSTDIR"
  File "/oname=${APP_EXE}" "${APP_EXE_SRC}"
  File "/oname=License.txt" "${LICENSE_FILE}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateShortcut "$SMPROGRAMS\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0 SW_SHOWNORMAL "" "Download public Google Drive folders"

  ; Record the installation and let Eastape Tech know about it (see the
  ; Privacy Policy). Takes at most ~15 seconds; offline is fine, the app
  ; reports it later. This also carries over the install ID of a version
  ; 1.1 installation, so it must run before that one is removed.
  DetailPrint "Finishing setup..."
  ExecWait '"$INSTDIR\${APP_EXE}" --report-install'

  ; "Installed apps" entry.
  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayName"          "${APP_NAME}"
  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayVersion"       "${VERSION}"
  WriteRegStr   HKCU "${UNINST_KEY}" "Publisher"            "${COMPANY}"
  WriteRegStr   HKCU "${UNINST_KEY}" "Comments"             "${SLOGAN}"
  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayIcon"          "$INSTDIR\${APP_EXE},0"
  WriteRegStr   HKCU "${UNINST_KEY}" "InstallLocation"      "$INSTDIR"
  WriteRegStr   HKCU "${UNINST_KEY}" "UninstallString"      '"$INSTDIR\Uninstall.exe"'
  WriteRegStr   HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" "$0"

  Call RemoveOldInstall
SectionEnd

Section "Desktop shortcut" SecDesktop
  SetShellVarContext current
  ; A silent update keeps the user's choice: no shortcut if they removed it.
  ${If} $IsUpdate == 1
  ${AndIfNot} ${FileExists} "$DESKTOP\${APP_NAME}.lnk"
    Return
  ${EndIf}
  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0 SW_SHOWNORMAL "" "Download public Google Drive folders"
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecApp}     "The app, a Start menu shortcut and an uninstaller. Installed for your Windows account only; no administrator rights needed."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "Put a shortcut to ${APP_NAME} on the desktop."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ---------------------------------------------------------------- uninstall
Section "Uninstall"
  SetShellVarContext current
  Call un.CloseApp

  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\License.txt"
  Delete "$INSTDIR\Uninstall.exe"
  ; Not /r: never delete anything the user put next to the app.
  RMDir "$INSTDIR"

  Delete "$SMPROGRAMS\${APP_NAME}.lnk"
  Delete "$DESKTOP\${APP_NAME}.lnk"

  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "${APP_REG_KEY}"
  DeleteRegKey /ifempty HKCU "Software\Eastape Tech"

  ; Downloaded updates
  RMDir /r "$LOCALAPPDATA\EastapeDownloader\updates"
  RMDir "$LOCALAPPDATA\EastapeDownloader"

  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete your ${APP_NAME} settings?$\r$\n$\r$\nYour downloaded files are never touched." /SD IDNO IDNO keepSettings
    RMDir /r "$APPDATA\EastapeDownloader"
  keepSettings:
SectionEnd

Function un.onInit
  StrCpy $IsUpdate 0
FunctionEnd
