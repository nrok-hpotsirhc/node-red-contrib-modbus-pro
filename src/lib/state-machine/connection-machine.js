'use strict';

const { setup, createActor, assign } = require('xstate');
const guards = require('./guards');
const actions = require('./actions');

/**
 * Default context values for the connection state machine.
 */
const DEFAULT_CONTEXT = {
  transport: null,
  retryCount: 0,
  maxRetries: 5,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffDelay: 1000,
  lastError: null,
  queue: [],
  maxQueueSize: 100,
  currentRequest: null,
  onStatusChange: null
};

/**
 * XState v5 state machine definition for Modbus connection lifecycle.
 *
 * States:
 *   DISCONNECTED → CONNECTING → CONNECTED → READING/WRITING → CONNECTED
 *                     ↓                         ↓
 *                  ERROR → BACKOFF → RECONNECTING → CONNECTING
 *                                       ↓
 *                               DISCONNECTED (max retries)
 *
 * Events:
 *   CONNECT, DISCONNECT, READ_REQUEST, WRITE_REQUEST,
 *   SUCCESS, FAILURE, TIMEOUT, RETRY
 *
 * Status notifications are delivered via the optional onStatusChange callback
 * passed in the actor input. Consumers can also use actor.subscribe() to
 * observe state transitions directly.
 */
const connectionMachine = setup({
  types: {
    context: /** @type {typeof DEFAULT_CONTEXT} */ ({}),
    events: /** @type {
      | { type: 'CONNECT', transport?: object }
      | { type: 'DISCONNECT' }
      | { type: 'READ_REQUEST', request: object }
      | { type: 'WRITE_REQUEST', request: object }
      | { type: 'SUCCESS', data?: any }
      | { type: 'FAILURE', error?: any }
      | { type: 'TIMEOUT', error?: any }
      | { type: 'RETRY' }
      | { type: 'QUEUE_PROCESS' }
    } */ ({})
  },
  guards: {
    isConnected: guards.isConnected,
    hasRetriesLeft: guards.hasRetriesLeft,
    isQueueNotFull: guards.isQueueNotFull,
    isValidRequest: guards.isValidRequest,
    hasQueuedRequests: ({ context }) => context.queue.length > 0,
    canEnqueue: ({ context, event }) =>
      guards.isValidRequest({ event }) && guards.isQueueNotFull({ context })
  },
  actions: {
    incrementRetry: actions.incrementRetry,
    resetRetry: actions.resetRetry,
    storeError: actions.storeError,
    clearError: actions.clearError,
    enqueueRequest: actions.enqueueRequest,
    dequeueRequest: actions.dequeueRequest,
    clearCurrentRequest: actions.clearCurrentRequest,
    calculateBackoff: actions.calculateBackoff,
    storeTransport: actions.storeTransport,
    notifyStatus: ({ context }, params) => {
      if (typeof context.onStatusChange === 'function') {
        context.onStatusChange(params);
      }
    }
  }
}).createMachine({
  id: 'modbusConnection',
  initial: 'disconnected',
  context: ({ input }) => ({
    ...DEFAULT_CONTEXT,
    ...(input || {})
  }),
  states: {
    disconnected: {
      entry: [{
        type: 'notifyStatus',
        params: { state: 'disconnected', fill: 'red', shape: 'dot', text: 'Disconnected' }
      }],
      on: {
        CONNECT: {
          target: 'connecting',
          actions: ['storeTransport', 'clearError', 'resetRetry']
        }
      }
    },

    connecting: {
      entry: [{
        type: 'notifyStatus',
        params: { state: 'connecting', fill: 'yellow', shape: 'dot', text: 'Connecting...' }
      }],
      on: {
        SUCCESS: {
          target: 'connected',
          actions: ['resetRetry', 'clearError']
        },
        FAILURE: {
          target: 'error',
          actions: ['storeError']
        },
        TIMEOUT: {
          target: 'error',
          actions: ['storeError']
        },
        DISCONNECT: {
          target: 'disconnected'
        }
      }
    },

    connected: {
      entry: [{
        type: 'notifyStatus',
        params: { state: 'connected', fill: 'green', shape: 'dot', text: 'Connected' }
      }],
      on: {
        READ_REQUEST: [
          {
            guard: 'isValidRequest',
            target: 'reading',
            actions: ['enqueueRequest', 'dequeueRequest']
          }
        ],
        WRITE_REQUEST: [
          {
            guard: 'isValidRequest',
            target: 'writing',
            actions: ['enqueueRequest', 'dequeueRequest']
          }
        ],
        DISCONNECT: {
          target: 'disconnected',
          actions: ['clearCurrentRequest']
        },
        FAILURE: {
          target: 'error',
          actions: ['storeError']
        }
      }
    },

    // Note: reading and writing states share identical transition logic.
    // When a queued request is dequeued, the machine transitions to 'reading'
    // regardless of the original request type. This is intentional — the actual
    // read/write dispatch is handled by the consumer, not the FSM. The state
    // name indicates "bus busy processing a request".

    reading: {
      on: {
        SUCCESS: [
          {
            guard: 'hasQueuedRequests',
            target: 'reading',
            actions: ['clearCurrentRequest', 'dequeueRequest']
          },
          {
            target: 'connected',
            actions: ['clearCurrentRequest']
          }
        ],
        FAILURE: {
          target: 'error',
          actions: ['storeError', 'clearCurrentRequest']
        },
        TIMEOUT: {
          target: 'error',
          actions: ['storeError', 'clearCurrentRequest']
        },
        DISCONNECT: {
          target: 'disconnected',
          actions: ['clearCurrentRequest']
        },
        READ_REQUEST: {
          guard: 'canEnqueue',
          actions: ['enqueueRequest']
        },
        WRITE_REQUEST: {
          guard: 'canEnqueue',
          actions: ['enqueueRequest']
        }
      }
    },

    writing: {
      on: {
        SUCCESS: [
          {
            guard: 'hasQueuedRequests',
            target: 'reading',
            actions: ['clearCurrentRequest', 'dequeueRequest']
          },
          {
            target: 'connected',
            actions: ['clearCurrentRequest']
          }
        ],
        FAILURE: {
          target: 'error',
          actions: ['storeError', 'clearCurrentRequest']
        },
        TIMEOUT: {
          target: 'error',
          actions: ['storeError', 'clearCurrentRequest']
        },
        DISCONNECT: {
          target: 'disconnected',
          actions: ['clearCurrentRequest']
        },
        READ_REQUEST: {
          guard: 'canEnqueue',
          actions: ['enqueueRequest']
        },
        WRITE_REQUEST: {
          guard: 'canEnqueue',
          actions: ['enqueueRequest']
        }
      }
    },

    error: {
      entry: [{
        type: 'notifyStatus',
        params: ({ context }) => ({
          state: 'error',
          fill: 'red',
          shape: 'ring',
          text: `Error: ${context.lastError || 'Unknown'}`
        })
      }],
      on: {
        RETRY: [
          {
            guard: 'hasRetriesLeft',
            target: 'backoff',
            actions: ['calculateBackoff', 'incrementRetry']
          },
          {
            target: 'disconnected'
          }
        ],
        DISCONNECT: {
          target: 'disconnected'
        },
        CONNECT: {
          target: 'connecting',
          actions: ['storeTransport', 'clearError', 'resetRetry']
        }
      }
    },

    backoff: {
      entry: [{
        type: 'notifyStatus',
        params: ({ context }) => ({
          state: 'backoff',
          fill: 'yellow',
          shape: 'ring',
          text: `Reconnecting in ${context.backoffDelay}ms (${context.retryCount}/${context.maxRetries})`
        })
      }],
      on: {
        RETRY: {
          target: 'reconnecting'
        },
        DISCONNECT: {
          target: 'disconnected'
        }
      }
    },

    reconnecting: {
      entry: [{
        type: 'notifyStatus',
        params: { state: 'reconnecting', fill: 'yellow', shape: 'dot', text: 'Reconnecting...' }
      }],
      on: {
        SUCCESS: {
          target: 'connected',
          actions: ['clearError']
        },
        FAILURE: {
          target: 'error',
          actions: ['storeError']
        },
        TIMEOUT: {
          target: 'error',
          actions: ['storeError']
        },
        DISCONNECT: {
          target: 'disconnected'
        }
      }
    }
  }
});

/**
 * Create a new connection state machine actor.
 *
 * @param {object} [options] - Optional overrides for the default context.
 * @param {number} [options.maxRetries=5] - Maximum reconnection attempts.
 * @param {number} [options.baseDelay=1000] - Base delay for exponential backoff (ms).
 * @param {number} [options.maxDelay=30000] - Maximum backoff delay (ms).
 * @param {number} [options.maxQueueSize=100] - Maximum pending request queue size.
 * @returns {import('xstate').Actor}
 */
function createConnectionActor(options = {}) {
  return createActor(connectionMachine, {
    input: options
  });
}

module.exports = {
  connectionMachine,
  createConnectionActor,
  DEFAULT_CONTEXT
};
