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
| C++ compiler | for the system audio helper: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **Desktop development with C++** workload, e.g. `winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"`. Alternatively cross-compile it elsewhere (`npm run build:capture:win` with mingw-w64) and copy `sonorus-capture.exe` into `electron\resources\win\` after cloning |
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

`build:win` runs `npm run build:capture:win` (the system audio helper `sonorus-capture.exe`), then
`node scripts/bundle-backend.js` (Python + libraries + `app/`, precompiled — see
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
3. **Settings → Models**: download a Whisper model and the diarization model. Downloads need no
   Developer Mode or administrator rights: without the symlink privilege the model cache stores
   plain copies of the files instead of symlinks.

After that, transcription works offline on the CPU. With an NVIDIA GPU (driver 570 or newer), **Settings →
GPU acceleration** downloads the CUDA build of PyTorch once and the app restarts its backend to use it
([GPU acceleration](../ui/electron/gpu-acceleration.md)).

---

## Where things are

| What | Path |
|---|---|
| App (per-user install) | `%LOCALAPPDATA%\Programs\Sonorus\` |
| Data: models, transcripts, recordings, settings | `%APPDATA%\sonorus\` |
| Log | `%APPDATA%\sonorus\sonorus.log` |
| GPU acceleration (CUDA build of PyTorch, if downloaded) | `%APPDATA%\sonorus\gpu\` |

`npm start` (dev mode) keeps its data apart, in `%APPDATA%\sonorus-dev\`. Sonorus does not start while
dev mode or another Sonorus with another data directory runs its backend (both use port 8000): an
error dialog names it — close it first. See [Configuration](../environment/configuration.md#sonorus_data_dir).
To try a build without touching existing data, start it with its own directory:

```powershell
& "$env:LOCALAPPDATA\Programs\Sonorus\Sonorus.exe" --user-data-dir="$env:APPDATA\sonorus-test"
```

---

## Uninstall

Quit Sonorus, then **Settings → Apps → Installed apps → Sonorus → Uninstall** (or
"Add or remove programs" on Windows 10). This removes the app, Python and all libraries; the GPU
download lives with the data (below), or remove it alone with **Settings → GPU acceleration → Remove**.

Remove the data as well (models, transcripts, recordings, settings and the GPU download — this cannot be undone), in PowerShell:

```powershell
Remove-Item -Recurse -Force "$env:APPDATA\sonorus"
```
