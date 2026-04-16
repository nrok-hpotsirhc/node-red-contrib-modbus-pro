'use strict';

/**
 * MOCK: Mock Serial Port
 * SIMULATES: serialport module for RTU transport unit tests
 * USED IN: test/unit/transport/rtu-transport.test.js
 * LAST UPDATED: 2026-04-16
 * REMOVABLE: no – required for RTU transport unit tests
 * DEPENDENCIES: none
 */

const { EventEmitter } = require('events');

/**
 * Configuration defaults for MockSerialPort.
 * Override via the options parameter in the constructor.
 */
const DEFAULT_OPTIONS = {
  path: '/dev/ttyUSB0',
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  autoOpen: true,
  openShouldSucceed: true,
  openDelay: 0,
  writeShouldSucceed: true,
  errorOnWrite: null
};

/**
 * MockSerialPort – deterministic mock for the serialport module.
 *
 * Mirrors the subset of the SerialPort API used by the RTU transport layer:
 *   open, close, write, drain, flush, update, get, set, isOpen,
 *   and EventEmitter events ('open', 'close', 'error', 'data').
 */
class MockSerialPort extends EventEmitter {
  /**
   * @param {string|object} pathOrOptions - Serial port path or options object.
   * @param {object} [options] - Port options when first arg is a path string.
   */
  constructor(pathOrOptions, options = {}) {
    super();

    // Normalize constructor arguments (mirrors serialport overloads)
    if (typeof pathOrOptions === 'object' && pathOrOptions !== null) {
      options = pathOrOptions;
    } else if (typeof pathOrOptions === 'string') {
      options = { ...options, path: pathOrOptions };
    }

    this._options = { ...DEFAULT_OPTIONS, ...options };

    // Public state
    this.path = this._options.path;
    this.baudRate = this._options.baudRate;
    this.isOpen = false;
    this.opening = false;

    // Port settings (mirrors serialport properties)
    this.settings = {
      path: this._options.path,
      baudRate: this._options.baudRate,
      dataBits: this._options.dataBits,
      stopBits: this._options.stopBits,
      parity: this._options.parity,
      autoOpen: this._options.autoOpen
    };

    // Internal tracking for assertions
    this._writeCalls = [];
    this._drainCalls = 0;
    this._flushCalls = 0;
    this._bytesWritten = 0;
    this._bytesRead = 0;

    // Auto-open if configured (matches real serialport behaviour)
    if (this._options.autoOpen) {
      process.nextTick(() => this.open());
    }
  }

  /**
   * Simulate SerialPort#open().
   * @param {Function} [callback] - Optional callback(err).
   * @returns {void}
   */
  open(callback) {
    if (this.isOpen) {
      const err = new Error('Port is already open');
      if (typeof callback === 'function') return callback(err);
      this.emit('error', err);
      return;
    }

    this.opening = true;

    const finish = () => {
      this.opening = false;

      if (this._options.openShouldSucceed) {
        this.isOpen = true;
        if (typeof callback === 'function') callback(null);
        this.emit('open');
      } else {
        const err = new Error('Error: No such file or directory, cannot open ' + this.path);
        err.code = 'ENOENT';
        if (typeof callback === 'function') callback(err);
        this.emit('error', err);
      }
    };

    if (this._options.openDelay > 0) {
      setTimeout(finish, this._options.openDelay);
    } else {
      process.nextTick(finish);
    }
  }

  /**
   * Simulate SerialPort#close().
   * @param {Function} [callback] - Optional callback(err).
   * @returns {void}
   */
  close(callback) {
    if (!this.isOpen) {
      const err = new Error('Port is not open');
      if (typeof callback === 'function') return callback(err);
      this.emit('error', err);
      return;
    }

    process.nextTick(() => {
      this.isOpen = false;
      if (typeof callback === 'function') callback(null);
      this.emit('close');
    });
  }

  /**
   * Simulate SerialPort#write().
   * @param {Buffer|string} data - Data to write.
   * @param {string|Function} [encoding] - Encoding or callback.
   * @param {Function} [callback] - Optional callback(err).
   * @returns {boolean} Backpressure flag.
   */
  write(data, encoding, callback) {
    if (typeof encoding === 'function') {
      callback = encoding;
      encoding = undefined;
    }

    if (!this.isOpen) {
      const err = new Error('Port is not open');
      if (typeof callback === 'function') {
        process.nextTick(() => callback(err));
      }
      return false;
    }

    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, encoding);
    this._writeCalls.push(buf);
    this._bytesWritten += buf.length;

    if (!this._options.writeShouldSucceed) {
      const err = this._options.errorOnWrite || new Error('Write failed');
      process.nextTick(() => {
        if (typeof callback === 'function') callback(err);
        this.emit('error', err);
      });
      return false;
    }

    process.nextTick(() => {
      if (typeof callback === 'function') callback(null);
    });
    return true;
  }

  /**
   * Simulate SerialPort#drain().
   * @param {Function} [callback] - Optional callback(err).
   * @returns {void}
   */
  drain(callback) {
    this._drainCalls++;
    process.nextTick(() => {
      if (typeof callback === 'function') callback(null);
    });
  }

  /**
   * Simulate SerialPort#flush().
   * @param {Function} [callback] - Optional callback(err).
   * @returns {void}
   */
  flush(callback) {
    this._flushCalls++;
    process.nextTick(() => {
      if (typeof callback === 'function') callback(null);
    });
  }

  /**
   * Simulate SerialPort#update().
   * @param {object} newOptions - Options to update (e.g. { baudRate: 115200 }).
   * @param {Function} [callback] - Optional callback(err).
   * @returns {void}
   */
  update(newOptions, callback) {
    if (newOptions && newOptions.baudRate) {
      this.baudRate = newOptions.baudRate;
      this.settings.baudRate = newOptions.baudRate;
    }
    process.nextTick(() => {
      if (typeof callback === 'function') callback(null);
    });
  }

  /**
   * Simulate SerialPort#get().
   * Returns deterministic modem control flags.
   * @param {Function} [callback] - callback(err, status).
   * @returns {void}
   */
  get(callback) {
    // TEST-DATA: deterministic modem control flags
    const status = {
      cts: true,
      dsr: true,
      dcd: false
    };
    process.nextTick(() => {
      if (typeof callback === 'function') callback(null, status);
    });
  }

  /**
   * Simulate SerialPort#set().
   * @param {object} signals - Modem signals to set (e.g. { rts: true, dtr: true }).
   * @param {Function} [callback] - callback(err).
   * @returns {void}
   */
  set(signals, callback) {
    process.nextTick(() => {
      if (typeof callback === 'function') callback(null);
    });
  }

  // ---------------------------------------------------------------------------
  // Test helpers – not part of the serialport API
  // ---------------------------------------------------------------------------

  /**
   * Inject a data event as if the serial port received data.
   * @param {Buffer|string} data - Incoming data.
   */
  simulateData(data) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    this._bytesRead += buf.length;
    this.emit('data', buf);
  }

  /**
   * Inject a disconnect event (simulates physical cable removal).
   * @param {Error} [error] - Optional error object.
   */
  simulateDisconnect(error) {
    this.isOpen = false;
    const err = error || new Error('Serial port disconnected unexpectedly');
    err.code = err.code || 'ENXIO';
    this.emit('error', err);
    this.emit('close');
  }

  /**
   * Reset internal tracking counters (useful between test cases).
   */
  resetTracking() {
    this._writeCalls = [];
    this._drainCalls = 0;
    this._flushCalls = 0;
    this._bytesWritten = 0;
    this._bytesRead = 0;
  }
}

/**
 * Factory function that mirrors `require('serialport')` usage patterns.
 * Usage in tests: const { SerialPort } = require('../mocks/mock-serial-port');
 */
module.exports = {
  SerialPort: MockSerialPort,
  MockSerialPort
};
