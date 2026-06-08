'use strict';

const BaseTransport = require('./base-transport');

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
 * @extends BaseTransport
 */
class RtuTransport extends BaseTransport {
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
    super({ ...RTU_DEFAULTS, ...config });
    this._serialAvailable = isSerialPortAvailable();
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
      this._emitError(err);
      throw err;
    }

    try {
      await this._client.connectRTUBuffered(this._config.serialPort, {
        baudRate: this._config.baudRate,
        parity: this._config.parity,
        dataBits: this._config.dataBits,
        stopBits: this._config.stopBits
      });
      this.setID(this._config.unitId);
      this._client.setTimeout(this._config.timeout);
      this._connected = true;
      this.emit('connect');
    } catch (err) {
      this._connected = false;
      this._emitError(err);
      throw err;
    }
  }
}

/**
 * Exported utility for checking serialport availability.
 */
RtuTransport.isSerialPortAvailable = isSerialPortAvailable;

module.exports = RtuTransport;
