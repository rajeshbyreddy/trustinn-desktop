; NSIS Script for TrustINN Desktop Windows Installer
; Handles Docker verification, image pulling, and setup

!include "MUI2.nsh"
!include "FileFunc.nsh"

; Variables
Var DockerPath
Var ResultsPath
Var DownloadPath

; Check if Docker is installed
Function CheckDocker
  ; Check if docker.exe exists in common installation paths
  ${If} ${FileExists} "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
    StrCpy $DockerPath "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
    Return
  ${ElseIf} ${FileExists} "C:\Program Files (x86)\Docker\Docker\resources\bin\docker.exe"
    StrCpy $DockerPath "C:\Program Files (x86)\Docker\Docker\resources\bin\docker.exe"
    Return
  ${EndIf}
  
  ; If not found, show error
  MessageBox MB_YESNO "Docker is not installed. Would you like to download Docker Desktop?" IDYES DownloadDocker IDNO AbortDocker
  
  DownloadDocker:
    ExecShell "open" "https://www.docker.com/products/docker-desktop"
    Abort
    
  AbortDocker:
    MessageBox MB_OK "Docker Desktop is required to run TrustINN. Please install Docker Desktop and try again."
    Abort
FunctionEnd

; Check if Docker is running
Function CheckDockerRunning
  nsExec::Exec '"$DockerPath" ps'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_YESNO "Docker is not running. Would you like to start Docker Desktop?" IDYES StartDocker IDNO AbortApp
    StartDocker:
      ExecShell "open" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
      Sleep 5000
      Return
    AbortApp:
      MessageBox MB_OK "Docker must be running to complete the setup."
      Abort
  ${EndIf}
FunctionEnd

; Pull Docker image with progress
Function PullDockerImage
  ; Create temporary batch file to pull image and capture output
  FileOpen $0 "$TEMP\pull-image.bat" w
  FileWrite $0 "@echo off$\r$\n"
  FileWrite $0 "title Pulling TrustINN Docker Image...$\r$\n"
  FileWrite $0 "$\"$DockerPath$\" pull rajeshbyreddy95/trustinn-tools:4.1.2$\r$\n"
  FileWrite $0 "if errorlevel 1 ($\r$\n"
  FileWrite $0 "  start cmd.exe /k echo Docker pull failed! Check your internet connection and try again from the app settings."
  FileWrite $0 ") else ($\r$\n"
  FileWrite $0 "  echo Docker image pulled successfully!$\r$\n"
  FileWrite $0 "  timeout /t 2 /nobreak$\r$\n"
  FileWrite $0 ")"
  FileClose $0
  
  ; Execute pull in hidden mode (no window visible to user)
  nsExec::ExecToStack '"$TEMP\pull-image.bat"'
  Pop $0
  Pop $1
  
  ${If} $0 != 0
    MessageBox MB_OK "Failed to pull Docker image. Please check your internet connection and restart the application."
    Abort
  ${EndIf}
  
  ; Clean up
  Delete "$TEMP\pull-image.bat"
FunctionEnd

; Select results download folder
Function SelectResultsFolder
  nsDialogs::Create 1018
  Pop $0
  
  ${If} $0 == error
    Abort
  ${EndIf}
  
  ${NSD_CreateLabel} 0 0 100% 30u "Select where to save analysis results:"
  
  ${NSD_CreateBrowseButton} 0 35u 100% 12u "Browse..."
  Pop $1
  ${NSD_OnClick} $1 SelectFolder
  
  ${NSD_CreateText} 0 50u 100% 12u ""
  Pop $2
  ${NSD_SetText} $2 "$DOCUMENTS\TrustinnDownloads"
  StrCpy $ResultsPath "$DOCUMENTS\TrustinnDownloads"
  
  nsDialogs::Show
FunctionEnd

Function SelectFolder
  nsDialogs::SelectFolderDialog "Select Results Folder:" "$DOCUMENTS"
  Pop $DownloadPath
  ${If} $DownloadPath != ""
    StrCpy $ResultsPath $DownloadPath
    GetDlgItem $0 $hwndParent 1200
    SendMessage $0 ${WM_SETTEXT} 0 "STR:$ResultsPath"
  ${EndIf}
FunctionEnd

; Save configuration
Function SaveConfiguration
  ; Create TrustINN config directory
  CreateDirectory "$APPDATA\TrustINN"
  
  ; Save results path to config file
  FileOpen $0 "$APPDATA\TrustINN\config.ini" w
  FileWrite $0 "[paths]$\r$\n"
  FileWrite $0 "resultsDir=$ResultsPath$\r$\n"
  FileClose $0
FunctionEnd
