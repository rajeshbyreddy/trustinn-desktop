# Pre-Deployment Checklist

Use this checklist to verify everything is configured correctly before building and deploying.

## Code Configuration

### Package.json Verification
- [ ] Version is set to `0.0.1`
- [ ] `electron-builder` in dependencies
- [ ] `electron-updater` in dependencies
- [ ] Scripts include `electron-build:win` and `electron-build:win:publish`
- [ ] Build configuration includes Windows (win section)
- [ ] NSIS settings configured in build
- [ ] GitHub publish provider configured with:
  - [ ] Correct `owner` (your GitHub username)
  - [ ] Correct `repo` name (your repository name)

### Main Process (electron/main.cjs)
- [ ] `setup-docker.cjs` is imported
- [ ] `setupAutoUpdater()` function exists
- [ ] `initializeDockerSetup()` function exists
- [ ] `IS_WIN` flag is defined
- [ ] IPC handler `update:quit-and-install` exists
- [ ] Auto-updater initialized in `app.whenReady()`
- [ ] Docker setup initialized in `app.whenReady()` for Windows

### Preload (electron/preload.cjs)
- [ ] Setup IPC listeners exposed:
  - [ ] `onSetupPullingImage`
  - [ ] `onSetupProgress`
  - [ ] `onSetupComplete`
- [ ] Update IPC listeners exposed:
  - [ ] `onUpdateAvailable`
  - [ ] `onUpdateProgress`
  - [ ] `onUpdateDownloaded`
- [ ] `quitAndInstall` invoke handler exists

### Docker Setup (electron/setup-docker.cjs)
- [ ] File exists at `electron/setup-docker.cjs`
- [ ] Exports `initializeSetup()` function
- [ ] Handles Docker detection
- [ ] Handles image pulling with progress
- [ ] Saves config to AppData

### NSIS Installer (electron/installer.nsh)
- [ ] File exists at `electron/installer.nsh`
- [ ] Checks for Docker installation
- [ ] Prompts for results folder
- [ ] Saves configuration

### UI Components
- [ ] `SetupModal.tsx` exists in `components/`
- [ ] `UpdateNotification.tsx` exists in `components/`
- [ ] Both components imported in `app/layout.tsx`
- [ ] Metadata updated in layout

### GitHub Actions
- [ ] `.github/workflows/release.yml` exists
- [ ] Workflow triggers on tag push (v*)
- [ ] Workflow has Windows build step
- [ ] Workflow publishes to GitHub releases

## Documentation
- [ ] `WINDOWS_BUILD.md` exists
- [ ] `INSTALLER_SETUP_SUMMARY.md` exists
- [ ] `QUICK_START_NEXT_STEPS.md` exists (this file's companion)

## Environment & Build

### System Requirements
- [ ] Node.js 16+ installed (`node --version`)
- [ ] Git installed (`git --version`)
- [ ] Windows installed (for testing, macOS for GitHub Actions)

### Local Setup
- [ ] `npm install` has been run
- [ ] `node_modules/electron-builder` exists
- [ ] `node_modules/electron-updater` exists

### Build Test
- [ ] `npm run electron-build:win` completes without errors
- [ ] `dist/trustinn-desktop-0.0.1.exe` is created
- [ ] `dist/trustinn-desktop-0.0.1.exe.blockmap` is created
- [ ] `dist/latest.yml` is created

## GitHub Configuration

### Repository Setup
- [ ] GitHub repo created at `https://github.com/yourusername/trustinn-desktop`
- [ ] Local code pushed to `main` branch
- [ ] Remote origin points to GitHub repo

### GitHub Token
- [ ] Token created with `public_repo` scope (https://github.com/settings/tokens)
- [ ] Token added as secret `GITHUB_TOKEN` in repo settings
- [ ] Secret is visible in: Settings → Secrets and variables → Actions

### Package.json GitHub Config
- [ ] `publish[0].owner` matches GitHub username
- [ ] `publish[0].repo` matches repository name

## Pre-Release Verification

### Git Status
- [ ] All files committed with `git add .` and `git commit`
- [ ] No uncommitted changes (`git status` should be clean)
- [ ] Commit message is descriptive

### Version Lock
- [ ] First release should be `v0.0.1`
- [ ] Version in `package.json` matches tag version
- [ ] No `v` prefix in package.json (e.g., `"0.0.1"` not `"v0.0.1"`)

### Release Readiness
- [ ] Commit is on `main` branch (`git branch`)
- [ ] Latest commit is ready for release
- [ ] No experimental code or debug logging left in

## Release Execution

### Tag Creation
- [ ] Tag name follows format: `v0.0.1` (with `v` prefix)
- [ ] Command: `git tag v0.0.1`
- [ ] Pushed to remote: `git push origin v0.0.1`

### GitHub Actions Monitoring
- [ ] Go to repo → Actions tab
- [ ] Release workflow appears and starts
- [ ] Workflow completes (watch for ~2-3 minutes)
- [ ] Build succeeds: ✅ checkmark
- [ ] No build errors

### Release Verification
- [ ] Go to repo → Releases tab
- [ ] Version `v0.0.1` appears
- [ ] Installer `.exe` file is attached
- [ ] `.exe.blockmap` file is attached
- [ ] `latest.yml` file is attached
- [ ] Release notes are visible (auto-generated from commit)

## Post-Release Testing

### Installer Testing
- [ ] Download `.exe` from release
- [ ] Run installer on Windows VM or test machine
- [ ] Run through installation flow:
  - [ ] Docker check succeeds (or prompts if not installed)
  - [ ] Folder selection dialog appears
  - [ ] Results folder is selected
  - [ ] Configuration saved
  - [ ] App launches successfully

### Auto-Update Testing (Optional)
- [ ] Keep v0.0.1 installed
- [ ] Bump package.json to v0.0.2
- [ ] Commit: `git commit -am "bump: v0.0.2"`
- [ ] Create tag: `git tag v0.0.2`
- [ ] Push: `git push origin v0.0.2`
- [ ] Wait for GitHub Actions
- [ ] Restart v0.0.1 app
- [ ] Should see update notification
- [ ] Click "Update Now"
- [ ] App restarts with v0.0.2

## Common Issues Checklist

If something fails, verify:

### Build Failures
- [ ] `npm install` was run successfully
- [ ] `npm ls electron-builder` shows package installed
- [ ] No `.next` build errors (`npm run build` works)
- [ ] `electron/main.cjs` is valid JavaScript

### GitHub Actions Failures
- [ ] Token secret exists and is named exactly `GITHUB_TOKEN`
- [ ] Token has `public_repo` scope
- [ ] `owner` in package.json is correct username
- [ ] `repo` in package.json matches actual repo name
- [ ] No typos in `.github/workflows/release.yml`

### Release Not Appearing
- [ ] Tag was pushed: `git push origin v0.0.1`
- [ ] Commit was on `main` branch
- [ ] Actions workflow ran (check Actions tab)
- [ ] Workflow status is ✅ green
- [ ] Refresh GitHub releases page (F5)

### Installer Issues
- [ ] File downloaded is `.exe` not `.blockmap`
- [ ] File is from the correct tag version
- [ ] Run elevated (right-click → Run as administrator) on Windows
- [ ] Check System Event Viewer for errors

---

## Completion

When all boxes are checked:
- ✅ Code is properly configured
- ✅ Build system is working
- ✅ GitHub is set up
- ✅ Installer can be created and distributed
- ✅ Auto-updates are ready to use

You're ready to maintain and update the application going forward!

---

**Quick Command Reference to Complete Setup**:
```bash
# Install dependencies
npm install

# Test build
npm run electron-build:win

# Initial commit and push
git add .
git commit -m "feat: initial commit with Windows installer and auto-updates"
git push origin main

# Create and push release tag
git tag v0.0.1
git push origin v0.0.1

# Wait 2-3 minutes, then:
# Visit https://github.com/yourusername/trustinn-desktop/releases
```
