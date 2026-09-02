# SAFR Utility

[![Build and Release](https://github.com/Nat-As/SAFR_Utility/actions/workflows/build.yml/badge.svg)](https://github.com/Nat-As/SAFR_Utility/actions/workflows/build.yml)
![Downloads](https://img.shields.io/github/downloads/Nat-As/SAFR_Utility/total)

Cross-platform serial control and monitoring for the SAFR 247nm laser board — an
Electron port of the PyQt5 `247nm_Laser_GUI.py` / `SAFRPy.py` / `extendedSerial.py`
toolchain, using the [Web Serial API](https://developer.mozilla.org/docs/Web/API/Web_Serial_API)
instead of pyserial.

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

**Connect** becomes **Disconnect** while the link is up. Closing the window
disconnects cleanly and closes any open recording.

### Reading telemetry

Once connected, the app polls the board continuously and fills the read-only
fields. **Update Interval** (bottom of the plot panel) sets how often, from 50 ms
to 2 s; 250 ms is a good default and slower rates are gentler on a busy board.

| Field | Source |
| --- | --- |
| Laser Current | measured output current, amps |
| Pr:BYF Setpoint / BBO Setpoint | the two TEC loop targets the board is holding |
| Pr:BYF Temperature | spectrometer-side thermistor |
| BBO Temperature | laser-side thermistor |
| Diode Temperature | pump diode thermistor |
| TEC Voltage | TEC drive voltage — **only** with diagnostics on, see below |

**TEC Voltage stays blank until you tick "Stream TEC voltage."** No query returns
it; the board only reports TEC voltage in the raw telemetry stream that
diagnostic mode (`ta5`) turns on. Tick the box to see it, untick to stop the
stream.

### Setting temperatures and current

The **Set setpoint** and **Set current** rows are the writable ones — the row
above each shows what the board currently reports.

Type a value and press **Enter** (or click away). The field clears and the status
line echoes the command that went out, so you can confirm it landed:

- **Pr:BYF Setpoint** → selects the spectrometer TEC, then sets the target
- **BBO Setpoint** → selects the laser TEC, then sets the target
- **Set current** → sets the laser drive current in amps, e.g. `1.25`

Values are sent in hundredths, so `45.00` °C goes out as `tT4500`. Read the
setpoint row back to confirm the board accepted it — it should follow within a
poll or two. Non-numeric input is ignored rather than sent.

### Firing the laser

> ⚠️ **On** energises the laser output. Confirm the interlocks, beam path and eye
> protection for your setup before using it.

**On** and **Off** drive the output (`lO1` / `lO0`). Two indicators track state:

- **Power** — lit while the board reports the output as on
- **Timeout** — lit while the firmware's auto-shutoff timer is armed

Both are read back from the board, not set locally, so they show what the
hardware actually thinks. They are indicators only; use the buttons to change
state.

### Plotting and recording

The chart shows the three temperatures against the left axis and TEC voltage
against the right, colour-matched to the legend. Current values sit beside each
legend entry.

**Max Length** sets the rolling window (hours / minutes / seconds, 1 second to
23:59:59). The trace fills left to right, then scrolls once full. **Reset**
clears the buffers and restarts the time base.

**Record** writes every sample to CSV. You choose the file; it defaults to a
`YYYYMMDD-HHMMSS.csv` timestamp. Columns are:

```
Time(s),PrBYFTemp(C),BBOTemp(C),DiodeTemp(C),TECVoltage(V)
```

**Recording stops on its own once it fills the Max Length window** — so a 15
second window records 15 seconds. Set Max Length to the run duration you want
before starting. **Stop** ends it early.

### Sending raw commands

**Manual Command** sends any string the board understands, verbatim, with `\r\n`
appended — handy for commands the panel does not cover (motor, CCD, LED, fan,
PID tuning). Press Enter or click **Send**.

The **Serial Monitor** logs both directions, `>` transmitted and `<` received, so
you can see exactly what the board replied. **Pause** freezes the log without
touching the link; **Clear** empties it. Text is selectable for copying.

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
8-field CSV stream produced by TEC diagnostic mode.

`SAFRPy.py` sets `self.diodeTemp = self.externTemp2` while the GUI routes
`externTemp2` to the Pr:BYF field and `externTemp1` to the Diode field. The GUI's
wiring is what this port follows; the unused `diodeTemp` attribute was dropped.
