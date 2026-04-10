!macro customInstall
  ExecWait '"$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe" -ExecutionPolicy Bypass -File "$INSTDIR\\resources\\windows-prereq-setup.ps1"'
!macroend
