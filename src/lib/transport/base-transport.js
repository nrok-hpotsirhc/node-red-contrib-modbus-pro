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

  // -- Diagnostic / legacy serial-line function codes (MS-10 / WP 6.3, 6.4) --

  /**
   * Read Exception Status (FC 07).
   * Returns an 8-bit byte mapped to 8 device-specific exception/alarm bits.
   * Defined for serial line only; many TCP-to-RTU gateways still forward it.
   * Implemented via modbus-serial's `customFunction()` because the library
   * does not expose a typed wrapper.
   *
   * @returns {Promise<{statusByte: number, bits: boolean[], buffer: Buffer}>}
   */
  async readExceptionStatus() {
    this._assertConnected();
    const result = await this._client.customFunction(0x07, []);
    const buf = (result && result.buffer) ? result.buffer : Buffer.alloc(0);
    const statusByte = buf.length > 0 ? buf[0] : 0;
    const bits = [];
    for (let i = 0; i < 8; i++) {
      bits.push(((statusByte >> i) & 0x01) === 1);
    }
    return { statusByte, bits, buffer: buf };
  }

  /**
   * Diagnostics (FC 08). Multiplexed via 16-bit sub-function codes.
   * Common sub-functions:
   *   0x0000 Return Query Data (loopback)
   *   0x0001 Restart Communications Option
   *   0x0002 Return Diagnostic Register
   *   0x000A Clear Counters and Diagnostic Register
   *   0x000B–0x0012 various counter retrievals
   *
   * @param {number} subFunction - Sub-function code (0..0xFFFF).
   * @param {number} [data=0] - 16-bit data field (default 0x0000).
   * @returns {Promise<{subFunction: number, data: number, buffer: Buffer}>}
   */
  async diagnostics(subFunction, data) {
    this._assertConnected();
    if (typeof subFunction !== 'number' || !Number.isInteger(subFunction) ||
        subFunction < 0 || subFunction > 0xFFFF) {
      throw new RangeError(`Sub-function must be 0x0000–0xFFFF, got: ${subFunction}`);
    }
    const dataField = (data === undefined || data === null) ? 0 : data;
    if (typeof dataField !== 'number' || !Number.isInteger(dataField) ||
        dataField < 0 || dataField > 0xFFFF) {
      throw new RangeError(`Data field must be 0x0000–0xFFFF, got: ${dataField}`);
    }
    const request = [
      (subFunction >> 8) & 0xFF, subFunction & 0xFF,
      (dataField >> 8) & 0xFF, dataField & 0xFF
    ];
    const result = await this._client.customFunction(0x08, request);
    const buf = (result && result.buffer) ? result.buffer : Buffer.alloc(0);
    // Response echoes sub-function (2 bytes) + data (2 bytes)
    let subResp = subFunction;
    let dataResp = dataField;
    if (buf.length >= 4) {
      subResp = (buf[0] << 8) | buf[1];
      dataResp = (buf[2] << 8) | buf[3];
    } else if (buf.length >= 2) {
      dataResp = (buf[0] << 8) | buf[1];
    }
    return { subFunction: subResp, data: dataResp, buffer: buf };
  }

  /**
   * Get Comm Event Counter (FC 11).
   * @returns {Promise<{status: number, eventCount: number, buffer: Buffer}>}
   */
  async getCommEventCounter() {
    this._assertConnected();
    const result = await this._client.customFunction(0x0B, []);
    const buf = (result && result.buffer) ? result.buffer : Buffer.alloc(0);
    let status = 0, eventCount = 0;
    if (buf.length >= 4) {
      status = (buf[0] << 8) | buf[1];
      eventCount = (buf[2] << 8) | buf[3];
    }
    return { status, eventCount, buffer: buf };
  }

  /**
   * Get Comm Event Log (FC 12).
   * @returns {Promise<{
   *   status: number, eventCount: number, messageCount: number,
   *   events: number[], buffer: Buffer
   * }>}
   */
  async getCommEventLog() {
    this._assertConnected();
    const result = await this._client.customFunction(0x0C, []);
    const buf = (result && result.buffer) ? result.buffer : Buffer.alloc(0);
    let status = 0, eventCount = 0, messageCount = 0;
    let events = [];
    // Response: byteCount(1) + status(2) + eventCount(2) + messageCount(2) + events[]
    if (buf.length >= 1) {
      const byteCount = buf[0];
      if (buf.length >= 1 + Math.min(byteCount, 6)) {
        status = (buf[1] << 8) | buf[2];
        eventCount = (buf[3] << 8) | buf[4];
        messageCount = (buf[5] << 8) | buf[6];
        const eventsStart = 7;
        const eventsLen = Math.max(0, byteCount - 6);
        for (let i = 0; i < eventsLen && eventsStart + i < buf.length; i++) {
          events.push(buf[eventsStart + i]);
        }
      }
    }
    return { status, eventCount, messageCount, events, buffer: buf };
  }

  /**
   * Report Server ID (FC 17). Returns device-specific identification bytes.
   * Uses modbus-serial's native `reportServerID()` API.
   * @returns {Promise<{serverId: number, running: boolean, additionalData: Buffer, buffer: Buffer}>}
   */
  async reportServerID() {
    this._assertConnected();
    const result = await this._client.reportServerID();
    return {
      serverId: (result && typeof result.serverId === 'number') ? result.serverId : 0,
      running: !!(result && result.running),
      additionalData: (result && result.additionalData) ? result.additionalData : Buffer.alloc(0),
      buffer: (result && result.buffer) ? result.buffer : Buffer.alloc(0)
    };
  }

  /**
   * Read File Record (FC 20). Reads one or more sub-records from the device's
   * extended file memory area.
   *
   * @param {Array<{fileNumber: number, recordNumber: number, recordLength: number}>} subRequests
   * @returns {Promise<{records: number[][], buffer: Buffer}>}
   */
  async readFileRecord(subRequests) {
    this._assertConnected();
    this._validateFileSubRequests(subRequests, false);
    const request = [];
    for (const r of subRequests) {
      request.push(0x06); // Reference Type, always 0x06
      request.push((r.fileNumber >> 8) & 0xFF, r.fileNumber & 0xFF);
      request.push((r.recordNumber >> 8) & 0xFF, r.recordNumber & 0xFF);
      request.push((r.recordLength >> 8) & 0xFF, r.recordLength & 0xFF);
    }
    const result = await this._client.customFunction(0x14, request);
    const buf = (result && result.buffer) ? result.buffer : Buffer.alloc(0);
    return { records: this._parseFileRecordResponse(buf), buffer: buf };
  }

  /**
   * Write File Record (FC 21).
   *
   * @param {Array<{
   *   fileNumber: number,
   *   recordNumber: number,
   *   values: number[]
   * }>} subRequests
   * @returns {Promise<{buffer: Buffer}>}
   */
  async writeFileRecord(subRequests) {
    this._assertConnected();
    this._validateFileSubRequests(subRequests, true);
    const request = [];
    for (const r of subRequests) {
      request.push(0x06);
      request.push((r.fileNumber >> 8) & 0xFF, r.fileNumber & 0xFF);
      request.push((r.recordNumber >> 8) & 0xFF, r.recordNumber & 0xFF);
      request.push((r.values.length >> 8) & 0xFF, r.values.length & 0xFF);
      for (const v of r.values) {
        request.push((v >> 8) & 0xFF, v & 0xFF);
      }
    }
    const result = await this._client.customFunction(0x15, request);
    const buf = (result && result.buffer) ? result.buffer : Buffer.alloc(0);
    return { buffer: buf };
  }

  /**
   * Read FIFO Queue (FC 24). Returns up to 31 register values associated with
   * the given pointer address.
   *
   * @param {number} fifoPointerAddress - Address of the FIFO pointer register.
   * @returns {Promise<{count: number, values: number[], buffer: Buffer}>}
   */
  async readFifoQueue(fifoPointerAddress) {
    this._assertConnected();
    this._validateAddress(fifoPointerAddress);
    const request = [
      (fifoPointerAddress >> 8) & 0xFF, fifoPointerAddress & 0xFF
    ];
    const result = await this._client.customFunction(0x18, request);
    const buf = (result && result.buffer) ? result.buffer : Buffer.alloc(0);
    let count = 0;
    const values = [];
    // Response: byteCount(2) + fifoCount(2) + values[]*2
    if (buf.length >= 4) {
      count = (buf[2] << 8) | buf[3];
      if (count > 31) count = 31;
      for (let i = 0; i < count; i++) {
        const off = 4 + i * 2;
        if (off + 1 >= buf.length) break;
        values.push((buf[off] << 8) | buf[off + 1]);
      }
    }
    return { count, values, buffer: buf };
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

  /**
   * Validate sub-requests for FC 20 / 21 (file record access).
   * @param {Array<object>} subRequests
   * @param {boolean} requireValues - Whether each entry must include a values array.
   * @throws {RangeError|TypeError}
   * @private
   */
  _validateFileSubRequests(subRequests, requireValues) {
    if (!Array.isArray(subRequests) || subRequests.length === 0) {
      throw new TypeError('subRequests must be a non-empty array');
    }
    for (let i = 0; i < subRequests.length; i++) {
      const r = subRequests[i];
      if (!r || typeof r !== 'object') {
        throw new TypeError(`subRequests[${i}] must be an object`);
      }
      if (!Number.isInteger(r.fileNumber) || r.fileNumber < 1 || r.fileNumber > 0xFFFF) {
        throw new RangeError(`subRequests[${i}].fileNumber must be 1..65535, got: ${r.fileNumber}`);
      }
      if (!Number.isInteger(r.recordNumber) || r.recordNumber < 0 || r.recordNumber > 0x270F) {
        throw new RangeError(`subRequests[${i}].recordNumber must be 0..9999, got: ${r.recordNumber}`);
      }
      if (requireValues) {
        if (!Array.isArray(r.values) || r.values.length === 0) {
          throw new RangeError(`subRequests[${i}].values must be a non-empty array`);
        }
        for (let j = 0; j < r.values.length; j++) {
          const v = r.values[j];
          if (!Number.isInteger(v) || v < 0 || v > 0xFFFF) {
            throw new RangeError(
              `subRequests[${i}].values[${j}] must be in [0, 65535], got: ${v}`
            );
          }
        }
      } else {
        if (!Number.isInteger(r.recordLength) || r.recordLength < 1 || r.recordLength > 0x7D) {
          throw new RangeError(
            `subRequests[${i}].recordLength must be 1..125, got: ${r.recordLength}`
          );
        }
      }
    }
  }

  /**
   * Parse the raw response buffer of an FC 20 (Read File Record) request into
   * an array of records (each record is an array of 16-bit register values).
   *
   * Response layout per Modbus spec V1.1b3 §6.14:
   *   responseDataLength(1) + sub-resp[1..N]
   *   sub-resp = subRespLen(1) + refType(1, 0x06) + data(2*L)
   *
   * The leading responseDataLength byte may be omitted by some implementations
   * of `customFunction()`. This parser tries both layouts and returns whichever
   * consumes the buffer cleanly.
   *
   * @param {Buffer} buf
   * @returns {number[][]}
   * @private
   */
  _parseFileRecordResponse(buf) {
    if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) {
      return [];
    }
    // Try headerless first; if that fails, retry assuming a leading length byte.
    const headerless = this._parseFileRecordSubResponses(buf, 0);
    if (headerless.consumed === buf.length) {
      return headerless.records;
    }
    if (buf.length >= 1 && buf[0] === buf.length - 1) {
      const withHeader = this._parseFileRecordSubResponses(buf, 1);
      if (withHeader.consumed === buf.length - 1) {
        return withHeader.records;
      }
    }
    // Fall back to whichever produced more records
    return headerless.records.length >= 0 ? headerless.records : [];
  }

  /**
   * Internal: walk a buffer of consecutive sub-responses starting at the given offset.
   * @private
   */
  _parseFileRecordSubResponses(buf, startOffset) {
    const records = [];
    let offset = startOffset;
    while (offset < buf.length) {
      const subLen = buf[offset];
      if (subLen < 1 || offset + 1 + subLen > buf.length) {
        return { records, consumed: offset - startOffset, ok: false };
      }
      // refType byte at buf[offset+1] should be 0x06
      const dataStart = offset + 2;
      const dataLen = subLen - 1;
      const record = [];
      for (let i = 0; i + 1 < dataLen; i += 2) {
        record.push((buf[dataStart + i] << 8) | buf[dataStart + i + 1]);
      }
      records.push(record);
      offset += 1 + subLen;
    }
    return { records, consumed: offset - startOffset, ok: true };
  }
}

module.exports = BaseTransport;
module.exports.MODBUS_LIMITS = MODBUS_LIMITS;
