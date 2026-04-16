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
 * In XState v5, error data is provided via event.error.
 */
const storeError = assign({
  lastError: ({ event }) => event.error || null
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
  queue: ({ context, event }) => [...context.queue, event.request]
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
 * Calculate the exponential backoff delay with jitter.
 * Formula: min(baseDelay * 2^retryCount, maxDelay) ± 25% jitter.
 * Jitter prevents thundering-herd when multiple clients reconnect simultaneously.
 */
const calculateBackoff = assign({
  backoffDelay: ({ context }) => {
    const base = Math.min(
      context.baseDelay * Math.pow(2, context.retryCount),
      context.maxDelay
    );
    const jitter = base * 0.25 * (Math.random() * 2 - 1);
    return Math.min(context.maxDelay, Math.max(0, Math.round(base + jitter)));
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
