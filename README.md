# SAFR Utility

Cross-platform serial control and monitoring for the SAFR 247nm laser board — an
Electron port of the PyQt5 `247nm_Laser_GUI.py` / `SAFRPy.py` / `extendedSerial.py`
toolchain, using the [Web Serial API](https://developer.mozilla.org/docs/Web/API/Web_Serial_API)
instead of pyserial.

No Python, no PyQt5, no native modules — one self-contained executable per platform.

## Features

**Control**
- Serial port picker with OS-level port scan (`COM4`, `/dev/ttyUSB0`, …) at 115200 8N1
- Firmware version query (`v?`)
- Laser current readback and setpoint (`lC`)
- Pr:BYF TEC setpoint (`tS0` + `tT`) and BBO TEC setpoint (`tS1` + `tT`)
- Laser output on/off (`lO1` / `lO0`) with power and firmware-timeout status flags
- Laser timeout override applied on connect (`lT1`)
- TEC diagnostic stream toggle (`ta5` / `ta0`) — required for live TEC voltage
- Free-form command entry for anything not on the panel

**Monitoring**
- Live readouts: Pr:BYF, BBO and diode temperatures, TEC voltage, laser current
- Dual-Y-axis strip chart — temperatures left, TEC voltage right — with a rolling
  time window from 1 second to 23:59:59
- Adjustable poll interval (50–2000 ms)
- CSV recording to a file you choose, with per-sample timestamps
- Serial monitor showing every transmitted and received line

## Install

Grab a build from [Releases](../../releases):

| Platform | File |
| --- | --- |
| Windows (installer) | `SAFR Utility-Setup-<version>.exe` |
| Windows (portable) | `SAFR Utility-<version>-portable.exe` |
| Linux (AppImage) | `SAFR Utility-<version>-x86_64.AppImage` |
| Linux (Debian/Ubuntu) | `safr-utility_<version>_amd64.deb` |

The AppImage needs to be marked executable before it will run:

```bash
chmod +x 'SAFR Utility-'*.AppImage
./'SAFR Utility-'*.AppImage
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

### Protocol notes

Commands are written as `<cmd>\r\n`. Replies come back as `<cmd> <data> <err>`,
where `<err>` is `E0` on success. Temperatures and currents travel as hundredths,
so a `4500` setpoint means 45.00 °C.

The poll loop issues `c?`, `t?`, `a?` and `l?` each tick:

| Query | Fields used |
| --- | --- |
| `a?` | board temp, CCD temp, extern temp 1 (diode), extern temp 2 (Pr:BYF), laser temp (BBO), laser current, board current |
| `t?` | laser TEC setpoint (BBO), spec TEC setpoint (Pr:BYF), selected TEC, TEC enable |
| `l?` | output state, current, firmware timeout flag |
| `c?` | CCD integration time and pixel ROI |

TEC voltage is not exposed by any query — the board only reports it in the bare
8-field CSV stream produced by TEC diagnostic mode. Tick **Stream TEC voltage
(ta5)** to turn that stream on.

### Differences from the Python GUI

Behaviour was kept identical except where the original was plainly broken or
unfinished:

- **TEC voltage now reaches its field.** `updateTECVoltageLineEdit` wrote to
  `voltageLabel` instead of `voltageLineEdit`, so the value overwrote the row's
  caption and the field stayed blank.
- **Port list is not probed by opening every port.** The Python startup loop
  opened each port and looked for a `v?`/`E0` reply — but always against a
  hardcoded `COM4`, so on any other machine it listed ports that were never
  tested. Ports are now listed from the OS and verified after connecting: if the
  board does not answer `v?` within 1.5 s, the status line says so.
- **Buttons that were never connected now work.** `Query` (firmware) and `Reset`
  (clear plot buffers) had no signal connections.
- **The update-interval slider now does something.** It was created but never
  wired; it sets the poll interval, replacing the fixed 100 ms plot timer and
  250 ms query timer with a single tick so no sample is plotted twice.
- **CSV header matches the columns.** The header named four columns while five
  were written; it is now `Time(s),PrBYFTemp(C),BBOTemp(C),DiodeTemp(C),TECVoltage(V)`.
- **Recordings go where you choose.** A save dialog replaces an auto-named file
  dropped in the working directory. As before, a run stops on its own once it
  fills the Max Length window.
- **TEC diagnostic mode is a checkbox** rather than a commented-out line.
- **A serial monitor was added.** `SAFRPy` emitted `updateTX`/`updateRX` but the
  GUI never displayed them.

`SAFRPy.py` sets `self.diodeTemp = self.externTemp2` while the GUI routes
`externTemp2` to the Pr:BYF field and `externTemp1` to the Diode field. The GUI's
wiring is what this port follows; the unused `diodeTemp` attribute was dropped.
