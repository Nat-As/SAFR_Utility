'use strict';

/**
 * Web Serial transport for the SAFR board — the JS counterpart of
 * extendedSerial.py's SerialPort class.
 *
 * The board speaks newline-delimited ASCII at 115200 8N1: every command is
 * written as `<cmd>\r\n` and every reply comes back as `<cmd> <data> <err>\r\n`.
 * extendedSerial.py paced this with an explicit tx buffer plus a blocking flag
 * because pyserial reads are synchronous. Here the read loop runs continuously
 * and replies are matched by the echoed command, so the tx queue only needs to
 * serialise writes and keep the board from being flooded.
 */
class SerialTransport {
  static LINE_ENDING = '\r\n';

  /**
   * @param {object} options
   * @param {(line: string) => void} options.onLine   called per received line
   * @param {(cmd: string) => void}   [options.onWrite] called per transmitted command
   * @param {(err: Error) => void}    [options.onError]
   * @param {() => void}              [options.onDisconnect]
   * @param {number}                  [options.writeGapMs] min gap between writes
   */
  constructor({ onLine, onWrite, onError, onDisconnect, writeGapMs = 8 } = {}) {
    this.onLine = onLine || (() => {});
    this.onWrite = onWrite || (() => {});
    this.onError = onError || (() => {});
    this.onDisconnect = onDisconnect || (() => {});
    this.writeGapMs = writeGapMs;

    this.port = null;
    this.reader = null;
    this.writer = null;
    this.encoder = new TextEncoder();
    this.decoder = new TextDecoder();

    this.txQueue = [];
    this.inFlight = null;
    this.draining = false;
    this.closing = false;
    this.rxBuffer = '';
    this.readDone = Promise.resolve();
  }

  get isOpen() {
    return this.port !== null;
  }

  /** Number of commands still waiting to go out. */
  get pending() {
    return this.txQueue.length;
  }

  /**
   * @param {SerialPort} port a Web Serial port already granted by the user
   * @param {number} baudRate
   */
  async open(port, baudRate = 115200) {
    await port.open({
      baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: 'none',
      bufferSize: 8192
    });

    this.port = port;
    this.closing = false;
    this.rxBuffer = '';
    this.txQueue = [];
    this.writer = port.writable.getWriter();
    this.readDone = this.#readLoop();
  }

  async close() {
    this.closing = true;
    this.txQueue = [];

    // port.close() rejects while either stream is still locked, so unwind the
    // read loop and let any in-flight write finish before releasing locks.
    try {
      if (this.reader) await this.reader.cancel();
    } catch (_) { /* the loop is already unwinding */ }

    try {
      await this.readDone;
    } catch (_) { /* surfaced through onError already */ }

    const deadline = Date.now() + 250;
    while (this.draining && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    if (this.writer) {
      try {
        this.writer.releaseLock();
      } catch (_) { /* a pending write still holds it; port.close() will report */ }
      this.writer = null;
    }

    try {
      if (this.port) await this.port.close();
    } catch (err) {
      this.onError(err);
    }

    this.port = null;
    this.reader = null;
  }

  /**
   * Queue a command. With `coalesce`, a command that is already queued or still
   * being transmitted is dropped, so a slow board cannot make the queue grow
   * without bound (extendedSerial.py used a blocking flag for the same purpose).
   * @param {string} cmd
   * @param {boolean} [coalesce]
   */
  write(cmd, coalesce = false) {
    if (!this.isOpen) return false;
    const msg = String(cmd).trim();
    if (!msg) return false;
    if (coalesce && (this.inFlight === msg || this.txQueue.includes(msg))) return false;

    this.txQueue.push(msg);
    this.#drain();
    return true;
  }

  async #drain() {
    if (this.draining) return;
    this.draining = true;

    while (this.txQueue.length && this.writer && !this.closing) {
      const msg = this.txQueue.shift();
      this.inFlight = msg;
      try {
        await this.writer.write(this.encoder.encode(msg + SerialTransport.LINE_ENDING));
        this.onWrite(msg);
      } catch (err) {
        this.onError(err);
        break;
      } finally {
        this.inFlight = null;
      }
      if (this.writeGapMs > 0 && this.txQueue.length) {
        await new Promise((resolve) => setTimeout(resolve, this.writeGapMs));
      }
    }

    this.draining = false;
  }

  async #readLoop() {
    while (this.port && this.port.readable && !this.closing) {
      this.reader = this.port.readable.getReader();
      let ended = false;
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) {
            ended = true;
            break;
          }
          if (value && value.length) this.#ingest(value);
        }
      } catch (err) {
        if (!this.closing) this.onError(err);
      } finally {
        try {
          this.reader.releaseLock();
        } catch (_) { /* already released */ }
        this.reader = null;
      }
      // A closed stream stays truthy, so without this the outer loop spins.
      if (ended) break;
    }

    if (!this.closing) this.onDisconnect();
  }

  #ingest(chunk) {
    this.rxBuffer += this.decoder.decode(chunk, { stream: true });

    let index;
    while ((index = this.rxBuffer.indexOf('\n')) !== -1) {
      const line = this.rxBuffer.slice(0, index).replace(/\r+$/, '');
      this.rxBuffer = this.rxBuffer.slice(index + 1);
      if (line.length) this.onLine(line);
    }

    // A wedged partial line must not grow forever.
    if (this.rxBuffer.length > 16384) this.rxBuffer = '';
  }
}

window.SerialTransport = SerialTransport;
