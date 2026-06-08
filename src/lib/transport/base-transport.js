'use strict';

const EventEmitter = require('events');
const ModbusRTU = require('modbus-serial');

/**
 * Timeout in ms before forcing disconnect if close callback hangs.
 */
const DISCONNECT_TIMEOUT = 10000;

/**
 * Modbus protocol limits per specification V1.1b3.
 */
const MODBUS_LIMITS = {
  MIN_ADDRESS: 0,
  MAX_ADDRESS: 65535,
  MIN_UNIT_ID: 0,
  MAX_UNIT_ID: 255,
  MAX_READ_REGISTERS: 125,
  MAX_READ_COILS: 2000,
  MAX_WRITE_REGISTERS: 123,
  MAX_WRITE_COILS: 1968,
  MAX_FC23_WRITE_REGISTERS: 121
};

/**
 * Abstract base class for Modbus transport implementations.
 *
 * Provides the shared interface for TCP and RTU transports including
 * all Modbus read/write operations, input validation, connection
 * lifecycle management, and event emission.
 *
 * Subclasses must implement:
 *   - get type()   → transport type identifier string
 *   - connect()    → establish the underlying connection
 *
 * Emits lifecycle events: 'connect', 'disconnect', 'error'.
 *
 * @extends EventEmitter
 */
class BaseTransport extends EventEmitter {
  /**
   * @param {object} config - Merged transport configuration (defaults + user overrides).
   */
  constructor(config) {
    super();
    this._config = config;
    this._client = new ModbusRTU();
    this._connected = false;

    this._client.on('close', () => this._handleDisconnect());
    this._client.on('error', (err) => this._emitError(err));
  }

  /**
   * Returns the transport type identifier.
   * Must be overridden by subclasses.
   * @returns {string}
   */
  get type() {
    throw new Error('BaseTransport: subclass must implement type getter');
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
   * @param {number} id - Unit/slave ID (0-255).
   * @throws {RangeError} If id is outside valid range.
   */
  setID(id) {
    if (typeof id !== 'number' || !Number.isInteger(id) ||
        id < MODBUS_LIMITS.MIN_UNIT_ID || id > MODBUS_LIMITS.MAX_UNIT_ID) {
      throw new RangeError(
        `Unit ID must be an integer between ${MODBUS_LIMITS.MIN_UNIT_ID} and ${MODBUS_LIMITS.MAX_UNIT_ID}, got: ${id}`
      );
    }
    this._client.setID(id);
  }

  // -- Read operations --

  /**
   * Read holding registers (FC 03).
   * @param {number} address - Starting register address (0-65535).
   * @param {number} length - Number of registers to read (1-125).
   * @returns {Promise<{data: number[], buffer: Buffer}>}
   */
  async readHoldingRegisters(address, length) {
    this._assertConnected();
    this._validateReadParams(address, length, MODBUS_LIMITS.MAX_READ_REGISTERS);
    return this._client.readHoldingRegisters(address, length);
  }

  /**
   * Read coils (FC 01).
   * @param {number} address - Starting coil address (0-65535).
   * @param {number} length - Number of coils to read (1-2000).
   * @returns {Promise<{data: boolean[], buffer: Buffer}>}
   */
  async readCoils(address, length) {
    this._assertConnected();
    this._validateReadParams(address, length, MODBUS_LIMITS.MAX_READ_COILS);
    return this._client.readCoils(address, length);
  }

  /**
   * Read discrete inputs (FC 02).
   * @param {number} address - Starting input address (0-65535).
   * @param {number} length - Number of inputs to read (1-2000).
   * @returns {Promise<{data: boolean[], buffer: Buffer}>}
   */
  async readDiscreteInputs(address, length) {
    this._assertConnected();
    this._validateReadParams(address, length, MODBUS_LIMITS.MAX_READ_COILS);
    return this._client.readDiscreteInputs(address, length);
  }

  /**
   * Read input registers (FC 04).
   * @param {number} address - Starting register address (0-65535).
   * @param {number} length - Number of registers to read (1-125).
   * @returns {Promise<{data: number[], buffer: Buffer}>}
   */
  async readInputRegisters(address, length) {
    this._assertConnected();
    this._validateReadParams(address, length, MODBUS_LIMITS.MAX_READ_REGISTERS);
    return this._client.readInputRegisters(address, length);
  }

  // -- Write operations --

  /**
   * Write a single coil (FC 05).
   * @param {number} address - Coil address (0-65535).
   * @param {boolean} value - Coil value.
   * @returns {Promise<void>}
   */
  async writeCoil(address, value) {
    this._assertConnected();
    this._validateAddress(address);
    return this._client.writeCoil(address, value);
  }

  /**
   * Write a single holding register (FC 06).
   * @param {number} address - Register address (0-65535).
   * @param {number} value - Register value.
   * @returns {Promise<void>}
   */
  async writeRegister(address, value) {
    this._assertConnected();
    this._validateAddress(address);
    return this._client.writeRegister(address, value);
  }

  /**
   * Write multiple coils (FC 15).
   * @param {number} address - Starting coil address (0-65535).
   * @param {boolean[]} values - Array of coil values (max 1968).
   * @returns {Promise<void>}
   */
  async writeCoils(address, values) {
    this._assertConnected();
    this._validateAddress(address);
    this._validateWriteArray(values, MODBUS_LIMITS.MAX_WRITE_COILS, 'coils');
    return this._client.writeCoils(address, values);
  }

  /**
   * Write multiple holding registers (FC 16).
   * @param {number} address - Starting register address (0-65535).
   * @param {number[]} values - Array of register values (max 123).
   * @returns {Promise<void>}
   */
  async writeRegisters(address, values) {
    this._assertConnected();
    this._validateAddress(address);
    this._validateWriteArray(values, MODBUS_LIMITS.MAX_WRITE_REGISTERS, 'registers');
    return this._client.writeRegisters(address, values);
  }

  // -- Extended function codes --

  /**
   * Mask write a holding register (FC 22).
   * Atomic operation: result = (current AND andMask) OR (orMask AND NOT andMask)
   * @param {number} address - Register address (0-65535).
   * @param {number} andMask - AND bitmask (0x0000-0xFFFF).
   * @param {number} orMask - OR bitmask (0x0000-0xFFFF).
   * @returns {Promise<{address: number, andMask: number, orMask: number}>}
   */
  async maskWriteRegister(address, andMask, orMask) {
    this._assertConnected();
    this._validateAddress(address);
    this._validateMask(andMask, 'AND mask');
    this._validateMask(orMask, 'OR mask');
    return this._client.maskWriteRegister(address, andMask, orMask);
  }

  /**
   * Read/write multiple registers in a single transaction (FC 23).
   * Write is executed first, then read is performed.
   * @param {number} readAddress - Starting read register address (0-65535).
   * @param {number} readLength - Number of registers to read (1-125).
   * @param {number} writeAddress - Starting write register address (0-65535).
   * @param {number[]} writeValues - Register values to write (max 121).
   * @returns {Promise<{data: number[], buffer: Buffer}>}
   */
  async readWriteRegisters(readAddress, readLength, writeAddress, writeValues) {
    this._assertConnected();
    this._validateReadParams(readAddress, readLength, MODBUS_LIMITS.MAX_READ_REGISTERS);
    this._validateAddress(writeAddress);
    this._validateWriteArray(writeValues, MODBUS_LIMITS.MAX_FC23_WRITE_REGISTERS, 'FC23 registers');
    return this._client.writeFC23(readAddress, readLength, writeAddress, writeValues.length, writeValues);
  }

  /**
   * Read device identification (FC 43/14 - MEI Transport).
   * @param {number} deviceIdCode - Read device ID code (1-4).
   * @param {number} [objectId=0] - Starting object ID.
   * @returns {Promise<{data: string[], conformityLevel: number}>}
   */
  async readDeviceIdentification(deviceIdCode, objectId) {
    this._assertConnected();
    if (typeof deviceIdCode !== 'number' || !Number.isInteger(deviceIdCode) ||
        deviceIdCode < 1 || deviceIdCode > 4) {
      throw new RangeError('Device ID code must be 1-4, got: ' + deviceIdCode);
    }
    const oid = (objectId !== undefined && objectId !== null) ? objectId : 0;
    if (typeof oid !== 'number' || !Number.isInteger(oid) || oid < 0 || oid > 255) {
      throw new RangeError('Object ID must be 0-255, got: ' + oid);
    }
    return this._client.readDeviceIdentification(deviceIdCode, oid);
  }

  /**
   * Disconnect from the Modbus device.
   * Properly awaits the close callback before resolving.
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (!this._connected) {
      return;
    }

    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this._handleDisconnect();
          resolve();
        }, DISCONNECT_TIMEOUT);

        this._client.close((err) => {
          clearTimeout(timer);
          if (err) reject(err);
          else resolve();
        });
      });
    } catch (err) {
      this._emitError(err);
      throw err;
    } finally {
      this._handleDisconnect();
    }
  }

  /**
   * Destroy the transport, removing all listeners and closing the connection.
   * @returns {Promise<void>}
   */
  async destroy() {
    try {
      await this.disconnect();
    } catch (_err) {
      // Ignore close errors during destroy – cleanup must complete
    }
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
      throw new Error(`${this.constructor.name}: not connected`);
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

  /**
   * Emit an error only when consumers are listening.
   * @param {Error} err
   * @private
   */
  _emitError(err) {
    if (this.listenerCount('error') > 0) {
      this.emit('error', err);
    }
  }

  /**
   * Validate a Modbus address.
   * @param {number} address
   * @throws {RangeError}
   * @private
   */
  _validateAddress(address) {
    if (typeof address !== 'number' || !Number.isInteger(address) ||
        address < MODBUS_LIMITS.MIN_ADDRESS || address > MODBUS_LIMITS.MAX_ADDRESS) {
      throw new RangeError(
        `Address must be an integer between ${MODBUS_LIMITS.MIN_ADDRESS} and ${MODBUS_LIMITS.MAX_ADDRESS}, got: ${address}`
      );
    }
  }

  /**
   * Validate address and length for read operations.
   * @param {number} address
   * @param {number} length
   * @param {number} maxLength
   * @throws {RangeError}
   * @private
   */
  _validateReadParams(address, length, maxLength) {
    this._validateAddress(address);
    if (typeof length !== 'number' || !Number.isInteger(length) ||
        length < 1 || length > maxLength) {
      throw new RangeError(
        `Read length must be an integer between 1 and ${maxLength}, got: ${length}`
      );
    }
  }

  /**
   * Validate a values array for write-multiple operations.
   * @param {Array} values
   * @param {number} maxLength
   * @param {string} label - Description for error messages.
   * @throws {RangeError}
   * @private
   */
  _validateWriteArray(values, maxLength, label) {
    if (!Array.isArray(values) || values.length === 0 || values.length > maxLength) {
      throw new RangeError(
        `Write ${label} count must be 1-${maxLength}, got: ${Array.isArray(values) ? values.length : 'non-array'}`
      );
    }
  }

  /**
   * Validate a 16-bit bitmask value for FC 22 operations.
   * @param {number} value
   * @param {string} label - Description for error messages (e.g. 'AND mask').
   * @throws {RangeError}
   * @private
   */
  _validateMask(value, label) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0xFFFF) {
      throw new RangeError(
        `${label} must be an integer between 0x0000 and 0xFFFF, got: ${value}`
      );
    }
  }
}

module.exports = BaseTransport;
module.exports.MODBUS_LIMITS = MODBUS_LIMITS;
