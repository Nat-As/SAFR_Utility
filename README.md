# SAFR Utility

[![Build and Release](https://github.com/Nat-As/SAFR_Utility/actions/workflows/build.yml/badge.svg)](https://github.com/Nat-As/SAFR_Utility/actions/workflows/build.yml)
[![Downloads](https://img.shields.io/github/downloads/Nat-As/SAFR_Utility/total?label=downloads)](https://github.com/Nat-As/SAFR_Utility/releases)

Cross-platform serial control and monitoring for the SAFR laser board — in
Electron!

## Download
Download is available for Linux / Windows [HERE](https://github.com/Nat-As/SAFR_Utility/releases)

## Usage

### Connecting

1. Pick the board's port from **COM Port**. The list is scanned from the OS at
   startup — hit **Refresh** if you plug the board in afterwards. On Windows it
   shows `COM4`-style names, on Linux `/dev/ttyUSB0` with the USB adapter's
   description beside it.
2. Press **Connect**. The app opens the port at 115200 8N1, asks for the firmware
   version, and overrides the firmware's laser-on timeout (`lT1`) so the output
   does not shut itself off mid-session.
3. The badge in the top-right turns green and the status line at the bottom
   reports the poll rate. If the board does not answer within 1.5 seconds the
   status line warns you — usually the wrong port.

### Firing the laser

>[!CAUTION]
> **On** energises the laser output. Confirm the interlocks, beam path and eye
> protection for your setup before using it.


### Sending raw commands

**Manual Command** sends any string the board understands, verbatim, with `\r\n`
appended — handy for commands the panel does not cover (motor, CCD, LED, fan,
PID tuning). Press Enter or click **Send**.

## Install

Grab a build from [Releases](../../releases):

| Platform | File |
| --- | --- |
| Windows (installer) | `SAFR-Utility-Setup-<version>.exe` |
| Windows (portable) | `SAFR-Utility-<version>-portable.exe` |
| Linux (AppImage) | `SAFR-Utility-<version>-x86_64.AppImage` |
| Linux (Debian/Ubuntu) | `safr-utility_<version>_amd64.deb` |

The AppImage needs to be marked executable before it will run:

```bash
chmod +x SAFR-Utility-*.AppImage
./SAFR-Utility-*.AppImage
```

### Linux serial permissions

Serial devices are owned by the `dialout` group on most distributions. Add
yourself once, then log out and back in:

```bash
sudo usermod -aG dialout "$USER"
```

## Development

```bash
npm install
npm start            # run from source
npm test             # protocol + transport tests (no hardware needed)
npm run build:win    # NSIS installer + portable .exe  -> dist/
npm run build:linux  # AppImage + .deb                 -> dist/
npm run build:all    # both
node tools/make-icon.js   # regenerate build/icon.png
```

Windows builds must run on Windows and Linux builds on Linux; the GitHub Actions
workflow does both in parallel.

`npm test` needs no Electron binary, so `npm ci --ignore-scripts` is enough for a
test-only checkout.

> **Building for Windows locally** requires symlink privileges: electron-builder
> unpacks its `winCodeSign` toolchain from an archive containing macOS symlinks,
> and without Developer Mode (or an elevated shell) 7-Zip fails with
> `Cannot create symbolic link : A required privilege is not held by the client`.
> Enable **Settings → System → For developers → Developer Mode**, or just let CI
> do the packaging. `npm start` and `npx electron-builder --win --dir` are
> unaffected.

## Releasing

`.github/workflows/build.yml` builds on every push to `main`, on pull requests,
and on demand. Pushing a `v*` tag additionally publishes a GitHub release with
all four artifacts attached:

```bash
npm version 1.0.1        # bumps package.json and commits a v1.0.1 tag
git push --follow-tags
```

## Architecture

| File | Replaces | Purpose |
| --- | --- | --- |
| `src/main.js` | — | Electron main process, Web Serial permissions, CSV file writer |
| `src/ports.js` | `serial.tools.list_ports` | Gesture-free serial port enumeration per OS |
| `src/preload.js` | — | `contextBridge` surface exposed to the renderer |
| `src/renderer/transport.js` | `extendedSerial.py` | Web Serial line transport and transmit queue |
| `src/renderer/safr.js` | `SAFRPy.py` | Board protocol: command builders and reply parsing |
| `src/renderer/plot.js` | `TwoYAxisPlot` (pyqtgraph) | Dual-Y-axis canvas strip chart |
| `src/renderer/app.js` | `247nm_Laser_GUI.py` | UI wiring, polling loop, rolling buffers, recording |
