'use strict';

/**
 * Payload builder for Modbus read responses.
 *
 * Standardizes the msg.payload structure for Node-RED messages,
 * enriching raw Modbus data with metadata (function code, address,
 * timestamp, unit ID, connection info).
 *
 * @module parser/payload-builder
 */

/**
 * Map of function code numbers to human-readable names.
 * @readonly
 */
const FC_NAMES = Object.freeze({
  1: 'readCoils',
  2: 'readDiscreteInputs',
  3: 'readHoldingRegisters',
  4: 'readInputRegisters',
  5: 'writeSingleCoil',
  6: 'writeSingleRegister',
  15: 'writeMultipleCoils',
  16: 'writeMultipleRegisters',
  22: 'maskWriteRegister',
  23: 'readWriteMultipleRegisters',
  43: 'readDeviceIdentification'
});

/**
 * Build a standardized payload from a Modbus read response.
 *
 * @param {object} options - Payload options.
 * @param {number[]|boolean[]} options.data - Raw response data (register values or coil states).
 * @param {Buffer} [options.buffer] - Raw response buffer.
 * @param {number} options.fc - Function code used (1-4).
 * @param {number} options.address - Start address (zero-based protocol level).
 * @param {number} options.quantity - Number of registers/coils requested.
 * @param {number} options.unitId - Modbus unit/slave ID.
 * @param {string} [options.connection] - Connection identifier string (e.g. 'tcp://192.168.1.100:502').
 * @returns {object} Standardized payload object.
 */
function buildReadPayload(options) {
  _validateOptions(options, ['data', 'fc', 'address', 'quantity', 'unitId']);

  return {
    data: options.data,
    buffer: options.buffer || null,
    fc: options.fc,
    fcName: FC_NAMES[options.fc] || `fc${options.fc}`,
    address: options.address,
    quantity: options.quantity,
    unitId: options.unitId,
    timestamp: new Date().toISOString(),
    connection: options.connection || null
  };
}

/**
 * Build a standardized payload from a Modbus write response.
 *
 * @param {object} options - Payload options.
 * @param {number} options.fc - Function code used (5, 6, 15, 16).
 * @param {number} options.address - Start address (zero-based protocol level).
 * @param {number|boolean|number[]|boolean[]} options.value - Value(s) written.
 * @param {number} options.unitId - Modbus unit/slave ID.
 * @param {string} [options.connection] - Connection identifier string.
 * @returns {object} Standardized payload object.
 */
function buildWritePayload(options) {
  _validateOptions(options, ['fc', 'address', 'value', 'unitId']);

  const quantity = Array.isArray(options.value) ? options.value.length : 1;

  return {
    fc: options.fc,
    fcName: FC_NAMES[options.fc] || `fc${options.fc}`,
    address: options.address,
    quantity: quantity,
    value: options.value,
    unitId: options.unitId,
    timestamp: new Date().toISOString(),
    connection: options.connection || null
  };
}

/**
 * Build a connection identifier string from transport config.
 *
 * @param {object} config - Transport configuration.
 * @param {string} config.type - 'tcp' or 'rtu'.
 * @param {string} [config.host] - TCP host.
 * @param {number} [config.port] - TCP port.
 * @param {string} [config.serialPort] - RTU serial port path.
 * @param {number} [config.baudRate] - RTU baud rate.
 * @returns {string} Connection identifier (e.g. 'tcp://192.168.1.100:502').
 */
function buildConnectionString(config) {
  if (!config || typeof config !== 'object') {
    return 'unknown';
  }
  if (config.type === 'tcp') {
    return `tcp://${config.host || '0.0.0.0'}:${config.port || 502}`;
  }
  if (config.type === 'rtu-over-tcp') {
    return `rtu+tcp://${config.host || '0.0.0.0'}:${config.port || 4001}`;
  }
  if (config.type === 'rtu') {
    return `rtu://${config.serialPort || 'unknown'}@${config.baudRate || 9600}`;
  }
  return 'unknown';
}

/**
 * Build a standardized payload from a Modbus FC 23 read/write response.
 *
 * @param {object} options - Payload options.
 * @param {number[]} options.data - Read response data (register values).
 * @param {Buffer} [options.buffer] - Raw response buffer.
 * @param {number} options.fc - Function code (23).
 * @param {number} options.readAddress - Starting read address (zero-based).
 * @param {number} options.readQuantity - Number of registers read.
 * @param {number} options.writeAddress - Starting write address (zero-based).
 * @param {number[]} options.writeValues - Values written.
 * @param {number} options.unitId - Modbus unit/slave ID.
 * @param {string} [options.connection] - Connection identifier string.
 * @returns {object} Standardized payload object.
 */
function buildReadWritePayload(options) {
  _validateOptions(options, ['data', 'fc', 'readAddress', 'readQuantity', 'writeAddress', 'writeValues', 'unitId']);

  return {
    data: options.data,
    buffer: options.buffer || null,
    fc: options.fc,
    fcName: FC_NAMES[options.fc] || `fc${options.fc}`,
    readAddress: options.readAddress,
    readQuantity: options.readQuantity,
    writeAddress: options.writeAddress,
    writeQuantity: options.writeValues.length,
    writeValues: options.writeValues,
    unitId: options.unitId,
    timestamp: new Date().toISOString(),
    connection: options.connection || null
  };
}

/**
 * Build a standardized payload from a Modbus FC 43/14 device identification response.
 *
 * @param {object} options - Payload options.
 * @param {number} options.deviceIdCode - Read device ID code used (1-4).
 * @param {number} options.objectId - Starting object ID.
 * @param {object} options.deviceInfo - Parsed device information map.
 * @param {number} [options.conformityLevel] - Device conformity level.
 * @param {number} options.unitId - Modbus unit/slave ID.
 * @param {string} [options.connection] - Connection identifier string.
 * @returns {object} Standardized payload object.
 */
function buildDiscoverPayload(options) {
  _validateOptions(options, ['deviceIdCode', 'objectId', 'unitId']);

  return {
    fc: 43,
    fcName: FC_NAMES[43] || 'readDeviceIdentification',
    deviceIdCode: options.deviceIdCode,
    objectId: options.objectId,
    deviceInfo: options.deviceInfo || {},
    conformityLevel: options.conformityLevel || 0,
    unitId: options.unitId,
    timestamp: new Date().toISOString(),
    connection: options.connection || null
  };
}

/**
 * Validate that all required fields are present in an options object.
 * @param {object} options
 * @param {string[]} requiredFields
 * @throws {TypeError}
 * @private
 */
function _validateOptions(options, requiredFields) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('options must be a non-null object');
  }
  for (const field of requiredFields) {
    if (options[field] === undefined || options[field] === null) {
      throw new TypeError(`Missing required field: ${field}`);
    }
  }
}

module.exports = {
  FC_NAMES,
  buildReadPayload,
  buildWritePayload,
  buildReadWritePayload,
  buildDiscoverPayload,
  buildConnectionString
};
