!macro customInstall
  ExecWait '"$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\\resources\\windows-prereq-setup.ps1"' $0
  StrCmp $0 0 prereq_ok
    MessageBox MB_ICONSTOP|MB_OK "Trustinn prerequisite setup is incomplete (code $0). Complete WSL/Docker setup and run the installer again."
    Abort
  prereq_ok:
!macroend
