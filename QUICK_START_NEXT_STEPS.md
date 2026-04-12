# Quick Start: Next Steps to Deploy

Everything is set up! Here's what to do now:

## Step 1: Install Dependencies
```bash
npm install
```
This installs `electron-builder` and `electron-updater` packages needed for building and updates.

**What it does**: Adds the build tools to your node_modules

---

## Step 2: Test Build Locally
```bash
npm run electron-build:win
```
This creates a test Windows installer without publishing.

**What it does**: 
- Generates `dist/trustinn-desktop-0.0.1.exe`
- Creates delta update files
- Allows testing on Windows before GitHub release

**Location**: `dist/trustinn-desktop-0.0.1.exe`

---

## Step 3: Set Up GitHub Repository

### Option A: If you don't have a repo yet
```bash
git init
git add .
git commit -m "feat: initial commit with Windows installer and auto-updates"
git branch -M main
git remote add origin https://github.com/yourusername/trustinn-desktop.git
git push -u origin main
```

### Option B: If you already have a repo
```bash
git add .
git commit -m "feat: add Windows installer and auto-updates"
git push origin main
```

**Replace `yourusername` with your GitHub username!**

---

## Step 4: Create GitHub Token for Auto-Updates

1. Go to: https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Give it a name like "trustinn-desktop-build"
4. Select scope: `public_repo` (this is enough for releases)
5. Click "Generate token"
6. **Copy the token immediately** (you won't see it again)

### Add Token to Repository

1. Go to your GitHub repo
2. Settings → Secrets and variables → Actions
3. Click "New repository secret"
4. **Name**: `GITHUB_TOKEN`
5. **Value**: (paste the token you just created)
6. Click "Add secret"

---

## Step 5: Create Release Tag

This triggers the GitHub Actions workflow to automatically build and publish your installer.

```bash
git tag v0.0.1
git push origin v0.0.1
```

**Wait 2-3 minutes** for GitHub Actions to build.

---

## Step 6: Verify Release

1. Go to your GitHub repo
2. Click "Releases" on the right
3. You should see "v0.0.1" with:
   - `trustinn-desktop-0.0.1.exe` (the installer)
   - `trustinn-desktop-0.0.1.exe.blockmap` (delta updates)
   - `latest.yml` (update metadata)

---

## Step 7: Test on Windows

1. Download `trustinn-desktop-0.0.1.exe` from releases
2. Install on a clean Windows machine
3. Verify:
   - ✅ Docker is detected (or prompts to install)
   - ✅ Docker image pulls with progress bar
   - ✅ Can select results folder
   - ✅ App launches successfully

---

## Step 8: Release the Installer

Share the installer link:
```
https://github.com/yourusername/trustinn-desktop/releases/download/v0.0.1/trustinn-desktop-0.0.1.exe
```

Users can now:
- Download and install
- Get automatic update notifications
- Auto-update to new versions

---

## Testing Auto-Updates (Optional)

To test auto-update functionality:

1. Bump version to `0.0.2` in `package.json`
2. Make a small change (e.g., update a message)
3. Commit and push: `git add . && git commit -m "bump: v0.0.2"`
4. Create tag: `git tag v0.0.2 && git push origin v0.0.2`
5. GitHub Actions builds automatically
6. Run v0.0.1 installer → should see update notification

---

## Troubleshooting

### Issue: GitHub Actions fails
- Check: Is GITHUB_TOKEN secret added? (Settings → Secrets)
- Check: Did you push the tag? (`git push origin v0.0.1`)
- View logs: Go to repo → Actions tab

### Issue: Can't create token
- Make sure you're logged into GitHub
- Token needs `public_repo` scope minimum
- Copy token immediately (only shown once)

### Issue: Installer doesn't pull Docker image
- Verify Docker Desktop is installed on Windows
- Check Docker is in PATH or at `C:\Program Files\Docker\Docker\Docker Desktop.exe`
- Look at logs in `C:\Users\{username}\AppData\Roaming\TrustINN\`

### Issue: Updates not detected
- Make sure previous version was released (v0.0.1)
- Bump to new version (v0.0.2)
- Create tag and push
- Wait 5 minutes for GitHub Actions
- Restart application to check for updates

---

## Important Configuration to Update

In `package.json`, find this section:

```json
"publish": [{
  "provider": "github",
  "owner": "yourusername",
  "repo": "trustinn-desktop",
  "releaseType": "release"
}]
```

**Replace `yourusername` with your actual GitHub username!**

Also in `WINDOWS_BUILD.md`, update:
- `yourusername` in GitHub URLs
- `trustinn-desktop` repo name if different

---

## Command Reference

```bash
# Local build (no publish)
npm run electron-build:win

# Build and publish (requires GITHUB_TOKEN)
npm run electron-build:win:publish

# Create release tag
git tag v0.0.1
git push origin v0.0.1

# View available tags
git tag -l

# Push to GitHub
git push origin main
```

---

## Timeline

**Immediate** (5 min):
1. `npm install`
2. `npm run electron-build:win`

**Today** (15 min):
1. Create GitHub repo
2. Push code
3. Create GitHub token
4. Add token to secrets

**Release** (2-3 min):
1. `git tag v0.0.1`
2. `git push origin v0.0.1`
3. Wait for GitHub Actions
4. Check Releases tab

**Total setup time**: ~30 minutes

---

## Help & Documentation

- **Build Details**: See `WINDOWS_BUILD.md`
- **Summary**: See `INSTALLER_SETUP_SUMMARY.md`
- **Electron CLI**: `npx electron-builder --help`
- **Updates**: `https://www.electron.build/auto-update`

---

**You're ready to go! Start with `npm install` →**
