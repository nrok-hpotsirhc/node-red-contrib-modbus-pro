'use strict';

const EventEmitter = require('events');
const ModbusRTU = require('modbus-serial');

/**
 * Default configuration for TCP transport.
 */
const TCP_DEFAULTS = {
  host: '127.0.0.1',
  port: 502,
  timeout: 5000,
  unitId: 1
};

/**
 * TCP transport abstraction wrapping modbus-serial's TCP connectivity.
 *
 * Provides a unified interface for Modbus TCP communication and emits
 * lifecycle events: 'connect', 'disconnect', 'error'.
 *
 * @extends EventEmitter
 */
class TcpTransport extends EventEmitter {
  /**
   * @param {object} config - Transport configuration.
   * @param {string} [config.host='127.0.0.1'] - Target host IP or hostname.
   * @param {number} [config.port=502] - Target TCP port.
   * @param {number} [config.timeout=5000] - Response timeout in milliseconds.
   * @param {number} [config.unitId=1] - Modbus unit/slave ID.
   */
  constructor(config = {}) {
    super();
    this._config = { ...TCP_DEFAULTS, ...config };
    this._client = new ModbusRTU();
    this._connected = false;

    this._client.on('close', () => {
      this._handleDisconnect();
    });

    this._client.on('error', (err) => {
      this.emit('error', err);
    });
  }

  /**
   * Returns the transport type identifier.
   * @returns {string}
   */
  get type() {
    return 'tcp';
  }

  /**
   * Connect to the Modbus TCP device.
   * @returns {Promise<void>}
   */
  async connect() {
    if (this._connected) {
      return;
    }

    try {
      await this._client.connectTCP(this._config.host, {
        port: this._config.port
      });
      this._client.setID(this._config.unitId);
      this._client.setTimeout(this._config.timeout);
      this._connected = true;
      this.emit('connect');
    } catch (err) {
      this._connected = false;
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Disconnect from the Modbus TCP device.
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (!this._connected) {
      return;
    }

    try {
      this._client.close(() => {});
      this._handleDisconnect();
    } catch (err) {
      this._connected = false;
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * Check whether the underlying connection is open.
   * @returns {boolean}
   */
  isOpen() {
    return this._connected && this._client.isOpen;
  }

  /**
   * Get the current Modbus unit/slave ID.
   * @returns {number}
   */
  getID() {
    return this._client.getID();
  }

  /**
   * Set the Modbus unit/slave ID for subsequent requests.
   * @param {number} id - Unit/slave ID (1-247).
   */
  setID(id) {
    this._client.setID(id);
  }

  // -- Read operations --

  /**
   * Read holding registers (FC 03).
   * @param {number} address - Starting register address.
   * @param {number} length - Number of registers to read.
   * @returns {Promise<{data: number[], buffer: Buffer}>}
   */
  async readHoldingRegisters(address, length) {
    this._assertConnected();
    return this._client.readHoldingRegisters(address, length);
  }

  /**
   * Read coils (FC 01).
   * @param {number} address - Starting coil address.
   * @param {number} length - Number of coils to read.
   * @returns {Promise<{data: boolean[], buffer: Buffer}>}
   */
  async readCoils(address, length) {
    this._assertConnected();
    return this._client.readCoils(address, length);
  }

  /**
   * Read discrete inputs (FC 02).
   * @param {number} address - Starting input address.
   * @param {number} length - Number of inputs to read.
   * @returns {Promise<{data: boolean[], buffer: Buffer}>}
   */
  async readDiscreteInputs(address, length) {
    this._assertConnected();
    return this._client.readDiscreteInputs(address, length);
  }

  /**
   * Read input registers (FC 04).
   * @param {number} address - Starting register address.
   * @param {number} length - Number of registers to read.
   * @returns {Promise<{data: number[], buffer: Buffer}>}
   */
  async readInputRegisters(address, length) {
    this._assertConnected();
    return this._client.readInputRegisters(address, length);
  }

  // -- Write operations --

  /**
   * Write a single coil (FC 05).
   * @param {number} address - Coil address.
   * @param {boolean} value - Coil value.
   * @returns {Promise<void>}
   */
  async writeCoil(address, value) {
    this._assertConnected();
    return this._client.writeCoil(address, value);
  }

  /**
   * Write a single holding register (FC 06).
   * @param {number} address - Register address.
   * @param {number} value - Register value.
   * @returns {Promise<void>}
   */
  async writeRegister(address, value) {
    this._assertConnected();
    return this._client.writeRegister(address, value);
  }

  /**
   * Write multiple coils (FC 15).
   * @param {number} address - Starting coil address.
   * @param {boolean[]} values - Array of coil values.
   * @returns {Promise<void>}
   */
  async writeCoils(address, values) {
    this._assertConnected();
    return this._client.writeCoils(address, values);
  }

  /**
   * Write multiple holding registers (FC 16).
   * @param {number} address - Starting register address.
   * @param {number[]} values - Array of register values.
   * @returns {Promise<void>}
   */
  async writeRegisters(address, values) {
    this._assertConnected();
    return this._client.writeRegisters(address, values);
  }

  /**
   * Destroy the transport, removing all listeners and closing the connection.
   * @returns {Promise<void>}
   */
  async destroy() {
    await this.disconnect();
    this._client.removeAllListeners();
    this.removeAllListeners();
  }

  // -- Internal helpers --

  /**
   * Assert that the transport is connected before performing an operation.
   * @throws {Error} If not connected.
   * @private
   */
  _assertConnected() {
    if (!this._connected) {
      throw new Error('TcpTransport: not connected');
    }
  }

  /**
   * Handle disconnect state transition and emit event.
   * @private
   */
  _handleDisconnect() {
    if (this._connected) {
      this._connected = false;
      this.emit('disconnect');
    }
  }
}

module.exports = TcpTransport;
