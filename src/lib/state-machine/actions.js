'use strict';

/**
 * XState v5 actions for the Modbus connection state machine.
 *
 * Actions are side-effect functions executed during state transitions.
 * They modify the machine context or interact with external systems
 * (transport, Node-RED status API).
 */

const { assign } = require('xstate');

/**
 * Increment the retry counter.
 */
const incrementRetry = assign({
  retryCount: ({ context }) => context.retryCount + 1
});

/**
 * Reset the retry counter to zero.
 */
const resetRetry = assign({
  retryCount: 0
});

/**
 * Store the last error in context.
 */
const storeError = assign({
  lastError: ({ event }) => event.error || event.data || null
});

/**
 * Clear the last error from context.
 */
const clearError = assign({
  lastError: null
});

/**
 * Enqueue a request into the pending queue.
 */
const enqueueRequest = assign({
  queue: ({ context, event }) => {
    const newQueue = [...context.queue, event.request];
    return newQueue;
  }
});

/**
 * Dequeue the first request from the pending queue
 * and set it as the current request.
 */
const dequeueRequest = assign({
  currentRequest: ({ context }) => context.queue[0] || null,
  queue: ({ context }) => context.queue.slice(1)
});

/**
 * Clear the current request after completion.
 */
const clearCurrentRequest = assign({
  currentRequest: null
});

/**
 * Calculate the exponential backoff delay and store it.
 * Formula: min(baseDelay * 2^retryCount, maxDelay)
 */
const calculateBackoff = assign({
  backoffDelay: ({ context }) => {
    const delay = Math.min(
      context.baseDelay * Math.pow(2, context.retryCount),
      context.maxDelay
    );
    return delay;
  }
});

/**
 * Store a reference to the transport in context.
 */
const storeTransport = assign({
  transport: ({ event }) => event.transport || null
});

module.exports = {
  incrementRetry,
  resetRetry,
  storeError,
  clearError,
  enqueueRequest,
  dequeueRequest,
  clearCurrentRequest,
  calculateBackoff,
  storeTransport
};
