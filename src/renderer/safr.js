'use strict';

/**
 * SAFR board protocol layer — the JS counterpart of SAFRPy.py's SAFR class.
 *
 * Wire format: commands go out as `<cmd>\r\n`; replies come back as
 * `<cmd> <data> <err>` where <err> is `E0` on success. A board left in TEC
 * diagnostic mode (`ta5`) also streams bare 8-field CSV lines, which is the
 * only source of TEC voltage — the same fallback SAFRPy.py handles in its
 * ValueError branch.
 *
 * Values are transmitted as hundredths: temperatures and currents are
 * data/100, TEC voltage from the diagnostic stream is data/1000.
 */
class SAFR {
  constructor({ onEvent, onTx, onRx, onError } = {}) {
    this.onEvent = onEvent || (() => {});
    this.onTx = onTx || (() => {});
    this.onRx = onRx || (() => {});
    this.onError = onError || (() => {});

    // Telemetry mirrored from SAFRPy's instance state; app.js samples these.
    this.boardTemp = 0;
    this.ccdTemp = 0;
    this.externTemp1 = 0; // "Diode Temperature" in the 247nm GUI
    this.externTemp2 = 0; // "Pr:BYF Temperature" in the 247nm GUI
    this.bboTemp = 0; // laser thermistor
    this.tecVoltage = 0;
    this.laserCurrent = 0;
    this.boardCurrent = 0;

    this.intTime = 0;
    this.lowPixel = 0;
    this.highPixel = 0;

    this.laserTecSetpoint = 0; // -> BBO setpoint
    this.specTecSetpoint = 0; // -> Pr:BYF setpoint
    this.selectedTec = null;
    this.tecEnable = null;

    this.laserFiring = 0;
    this.version = '';

    this.transport = new window.SerialTransport({
      onLine: (line) => this.readHandler(line),
      onWrite: (cmd) => this.onTx(cmd),
      onError: (err) => this.onError(err),
      onDisconnect: () => this.emit('disconnect', null)
    });
  }

  get isOpen() {
    return this.transport.isOpen;
  }

  emit(name, payload) {
    this.onEvent(name, payload);
  }

  // ---------------------------------------------------------------- transport

  async open(port, baudRate = 115200) {
    await this.transport.open(port, baudRate);
    // SAFRPy's constructor pins the CCD ROI to the full sensor on connect.
    this.setPixelROIHigh(2068);
    this.setPixelROILow(0);
  }

  async close() {
    await this.transport.close();
  }

  /** Queue a command. `coalesce` drops it when an identical one is still pending. */
  write(msg, coalesce = false) {
    return this.transport.write(msg, coalesce);
  }

  // ------------------------------------------------------------------ parsing

  readHandler(line) {
    this.onRx(line);

    const parts = line.split(' ');
    if (parts.length !== 3) {
      this.parseDiagnosticStream(parts[0]);
      return;
    }

    const [cmd, data, err] = parts;
    try {
      this.dispatch(cmd, data, err);
    } catch (parseError) {
      this.emit('unparsed', { line, error: parseError.message });
    }
  }

  /**
   * TEC diagnostic mode (`ta5`) streams 8 comma-separated fields with no
   * command echo: laserTemp, externTemp2, ..., tecVoltage(mV), ...
   */
  parseDiagnosticStream(text) {
    const vals = String(text).split(',');
    if (vals.length !== 8 || vals.some((v) => v === '' || Number.isNaN(Number(v)))) {
      this.emit('unparsed', { line: text });
      return;
    }
    this.bboTemp = Number(vals[0]) / 100;
    this.externTemp2 = Number(vals[1]) / 100;
    this.tecVoltage = Number(vals[5]) / 1000;

    this.emit('laserTemp', this.bboTemp);
    this.emit('externTemp2', this.externTemp2);
    this.emit('tecVoltage', this.tecVoltage);
  }

  dispatch(cmd, data, err) {
    const ints = () => data.split(',').map((v) => parseInt(v, 10));
    const floats = () => data.split(',').map((v) => parseFloat(v));

    // Order matters: `c?` must be tested before `cI`/`cH`/`cL` etc. would
    // match, exactly as in SAFRPy.read_handler.
    if (cmd.includes('cD1')) {
      return; // binary spectra frame; the 247nm workflow never requests one
    }
    if (cmd.includes('l?')) {
      const vals = ints();
      vals[1] = Math.round((vals[1] / 100) * 100) / 100;
      vals[2] = Math.round((vals[2] / 100) * 100) / 100;
      this.emit('laserStatus', vals);
      return;
    }
    if (cmd.includes('c?')) {
      const [intTime, lowPixel, highPixel] = ints();
      this.intTime = intTime;
      this.lowPixel = lowPixel;
      this.highPixel = highPixel;
      this.emit('ccd', { intTime, lowPixel, highPixel });
      return;
    }
    if (cmd.includes('a?')) {
      const vals = floats();
      this.boardTemp = vals[0] / 100;
      this.ccdTemp = vals[1] / 100;
      this.externTemp1 = vals[2] / 100;
      this.externTemp2 = vals[3] / 100;
      this.bboTemp = vals[4] / 100;
      this.laserCurrent = vals[5];
      this.boardCurrent = vals[6];

      this.emit('boardTemp', this.boardTemp);
      this.emit('ccdTemp', this.ccdTemp);
      this.emit('externTemp1', this.externTemp1);
      this.emit('externTemp2', this.externTemp2);
      this.emit('laserTemp', this.bboTemp);
      this.emit('laserCurrent', this.laserCurrent);
      this.emit('boardCurrent', this.boardCurrent);
      return;
    }
    if (cmd.includes('v?')) {
      this.version = data;
      this.emit('version', data);
      return;
    }
    if (cmd.includes('t?')) {
      this.parseTecQuery(data);
      return;
    }
    if (cmd.includes('rR?')) return;
    if (cmd.includes('mH')) return this.emit('homed', data);
    if (cmd.includes('r?')) return this.emit('range', data.split(','));
    if (cmd.includes('mX')) return this.emit('focusC0', data);
    if (cmd.includes('mY')) return this.emit('focusC1', data);
    if (cmd.includes('mM')) return this.emit('motorPos', data);
    if (cmd.includes('oT')) return this.emit('trigger', data);
    if (cmd.includes('aA')) {
      this.laserCurrent = parseInt(data, 10);
      return this.emit('laserCurrent', this.laserCurrent);
    }
    if (cmd.includes('aB')) {
      this.boardTemp = parseFloat(data) / 100;
      return this.emit('boardTemp', this.boardTemp);
    }
    if (cmd.includes('aC')) {
      this.ccdTemp = parseFloat(data) / 100;
      return this.emit('ccdTemp', this.ccdTemp);
    }
    if (cmd.includes('aL')) return this.emit('laserSetpoint', data);
    if (cmd.includes('aT')) {
      this.boardCurrent = parseInt(data, 10);
      return this.emit('boardCurrent', this.boardCurrent);
    }
    if (cmd.includes('aX')) {
      this.externTemp1 = parseFloat(data) / 100;
      return this.emit('externTemp1', this.externTemp1);
    }
    if (cmd.includes('aY')) {
      this.externTemp2 = parseFloat(data) / 100;
      return this.emit('externTemp2', this.externTemp2);
    }
    if (cmd.includes('cI')) {
      const t = parseFloat(data);
      if (!Number.isNaN(t)) this.intTime = t;
      return this.emit('ccdIntTime', data);
    }
    if (cmd.includes('cH')) {
      const h = parseInt(data, 10);
      if (!Number.isNaN(h)) this.highPixel = h;
      return this.emit('ccdHigh', data);
    }
    if (cmd.includes('cL')) {
      const l = parseInt(data, 10);
      if (!Number.isNaN(l)) this.lowPixel = l;
      return this.emit('ccdLow', data);
    }
    if (cmd.includes('lC?')) return this.emit('currentSetpoint', data);
    if (cmd.includes('tU')) {
      const v = parseFloat(data);
      if (!Number.isNaN(v)) {
        this.tecVoltage = v / 1000;
        this.emit('tecVoltage', this.tecVoltage);
      }
      return;
    }
    if (cmd.includes('tW')) return this.emit('tecAccError', data);
    if (cmd.includes('tV')) return this.emit('tecError', data);
    if (cmd.includes('tX')) return this.emit('tecP', data);
    if (cmd.includes('tY')) return this.emit('tecI', data);
    if (cmd.includes('tZ')) return this.emit('tecD', data);

    this.emit('unparsed', { line: `${cmd} ${data} ${err}` });
  }

  /** `t?` reply: 12 comma-separated TEC loop fields. */
  parseTecQuery(data) {
    const d = data.split(',');
    if (d.length < 12) {
      this.emit('unparsed', { line: data });
      return;
    }
    this.laserTecEnable = d[0];
    this.laserTecSetpoint = parseFloat(d[1]) / 100;
    this.laserTecP = d[2];
    this.laserTecI = d[3];
    this.laserTecD = d[4];
    this.specTecEnable = d[5];
    this.specTecSetpoint = parseFloat(d[6]) / 100;
    this.specTecP = d[7];
    this.specTecI = d[8];
    this.specTecD = d[9];
    this.selectedTec = d[10];
    this.tecEnable = d[11];

    this.emit('bboSetpoint', this.laserTecSetpoint);
    this.emit('byfSetpoint', this.specTecSetpoint);
    this.emit('tecState', {
      selectedTec: this.selectedTec,
      tecEnable: this.tecEnable,
      laserTecEnable: this.laserTecEnable,
      specTecEnable: this.specTecEnable
    });
  }

  // ----------------------------------------------------------------- commands

  getVersion() { this.write('v?'); }
  getAnalog() { this.write('a?', true); }
  getCCD() { this.write('c?', true); }
  getLaser() { this.write('l?', true); }
  getTEC() { this.write('t?', true); }

  /** One polling round, matching SAFRPy.update_info(). */
  updateInfo() {
    this.getCCD();
    this.getTEC();
    this.getAnalog();
    this.getLaser();
  }

  selectSpecTEC() { this.write('tS0'); }
  selectLaserTEC() { this.write('tS1'); }

  /** @param {number} hundredthsDegC setpoint in hundredths of a degree C */
  setTECTemperature(hundredthsDegC) { this.write(`tT${hundredthsDegC}`); }

  setTECEnable(on) { this.write(on ? 'tE1' : 'tE0'); }
  setTECMode(on) { this.write(on ? 'tO1' : 'tO0'); }

  /** `ta5` puts the board in TEC diagnostic mode, which streams TEC voltage. */
  setTECDiagnosticMode(on) { this.write(on ? 'ta5' : 'ta0'); }

  getTecVoltage() { this.write('tU1'); }
  getTecError() { this.write('tV1'); }
  getTecAccError() { this.write('tW1'); }

  setPLoop(p) { this.write(`tP${p}`); }
  setILoop(i) { this.write(`tI${i}`); }
  setDLoop(d) { this.write(`tD${d}`); }

  /** @param {number} hundredthsAmp current in hundredths of an amp */
  setLaserCurrent(hundredthsAmp) { this.write(`lC${hundredthsAmp}`); }
  getLaserCurrent() { this.write('aA?'); }

  laserOutputOn() {
    this.laserFiring = 1;
    this.write('lO1');
  }

  laserOutputOff() {
    this.laserFiring = 0;
    this.write('lO0');
  }

  /** `lT<n>` overrides the firmware's laser-on timeout. */
  setLaserOverride(val) { this.write(`lT${val}`); }

  setPixelROILow(low) {
    this.lowPixel = parseInt(low, 10);
    this.write(`cL${low}`);
  }

  setPixelROIHigh(high) {
    this.highPixel = parseInt(high, 10);
    this.write(`cH${high}`);
  }

  setIntTime(t) {
    this.intTime = parseInt(t, 10);
    this.write(`cI${t}`);
  }
}

window.SAFR = SAFR;
