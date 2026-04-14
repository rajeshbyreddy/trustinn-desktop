# GitHub Actions CI/CD Workflow

This document describes the automated workflows set up for the TrustInn Desktop project.

## Workflows Overview

### 1. **CI Workflow** (`.github/workflows/ci.yml`)
Runs on every push to `main` and `develop` branches, and on pull requests.

**Jobs:**
- **build-and-test**: Main build verification
  - Installs dependencies (`npm ci`)
  - Runs ESLint (code style checks)
  - Builds Next.js project
  - TypeScript type checking

- **security-scan**: Dependency vulnerability scanning
  - Checks npm packages for known vulnerabilities
  - Reports at moderate severity level

- **lint-check**: Code quality verification
  - ESLint enforcement
  - Format checks (if configured)

**Triggers:** 
- Push to `main` or `develop`
- Pull requests targeting `main` or `develop`

---

### 2. **PR Checks Workflow** (`.github/workflows/pr-checks.yml`)
Enhanced validation specifically for pull requests with detailed commentary.

**Jobs:**
- **pr-validation**: Comprehensive PR checks
  - Build verification
  - TypeScript compilation check
  - ESLint validation
  - Posts automated comment with check results

- **code-quality**: Code quality scanning
  - Finds TODO/FIXME comments
  - Dependency audit
  - Identifies potential issues

**Triggers:** Pull requests opened, synchronized, or reopened targeting `main` or `develop`

---

### 3. **Release Workflow** (`.github/workflows/release.yml`)
Automated macOS DMG creation and release publishing.

**Job:** build-mac
- Generates macOS application icon
- Builds macOS DMG distribution
- Uploads artifacts to GitHub Release

**Triggers:** Tag push (v* or *.*.*)

---

## What Gets Checked

| Check | Command | Purpose |
|-------|---------|---------|
| Dependencies | `npm ci` | Clean install, ensures consistency |
| ESLint | `npm run lint` | Code style & best practices |
| TypeScript | `npx tsc --noEmit` | Type safety & compilation |
| Build | `npx next build` | Next.js production build |
| Security | `npm audit` | Vulnerable dependency detection |

---

## Build Status Badges

Add these to your README to show build status:

```markdown
[![CI Build](https://github.com/rajeshbyreddy/trustinn-desktop/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/rajeshbyreddy/trustinn-desktop/actions/workflows/ci.yml)
[![PR Checks](https://github.com/rajeshbyreddy/trustinn-desktop/actions/workflows/pr-checks.yml/badge.svg)](https://github.com/rajeshbyreddy/trustinn-desktop/actions/workflows/pr-checks.yml)
```

---

## Node Version

All workflows use **Node.js 22** (LTS) to match the release workflow and development environment.

---

## Configuration

### ESLint
- Defined in: `eslint.config.mjs`
- Run locally: `npm run lint`

### TypeScript
- Configured in: `tsconfig.json`
- Check locally: `npx tsc --noEmit`

### Next.js Build
- Configured in: `next.config.ts`
- Build locally: `npm run build`

---

## Skipping Workflows

To skip CI on a specific commit, add to commit message:
```
[skip ci]
```

Example:
```bash
git commit -m "docs: update README [skip ci]"
```

---

## Troubleshooting

### Build Failures
1. Check Actions tab on GitHub: https://github.com/rajeshbyreddy/trustinn-desktop/actions
2. View workflow run logs for details
3. Run `npm ci && npm run lint && npx next build` locally to reproduce

### ESLint Errors
- Run `npm run lint` locally
- Fix issues or update `.eslintrc` configuration if needed

### TypeScript Errors
- Run `npx tsc --noEmit` to identify issues
- Ensure imports and types are correct

### Dependency Issues
- Run `npm audit` to see vulnerabilities
- Update packages: `npm update`
- Lock file: `npm ci` to install from lock file

---

## Adding New Workflows

To add a new workflow:
1. Create `.github/workflows/your-workflow.yml`
2. Define triggers (`on:` section)
3. Configure jobs and steps
4. Test by pushing to a feature branch
5. Monitor GitHub Actions tab

---

## Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Workflow Syntax](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions)
- [Actions Marketplace](https://github.com/marketplace?type=actions)

---

## Last Updated
April 15, 2026

**Workflows Created:**
- `ci.yml` - Continuous Integration
- `pr-checks.yml` - Pull Request Validation

**Maintained by:** Development Team
