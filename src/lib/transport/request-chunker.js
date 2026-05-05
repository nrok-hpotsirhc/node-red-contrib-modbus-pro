'use strict';

/**
 * Request chunker for Modbus operations whose payload exceeds a single PDU.
 *
 * The Modbus protocol caps each PDU at 253 bytes, which translates to per-FC
 * limits (e.g. 125 holding registers, 2000 coils, 123 write registers).
 * This module deterministically splits oversized requests into the minimum
 * number of sequential sub-requests and reassembles their results.
 *
 * Also exposes a small helper for broadcast detection (Unit ID 0).
 *
 * @module transport/request-chunker
 *
 * @see THEORETICAL_FOUNDATIONS.md §14 PDU Payload Limits and Request Chunking
 */

/**
 * Per-function-code maximum quantity in a single Modbus PDU.
 * @readonly
 */
const FC_MAX = Object.freeze({
  1: 2000,   // Read Coils
  2: 2000,   // Read Discrete Inputs
  3: 125,    // Read Holding Registers
  4: 125,    // Read Input Registers
  15: 1968,  // Write Multiple Coils
  16: 123    // Write Multiple Registers
});

const MIN_ADDRESS = 0;
const MAX_ADDRESS = 0xFFFF;

/**
 * Split a read request into chunks that respect the per-FC PDU limit.
 *
 * @param {object} options
 * @param {number} options.fc - Function code (1, 2, 3, or 4).
 * @param {number} options.address - Starting register/coil address (0..65535).
 * @param {number} options.quantity - Total number of registers/coils to read (>=1).
 * @param {number} [options.maxPerRequest] - Optional override (e.g. for tests).
 * @returns {Array<{address: number, length: number, offset: number}>}
 *   List of sub-requests in dispatch order. `offset` is the starting index in
 *   the reassembled output array.
 * @throws {RangeError} On invalid input.
 */
function chunkReadRequest(options) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('chunkReadRequest: options object is required');
  }
  const fc = options.fc;
  const address = options.address;
  const quantity = options.quantity;
  if (!FC_MAX[fc]) {
    throw new RangeError(`chunkReadRequest: unsupported read FC ${fc}`);
  }
  _validateAddress(address);
  _validateQuantity(quantity);

  const max = (typeof options.maxPerRequest === 'number' && options.maxPerRequest > 0)
    ? Math.min(options.maxPerRequest, FC_MAX[fc])
    : FC_MAX[fc];

  if (address + quantity - 1 > MAX_ADDRESS) {
    throw new RangeError(
      `chunkReadRequest: address range ${address}..${address + quantity - 1} exceeds Modbus 16-bit address space`
    );
  }

  const chunks = [];
  let remaining = quantity;
  let offset = 0;
  while (remaining > 0) {
    const length = Math.min(remaining, max);
    chunks.push({ address: address + offset, length, offset });
    offset += length;
    remaining -= length;
  }
  return chunks;
}

/**
 * Split a write-multiple request into chunks.
 *
 * @param {object} options
 * @param {number} options.fc - 15 (coils) or 16 (registers).
 * @param {number} options.address - Starting address (0..65535).
 * @param {Array<boolean|number>} options.values - Values to write.
 * @param {number} [options.maxPerRequest] - Optional override.
 * @returns {Array<{address: number, values: Array, offset: number}>}
 */
function chunkWriteRequest(options) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('chunkWriteRequest: options object is required');
  }
  const fc = options.fc;
  const address = options.address;
  const values = options.values;
  if (fc !== 15 && fc !== 16) {
    throw new RangeError(`chunkWriteRequest: unsupported write FC ${fc} (only 15, 16)`);
  }
  if (!Array.isArray(values) || values.length === 0) {
    throw new RangeError('chunkWriteRequest: values must be a non-empty array');
  }
  _validateAddress(address);
  if (address + values.length - 1 > MAX_ADDRESS) {
    throw new RangeError(
      `chunkWriteRequest: address range ${address}..${address + values.length - 1} exceeds Modbus 16-bit address space`
    );
  }

  const max = (typeof options.maxPerRequest === 'number' && options.maxPerRequest > 0)
    ? Math.min(options.maxPerRequest, FC_MAX[fc])
    : FC_MAX[fc];

  const chunks = [];
  let offset = 0;
  while (offset < values.length) {
    const slice = values.slice(offset, offset + max);
    chunks.push({ address: address + offset, values: slice, offset });
    offset += slice.length;
  }
  return chunks;
}

/**
 * Reassemble chunked read results in the original request order.
 *
 * Each result must mirror modbus-serial's read response shape:
 *   { data: Array, buffer: Buffer }
 *
 * Buffers are concatenated in chunk order; data arrays are concatenated
 * to produce a flat array of length `totalQuantity`.
 *
 * @param {Array<{data: Array, buffer?: Buffer}>} results - Sub-request results.
 * @returns {{data: Array, buffer: Buffer}}
 * @throws {Error} When any result is missing a data array.
 */
function reassembleReadResults(results) {
  if (!Array.isArray(results) || results.length === 0) {
    throw new TypeError('reassembleReadResults: results must be a non-empty array');
  }
  let data = [];
  const buffers = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!r || !Array.isArray(r.data)) {
      throw new Error(`reassembleReadResults: chunk ${i} is missing data array`);
    }
    data = data.concat(r.data);
    if (r.buffer && Buffer.isBuffer(r.buffer)) {
      buffers.push(r.buffer);
    }
  }
  return {
    data,
    buffer: buffers.length > 0 ? Buffer.concat(buffers) : Buffer.alloc(0)
  };
}

/**
 * Determine whether a unit ID is the Modbus broadcast address.
 * Broadcast (Unit ID 0) is only meaningful for write FCs (5, 6, 15, 16) on
 * RTU buses; servers must not respond, so the transport layer should resolve
 * the promise immediately without waiting for a reply.
 *
 * @param {number} unitId
 * @returns {boolean}
 */
function isBroadcast(unitId) {
  return unitId === 0;
}

/**
 * Whether a function code is a write-many operation that supports broadcast.
 * @param {number} fc
 * @returns {boolean}
 */
function isBroadcastableFC(fc) {
  return fc === 5 || fc === 6 || fc === 15 || fc === 16;
}

function _validateAddress(address) {
  if (typeof address !== 'number' || !Number.isInteger(address) ||
      address < MIN_ADDRESS || address > MAX_ADDRESS) {
    throw new RangeError(`address must be an integer between 0 and 65535, got: ${address}`);
  }
}

function _validateQuantity(quantity) {
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
    throw new RangeError(`quantity must be a positive integer, got: ${quantity}`);
  }
}

module.exports = {
  FC_MAX,
  chunkReadRequest,
  chunkWriteRequest,
  reassembleReadResults,
  isBroadcast,
  isBroadcastableFC
};
