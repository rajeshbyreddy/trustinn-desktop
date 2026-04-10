$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$logPath = Join-Path $env:TEMP "trustinn-prereq-setup.log"
try {
  Start-Transcript -Path $logPath -Force | Out-Null
} catch {
  # Ignore transcript failures.
}

function Ask-YesNo([string]$message) {
  $choice = [System.Windows.Forms.MessageBox]::Show($message, "Trustinn Setup", "YesNo", "Question")
  return $choice -eq [System.Windows.Forms.DialogResult]::Yes
}

Add-Type -AssemblyName System.Windows.Forms

Write-Host "[Trustinn] Checking Windows prerequisites..."

function Finish-Safely([string]$message) {
  Write-Host "[Trustinn] $message"
  try {
    Stop-Transcript | Out-Null
  } catch {
    # Ignore transcript close failure.
  }
  exit 0
}

$wslInstalled = $false
try {
  wsl --status 2>$null | Out-Null
  $wslInstalled = $true
} catch {
  $wslInstalled = $false
}

if (-not $wslInstalled) {
  if (Ask-YesNo "WSL is required. Install WSL now?") {
    try {
      Start-Process -FilePath "wsl.exe" -ArgumentList "--install" -Verb RunAs -Wait
      [System.Windows.Forms.MessageBox]::Show(
        "WSL installation has been started. Please restart Windows if prompted, then launch Trustinn again to finish setup.",
        "Trustinn Setup",
        "OK",
        "Information"
      ) | Out-Null
      Finish-Safely "WSL install initiated."
    } catch {
      Finish-Safely "WSL install failed or was cancelled by user."
    }
  } else {
    Finish-Safely "WSL install skipped by user."
  }
}

$wslDistroReady = $false
try {
  $distros = wsl -l -q 2>$null | Where-Object { $_ -and $_.Trim() -ne "" }
  $wslDistroReady = ($distros.Count -gt 0)
} catch {
  $wslDistroReady = $false
}

if (-not $wslDistroReady) {
  if (Ask-YesNo "No WSL Linux distribution is installed. Install Ubuntu now?") {
    try {
      Start-Process -FilePath "wsl.exe" -ArgumentList "--install", "-d", "Ubuntu" -Verb RunAs -Wait
      [System.Windows.Forms.MessageBox]::Show(
        "Ubuntu installation has been started. Complete first launch of Ubuntu, then run Trustinn again.",
        "Trustinn Setup",
        "OK",
        "Information"
      ) | Out-Null
      Finish-Safely "WSL distro install initiated."
    } catch {
      Finish-Safely "WSL distro install failed or was cancelled by user."
    }
  } else {
    Finish-Safely "WSL distro install skipped by user."
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
  Finish-Safely "Docker is not installed yet."
}

Write-Host "[Trustinn] Installing WSL dependencies..."
$wslCmd = @(
  "sudo apt-get update",
  "sudo apt-get install -y python3-pip python3-tabulate python-is-python3 clang z3 cbmc g++ libtcmalloc-minimal4",
  "sudo apt-get install -y jbmc || true",
  "pip3 install --break-system-packages tabulate"
) -join " && "

try {
  wsl bash -lc $wslCmd
} catch {
  Finish-Safely "Dependency install in WSL failed. Please retry after opening Ubuntu once manually."
}

Write-Host "[Trustinn] Pulling Trustinn Docker image..."
try {
  docker pull pasup/trustinn-tools:2.0.0
} catch {
  Finish-Safely "Docker image pull failed. Please run 'docker pull pasup/trustinn-tools:2.0.0' manually."
}

Finish-Safely "Prerequisites setup complete."
