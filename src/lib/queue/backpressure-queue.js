'use strict';

const EventEmitter = require('events');

/**
 * Drop strategies for queue overflow.
 * @readonly
 * @enum {string}
 */
const DROP_STRATEGY = Object.freeze({
  /** Remove the oldest message when the queue is full (ideal for sensor monitoring). */
  FIFO: 'fifo',
  /** Discard the newest (incoming) message when the queue is full (ideal for alarm events). */
  LIFO: 'lifo'
});

/**
 * Default configuration for the backpressure queue.
 * @readonly
 */
const DEFAULTS = Object.freeze({
  maxSize: 100,
  dropStrategy: DROP_STRATEGY.FIFO,
  highWaterMark: 0.8
});

/**
 * A configurable backpressure queue for Modbus write operations.
 *
 * Protects the Node.js event loop from unbounded memory growth
 * when the polling/write rate exceeds the physical bus processing rate.
 *
 * Features:
 *   - Hard limit on queue size
 *   - FIFO drop (oldest removed) or LIFO drop (newest rejected)
 *   - High-water-mark warning at configurable threshold (default 80%)
 *   - Event-driven: emits 'enqueue', 'dequeue', 'drop', 'drain', 'highWater', 'lowWater'
 *   - Constant memory footprint under flooding
 *
 * @extends EventEmitter
 */
class BackpressureQueue extends EventEmitter {
  /**
   * @param {object} [options] - Queue configuration.
   * @param {number} [options.maxSize=100] - Maximum number of items in the queue (1–10000).
   * @param {string} [options.dropStrategy='fifo'] - Drop strategy: 'fifo' or 'lifo'.
   * @param {number} [options.highWaterMark=0.8] - Fraction (0–1) at which highWater event fires.
   */
  constructor(options = {}) {
    super();
    const opts = { ...DEFAULTS, ...options };

    if (typeof opts.maxSize !== 'number' || !Number.isInteger(opts.maxSize) ||
        opts.maxSize < 1 || opts.maxSize > 10000) {
      throw new RangeError(`maxSize must be an integer between 1 and 10000, got: ${opts.maxSize}`);
    }

    if (opts.dropStrategy !== DROP_STRATEGY.FIFO && opts.dropStrategy !== DROP_STRATEGY.LIFO) {
      throw new TypeError(`dropStrategy must be '${DROP_STRATEGY.FIFO}' or '${DROP_STRATEGY.LIFO}', got: '${opts.dropStrategy}'`);
    }

    if (typeof opts.highWaterMark !== 'number' || opts.highWaterMark < 0 || opts.highWaterMark > 1) {
      throw new RangeError(`highWaterMark must be a number between 0 and 1, got: ${opts.highWaterMark}`);
    }

    this._maxSize = opts.maxSize;
    this._dropStrategy = opts.dropStrategy;
    this._highWaterMark = opts.highWaterMark;
    this._queue = [];
    this._aboveHighWater = false;
    this._totalEnqueued = 0;
    this._totalDequeued = 0;
    this._totalDropped = 0;
  }

  // -- Public API --

  /**
   * Current number of items in the queue.
   * @returns {number}
   */
  get length() {
    return this._queue.length;
  }

  /**
   * Maximum queue capacity.
   * @returns {number}
   */
  get maxSize() {
    return this._maxSize;
  }

  /**
   * Current drop strategy.
   * @returns {string}
   */
  get dropStrategy() {
    return this._dropStrategy;
  }

  /**
   * Whether the queue is full.
   * @returns {boolean}
   */
  isFull() {
    return this._queue.length >= this._maxSize;
  }

  /**
   * Whether the queue is empty.
   * @returns {boolean}
   */
  isEmpty() {
    return this._queue.length === 0;
  }

  /**
   * Enqueue an item. If the queue is full, the drop strategy is applied.
   *
   * @param {*} item - The item to enqueue.
   * @returns {{ enqueued: boolean, dropped: *|null }} Result indicating whether
   *   the item was enqueued and which item (if any) was dropped.
   */
  enqueue(item) {
    let dropped = null;

    if (this._queue.length >= this._maxSize) {
      if (this._dropStrategy === DROP_STRATEGY.FIFO) {
        // Remove oldest to make room for the new item
        dropped = this._queue.shift();
        this._totalDropped++;
        this._emitSafe('drop', { item: dropped, reason: 'fifo_overflow', queueLength: this._queue.length });
      } else {
        // LIFO: reject the incoming item
        this._totalDropped++;
        this._emitSafe('drop', { item: item, reason: 'lifo_overflow', queueLength: this._queue.length });
        return { enqueued: false, dropped: item };
      }
    }

    this._queue.push(item);
    this._totalEnqueued++;
    this._emitSafe('enqueue', { item, queueLength: this._queue.length });
    this._checkHighWater();

    return { enqueued: true, dropped };
  }

  /**
   * Dequeue the next item (FIFO order).
   *
   * @returns {*|undefined} The dequeued item, or undefined if the queue is empty.
   */
  dequeue() {
    if (this._queue.length === 0) {
      return undefined;
    }

    const item = this._queue.shift();
    this._totalDequeued++;
    this._emitSafe('dequeue', { item, queueLength: this._queue.length });

    if (this._queue.length === 0) {
      this._emitSafe('drain');
    }
    this._checkLowWater();

    return item;
  }

  /**
   * Peek at the next item without removing it.
   *
   * @returns {*|undefined} The next item, or undefined if the queue is empty.
   */
  peek() {
    return this._queue.length > 0 ? this._queue[0] : undefined;
  }

  /**
   * Clear all items from the queue.
   *
   * @returns {number} Number of items that were removed.
   */
  clear() {
    const count = this._queue.length;
    this._queue = [];
    if (this._aboveHighWater) {
      this._aboveHighWater = false;
      this._emitSafe('lowWater', { queueLength: 0 });
    }
    if (count > 0) {
      this._emitSafe('drain');
    }
    return count;
  }

  /**
   * Get queue statistics.
   *
   * @returns {{ length: number, maxSize: number, dropStrategy: string,
   *             totalEnqueued: number, totalDequeued: number, totalDropped: number,
   *             utilization: number }}
   */
  getStats() {
    return {
      length: this._queue.length,
      maxSize: this._maxSize,
      dropStrategy: this._dropStrategy,
      totalEnqueued: this._totalEnqueued,
      totalDequeued: this._totalDequeued,
      totalDropped: this._totalDropped,
      utilization: this._maxSize > 0 ? this._queue.length / this._maxSize : 0
    };
  }

  /**
   * Destroy the queue, removing all items and listeners.
   */
  destroy() {
    this._queue = [];
    this._aboveHighWater = false;
    this.removeAllListeners();
  }

  // -- Internal helpers --

  /**
   * Check if the queue has crossed above the high-water mark.
   * @private
   */
  _checkHighWater() {
    const utilization = this._queue.length / this._maxSize;
    if (!this._aboveHighWater && utilization >= this._highWaterMark) {
      this._aboveHighWater = true;
      this._emitSafe('highWater', { queueLength: this._queue.length, utilization });
    }
  }

  /**
   * Check if the queue has dropped below the high-water mark.
   * @private
   */
  _checkLowWater() {
    const utilization = this._queue.length / this._maxSize;
    if (this._aboveHighWater && utilization < this._highWaterMark) {
      this._aboveHighWater = false;
      this._emitSafe('lowWater', { queueLength: this._queue.length, utilization });
    }
  }

  /**
   * Safely emit an event only when there are listeners.
   * Prevents unhandled 'error' event crashes.
   * @param {string} event
   * @param {...*} args
   * @private
   */
  _emitSafe(event, ...args) {
    if (this.listenerCount(event) > 0) {
      this.emit(event, ...args);
    }
  }
}

module.exports = BackpressureQueue;
module.exports.DROP_STRATEGY = DROP_STRATEGY;
module.exports.DEFAULTS = DEFAULTS;
