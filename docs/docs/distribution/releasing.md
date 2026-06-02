---
sidebar_position: 2
---

# Releasing

How to publish a new version of Sonorus to GitHub Releases.

---

## Process overview

1. Merge all changes into `main`
2. Push a version tag → GitHub Actions builds all platforms automatically
3. Review the draft release on GitHub
4. Edit description and publish

---

## Step-by-step

### 1. Merge and verify

```bash
git checkout main
git merge feat/your-branch
.venv/bin/python -m pytest tests/ -v
npm start   # smoke test
```

### 2. Bump version

Update `package.json`:
```json
{ "version": "0.2.0" }
```

Commit:
```bash
git add package.json
git commit -m "chore: bump version to 0.2.0"
```

### 3. Tag and push

```bash
git tag v0.2.0
git push origin main
git push origin v0.2.0
```

The tag push triggers `.github/workflows/build.yml`.

---

## GitHub Actions workflow

Triggered by any tag matching `v*`.

| Job | Runner | Output |
|---|---|---|
| `build-mac` (arm64) | `macos-latest` | `Sonorus-x.x.x-arm64.dmg`, `...-arm64-mac.zip` |
| `build-mac` (x64) | `macos-13` | `Sonorus-x.x.x-x64.dmg`, `...-x64-mac.zip` |
| `build-win` | `windows-latest` | `Sonorus Setup x.x.x.exe` |
| `build-linux` | `ubuntu-latest` | `Sonorus-x.x.x.AppImage` |
| `release` | `ubuntu-latest` | Draft GitHub Release with all artifacts |

Each build job:
1. `npm install`
2. `node scripts/bundle-backend.js` — downloads Python standalone + copies `app/`
3. `npx electron-builder --<platform> --<arch> --publish never`

Total duration: ~20–30 minutes.

### 4. Publish the draft

After all jobs complete, a **draft release** appears at:
```
https://github.com/theoceankit/sonurus/releases
```

The draft includes auto-generated release notes from commits. Edit the description and click **Publish release** when ready.

---

## Version naming

Follow [Semantic Versioning](https://semver.org/):

| Version bump | When |
|---|---|
| Patch (`0.1.x`) | Bug fixes, no new features |
| Minor (`0.x.0`) | New features, backward-compatible |
| Major (`x.0.0`) | Breaking changes |

Tag format: `v` prefix + semver, e.g. `v0.1.0`, `v0.2.0`, `v1.0.0`.

---

## Local build (dev)

Builds are not cross-platform. Build on the target OS:

```bash
# macOS (must run on macOS)
npm run build:mac

# Windows (must run on Windows)
npm run build:win

# Linux
npm run build:linux
```

Output in `dist/`. For macOS builds on an arm64 machine, add `--arm64` to get only the native arch.

---

## Notes

- Builds are **unsigned** — see [Packaging → Code signing](./packaging.md#code-signing)
- `backend-dist/` and `dist/` are gitignored — never commit them
- The Python tarball is cached in `backend-dist/` locally between builds but not in CI (each CI run re-downloads)
