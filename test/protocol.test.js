'use strict';

/**
 * Protocol tests. The renderer files are plain scripts that publish onto
 * `window`, so the suite installs a `window` global and loads them the same way
 * index.html does.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

globalThis.window = globalThis.window || {};

const RENDERER = path.join(__dirname, '..', 'src', 'renderer');
require(path.join(RENDERER, 'transport.js'));
const RealTransport = window.SerialTransport;

/** Stands in for SerialTransport so protocol tests need no streams. */
class FakeTransport {
  constructor(options) {
    this.options = options;
    this.writes = [];
    this.opened = false;
  }

  get isOpen() {
    return this.opened;
  }

  get pending() {
    return 0;
  }

  async open() {
    this.opened = true;
  }

  async close() {
    this.opened = false;
  }

  write(msg, coalesce = false) {
    if (coalesce && this.writes.includes(msg)) return false;
    this.writes.push(msg);
    return true;
  }
}

window.SerialTransport = FakeTransport;
require(path.join(RENDERER, 'safr.js'));
require(path.join(RENDERER, 'plot.js'));

const { SAFR, DualAxisPlot } = window;

/** @returns {{safr: SAFR, events: Array, tx: string[]}} */
function makeBoard() {
  const events = [];
  const safr = new SAFR({
    onEvent: (name, payload) => events.push([name, payload]),
    onError: (err) => events.push(['error', err.message])
  });
  return { safr, events, tx: safr.transport.writes };
}

const valueOf = (events, name) => {
  const hit = events.filter((e) => e[0] === name).pop();
  return hit ? hit[1] : undefined;
};

// ---------------------------------------------------------------- reply parsing

test('a? reply scales analog telemetry and maps it to the GUI fields', () => {
  const { safr, events } = makeBoard();
  // boardT, ccdT, externT1 (diode), externT2 (Pr:BYF), laserT (BBO), laserI, boardI
  safr.readHandler('a? 3210,1500,2705,3250,4499,125,340 E0');

  assert.equal(safr.boardTemp, 32.1);
  assert.equal(safr.ccdTemp, 15);
  assert.equal(safr.externTemp1, 27.05);
  assert.equal(safr.externTemp2, 32.5);
  assert.equal(safr.bboTemp, 44.99);
  assert.equal(safr.laserCurrent, 125);
  assert.equal(safr.boardCurrent, 340);

  assert.equal(valueOf(events, 'externTemp1'), 27.05);
  assert.equal(valueOf(events, 'externTemp2'), 32.5);
  assert.equal(valueOf(events, 'laserTemp'), 44.99);
});

test('t? reply splits the two TEC setpoints', () => {
  const { safr, events } = makeBoard();
  //    laserEn,laserSp,P,I,D,specEn,specSp,P,I,D,selected,enable
  safr.readHandler('t? 1,4500,10,2,1,1,3250,8,3,1,1,1 E0');

  assert.equal(safr.laserTecSetpoint, 45); // BBO
  assert.equal(safr.specTecSetpoint, 32.5); // Pr:BYF
  assert.equal(valueOf(events, 'bboSetpoint'), 45);
  assert.equal(valueOf(events, 'byfSetpoint'), 32.5);
  assert.deepEqual(valueOf(events, 'tecState'), {
    selectedTec: '1',
    tecEnable: '1',
    laserTecEnable: '1',
    specTecEnable: '1'
  });
});

test('l? reply reports output state, current in amps and the timeout flag', () => {
  const { safr, events } = makeBoard();
  safr.readHandler('l? 1,150,4500,0,0 E0');

  const status = valueOf(events, 'laserStatus');
  assert.equal(status[0], 1); // output on
  assert.equal(status[1], 1.5); // 150 -> 1.50 A
  assert.equal(status[2], 45);
  assert.equal(status[3], 0); // firmware timeout armed
});

test('c? reply captures integration time and pixel ROI', () => {
  const { safr } = makeBoard();
  safr.readHandler('c? 2500,0,2068 E0');
  assert.equal(safr.intTime, 2500);
  assert.equal(safr.lowPixel, 0);
  assert.equal(safr.highPixel, 2068);
});

test('v? reply stores the firmware version', () => {
  const { safr, events } = makeBoard();
  safr.readHandler('v? 1.2.3 E0');
  assert.equal(safr.version, '1.2.3');
  assert.equal(valueOf(events, 'version'), '1.2.3');
});

test('single-value analog replies scale by 100', () => {
  const { safr } = makeBoard();
  safr.readHandler('aX 2705 E0');
  safr.readHandler('aY 3250 E0');
  assert.equal(safr.externTemp1, 27.05);
  assert.equal(safr.externTemp2, 32.5);
});

test('tU reply converts TEC millivolts to volts', () => {
  const { safr, events } = makeBoard();
  safr.readHandler('tU 1234 E0');
  assert.equal(safr.tecVoltage, 1.234);
  assert.equal(valueOf(events, 'tecVoltage'), 1.234);
});

test('the ta5 diagnostic stream carries TEC voltage in millivolts', () => {
  const { safr, events } = makeBoard();
  safr.readHandler('4499,3250,0,0,0,1234,0,0');

  assert.equal(safr.bboTemp, 44.99);
  assert.equal(safr.externTemp2, 32.5);
  assert.equal(safr.tecVoltage, 1.234);
  assert.equal(valueOf(events, 'tecVoltage'), 1.234);
});

test('unrecognised lines are reported, not thrown', () => {
  const { safr, events } = makeBoard();
  safr.readHandler('garbage');
  safr.readHandler('zz 1 E0');
  assert.equal(events.filter((e) => e[0] === 'unparsed').length, 2);
});

test('a short t? payload does not corrupt the stored setpoints', () => {
  const { safr, events } = makeBoard();
  safr.readHandler('t? 1,4500,10 E0');
  assert.equal(safr.laserTecSetpoint, 0);
  assert.ok(events.some((e) => e[0] === 'unparsed'));
});

// -------------------------------------------------------------- command output

test('setpoint helpers emit the documented command strings', () => {
  const { safr, tx } = makeBoard();

  safr.selectSpecTEC();
  safr.setTECTemperature(3250);
  safr.selectLaserTEC();
  safr.setTECTemperature(4500);
  safr.setLaserCurrent(125);
  safr.laserOutputOn();
  safr.laserOutputOff();
  safr.setLaserOverride(1);
  safr.setTECDiagnosticMode(true);
  safr.setTECDiagnosticMode(false);
  safr.getVersion();

  assert.deepEqual(tx, [
    'tS0', 'tT3250',
    'tS1', 'tT4500',
    'lC125',
    'lO1', 'lO0',
    'lT1',
    'ta5', 'ta0',
    'v?'
  ]);
});

test('laserFiring tracks the output commands', () => {
  const { safr } = makeBoard();
  assert.equal(safr.laserFiring, 0);
  safr.laserOutputOn();
  assert.equal(safr.laserFiring, 1);
  safr.laserOutputOff();
  assert.equal(safr.laserFiring, 0);
});

test('updateInfo polls the four queries in order', () => {
  const { safr, tx } = makeBoard();
  safr.updateInfo();
  assert.deepEqual(tx, ['c?', 't?', 'a?', 'l?']);
});

test('open pins the CCD ROI to the full sensor', async () => {
  const { safr, tx } = makeBoard();
  await safr.open({});
  assert.deepEqual(tx, ['cH2068', 'cL0']);
  assert.equal(safr.highPixel, 2068);
  assert.equal(safr.lowPixel, 0);
});

// -------------------------------------------------------------- line transport

/** Minimal Web Serial port backed by web streams. */
function fakePort() {
  let pushChunk;
  let closeStream;
  const written = [];

  const readable = new ReadableStream({
    start(controller) {
      pushChunk = (bytes) => controller.enqueue(bytes);
      closeStream = () => controller.close();
    }
  });

  const writable = new WritableStream({
    write(chunk) {
      written.push(new TextDecoder().decode(chunk));
    }
  });

  return {
    readable,
    writable,
    written,
    opened: false,
    async open() {
      this.opened = true;
    },
    async close() {
      this.opened = false;
    },
    push: (text) => pushChunk(new TextEncoder().encode(text)),
    end: () => closeStream()
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('the transport reassembles lines split across chunks', async () => {
  const lines = [];
  const transport = new RealTransport({ onLine: (line) => lines.push(line) });
  const port = fakePort();
  await transport.open(port);

  port.push('a? 1,2,3 E0\r\nv? 1.');
  await settle();
  assert.deepEqual(lines, ['a? 1,2,3 E0']);

  port.push('2.3 E0\r\n');
  await settle();
  assert.deepEqual(lines, ['a? 1,2,3 E0', 'v? 1.2.3 E0']);

  // Several replies arriving in one chunk, and a bare \n terminator.
  port.push('l? 1,0,0,0 E0\r\nt? 1,2 E0\n');
  await settle();
  assert.deepEqual(lines.slice(2), ['l? 1,0,0,0 E0', 't? 1,2 E0']);

  await transport.close();
});

test('the transport appends CRLF and coalesces duplicate pending commands', async () => {
  const transport = new RealTransport({ onLine: () => {}, writeGapMs: 0 });
  const port = fakePort();
  await transport.open(port);

  transport.write('a?');
  transport.write('a?', true); // dropped: the same command is still in flight
  transport.write('l?');
  transport.write('l?', true); // dropped: the same command is still queued
  await settle();
  await settle();

  assert.deepEqual(port.written, ['a?\r\n', 'l?\r\n']);
  await transport.close();
});

test('a poll round that overtakes a slow link does not stack up commands', async () => {
  // A writable stream that never settles keeps the queue from draining, which
  // is exactly the case coalescing exists to survive.
  const transport = new RealTransport({ onLine: () => {}, writeGapMs: 0 });
  const stalled = {
    readable: new ReadableStream({ start() {} }),
    writable: new WritableStream({ write: () => new Promise(() => {}) }),
    async open() {},
    async close() {}
  };
  await transport.open(stalled);

  const poll = () => ['c?', 't?', 'a?', 'l?'].forEach((cmd) => transport.write(cmd, true));
  for (let round = 0; round < 50; round += 1) {
    poll();
    await settle();
  }

  // One command in flight plus at most the other three waiting.
  assert.ok(transport.pending <= 3, `queue grew to ${transport.pending}`);
});

test('a stream that ends reports a disconnect exactly once', async () => {
  let disconnects = 0;
  const transport = new RealTransport({ onLine: () => {}, onDisconnect: () => { disconnects += 1; } });
  const port = fakePort();
  await transport.open(port);

  port.end();
  await transport.readDone;
  assert.equal(disconnects, 1);
});

test('closing releases both streams so the port can be reopened', async () => {
  const transport = new RealTransport({ onLine: () => {} });
  const port = fakePort();
  await transport.open(port);
  transport.write('v?');
  await transport.close();

  assert.equal(transport.isOpen, false);
  assert.equal(port.opened, false);
  assert.equal(port.readable.locked, false);
  assert.equal(port.writable.locked, false);
});

// ------------------------------------------------------------------- plot maths

test('axis ticks land on 1/2/5 multiples inside the range', () => {
  assert.deepEqual(DualAxisPlot.ticks(0, 15, 8), [0, 2, 4, 6, 8, 10, 12, 14]);
  assert.equal(DualAxisPlot.niceStep(0.3), 0.5);
  assert.equal(DualAxisPlot.niceStep(3), 5);
  assert.equal(DualAxisPlot.niceStep(120), 200);

  const ticks = DualAxisPlot.ticks(44.9, 45.1, 4);
  assert.ok(ticks.length >= 2);
  assert.ok(ticks.every((v) => v >= 44.9 && v <= 45.1));
});
