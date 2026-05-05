'use strict';

/**
 * Exception parser for Modbus error responses.
 *
 * When a Modbus server cannot fulfill a request it returns an exception
 * response: the function code OR-ed with 0x80 followed by an exception
 * code byte. The modbus-serial library raises a JavaScript Error whose
 * `.modbusCode` (or `.err` / message) carries the exception code.
 *
 * This module maps raw codes to a structured object suitable for
 * downstream SCADA alarm handling.
 *
 * @module parser/exception-parser
 *
 * @see THEORETICAL_FOUNDATIONS.md §13 Modbus Exception Responses
 */

/**
 * Reference table of known Modbus exception codes.
 *
 * Each entry includes:
 *   - name      Canonical UPPER_SNAKE_CASE identifier
 *   - severity  'info' | 'warning' | 'error' | 'critical'
 *   - retryable Whether an automatic retry might succeed
 *   - description Human-readable description
 *
 * @readonly
 */
const EXCEPTION_CODES = Object.freeze({
  0x01: { name: 'ILLEGAL_FUNCTION', severity: 'error', retryable: false,
    description: 'Function code is not supported by the device' },
  0x02: { name: 'ILLEGAL_DATA_ADDRESS', severity: 'error', retryable: false,
    description: 'Register/coil address does not exist on this device' },
  0x03: { name: 'ILLEGAL_DATA_VALUE', severity: 'error', retryable: false,
    description: 'Value is out of range or quantity exceeds PDU limit' },
  0x04: { name: 'SERVER_DEVICE_FAILURE', severity: 'critical', retryable: false,
    description: 'Unrecoverable internal error in the device' },
  0x05: { name: 'ACKNOWLEDGE', severity: 'info', retryable: true,
    description: 'Long-running operation accepted; retry later for status' },
  0x06: { name: 'SERVER_DEVICE_BUSY', severity: 'warning', retryable: true,
    description: 'Device is busy processing another request; retry later' },
  0x07: { name: 'NEGATIVE_ACKNOWLEDGE', severity: 'error', retryable: false,
    description: 'Programming function rejected by the device' },
  0x08: { name: 'MEMORY_PARITY_ERROR', severity: 'critical', retryable: false,
    description: 'Extended memory (EEPROM/flash) parity failure' },
  0x0A: { name: 'GATEWAY_PATH_UNAVAILABLE', severity: 'error', retryable: false,
    description: 'TCP-to-RTU gateway misconfiguration or serial bus offline' },
  0x0B: { name: 'GATEWAY_TARGET_FAILED', severity: 'error', retryable: true,
    description: 'Gateway reached but target device did not respond' }
});

/**
 * Sentinel for codes outside the documented range.
 * @readonly
 */
const UNKNOWN_EXCEPTION = Object.freeze({
  name: 'UNKNOWN_EXCEPTION',
  severity: 'error',
  retryable: false,
  description: 'Undocumented Modbus exception code'
});

/**
 * Extract the raw exception code (0x01..0xFF) from a thrown Error or
 * exception-like object emitted by the modbus-serial library.
 *
 * Recognized shapes:
 *   - err.modbusCode (number)
 *   - err.err.modbusCode (number)
 *   - err.err (string starting with 'Modbus exception X' or just exception name)
 *   - err.message embedded code: 'Modbus exception N (Name)'
 *
 * @param {Error|object|string} err
 * @returns {number|null} 0x01..0xFF, or null if no code could be derived.
 */
function extractExceptionCode(err) {
  if (err === null || err === undefined) {
    return null;
  }
  if (typeof err === 'number' && Number.isInteger(err) && err > 0 && err <= 0xFF) {
    return err;
  }
  if (typeof err === 'object') {
    if (typeof err.modbusCode === 'number' && Number.isInteger(err.modbusCode)) {
      return err.modbusCode;
    }
    if (err.err && typeof err.err === 'object' && typeof err.err.modbusCode === 'number') {
      return err.err.modbusCode;
    }
  }
  // Fallback: scan a string representation for "Modbus exception N"
  const text = (err && typeof err === 'object' && err.message) ? err.message
    : (typeof err === 'string' ? err : '');
  if (!text) return null;

  const m1 = /Modbus exception\s+(\d+)/i.exec(text);
  if (m1) {
    const code = parseInt(m1[1], 10);
    if (Number.isFinite(code) && code > 0 && code <= 0xFF) {
      return code;
    }
  }
  // 0x.. hex pattern as a last resort
  const m2 = /0x([0-9A-Fa-f]{1,2})/.exec(text);
  if (m2) {
    const code = parseInt(m2[1], 16);
    if (Number.isFinite(code) && code > 0 && code <= 0xFF) {
      return code;
    }
  }
  return null;
}

/**
 * Build a structured exception object for downstream consumers.
 *
 * @param {Error|object|number} err - The raw error or numeric code.
 * @param {object} [context] - Optional context to propagate.
 * @param {number} [context.fc] - Function code that was attempted.
 * @param {number} [context.address] - Register/coil address attempted.
 * @param {number} [context.unitId] - Modbus unit ID.
 * @returns {{
 *   isException: boolean,
 *   code: number|null,
 *   codeHex: string|null,
 *   name: string,
 *   severity: string,
 *   retryable: boolean,
 *   description: string,
 *   message: string,
 *   fc: number|null,
 *   address: number|null,
 *   unitId: number|null
 * }}
 */
function parseException(err, context) {
  const ctx = context || {};
  const code = extractExceptionCode(err);
  const entry = (code !== null && EXCEPTION_CODES[code]) || (code !== null ? UNKNOWN_EXCEPTION : null);

  const baseMessage = (err && typeof err === 'object' && err.message)
    ? err.message
    : (typeof err === 'string' ? err : '');

  if (code === null || !entry) {
    // Not a Modbus exception – return a minimal non-exception envelope
    return {
      isException: false,
      code: null,
      codeHex: null,
      name: 'NOT_AN_EXCEPTION',
      severity: 'error',
      retryable: false,
      description: 'Error is not a Modbus protocol exception',
      message: baseMessage || String(err || ''),
      fc: typeof ctx.fc === 'number' ? ctx.fc : null,
      address: typeof ctx.address === 'number' ? ctx.address : null,
      unitId: typeof ctx.unitId === 'number' ? ctx.unitId : null
    };
  }

  return {
    isException: true,
    code: code,
    codeHex: '0x' + code.toString(16).toUpperCase().padStart(2, '0'),
    name: entry.name,
    severity: entry.severity,
    retryable: entry.retryable,
    description: entry.description,
    message: baseMessage || `Modbus exception ${code} (${entry.name})`,
    fc: typeof ctx.fc === 'number' ? ctx.fc : null,
    address: typeof ctx.address === 'number' ? ctx.address : null,
    unitId: typeof ctx.unitId === 'number' ? ctx.unitId : null
  };
}

/**
 * Determine whether an arbitrary error appears to be a Modbus exception response.
 *
 * @param {*} err
 * @returns {boolean}
 */
function isModbusException(err) {
  return extractExceptionCode(err) !== null;
}

module.exports = {
  EXCEPTION_CODES,
  UNKNOWN_EXCEPTION,
  parseException,
  isModbusException,
  extractExceptionCode
};
