!macro customInstall
  ; Match desktop/electron/main.cjs appDataRoot() on Windows.
  SetShellVarContext current
  CreateDirectory "$LOCALAPPDATA\ExoraDock"
  CreateDirectory "$LOCALAPPDATA\ExoraDock\data"
  CreateDirectory "$LOCALAPPDATA\ExoraDock\data\jobs"
  CreateDirectory "$LOCALAPPDATA\ExoraDock\data\jobs\AgenStaff_Project"
!macroend
