'use strict';

/**
 * Buffer parser for Modbus register/coil data.
 *
 * Handles the endianness challenge inherent in Modbus communication:
 * - Modbus transmits 16-bit registers in big-endian (MSB first).
 * - 32-bit values (Float32, UInt32, Int32) span two consecutive registers.
 * - The word order of those two registers is device-dependent.
 *
 * Supported byte orders:
 *   BE     – Big-Endian (AB CD)         – high word first (Modbus standard)
 *   LE     – Little-Endian (CD AB)      – low word first
 *   BE_BS  – Big-Endian Byte Swap (BA DC)
 *   LE_BS  – Little-Endian Byte Swap (DC BA)
 *
 * @module parser/buffer-parser
 */

/**
 * Valid byte order identifiers.
 * @readonly
 * @enum {string}
 */
const BYTE_ORDER = Object.freeze({
  BE: 'BE',
  LE: 'LE',
  BE_BS: 'BE_BS',
  LE_BS: 'LE_BS'
});

/**
 * Convert an array of 16-bit register values to a Buffer.
 * Each register occupies two bytes in big-endian order (Modbus standard).
 *
 * @param {number[]} registers - Array of 16-bit unsigned integers.
 * @returns {Buffer}
 */
function registersToBuffer(registers) {
  if (!Array.isArray(registers)) {
    throw new TypeError('registers must be an array');
  }
  const buf = Buffer.alloc(registers.length * 2);
  for (let i = 0; i < registers.length; i++) {
    buf.writeUInt16BE(registers[i] & 0xFFFF, i * 2);
  }
  return buf;
}

/**
 * Rearrange 4 bytes from a pair of registers according to the specified byte order.
 *
 * @param {Buffer} buf - 4-byte buffer (2 registers, big-endian).
 * @param {string} byteOrder - One of BYTE_ORDER values.
 * @returns {Buffer} 4-byte buffer in the canonical big-endian order for DataView.
 * @private
 */
function _reorderBytes(buf, byteOrder) {
  const out = Buffer.alloc(4);
  switch (byteOrder) {
    case BYTE_ORDER.BE: // AB CD – already in order
      out[0] = buf[0];
      out[1] = buf[1];
      out[2] = buf[2];
      out[3] = buf[3];
      break;
    case BYTE_ORDER.LE: // CD AB – swap words
      out[0] = buf[2];
      out[1] = buf[3];
      out[2] = buf[0];
      out[3] = buf[1];
      break;
    case BYTE_ORDER.BE_BS: // BA DC – swap bytes within words
      out[0] = buf[1];
      out[1] = buf[0];
      out[2] = buf[3];
      out[3] = buf[2];
      break;
    case BYTE_ORDER.LE_BS: // DC BA – swap both words and bytes
      out[0] = buf[3];
      out[1] = buf[2];
      out[2] = buf[1];
      out[3] = buf[0];
      break;
    default:
      throw new RangeError(`Unknown byte order: ${byteOrder}`);
  }
  return out;
}

/**
 * Parse a Float32 (IEEE 754) value from two consecutive 16-bit registers.
 *
 * @param {number[]} registers - Array of exactly 2 unsigned 16-bit values.
 * @param {string} [byteOrder='BE'] - Byte order for word arrangement.
 * @returns {number} Parsed 32-bit float.
 */
function parseFloat32(registers, byteOrder = BYTE_ORDER.BE) {
  _validateRegisterPair(registers);
  const buf = registersToBuffer(registers);
  const ordered = _reorderBytes(buf, byteOrder);
  return ordered.readFloatBE(0);
}

/**
 * Parse a UInt32 value from two consecutive 16-bit registers.
 *
 * @param {number[]} registers - Array of exactly 2 unsigned 16-bit values.
 * @param {string} [byteOrder='BE'] - Byte order for word arrangement.
 * @returns {number} Parsed 32-bit unsigned integer.
 */
function parseUInt32(registers, byteOrder = BYTE_ORDER.BE) {
  _validateRegisterPair(registers);
  const buf = registersToBuffer(registers);
  const ordered = _reorderBytes(buf, byteOrder);
  return ordered.readUInt32BE(0);
}

/**
 * Parse an Int32 value from two consecutive 16-bit registers.
 *
 * @param {number[]} registers - Array of exactly 2 unsigned 16-bit values.
 * @param {string} [byteOrder='BE'] - Byte order for word arrangement.
 * @returns {number} Parsed 32-bit signed integer.
 */
function parseInt32(registers, byteOrder = BYTE_ORDER.BE) {
  _validateRegisterPair(registers);
  const buf = registersToBuffer(registers);
  const ordered = _reorderBytes(buf, byteOrder);
  return ordered.readInt32BE(0);
}

/**
 * Parse an Int16 value from a single 16-bit register.
 *
 * @param {number} register - Unsigned 16-bit register value.
 * @returns {number} Signed 16-bit integer.
 */
function parseInt16(register) {
  if (typeof register !== 'number' || !Number.isFinite(register)) {
    throw new TypeError('register must be a finite number');
  }
  const buf = Buffer.alloc(2);
  buf.writeUInt16BE(register & 0xFFFF, 0);
  return buf.readInt16BE(0);
}

/**
 * Parse a UInt16 value from a single 16-bit register.
 *
 * @param {number} register - Unsigned 16-bit register value.
 * @returns {number} Unsigned 16-bit integer.
 */
function parseUInt16(register) {
  if (typeof register !== 'number' || !Number.isFinite(register)) {
    throw new TypeError('register must be a finite number');
  }
  return register & 0xFFFF;
}

/**
 * Parse an array of registers into an array of Float32 values.
 * Registers are consumed in pairs (2 registers per Float32).
 *
 * @param {number[]} registers - Array of unsigned 16-bit values (length must be even).
 * @param {string} [byteOrder='BE'] - Byte order for word arrangement.
 * @returns {number[]} Array of parsed Float32 values.
 */
function parseFloat32Array(registers, byteOrder = BYTE_ORDER.BE) {
  if (!Array.isArray(registers) || registers.length === 0 || registers.length % 2 !== 0) {
    throw new RangeError('registers array must be non-empty with an even number of elements');
  }
  const result = [];
  for (let i = 0; i < registers.length; i += 2) {
    result.push(parseFloat32([registers[i], registers[i + 1]], byteOrder));
  }
  return result;
}

/**
 * Parse an array of registers into an array of UInt32 values.
 *
 * @param {number[]} registers - Array of unsigned 16-bit values (length must be even).
 * @param {string} [byteOrder='BE'] - Byte order for word arrangement.
 * @returns {number[]} Array of parsed UInt32 values.
 */
function parseUInt32Array(registers, byteOrder = BYTE_ORDER.BE) {
  if (!Array.isArray(registers) || registers.length === 0 || registers.length % 2 !== 0) {
    throw new RangeError('registers array must be non-empty with an even number of elements');
  }
  const result = [];
  for (let i = 0; i < registers.length; i += 2) {
    result.push(parseUInt32([registers[i], registers[i + 1]], byteOrder));
  }
  return result;
}

/**
 * Parse an array of registers into an array of Int32 values.
 *
 * @param {number[]} registers - Array of unsigned 16-bit values (length must be even).
 * @param {string} [byteOrder='BE'] - Byte order for word arrangement.
 * @returns {number[]} Array of parsed Int32 values.
 */
function parseInt32Array(registers, byteOrder = BYTE_ORDER.BE) {
  if (!Array.isArray(registers) || registers.length === 0 || registers.length % 2 !== 0) {
    throw new RangeError('registers array must be non-empty with an even number of elements');
  }
  const result = [];
  for (let i = 0; i < registers.length; i += 2) {
    result.push(parseInt32([registers[i], registers[i + 1]], byteOrder));
  }
  return result;
}

/**
 * Validate that the input is a pair of registers.
 * @param {number[]} registers
 * @throws {TypeError|RangeError}
 * @private
 */
function _validateRegisterPair(registers) {
  if (!Array.isArray(registers) || registers.length !== 2) {
    throw new RangeError('Expected an array of exactly 2 register values');
  }
  for (let i = 0; i < 2; i++) {
    const v = registers[i];
    if (typeof v !== 'number') {
      throw new TypeError(`Register ${i} must be a number, got: ${typeof v}`);
    }
    if (!Number.isFinite(v) || !Number.isInteger(v) || v < 0 || v > 0xFFFF) {
      throw new RangeError(`Register ${i} must be an integer in [0, 65535], got: ${v}`);
    }
  }
}

/**
 * Rearrange 8 bytes from four registers according to the specified byte order.
 *
 * For 64-bit values the same logical orderings apply as for 32-bit:
 *   BE     – big-endian  (R0 R1 R2 R3 → bytes 0..7 in MSB-first order)
 *   LE     – little-endian word order (R3 R2 R1 R0)
 *   BE_BS  – big-endian, byte-swapped within each word
 *   LE_BS  – little-endian word order, byte-swapped within each word
 *
 * @param {Buffer} buf - 8-byte buffer (4 registers, big-endian).
 * @param {string} byteOrder
 * @returns {Buffer} 8-byte buffer in canonical big-endian order.
 * @private
 */
function _reorder8Bytes(buf, byteOrder) {
  const out = Buffer.alloc(8);
  switch (byteOrder) {
    case BYTE_ORDER.BE: // R0 R1 R2 R3 – already in order
      buf.copy(out, 0, 0, 8);
      break;
    case BYTE_ORDER.LE: // R3 R2 R1 R0 – reverse word order
      out[0] = buf[6]; out[1] = buf[7];
      out[2] = buf[4]; out[3] = buf[5];
      out[4] = buf[2]; out[5] = buf[3];
      out[6] = buf[0]; out[7] = buf[1];
      break;
    case BYTE_ORDER.BE_BS: // byte-swap inside each word, keep word order
      out[0] = buf[1]; out[1] = buf[0];
      out[2] = buf[3]; out[3] = buf[2];
      out[4] = buf[5]; out[5] = buf[4];
      out[6] = buf[7]; out[7] = buf[6];
      break;
    case BYTE_ORDER.LE_BS: // reverse word order AND byte-swap inside each word
      out[0] = buf[7]; out[1] = buf[6];
      out[2] = buf[5]; out[3] = buf[4];
      out[4] = buf[3]; out[5] = buf[2];
      out[6] = buf[1]; out[7] = buf[0];
      break;
    default:
      throw new RangeError(`Unknown byte order: ${byteOrder}`);
  }
  return out;
}

/**
 * Validate that the input is exactly four 16-bit registers.
 * @private
 */
function _validateRegisterQuad(registers) {
  if (!Array.isArray(registers) || registers.length !== 4) {
    throw new RangeError('Expected an array of exactly 4 register values');
  }
  for (let i = 0; i < 4; i++) {
    const v = registers[i];
    if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v) || v < 0 || v > 0xFFFF) {
      throw new RangeError(`Register ${i} must be an integer in [0, 65535], got: ${v}`);
    }
  }
}

/**
 * Parse a Float64 (IEEE 754 double-precision) value from four 16-bit registers.
 *
 * @param {number[]} registers - Exactly 4 unsigned 16-bit values.
 * @param {string} [byteOrder='BE'] - Byte order for word arrangement.
 * @returns {number} Parsed 64-bit float.
 */
function parseFloat64(registers, byteOrder = BYTE_ORDER.BE) {
  _validateRegisterQuad(registers);
  const buf = registersToBuffer(registers);
  return _reorder8Bytes(buf, byteOrder).readDoubleBE(0);
}

/**
 * Parse an Int64 value from four 16-bit registers. Returns a BigInt to
 * preserve full 64-bit precision (Number is limited to 2^53 - 1).
 *
 * @param {number[]} registers - Exactly 4 unsigned 16-bit values.
 * @param {string} [byteOrder='BE'] - Byte order for word arrangement.
 * @returns {bigint}
 */
function parseInt64(registers, byteOrder = BYTE_ORDER.BE) {
  _validateRegisterQuad(registers);
  const buf = registersToBuffer(registers);
  return _reorder8Bytes(buf, byteOrder).readBigInt64BE(0);
}

/**
 * Parse a UInt64 value from four 16-bit registers as a BigInt.
 *
 * @param {number[]} registers - Exactly 4 unsigned 16-bit values.
 * @param {string} [byteOrder='BE'] - Byte order for word arrangement.
 * @returns {bigint}
 */
function parseUInt64(registers, byteOrder = BYTE_ORDER.BE) {
  _validateRegisterQuad(registers);
  const buf = registersToBuffer(registers);
  return _reorder8Bytes(buf, byteOrder).readBigUInt64BE(0);
}

/**
 * Parse an ASCII string from a sequence of 16-bit registers.
 *
 * Each register holds two ASCII bytes (high byte first by Modbus convention).
 * Trailing NUL bytes (0x00) are trimmed; non-printable bytes are kept verbatim.
 * If `byteSwap` is true, the two bytes within each register are swapped before
 * decoding (some PLCs invert ASCII byte order).
 *
 * @param {number[]} registers - One or more unsigned 16-bit values.
 * @param {object} [opts]
 * @param {boolean} [opts.byteSwap=false]
 * @param {string} [opts.encoding='ascii']
 * @returns {string}
 */
function parseString(registers, opts) {
  if (!Array.isArray(registers) || registers.length === 0) {
    throw new RangeError('parseString: registers must be a non-empty array');
  }
  const options = opts || {};
  const encoding = options.encoding || 'ascii';
  const byteSwap = options.byteSwap === true;

  const buf = Buffer.alloc(registers.length * 2);
  for (let i = 0; i < registers.length; i++) {
    const v = registers[i];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 0xFFFF) {
      throw new RangeError(`parseString: register ${i} must be in [0, 65535], got: ${v}`);
    }
    if (byteSwap) {
      buf.writeUInt16LE(v & 0xFFFF, i * 2);
    } else {
      buf.writeUInt16BE(v & 0xFFFF, i * 2);
    }
  }
  // Truncate at first NUL byte
  let end = buf.length;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x00) { end = i; break; }
  }
  return buf.toString(encoding, 0, end);
}

/**
 * Parse a 16-bit register value as 4-digit packed BCD.
 *
 * Example: register 0x1234 → 1234.
 * Throws if any nibble is greater than 9.
 *
 * @param {number} register - Unsigned 16-bit value.
 * @returns {number}
 */
function parseBCD16(register) {
  if (typeof register !== 'number' || !Number.isInteger(register) || register < 0 || register > 0xFFFF) {
    throw new RangeError(`parseBCD16: register must be in [0, 65535], got: ${register}`);
  }
  let result = 0;
  for (let shift = 12; shift >= 0; shift -= 4) {
    const nibble = (register >> shift) & 0x0F;
    if (nibble > 9) {
      throw new RangeError(`parseBCD16: invalid BCD digit 0x${nibble.toString(16)} in register 0x${register.toString(16)}`);
    }
    result = result * 10 + nibble;
  }
  return result;
}

/**
 * Parse a 32-bit packed BCD value spanning two registers (8 decimal digits).
 *
 * @param {number[]} registers - Exactly 2 unsigned 16-bit values.
 * @param {string} [byteOrder='BE'] - Word order: BE = high register first.
 * @returns {number}
 */
function parseBCD32(registers, byteOrder = BYTE_ORDER.BE) {
  _validateRegisterPair(registers);
  const high = byteOrder === BYTE_ORDER.LE ? registers[1] : registers[0];
  const low = byteOrder === BYTE_ORDER.LE ? registers[0] : registers[1];
  return parseBCD16(high) * 10000 + parseBCD16(low);
}

/**
 * Parse a 32-bit Unix timestamp (seconds since 1970-01-01) from 2 registers
 * and convert it to a JavaScript Date.
 *
 * @param {number[]} registers - Exactly 2 unsigned 16-bit values.
 * @param {string} [byteOrder='BE'] - Byte order for word arrangement.
 * @returns {Date}
 */
function parseUnixTimestamp(registers, byteOrder = BYTE_ORDER.BE) {
  const seconds = parseUInt32(registers, byteOrder);
  return new Date(seconds * 1000);
}

module.exports = {
  BYTE_ORDER,
  registersToBuffer,
  parseFloat32,
  parseUInt32,
  parseInt32,
  parseInt16,
  parseUInt16,
  parseFloat32Array,
  parseUInt32Array,
  parseInt32Array,
  // Extended data types (WP 7.2)
  parseFloat64,
  parseInt64,
  parseUInt64,
  parseString,
  parseBCD16,
  parseBCD32,
  parseUnixTimestamp
};
