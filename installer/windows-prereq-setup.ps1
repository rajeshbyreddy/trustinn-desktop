$ErrorActionPreference = "Stop"

function Ask-YesNo([string]$message) {
  $choice = [System.Windows.Forms.MessageBox]::Show($message, "Trustinn Setup", "YesNo", "Question")
  return $choice -eq [System.Windows.Forms.DialogResult]::Yes
}

Add-Type -AssemblyName System.Windows.Forms

Write-Host "[Trustinn] Checking Windows prerequisites..."

$wslInstalled = $false
try {
  wsl --status | Out-Null
  $wslInstalled = $true
} catch {
  $wslInstalled = $false
}

if (-not $wslInstalled) {
  if (Ask-YesNo "WSL is required. Install WSL now?") {
    Start-Process -FilePath "wsl.exe" -ArgumentList "--install" -Verb RunAs -Wait
  } else {
    Write-Host "[Trustinn] WSL install skipped by user."
    exit 0
  }
}

$dockerInstalled = $false
try {
  docker --version | Out-Null
  $dockerInstalled = $true
} catch {
  $dockerInstalled = $false
}

if (-not $dockerInstalled) {
  if (Ask-YesNo "Docker Desktop is required. Open download page now?") {
    Start-Process "https://www.docker.com/products/docker-desktop/"
  }
  Write-Host "[Trustinn] Docker is not installed yet."
  exit 0
}

Write-Host "[Trustinn] Installing WSL dependencies..."
$wslCmd = @(
  "sudo apt-get update",
  "sudo apt-get install -y python3-pip python3-tabulate clang z3 cbmc g++",
  "sudo apt-get install -y jbmc || true",
  "pip3 install --break-system-packages tabulate"
) -join " && "

wsl bash -lc $wslCmd

Write-Host "[Trustinn] Pulling Trustinn Docker image..."
docker pull pasup/trustinn-tools:1.1.1

Write-Host "[Trustinn] Prerequisites setup complete."
