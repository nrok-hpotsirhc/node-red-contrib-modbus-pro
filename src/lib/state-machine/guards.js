'use strict';

/**
 * XState v5 guards for the Modbus connection state machine.
 *
 * Guards are pure boolean functions that determine whether a state
 * transition is allowed. They receive the machine context and the event.
 */

/**
 * Check whether the transport reports an open connection.
 * @param {object} params
 * @param {object} params.context - Machine context.
 * @returns {boolean}
 */
function isConnected({ context }) {
  return context.transport !== null && typeof context.transport.isOpen === 'function' && context.transport.isOpen();
}

/**
 * Check whether there are retry attempts remaining.
 * @param {object} params
 * @param {object} params.context - Machine context.
 * @returns {boolean}
 */
function hasRetriesLeft({ context }) {
  return context.retryCount < context.maxRetries;
}

/**
 * Check whether the request queue has capacity.
 * @param {object} params
 * @param {object} params.context - Machine context.
 * @returns {boolean}
 */
function isQueueNotFull({ context }) {
  return context.queue.length < context.maxQueueSize;
}

/**
 * Validate that the event carries a well-formed request.
 * A valid request must have an operation string, a numeric address,
 * and a numeric length or values array.
 * @param {object} params
 * @param {object} params.event - Incoming event.
 * @returns {boolean}
 */
function isValidRequest({ event }) {
  if (!event || !event.request) return false;
  const req = event.request;
  if (typeof req.operation !== 'string') return false;
  if (typeof req.address !== 'number' || req.address < 0) return false;
  // Read operations need length, write operations need value(s)
  const hasLength = typeof req.length === 'number' && req.length > 0;
  const hasValue = req.value !== undefined || req.values !== undefined;
  return hasLength || hasValue;
}

module.exports = {
  isConnected,
  hasRetriesLeft,
  isQueueNotFull,
  isValidRequest
};
