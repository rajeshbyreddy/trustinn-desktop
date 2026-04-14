# TrustINN Desktop - Windows Installer Build Instructions

## Overview

TrustINN Desktop is a professional Windows application for software analysis and verification. The application automatically handles Docker setup, configuration, and updates.

## Prerequisites

1. **Node.js 18+**: Download from https://nodejs.org/
2. **Docker Desktop**: Download from https://www.docker.com/products/docker-desktop
3. **Git**: For version control and GitHub integration
4. **GitHub Account**: For releases and auto-updates

## Setup Instructions

### 1. Clone and Install

```bash
git clone https://github.com/yourusername/trustinn-desktop.git
cd trustinn-desktop
npm install
```

### 2. Development Build

To run in development mode:

```bash
npm run electron-dev
```

### 3. Production Build (Windows)

Build the Windows installer:

```bash
npm run electron-build:win
```

This creates:
- `dist/trustinn-desktop-0.0.1.exe` - Main installer
- `dist/trustinn-desktop-0.0.1.exe.blockmap` - Block map for delta updates
- `dist/latest.yml` - Update metadata

## Installation Process

### First Installation

When the user installs and runs TrustINN for the first time on Windows:

1. ✅ **Docker Check**: Application verifies Docker is installed (`docker --version`)
2. 🔗 **Docker Install Prompt**: If not installed, user is offered to download Docker Desktop
3. ⏱️ **Docker Running Check**: Application verifies Docker daemon is running (`docker ps`)
4. ▶️ **Start Docker Prompt**: If not running, prompts user to start Docker
5. 📥 **Image Pulling**: Automatically pulls `rajeshbyreddy95/trustinn-tools:latest` with progress bar
6. 📂 **Results Folder**: Prompts user to select where to save analysis results
7. ✅ **Complete**: Application is ready to use

### All Steps Are Silent

- No PowerShell windows appear
- Progress is shown with visual progress bar in the application
- User only interacts with friendly dialogs

## Auto-Updates

### How It Works

1. **Check on Startup**: Every time the app starts, it checks GitHub releases for new versions
2. **New Version Available**: Shows notification in bottom-right corner
3. **User Clicks Update**: Application downloads the update in background
4. **Installation**: After download, prompts user to restart and install
5. **Automatic**: No manual download or file management needed

### Releasing Updates

#### Method 1: Manual Release (Recommended)

```bash
# 1. Update version in package.json
# 2. Commit changes
git add .
git commit -m "chore: bump to version 0.0.2"

# 3. Tag the release
git tag v0.0.2
git push origin v0.0.2

# 4. GitHub Actions automatically:
#    - Builds the Windows installer
#    - Creates GitHub release
#    - Uploads artifacts
#    - Notifies users
```

#### Method 2: Continuous Publishing

```bash
npm run electron-build:win:publish
```

This automatically publishes to GitHub releases.

## GitHub Setup for Auto-Updates

### 1. Create GitHub Token

1. Go to https://github.com/settings/tokens
2. Click "Generate new token"
3. Select: `public_repo` (for public repo)
4. Copy the token

### 2. Add to Repository

1. Go to your repo settings
2. Click "Secrets and variables" → "Actions"
3. Create new secret:
   - Name: `GITHUB_TOKEN`
   - Value: Paste your token

### 3. Update package.json

Replace `yourusername` with your actual GitHub username:

```json
{
  "repository": {
    "type": "git",
    "url": "https://github.com/yourusername/trustinn-desktop.git"
  },
  "build": {
    "publish": [
      {
        "provider": "github",
        "owner": "yourusername",
        "repo": "trustinn-desktop"
      }
    ]
  }
}
```

## Configuration Files

### First-Time Setup Paths

- **Config Directory**: `C:\Users\{username}\AppData\Roaming\TrustINN\`
- **Config File**: `.../TrustINN/config.ini`
- **Results Directory**: User selects during installation (default: `~/Downloads/TrustinnDownloads`)

### Config File Format

```ini
[paths]
resultsDir=C:\Users\YourName\Downloads\TrustinnDownloads
```

Users can manually edit `config.ini` to change settings without reinstalling.

## Troubleshooting

### Docker Not Installing

- Manually download Docker Desktop: https://www.docker.com/products/docker-desktop
- Run installer and restart TrustINN

### Docker Image Pull Fails

- Check internet connection
- Manually pull: `docker pull rajeshbyreddy95/trustinn-tools:latest`
- Restart application

### Update Not Showing

- Check GitHub releases/tags are created
- Verify `GITHUB_TOKEN` is set in repository secrets
- Check workflow in `.github/workflows/release.yml` runs successfully

### Results Directory Issues

- Edit `C:\Users\{username}\AppData\Roaming\TrustINN\config.ini`
- Change `resultsDir` path
- Restart application

## Version Management

### Current Version

```
v0.0.1 - Initial release
```

### Semantic Versioning

- **MAJOR** (v1.0.0): Breaking changes
- **MINOR** (v0.1.0): New features
- **PATCH** (v0.0.1): Bug fixes

## Building Distribution

### Distribute to Users

Three options:

1. **Direct GitHub Link**: Users download `.exe` from releases
2. **Setup Exe**: Distribute `trustinn-desktop-0.0.1.exe`
3. **Portable Exe**: Distribute `trustinn-desktop-0.0.1.exe` (standalone)

## Production Checklist

- [ ] Update version in `package.json`
- [ ] Test installation on clean Windows machine
- [ ] Test Docker auto-detection
- [ ] Test image pulling
- [ ] Test results folder selection
- [ ] Test application functionality
- [ ] Create GitHub release with tag
- [ ] Verify auto-update detection
- [ ] Test update installation
- [ ] Document changes in release notes

## Support

For issues:
1. Check troubleshooting section above
2. Check GitHub issues: https://github.com/yourusername/trustinn-desktop/issues
3. Review logs in DevTools (Cmd+Alt+I in dev mode)
