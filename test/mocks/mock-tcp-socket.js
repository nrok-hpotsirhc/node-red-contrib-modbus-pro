'use strict';

/**
 * MOCK: Mock TCP Socket
 * SIMULATES: net.Socket for TCP transport unit tests
 * USED IN: test/unit/transport/tcp-transport.test.js
 * LAST UPDATED: 2026-04-16
 * REMOVABLE: no – required for TCP transport unit tests
 * DEPENDENCIES: none
 */

const { EventEmitter } = require('events');

/**
 * Configuration defaults for MockTcpSocket.
 * Override via the options parameter in the constructor.
 */
const DEFAULT_OPTIONS = {
  connectShouldSucceed: true,
  connectDelay: 0,
  writeShouldSucceed: true,
  errorOnWrite: null,
  remoteAddress: '127.0.0.1',
  remotePort: 502
};

/**
 * MockTcpSocket – deterministic mock for net.Socket.
 *
 * Mirrors the subset of the net.Socket API used by the TCP transport layer:
 *   connect, write, end, destroy, setTimeout, setKeepAlive,
 *   setNoDelay, ref, unref, and EventEmitter events.
 */
class MockTcpSocket extends EventEmitter {
  /**
   * @param {object} [options] - Override defaults (see DEFAULT_OPTIONS).
   */
  constructor(options = {}) {
    super();

    this._options = { ...DEFAULT_OPTIONS, ...options };

    // Public state properties (mirrors net.Socket)
    this.connecting = false;
    this.destroyed = false;
    this.readable = true;
    this.writable = true;
    this.remoteAddress = this._options.remoteAddress;
    this.remotePort = this._options.remotePort;
    this.localAddress = '127.0.0.1';
    this.localPort = 0;
    this.bytesRead = 0;
    this.bytesWritten = 0;
    this.pending = true;

    // Internal tracking for assertions
    this._connectCalls = [];
    this._writeCalls = [];
    this._ended = false;
    this._timeoutMs = 0;
    this._keepAlive = false;
    this._noDelay = false;
  }

  /**
   * Simulate net.Socket#connect().
   * @param {number|object} portOrOptions - Port number or { port, host }.
   * @param {string} [host] - Host string when first arg is a port number.
   * @param {Function} [callback] - Optional connect callback.
   * @returns {MockTcpSocket} this
   */
  connect(portOrOptions, host, callback) {
    // Normalize arguments (mirrors net.Socket overloads)
    let port;
    if (typeof portOrOptions === 'object') {
      port = portOrOptions.port;
      host = portOrOptions.host || '127.0.0.1';
      callback = typeof host === 'function' ? host : callback;
    } else {
      port = portOrOptions;
      if (typeof host === 'function') {
        callback = host;
        host = '127.0.0.1';
      }
      host = host || '127.0.0.1';
    }

    this._connectCalls.push({ port, host });
    this.connecting = true;
    this.pending = true;

    const finish = () => {
      if (this._options.connectShouldSucceed) {
        this.connecting = false;
        this.pending = false;
        this.remoteAddress = host;
        this.remotePort = port;
        if (typeof callback === 'function') callback();
        this.emit('connect');
      } else {
        this.connecting = false;
        const err = new Error('ECONNREFUSED: Connection refused');
        err.code = 'ECONNREFUSED';
        err.address = host;
        err.port = port;
        this.emit('error', err);
      }
    };

    if (this._options.connectDelay > 0) {
      setTimeout(finish, this._options.connectDelay);
    } else {
      process.nextTick(finish);
    }

    return this;
  }

  /**
   * Simulate net.Socket#write().
   * @param {Buffer|string} data - Data to write.
   * @param {string|Function} [encoding] - Encoding or callback.
   * @param {Function} [callback] - Optional callback.
   * @returns {boolean} Backpressure flag.
   */
  write(data, encoding, callback) {
    if (typeof encoding === 'function') {
      callback = encoding;
      encoding = undefined;
    }

    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, encoding);
    this._writeCalls.push(buf);
    this.bytesWritten += buf.length;

    if (!this._options.writeShouldSucceed) {
      const err = this._options.errorOnWrite || new Error('EPIPE: Broken pipe');
      err.code = err.code || 'EPIPE';
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
   * Simulate net.Socket#end().
   * @param {Buffer|string} [data] - Optional final data to write.
   * @param {string} [encoding] - Encoding for the final data.
   * @param {Function} [callback] - Callback once the socket is fully closed.
   * @returns {MockTcpSocket} this
   */
  end(data, encoding, callback) {
    if (typeof data === 'function') {
      callback = data;
      data = undefined;
    }
    if (typeof encoding === 'function') {
      callback = encoding;
      encoding = undefined;
    }

    if (data !== undefined) {
      this.write(data, encoding);
    }

    this._ended = true;
    this.writable = false;

    process.nextTick(() => {
      this.readable = false;
      if (typeof callback === 'function') callback();
      this.emit('end');
      this.emit('close', false);
    });

    return this;
  }

  /**
   * Simulate net.Socket#destroy().
   * @param {Error} [error] - Optional error to emit.
   * @returns {MockTcpSocket} this
   */
  destroy(error) {
    if (this.destroyed) return this;

    this.destroyed = true;
    this.readable = false;
    this.writable = false;
    this.connecting = false;

    process.nextTick(() => {
      if (error) this.emit('error', error);
      this.emit('close', !!error);
    });

    return this;
  }

  /**
   * Simulate net.Socket#setTimeout().
   * @param {number} timeout - Timeout in milliseconds.
   * @param {Function} [callback] - Optional timeout callback.
   * @returns {MockTcpSocket} this
   */
  setTimeout(timeout, callback) {
    this._timeoutMs = timeout;
    if (typeof callback === 'function') {
      this.once('timeout', callback);
    }
    return this;
  }

  /**
   * Simulate net.Socket#setKeepAlive().
   * @param {boolean} [enable=false]
   * @param {number} [initialDelay=0]
   * @returns {MockTcpSocket} this
   */
  setKeepAlive(enable = false, initialDelay = 0) {
    this._keepAlive = enable;
    this._keepAliveDelay = initialDelay;
    return this;
  }

  /**
   * Simulate net.Socket#setNoDelay().
   * @param {boolean} [noDelay=true]
   * @returns {MockTcpSocket} this
   */
  setNoDelay(noDelay = true) {
    this._noDelay = noDelay;
    return this;
  }

  /** Simulate net.Socket#ref(). */
  ref() {
    return this;
  }

  /** Simulate net.Socket#unref(). */
  unref() {
    return this;
  }

  /** Simulate net.Socket#address(). */
  address() {
    return {
      port: this.localPort,
      family: 'IPv4',
      address: this.localAddress
    };
  }

  // ---------------------------------------------------------------------------
  // Test helpers – not part of net.Socket API
  // ---------------------------------------------------------------------------

  /**
   * Inject a data event as if the remote end sent data.
   * @param {Buffer|string} data - Incoming data.
   */
  simulateData(data) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    this.bytesRead += buf.length;
    this.emit('data', buf);
  }

  /**
   * Inject a remote-initiated close.
   * @param {boolean} [hadError=false]
   */
  simulateRemoteClose(hadError = false) {
    this.readable = false;
    this.writable = false;
    this.emit('end');
    this.emit('close', hadError);
  }

  /**
   * Inject a timeout event.
   */
  simulateTimeout() {
    this.emit('timeout');
  }

  /**
   * Reset internal tracking counters (useful between test cases).
   */
  resetTracking() {
    this._connectCalls = [];
    this._writeCalls = [];
    this._ended = false;
    this.bytesRead = 0;
    this.bytesWritten = 0;
  }
}

module.exports = MockTcpSocket;
