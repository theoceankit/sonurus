---
sidebar_position: 3
---

# Windows

Build the installer from source, install the app, and remove it again. Installers from
[GitHub Releases](https://github.com/theoceankit/sonurus/releases) are built the same way in CI
([Releasing](../distribution/releasing.md)); with a downloaded installer, skip to [Install](#install).

---

## Requirements

| | |
|---|---|
| System | Windows 10 or 11, x64 |
| Build tools | Git and Node.js 22.12+ with `npm`, e.g. `winget install Git.Git OpenJS.NodeJS.LTS` |
| Visual C++ runtime | Microsoft Visual C++ 2015–2022 Redistributable (x64), [`vc_redist.x64.exe`](https://aka.ms/vs/17/release/vc_redist.x64.exe) — the build copies it into the installer ([Packaging](../distribution/packaging.md#visual-c-runtime-windows)), so the installed app does not need it |
| Disk | ~10 GB free for the build |
| Network | needed to build (Node packages, Python, Python libraries); the built app starts offline |

A fresh Windows 10 may have no `winget` yet. Register it once in PowerShell, then open a new
PowerShell window:

```powershell
Add-AppxPackage -RegisterByFamilyName -MainPackage Microsoft.DesktopAppInstaller_8wekyb3d8bbwe
```

If `winget` is still not found, update **App Installer** in the Microsoft Store, or install Git from
[git-scm.com](https://git-scm.com/download/win) and the Node.js LTS installer from
[nodejs.org](https://nodejs.org) with their default options.

No Python installation is needed: the build downloads its own interpreter
(python-build-standalone) and installs every library into it from `locks/packaged-win32-x64.txt`.

The bundled libraries have deep paths (up to ~130 characters below `site-packages`). Clone into a
short path such as `C:\src\sonorus`, and keep the default install folder, so that no path exceeds
the 260-character limit of older Windows tools.

---

## Build

In PowerShell:

```powershell
git clone https://github.com/theoceankit/sonurus.git C:\src\sonorus
cd C:\src\sonorus
npm ci
npm run build:win
```

If PowerShell stops at `npm` with "running scripts is disabled on this system", its execution policy
blocks the `npm.ps1` wrapper (the default on a fresh Windows). Either call `npm.cmd ci` and
`npm.cmd run build:win` instead, or allow local scripts for your user once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

`build:win` runs `node scripts/bundle-backend.js` (Python + libraries + `app/`, precompiled — see
[Packaging](../distribution/packaging.md)) and then `electron-builder --win`. The result is
`dist\Sonorus Setup <version>.exe` (on GitHub Releases: `Sonorus.Setup.<version>.exe`).

---

## Install

1. Run `Sonorus Setup <version>.exe`. The installer is not code-signed, so SmartScreen may show
   "Windows protected your PC": click **More info → Run anyway**.
2. Choose per-user or all-users installation and the folder (the default is recommended), then finish.
   The installer creates Desktop and Start menu shortcuts.

Installation copies about 3 GB of files and can take a few minutes, longer while antivirus scans them.

---

## First launch

1. Start **Sonorus** from the Start menu. The main screen opens right away — there is no setup step.
   The very first start can take longer while Windows Defender scans the bundled libraries.
2. **Settings → API Keys**: enter a HuggingFace token (needed to download the diarization model,
   see [Setup → HuggingFace token](../environment/setup.md#huggingface-token)).
3. **Settings → Models**: download a Whisper model and the diarization model.

After that, transcription works offline. It runs on the CPU — the packaged app has no GPU support
([Known issues](../known-issues.md#packaged-app-uses-cpu-only-pytorch)).

---

## Where things are

| What | Path |
|---|---|
| App (per-user install) | `%LOCALAPPDATA%\Programs\Sonorus\` |
| Data: models, transcripts, recordings, settings | `%APPDATA%\sonorus\` |
| Log | `%APPDATA%\sonorus\sonorus.log` |

`npm start` (dev mode) uses the same data directory — see
[Known issues](../known-issues.md#dev-mode-and-the-packaged-app-share-data). To try a build without
touching existing data, start it with its own directory:

```powershell
& "$env:LOCALAPPDATA\Programs\Sonorus\Sonorus.exe" --user-data-dir="$env:APPDATA\sonorus-test"
```

---

## Uninstall

Quit Sonorus, then **Settings → Apps → Installed apps → Sonorus → Uninstall** (or
"Add or remove programs" on Windows 10). This removes the app, Python and all libraries.

Remove the data as well (models, transcripts, recordings, settings — this cannot be undone), in PowerShell:

```powershell
Remove-Item -Recurse -Force "$env:APPDATA\sonorus"
```
