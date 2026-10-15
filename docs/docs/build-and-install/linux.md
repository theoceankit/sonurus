---
sidebar_position: 1
---

# Linux

Build the AppImage from source, install it, and remove it again. Installers from
[GitHub Releases](https://github.com/theoceankit/sonurus/releases) are built the same way in CI
([Releasing](../distribution/releasing.md)); with a downloaded AppImage, skip to [Install](#install).

---

## Requirements

| | |
|---|---|
| System | x86_64 Linux with glibc 2.28 or later |
| Build tools | `git`, Node.js 22.12+ with `npm` |
| Disk | ~10 GB free for the build (the installed app itself takes ~3 GB on disk) |
| Network | needed to build (Node packages, Python, Python libraries); the built app starts offline |
| Running | FUSE 2 for AppImages, e.g. `sudo pacman -S fuse2` (Arch), `sudo apt install libfuse2` (Debian/Ubuntu) |
| System audio recording | `parec` and `pactl` (PulseAudio or PipeWire with `pipewire-pulse`), usually preinstalled: `sudo pacman -S libpulse` (Arch), `sudo apt install pulseaudio-utils` (Debian/Ubuntu), `sudo dnf install pulseaudio-utils` (Fedora) |

No Python installation is needed: the build downloads its own interpreter
(python-build-standalone) and installs every library into it from `locks/packaged-linux-x64.txt`.

---

## Build

```bash
git clone https://github.com/theoceankit/sonurus.git
cd sonurus
npm ci
npm run build:linux
```

`build:linux` runs `node scripts/bundle-backend.js` (Python + libraries + `app/`, precompiled — see
[Packaging](../distribution/packaging.md)) and then `electron-builder --linux`. The result is
`dist/Sonorus-<version>.AppImage` (~1 GB).

---

## Install

An AppImage needs no installation: put it somewhere permanent and, optionally, add a menu entry.

```bash
mkdir -p ~/Applications
cp dist/Sonorus-*.AppImage ~/Applications/Sonorus.AppImage
chmod +x ~/Applications/Sonorus.AppImage
```

Menu entry (GNOME and other desktops that read `~/.local/share/applications`):

```bash
mkdir -p ~/.local/share/icons
cp electron/assets/icon.png ~/.local/share/icons/sonorus.png
cat > ~/.local/share/applications/sonorus.desktop <<EOF
[Desktop Entry]
Type=Application
Name=Sonorus
Exec=$HOME/Applications/Sonorus.AppImage
Icon=$HOME/.local/share/icons/sonorus.png
Categories=AudioVideo;
StartupWMClass=Sonorus
EOF
```

[AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher) can do the same automatically.

---

## First launch

1. Start **Sonorus** from the menu, or `~/Applications/Sonorus.AppImage` from a terminal (the
   terminal shows `[backend] ready in … ms`). The main screen opens right away — there is no setup step.
2. **Settings → API Keys**: enter a HuggingFace token (needed to download the diarization model,
   see [Setup → HuggingFace token](../environment/setup.md#huggingface-token)).
3. **Settings → Models**: download a Whisper model and the diarization model.

After that, transcription works offline on the CPU. With an NVIDIA GPU (driver 570 or newer), **Settings →
GPU acceleration** downloads the CUDA build of PyTorch once and the app restarts its backend to use it
([GPU acceleration](../ui/electron/gpu-acceleration.md)).

Live recording of system audio uses `parec` from the system (see [Requirements](#requirements));
without it, starting a recording with system audio shows which package to install.

In a Wayland session Sonorus runs as a native Wayland app (Electron's default), in an X11 session as
an X11 app. Under XWayland, files dragged from a Wayland file manager (e.g. Nautilus) reach the window
without any data, so dropping files to transcribe would not work there. To force XWayland anyway,
start it with `--ozone-platform=x11`.

---

## Where things are

| What | Path |
|---|---|
| App | `~/Applications/Sonorus.AppImage` |
| Data: models, transcripts, recordings, settings | `~/.config/sonorus/` |
| Log | `~/.config/sonorus/sonorus.log` |
| GPU acceleration (CUDA build of PyTorch, if downloaded) | `~/.config/sonorus/gpu/` |

`npm start` (dev mode) keeps its data apart, in `~/.config/sonorus-dev/`. Sonorus does not start while
dev mode or another Sonorus with another data directory runs its backend (both use port 8000): an
error dialog names it — close it first. See [Configuration](../environment/configuration.md#sonorus_data_dir).
To try a build without touching existing data, start it with its own directory:

```bash
~/Applications/Sonorus.AppImage --user-data-dir=$HOME/.config/sonorus-test
```

---

## Uninstall

Quit Sonorus, then remove the app and its menu entry:

```bash
rm ~/Applications/Sonorus.AppImage
rm ~/.local/share/applications/sonorus.desktop ~/.local/share/icons/sonorus.png
```

Remove the data as well (models, transcripts, recordings, settings and the GPU download — this cannot be undone):

```bash
rm -rf ~/.config/sonorus
```

Nothing else is left behind: Python and all libraries live inside the AppImage. To free the space of
GPU acceleration only, use **Settings → GPU acceleration → Remove**, or delete `~/.config/sonorus/gpu/`
while Sonorus is closed.
