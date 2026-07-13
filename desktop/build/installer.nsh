!macro customInstall
  ; Match desktop/electron/main.cjs appDataRoot() on Windows.
  SetShellVarContext current
  CreateDirectory "$LOCALAPPDATA\ExoraDock"
  CreateDirectory "$LOCALAPPDATA\ExoraDock\data"
  CreateDirectory "$LOCALAPPDATA\ExoraDock\data\jobs"
  CreateDirectory "$LOCALAPPDATA\ExoraDock\data\jobs\AgenStaff_Project"
  SetShellVarContext all
  CreateDirectory "$APPDATA\Exora\runtime"
  CopyFiles /SILENT "$INSTDIR\resources\wsl\wsl-runtime.lock.json" "$APPDATA\Exora\runtime\wsl-runtime.lock.json"

  ; Enable only the Windows-owned virtualization features. No Linux distribution is installed.
  nsExec::ExecToLog 'dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart'
  Pop $0
  nsExec::ExecToLog 'dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart'
  Pop $0
  nsExec::ExecToLog 'msiexec.exe /i "$INSTDIR\resources\wsl\wsl.2.7.8.0.x64.msi" /qn /norestart'
  Pop $0
  StrCmp $0 "0" runtime_installed
  StrCmp $0 "3010" runtime_installed
  MessageBox MB_ICONSTOP "The bundled WSL Runtime could not be installed (exit $0)."
  Abort

runtime_installed:
  FileOpen $1 "$APPDATA\Exora\runtime\install-state.json" w
  FileWrite $1 '{"schema":"exora.wsl_install_receipt.v1","state":"reboot_required","runtimeVersion":"2.7.8.0"}'
  FileClose $1
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\RunOnce" "ExoraRuntimeResume" '"$INSTDIR\Exora Dock.exe" --exora-runtime-resume'
  MessageBox MB_YESNO|MB_ICONINFORMATION "Exora installed its offline WSL Runtime. Restart Windows now to finish preparing the provider runtime?" IDNO runtime_done
  Reboot
runtime_done:
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'sc.exe stop ExoraHostService'
  Pop $0
  nsExec::ExecToLog 'sc.exe delete ExoraHostService'
  Pop $0
  ; WSL and Windows virtualization features are intentionally retained because other user distributions may depend on them.
!macroend
