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
  currentRequest: null
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
    hasQueuedRequests: ({ context }) => context.queue.length > 0
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
    notifyConnect: ({ context, self }) => {
      self.system && self.system.emit && self.system.emit('status', {
        state: 'connected',
        fill: 'green',
        shape: 'dot',
        text: 'Connected'
      });
    },
    notifyDisconnect: ({ context, self }) => {
      self.system && self.system.emit && self.system.emit('status', {
        state: 'disconnected',
        fill: 'red',
        shape: 'dot',
        text: 'Disconnected'
      });
    },
    notifyError: ({ context, self }) => {
      self.system && self.system.emit && self.system.emit('status', {
        state: 'error',
        fill: 'red',
        shape: 'ring',
        text: `Error: ${context.lastError || 'Unknown'}`
      });
    },
    notifyBackoff: ({ context, self }) => {
      self.system && self.system.emit && self.system.emit('status', {
        state: 'backoff',
        fill: 'yellow',
        shape: 'ring',
        text: `Reconnecting in ${context.backoffDelay}ms (${context.retryCount}/${context.maxRetries})`
      });
    },
    notifyReading: () => {},
    notifyWriting: () => {}
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
      entry: ['notifyDisconnect'],
      on: {
        CONNECT: {
          target: 'connecting',
          actions: ['storeTransport', 'clearError', 'resetRetry']
        }
      }
    },

    connecting: {
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
      entry: ['notifyConnect'],
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

    reading: {
      entry: ['notifyReading'],
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
          guard: 'isValidRequest',
          actions: ['enqueueRequest']
        },
        WRITE_REQUEST: {
          guard: 'isValidRequest',
          actions: ['enqueueRequest']
        }
      }
    },

    writing: {
      entry: ['notifyWriting'],
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
          guard: 'isValidRequest',
          actions: ['enqueueRequest']
        },
        WRITE_REQUEST: {
          guard: 'isValidRequest',
          actions: ['enqueueRequest']
        }
      }
    },

    error: {
      entry: ['notifyError'],
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
      entry: ['notifyBackoff'],
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
