'use strict';

const EventEmitter = require('events');

/**
 * RTU Semaphore for serializing access to half-duplex RS-485 bus.
 *
 * Since RTU communication is inherently half-duplex, only one request
 * may be on the bus at any given time. This semaphore converts parallel
 * read/write requests from multiple Node-RED nodes into a strictly
 * sequential queue of promises.
 *
 * @extends EventEmitter
 */
class RtuSemaphore extends EventEmitter {
  /**
   * @param {object} [options] - Semaphore configuration.
   * @param {number} [options.timeout=5000] - Maximum time (ms) to wait for a response before releasing.
   * @param {number} [options.interFrameDelay=50] - Delay (ms) between frames (Modbus silent interval).
   */
  constructor(options = {}) {
    super();
    this._timeout = options.timeout || 5000;
    this._interFrameDelay = options.interFrameDelay || 50;
    this._queue = [];
    this._busy = false;
    this._currentOperation = null;
    this._completedCount = 0;
    this._droppedCount = 0;
    this._draining = false;
  }

  /**
   * Whether the semaphore is currently processing a request.
   * @returns {boolean}
   */
  get busy() {
    return this._busy;
  }

  /**
   * Number of requests waiting in the queue.
   * @returns {number}
   */
  get queueLength() {
    return this._queue.length;
  }

  /**
   * Total number of completed operations.
   * @returns {number}
   */
  get completedCount() {
    return this._completedCount;
  }

  /**
   * Total number of dropped operations (due to drain or timeout).
   * @returns {number}
   */
  get droppedCount() {
    return this._droppedCount;
  }

  /**
   * Execute an operation with exclusive bus access.
   *
   * The operation is queued and will be executed when the bus is free.
   * Returns a promise that resolves with the operation result or rejects
   * if the operation times out or fails.
   *
   * @param {Function} operation - Async function to execute on the bus.
   * @returns {Promise<any>} Result of the operation.
   */
  execute(operation) {
    if (this._draining) {
      return Promise.reject(new Error('RtuSemaphore: semaphore is draining'));
    }

    if (typeof operation !== 'function') {
      return Promise.reject(new Error('RtuSemaphore: operation must be a function'));
    }

    return new Promise((resolve, reject) => {
      this._queue.push({ operation, resolve, reject });
      this._processNext();
    });
  }

  /**
   * Process the next item in the queue, if not already busy.
   * @private
   */
  _processNext() {
    if (this._busy || this._queue.length === 0) {
      return;
    }

    this._busy = true;
    const item = this._queue.shift();
    this._currentOperation = item;

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      this._droppedCount++;
      this._busy = false;
      this._currentOperation = null;
      item.reject(new Error('RtuSemaphore: operation timed out'));
      this.emit('timeout');
      this._scheduleNext();
    }, this._timeout);

    Promise.resolve()
      .then(() => item.operation())
      .then((result) => {
        if (!timedOut) {
          clearTimeout(timer);
          this._completedCount++;
          this._busy = false;
          this._currentOperation = null;
          item.resolve(result);
          this.emit('complete', result);
          this._scheduleNext();
        }
      })
      .catch((err) => {
        if (!timedOut) {
          clearTimeout(timer);
          this._busy = false;
          this._currentOperation = null;
          item.reject(err);
          this._emitError(err);
          this._scheduleNext();
        }
      });
  }

  /**
   * Schedule the next queue item after the inter-frame delay.
   * @private
   */
  _scheduleNext() {
    if (this._queue.length > 0 && !this._draining) {
      setTimeout(() => this._processNext(), this._interFrameDelay);
    }
  }

  /**
   * Drain the semaphore: reject all pending operations and reset.
   *
   * @returns {Promise<void>}
   */
  async drain() {
    this._draining = true;

    // Reject all pending items in the queue
    while (this._queue.length > 0) {
      const item = this._queue.shift();
      this._droppedCount++;
      item.reject(new Error('RtuSemaphore: semaphore drained'));
    }

    // Wait for any current operation to finish (up to timeout)
    if (this._busy) {
      await new Promise((resolve) => {
        let resolved = false;
        const timer = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve();
          }
        }, this._timeout);

        const check = () => {
          if (!this._busy) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              resolve();
            }
          } else {
            setTimeout(check, 10);
          }
        };
        check();
      });
    }

    this._busy = false;
    this._currentOperation = null;
    this._draining = false;
    this.emit('drained');
  }

  /**
   * Get the current semaphore status.
   *
   * @returns {object} Status information.
   */
  getStatus() {
    return {
      busy: this._busy,
      queueLength: this._queue.length,
      completedCount: this._completedCount,
      droppedCount: this._droppedCount,
      draining: this._draining
    };
  }

  /**
   * Safely emit an error event. If no listener is registered,
   * the error is silently ignored to prevent unhandled error crashes.
   * @param {Error} err
   * @private
   */
  _emitError(err) {
    if (this.listenerCount('error') > 0) {
      this.emit('error', err);
    }
  }
}

module.exports = RtuSemaphore;
