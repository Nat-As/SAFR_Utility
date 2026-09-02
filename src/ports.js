'use strict';

/**
 * Dependency-free serial port enumeration for the port dropdown.
 *
 * navigator.serial.requestPort() needs a user gesture and pops a picker, so it
 * cannot fill a dropdown on startup. Reading the port names straight from the
 * OS can, and the names it returns (COM4, /dev/ttyUSB0) are exactly the
 * `portName` values Electron reports in its 'select-serial-port' list, so the
 * renderer's choice still resolves to a real Web Serial port at connect time.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function execText(command, args, timeout = 4000) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, windowsHide: true }, (err, stdout) => {
      resolve(err ? '' : String(stdout));
    });
  });
}

/** HKLM\HARDWARE\DEVICEMAP\SERIALCOMM lists every COM port the OS knows. */
async function listWindowsPorts() {
  const out = await execText('reg', ['query', 'HKLM\\HARDWARE\\DEVICEMAP\\SERIALCOMM']);
  const ports = [];
  out.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*(\S+)\s+REG_SZ\s+(COM\d+)\s*$/i);
    if (!match) return;
    ports.push({
      portName: match[2].toUpperCase(),
      displayName: match[1].replace(/^\\Device\\/, '')
    });
  });
  return ports;
}

function readTrimmed(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch (_) {
    return '';
  }
}

async function listLinuxPorts() {
  // /dev/serial/by-id carries the descriptive vendor/product string.
  const labels = new Map();
  try {
    fs.readdirSync('/dev/serial/by-id').forEach((entry) => {
      try {
        labels.set(fs.realpathSync(path.join('/dev/serial/by-id', entry)), entry);
      } catch (_) { /* dangling symlink */ }
    });
  } catch (_) { /* directory absent when no USB serial adapter is attached */ }

  let ttys = [];
  try {
    ttys = fs.readdirSync('/sys/class/tty');
  } catch (_) {
    return [];
  }

  const ports = [];
  ttys.forEach((name) => {
    const device = `/dev/${name}`;
    if (!fs.existsSync(`/sys/class/tty/${name}/device`)) return;
    if (!fs.existsSync(device)) return;

    if (/^ttyS\d+$/.test(name)) {
      // Most ttyS* nodes are placeholders; UART type 0 means "no hardware".
      const type = parseInt(readTrimmed(`/sys/class/tty/${name}/type`), 10);
      if (!type) return;
    } else if (!/^tty(USB|ACM|AMA|XRUSB)\d+$/.test(name)) {
      return;
    }

    ports.push({ portName: device, displayName: labels.get(device) || '' });
  });
  return ports;
}

async function listDarwinPorts() {
  let entries = [];
  try {
    entries = fs.readdirSync('/dev');
  } catch (_) {
    return [];
  }
  return entries
    .filter((name) => name.startsWith('cu.') && !/Bluetooth-Incoming/i.test(name))
    .map((name) => ({ portName: `/dev/${name}`, displayName: '' }));
}

function sortPorts(ports) {
  return ports.sort((a, b) => {
    const na = a.portName.match(/(\d+)$/);
    const nb = b.portName.match(/(\d+)$/);
    const prefixA = a.portName.replace(/\d+$/, '');
    const prefixB = b.portName.replace(/\d+$/, '');
    if (prefixA !== prefixB) return prefixA.localeCompare(prefixB);
    if (na && nb) return Number(na[1]) - Number(nb[1]);
    return a.portName.localeCompare(b.portName);
  });
}

/**
 * @param {Array} chromiumPorts ports cached from 'select-serial-port', used to
 *   enrich the OS list with vendor/product ids and Chromium's portId.
 */
async function listSerialPorts(chromiumPorts = []) {
  let ports = [];
  if (process.platform === 'win32') ports = await listWindowsPorts();
  else if (process.platform === 'linux') ports = await listLinuxPorts();
  else ports = await listDarwinPorts();

  const known = new Map(chromiumPorts.filter((p) => p.portName).map((p) => [p.portName, p]));

  const merged = ports.map((port) => {
    const extra = known.get(port.portName);
    return {
      portId: extra ? extra.portId : '',
      portName: port.portName,
      displayName: port.displayName || (extra ? extra.displayName : ''),
      vendorId: extra ? extra.vendorId : '',
      productId: extra ? extra.productId : '',
      serialNumber: extra ? extra.serialNumber : ''
    };
  });

  // Keep anything Chromium saw that the OS scan missed.
  const seen = new Set(merged.map((p) => p.portName));
  chromiumPorts.forEach((port) => {
    if (port.portName && !seen.has(port.portName)) merged.push(port);
  });

  return sortPorts(merged);
}

module.exports = { listSerialPorts };
