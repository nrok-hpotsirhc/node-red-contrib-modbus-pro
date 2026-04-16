'use strict';

const EventEmitter = require('events');
const ModbusRTU = require('modbus-serial');

/**
 * Check whether the serialport package is available.
 * This allows RTU transport to degrade gracefully on systems
 * without RS-485 hardware (e.g. cloud containers).
 * @returns {boolean}
 */
function isSerialPortAvailable() {
  try {
    require.resolve('serialport');
    return true;
  } catch (_err) {
    return false;
  }
}

/**
 * Default configuration for RTU transport.
 */
const RTU_DEFAULTS = {
  serialPort: '/dev/ttyUSB0',
  baudRate: 9600,
  parity: 'none',
  dataBits: 8,
  stopBits: 1,
  unitId: 1,
  timeout: 5000
};

/**
 * RTU serial transport abstraction wrapping modbus-serial's RTU connectivity.
 *
 * Provides the same unified interface as TcpTransport for interchangeable use.
 * If the `serialport` package is not installed, all connection attempts will
 * fail gracefully with descriptive errors instead of crashing.
 *
 * Emits lifecycle events: 'connect', 'disconnect', 'error'.
 *
 * @extends EventEmitter
 */
class RtuTransport extends EventEmitter {
  /**
   * @param {object} config - Transport configuration.
   * @param {string} [config.serialPort='/dev/ttyUSB0'] - Serial port path.
   * @param {number} [config.baudRate=9600] - Baud rate.
   * @param {string} [config.parity='none'] - Parity: 'none', 'even', 'odd'.
   * @param {number} [config.dataBits=8] - Data bits: 7 or 8.
   * @param {number} [config.stopBits=1] - Stop bits: 1 or 2.
   * @param {number} [config.unitId=1] - Modbus unit/slave ID.
   * @param {number} [config.timeout=5000] - Response timeout in milliseconds.
   */
  constructor(config = {}) {
    super();
    this._config = { ...RTU_DEFAULTS, ...config };
    this._client = new ModbusRTU();
    this._connected = false;
    this._serialAvailable = isSerialPortAvailable();

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
    return 'rtu';
  }

  /**
   * Whether the serialport package is installed and RTU is available.
   * @returns {boolean}
   */
  get serialAvailable() {
    return this._serialAvailable;
  }

  /**
   * Connect to the Modbus RTU device via serial port.
   * @returns {Promise<void>}
   * @throws {Error} If serialport is not installed.
   */
  async connect() {
    if (this._connected) {
      return;
    }

    if (!this._serialAvailable) {
      const err = new Error(
        'RtuTransport: serialport package is not installed. ' +
        'RTU transport is unavailable. Install with: npm install serialport'
      );
      this.emit('error', err);
      throw err;
    }

    try {
      await this._client.connectRTUBuffered(this._config.serialPort, {
        baudRate: this._config.baudRate,
        parity: this._config.parity,
        dataBits: this._config.dataBits,
        stopBits: this._config.stopBits
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
   * Disconnect from the serial port.
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
   * Check whether the underlying serial connection is open.
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
      throw new Error('RtuTransport: not connected');
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

/**
 * Exported utility for checking serialport availability.
 */
RtuTransport.isSerialPortAvailable = isSerialPortAvailable;

module.exports = RtuTransport;
