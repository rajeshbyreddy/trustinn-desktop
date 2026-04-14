# Architecture & System Flow

This document explains the overall architecture of the Windows installer and auto-update system.

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                  TrustINN Desktop Application            │
│                    (Electron + Next.js)                  │
└─────────────────────────────────────────────────────────┘
         ↓                                   ↓
    ┌─────────────┐                 ┌──────────────────┐
    │  Preload    │                 │  Main Process    │
    │  (IPC Safe) │                 │  (setup-docker)  │
    └─────────────┘                 └──────────────────┘
         ↑                                   ↓
    Renderer                        ┌──────────────────┐
    • Setup Modal                   │   electron/      │
    • Update Notif                  │   setup-docker   │
                                    └──────────────────┘
                                    • Docker Detection
                                    • Image Pulling
                                    • Config I/O
                                            ↓
                                    ┌──────────────────┐
                                    │   Docker Hub     │
                                    │   rajeshbyreddy95│
                                    │   /trustinn-tools│
                                    │   :latest       │
                                    └──────────────────┘
```

## Installation Flow

### Phase 1: NSIS Installer (Windows)

```
User Downloads: trustinn-desktop-0.0.1.exe
                        ↓
        ┌───────────────────────────────┐
        │   NSIS Installer Script       │
        │  (electron/installer.nsh)     │
        └───────────────────────────────┘
                        ↓
        ┌───────────────────────────────┐
        │  CheckDocker()                │
        │  • Look for docker.exe        │
        │  • Verify in PATH             │
        └───────────────────────────────┘
                ↙           ↘
            YES             NO
             ↓               ↓
          Install      Show Download
          Command      Prompt Dialog
          Silently           ↓
             ↓            User Clicks
             ↓            Download Link
             ↓               ↓
             ↓            Exit (User
             ↓            must install
             ↓            Docker first)
        Extract App Files
        Create Desktop Shortcut
             ↓
        PullDockerImage()
        • Show Progress
        • Pull image in background
             ↓
        SelectResultsFolder()
        • Show Browse Dialog
        • Save to config.ini
             ↓
        Launch Application
             ↓
    ┌─────────────────────┐
    │  Phase 2: App Start │
    └─────────────────────┘
```

### Phase 2: First App Launch

```
app.whenReady()
        ↓
┌───────────────────────┐
│ setupAutoUpdater()    │
│ (electron-updater)    │
└───────────────────────┘
        ↓
Check GitHub for updates
        ↓
        ├─→ No updates: Continue
        │
        └─→ Update available: 
            Show notification
            Download in background
                ↓
            On download complete:
            Show "Install now?" prompt
                ↓
                User clicks "Install Now"
                ↓
            quitAndInstall()
            Restart with new version
        ↓
┌───────────────────────┐
│ initializeDockerSetup│
│ (Windows only)        │
│ (Production only)     │
└───────────────────────┘
        ↓
    Check Docker:
    • isDockerInstalled()
    • isDockerRunning()
        ↓
        ├─→ Already pulled: Skip
        │
        └─→ Not present:
            Show setup modal
                ↓
            pullDockerImage()
            • Spawn: docker pull
            • Parse progress
            • Send IPC events to UI
                ↓
            On complete:
                ↓
            Load config:
            • Read resultsDir from config.ini
            • Make available to app
                ↓
            Hide modal
                ↓
    ┌─────────────────────┐
    │  App Ready          │
    │  (Main Page)        │
    └─────────────────────┘
```

## Component Communication Flow

### Setup Flow (IPC Events)

```
electron/setup-docker.cjs
    └─→ mainWindow.webContents.send()
            ↓
        setup:pulling-image
            ↓
        electron/preload.cjs
            └─→ window.onSetupPullingImage()
                    ↓
                components/SetupModal.tsx
                    └─→ Show modal, animate
        
        setup:pull-progress (percent)
            ↓
        electron/preload.cjs
            └─→ window.onSetupProgress()
                    ↓
                components/SetupModal.tsx
                    └─→ Update progress bar
        
        setup:pull-complete
            ↓
        electron/preload.cjs
            └─→ window.onSetupComplete()
                    ↓
                components/SetupModal.tsx
                    └─→ Hide after 1.5s delay
```

### Update Flow (IPC Events)

```
electron-updater (setupAutoUpdater)
    └─→ mainWindow.webContents.send()
            ↓
        update:available (info)
            ↓
        electron/preload.cjs
            └─→ window.onUpdateAvailable()
                    ↓
                components/UpdateNotification.tsx
                    └─→ Show "Update Available"
                        Start download
        
        update:progress (progress)
            ↓
        electron/preload.cjs
            └─→ window.onUpdateProgress()
                    ↓
                components/UpdateNotification.tsx
                    └─→ Show progress bar
                        Show speed (MB/s)
        
        update:downloaded (info)
            ↓
        electron/preload.cjs
            └─→ window.onUpdateDownloaded()
                    ↓
                components/UpdateNotification.tsx
                    └─→ Show "Install now?"
                    
        User clicks "Install Now"
            ↓
        electron/preload.cjs
            └─→ window.quitAndInstall()
                    ↓
                ipcMain.handle("update:quit-and-install")
                    ↓
                autoUpdater.quitAndInstall()
                    ↓
                App restarts with new version
```

## Configuration System

### Config File Location (Windows)
```
C:\Users\{username}\AppData\Roaming\TrustINN\config.ini
```

### Config File Format
```ini
[settings]
resultsDir=C:\Users\{username}\Desktop
```

### Config Read/Write Flow

```
First Installation:
    NSIS installer
        ↓
    SelectResultsFolder()
        ↓
    User selects folder
        ↓
    SaveConfiguration()
        └─→ Writes to config.ini
                ↓
        C:\Users\...\AppData\Roaming\TrustINN\config.ini

App Startup:
    setup-docker.cjs
        ↓
    parseConfig()
        ↓
    Read config.ini
        ↓
    Return {resultsDir: "C:\...\"}
        ↓
    Available to app
```

## Docker Image Pulling Flow

```
User doesn't have image: rajeshbyreddy95/trustinn-tools:latest
        ↓
pullDockerImage() called
        ↓
spawn("docker", ["pull", "rajeshbyreddy95/trustinn-tools:latest"])
        ↓
Capture stdout/stderr
        ↓
Parse output for progress:
    • Digest downloaded
    • Layers extracted
    • Percentage calculations
        ↓
For each event:
    mainWindow.webContents.send("setup:pull-progress", percent)
        ↓
UI updates progress bar
        ↓
stderr listener for complete:
    if (data.includes("Digest:"))
        ↓
    mainWindow.webContents.send("setup:pull-complete")
        ↓
    Hide modal
        ↓
Application ready to execute tools
```

## Auto-Update Release Flow

```
Developer edits code
        ↓
Bump version in package.json:
    "version": "0.0.2"
        ↓
git commit -am "bump: v0.0.2"
git tag v0.0.2
git push origin v0.0.2
        ↓
GitHub Actions Triggered
    └─→ .github/workflows/release.yml
        ↓
        1. Checkout code
        2. Setup Node.js
        3. npm ci (install)
        4. npm run build (Next.js)
        5. npm run electron-build:win:publish
            └─→ electron-builder publishes to GitHub
                ↓
                Creates:
                • trustinn-desktop-0.0.2.exe
                • trustinn-desktop-0.0.2.exe.blockmap
                • latest.yml (metadata)
        ↓
        6. Create GitHub Release
            └─→ Shows in Releases tab
                Download link ready
        ↓
User has v0.0.1 installed
        ↓
App checks for updates (on startup)
    └─→ setupAutoUpdater() calls:
        electron-updater.checkForUpdates()
        ↓
Queries GitHub releases:
    {
      "version": "0.0.2",
      "releaseDate": "2024-01-01",
      "url": ".../0.0.2.exe",
      "stagingPercentage": 100
    }
        ↓
Compares: 0.0.2 > 0.0.1
        ↓
Send IPC: update:available
        ↓
UI shows notification
        ↓
User clicks "Update Now"
        ↓
electron-updater downloads:
    trustinn-desktop-0.0.2.exe.blockmap
    (delta update, much smaller)
        ↓
Emit IPC: update:progress (percent)
        ↓
UI shows download progress
        ↓
Download complete
        ↓
Send IPC: update:downloaded
        ↓
UI shows "Restart to install"
        ↓
User clicks "Install Now"
        ↓
window.quitAndInstall()
        ↓
autoUpdater.quitAndInstall()
        ↓
App closes
New version installer runs
App restarts with v0.0.2
```

## File Organization

```
trustinn-desktop/
├── electron/
│   ├── main.cjs          ← Orchestration, IPC handlers
│   ├── setup-docker.cjs  ← Docker logic
│   ├── installer.nsh     ← NSIS Windows installer
│   └── preload.cjs       ← IPC bridge (safe)
│
├── components/
│   ├── SetupModal.tsx    ← Setup progress UI
│   └── UpdateNotification.tsx ← Update notification UI
│
├── app/
│   └── layout.tsx        ← Components integration
│
├── .github/
│   └── workflows/
│       └── release.yml   ← GitHub Actions build
│
├── package.json          ← Build config, versions
├── next.config.ts        ← Next.js config
└── tsconfig.json         ← TypeScript config

Output:
├── dist/
│   ├── trustinn-desktop-0.0.1.exe        ← Installer
│   ├── trustinn-desktop-0.0.1.exe.blockmap
│   └── latest.yml
│
└── .next/                ← Next.js build
```

## Security Considerations

### IPC Security
- Preload is sandboxed
- Only safe APIs exposed to renderer
- No `nodeIntegration: true`
- No `contextIsolation: false`

### Docker Operations
- Commands executed silently
- No shell scripting (direct spawn)
- Error handling for all operations
- User-friendly error dialogs

### Configuration Security
- Config stored in user AppData (not sensitive data)
- Only stores `resultsDir` path
- No credentials stored in config

### GitHub Token Security
- Token stored in GitHub Actions secrets
- Never exposed in logs
- Only used for publishing releases
- Scoped to `public_repo` only

## Troubleshooting Points

### Setup Fails
1. Check Docker installation (PATH, docker.exe location)
2. Check Docker daemon running (`docker ps`)
3. Check internet connection for image pull
4. Review config.ini location

### Updates Not Detected
1. Check GitHub token is valid
2. Check `owner` and `repo` in package.json
3. Check tag was pushed (`git push origin v0.0.1`)
4. Check GitHub Actions passed (green checkmark)
5. Wait 5+ minutes before retrying

### Image Pull Stalls
1. Check Docker daemon (restart if needed)
2. Check network connectivity
3. Large image (2-3GB) takes time
4. Check disk space available
5. Check stdout/stderr in console

### Installation Fails
1. Run as administrator
2. Check Windows User Account Control permissions
3. Check result directory permissions
4. Check config.ini is accessible
5. Check %APPDATA% path is valid

---

**Key Design Principles**:
- ✅ Silent operation (no PowerShell visible)
- ✅ User-friendly (dialogs, progress bars)
- ✅ Automatic (minimal user intervention)
- ✅ Recoverable (errors handled gracefully)
- ✅ Updatable (GitHub releases integration)
- ✅ Configurable (results folder selection)
