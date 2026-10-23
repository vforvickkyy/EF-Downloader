; Eastape Downloader installer (NSIS 3).
;
; Build after `wails build` (see scripts/build-windows.sh):
;   makensis -DVERSION=1.0.2 -DAPP_EXE_SRC=..\..\bin\EastapeDownloader.exe \
;            -DWEBVIEW2_BOOTSTRAPPER=path\to\MicrosoftEdgeWebview2Setup.exe eastape.nsi
; Optional: -DSIGN_CMD=path\to\sign.cmd signs the installer and uninstaller.

Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
RequestExecutionLevel admin

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
!define FIREWALL_RULE "Eastape Downloader"
!define APP_REG_KEY   "Software\Eastape Tech\Eastape Downloader"
; Mutex Wails holds while the app runs (its single-instance lock, from the
; SingleInstanceLock UniqueId in main.go).
!define RUNNING_MUTEX "wails-app-eastape-downloader-5f3c9a1esim"

Name "${APP_NAME}"
Caption "${APP_NAME} ${VERSION} Setup"
UninstallCaption "${APP_NAME} Uninstall"
BrandingText "${APP_NAME} ${VERSION} · ${COMPANY}"
OutFile "${OUT_DIR}\EastapeDownloader-Setup-${VERSION}.exe"
InstallDir "$PROGRAMFILES64\${APP_NAME}"
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
!define MUI_WELCOMEPAGE_TEXT "This will install ${APP_NAME} ${VERSION} by ${COMPANY} on your computer.$\r$\n$\r$\nDownload whole public Google Drive folders with the same folder structure, a speed limit you choose, and pause / resume.$\r$\n$\r$\n${SLOGAN}.$\r$\n$\r$\nFor personal, non-commercial use. Click Next to continue."
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
  retry:
    System::Call 'kernel32::OpenMutexW(i 0x00100000, i 0, w "${RUNNING_MUTEX}") i .r0'
    ${If} $0 <> 0
      System::Call 'kernel32::CloseHandle(i r0)'
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${APP_NAME} is running.$\r$\n$\r$\nPlease close it (if it is downloading, stop the download first), then click Retry." /SD IDCANCEL IDRETRY retry
      Abort
    ${EndIf}
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
  ; Upgrading: offer the folder of the existing installation.
  SetRegView 64
  ReadRegStr $0 HKLM "${UNINST_KEY}" "InstallLocation"
  ${If} $0 != ""
    StrCpy $INSTDIR $0
  ${EndIf}
FunctionEnd

; Setup runs as administrator; start the app through Explorer so it runs as
; the signed-in user, like a normal launch.
Function LaunchApp
  Exec '"$WINDIR\explorer.exe" "$INSTDIR\${APP_EXE}"'
FunctionEnd

; ---------------------------------------------------------------- install
Section "${APP_NAME} (required)" SecApp
  SectionIn RO
  SetShellVarContext all
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

  ; Firewall: allow the app explicitly so strict firewall setups never
  ; block or prompt for it. It only makes outgoing connections to Google.
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${FIREWALL_RULE}"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${FIREWALL_RULE}" dir=out action=allow program="$INSTDIR\${APP_EXE}" enable=yes profile=any description="Lets ${APP_NAME} download from Google Drive"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${FIREWALL_RULE}" dir=in action=allow program="$INSTDIR\${APP_EXE}" enable=yes profile=private,domain description="Prevents Windows Firewall prompts for ${APP_NAME}"'

  ; Record the installation and let Eastape Tech know about it (see the
  ; Privacy Policy). Takes at most ~15 seconds; offline is fine, the app
  ; reports it later.
  DetailPrint "Finishing setup..."
  ExecWait '"$INSTDIR\${APP_EXE}" --report-install'

  ; "Apps & features" entry.
  SetRegView 64
  WriteRegStr   HKLM "${UNINST_KEY}" "DisplayName"          "${APP_NAME}"
  WriteRegStr   HKLM "${UNINST_KEY}" "DisplayVersion"       "${VERSION}"
  WriteRegStr   HKLM "${UNINST_KEY}" "Publisher"            "${COMPANY}"
  WriteRegStr   HKLM "${UNINST_KEY}" "Comments"             "${SLOGAN}"
  WriteRegStr   HKLM "${UNINST_KEY}" "DisplayIcon"          "$INSTDIR\${APP_EXE},0"
  WriteRegStr   HKLM "${UNINST_KEY}" "InstallLocation"      "$INSTDIR"
  WriteRegStr   HKLM "${UNINST_KEY}" "UninstallString"      '"$INSTDIR\Uninstall.exe"'
  WriteRegStr   HKLM "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKLM "${UNINST_KEY}" "EstimatedSize" "$0"
SectionEnd

Section "Desktop shortcut" SecDesktop
  SetShellVarContext all
  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0 SW_SHOWNORMAL "" "Download public Google Drive folders"
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecApp}     "The app, a Start menu shortcut, an uninstaller and a Windows Firewall allow rule."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "Put a shortcut to ${APP_NAME} on the desktop."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ---------------------------------------------------------------- uninstall
Section "Uninstall"
  SetShellVarContext all
  Call un.CloseApp

  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\License.txt"
  Delete "$INSTDIR\Uninstall.exe"
  ; Not /r: never delete anything the user put next to the app.
  RMDir "$INSTDIR"

  Delete "$SMPROGRAMS\${APP_NAME}.lnk"
  Delete "$DESKTOP\${APP_NAME}.lnk"

  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${FIREWALL_RULE}"'

  SetRegView 64
  DeleteRegKey HKLM "${UNINST_KEY}"
  DeleteRegKey HKLM "${APP_REG_KEY}"
  DeleteRegKey /ifempty HKLM "Software\Eastape Tech"

  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete your ${APP_NAME} settings?$\r$\n$\r$\nYour downloaded files are never touched." /SD IDNO IDNO keepSettings
    SetShellVarContext current
    RMDir /r "$APPDATA\EastapeDownloader"
    SetShellVarContext all
  keepSettings:
SectionEnd
