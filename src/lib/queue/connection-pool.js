'use strict';

const EventEmitter = require('events');

/**
 * TCP Connection Pool for managing multiple parallel Modbus TCP connections.
 *
 * Distributes requests across a configurable number of connections via
 * round-robin multiplexing. Respects SYN flood protection by limiting
 * the maximum pool size.
 *
 * @extends EventEmitter
 */
class ConnectionPool extends EventEmitter {
  /**
   * @param {object} options - Pool configuration.
   * @param {Function} options.factory - Async function that creates and connects a transport instance.
   * @param {number} [options.size=1] - Number of connections in the pool.
   * @param {number} [options.maxSize=10] - Hard upper limit for pool size.
   */
  constructor(options = {}) {
    super();

    if (!options.factory || typeof options.factory !== 'function') {
      throw new Error('ConnectionPool: factory function is required');
    }

    this._factory = options.factory;
    this._size = Math.max(1, Math.min(options.size || 1, options.maxSize || 10));
    this._maxSize = options.maxSize || 10;
    this._connections = [];
    this._roundRobinIndex = 0;
    this._initialized = false;
    this._draining = false;
  }

  /**
   * Number of currently active connections.
   * @returns {number}
   */
  get activeCount() {
    return this._connections.filter(c => c && c.isOpen && c.isOpen()).length;
  }

  /**
   * Total pool size (including inactive connections).
   * @returns {number}
   */
  get totalCount() {
    return this._connections.length;
  }

  /**
   * Target pool size.
   * @returns {number}
   */
  get size() {
    return this._size;
  }

  /**
   * Whether the pool has been initialized.
   * @returns {boolean}
   */
  get initialized() {
    return this._initialized;
  }

  /**
   * Initialize the pool by creating all connections.
   * Connections that fail are stored as null and can be retried.
   *
   * @returns {Promise<number>} Number of successfully created connections.
   */
  async initialize() {
    if (this._draining) {
      throw new Error('ConnectionPool: pool is draining, cannot initialize');
    }

    const results = [];
    for (let i = 0; i < this._size; i++) {
      try {
        const transport = await this._factory();
        this._connections.push(transport);
        results.push(true);
      } catch (err) {
        this._connections.push(null);
        results.push(false);
        this._emitError(err);
      }
    }

    this._initialized = true;
    const successCount = results.filter(Boolean).length;
    this.emit('initialized', { total: this._size, active: successCount });
    return successCount;
  }

  /**
   * Acquire the next available connection via round-robin.
   *
   * @returns {object|null} A transport instance, or null if none available.
   */
  acquire() {
    if (this._connections.length === 0) {
      return null;
    }

    let attempts = 0;

    while (attempts < this._connections.length) {
      const idx = this._roundRobinIndex % this._connections.length;
      this._roundRobinIndex = (this._roundRobinIndex + 1) % this._connections.length;

      const conn = this._connections[idx];
      if (conn && typeof conn.isOpen === 'function' && conn.isOpen()) {
        return conn;
      }
      attempts++;
    }

    return null;
  }

  /**
   * Execute an operation on an acquired connection.
   *
   * @param {Function} operation - Async function receiving the transport.
   * @returns {Promise<any>} Result of the operation.
   * @throws {Error} If no connection is available.
   */
  async execute(operation) {
    const conn = this.acquire();
    if (!conn) {
      throw new Error('ConnectionPool: no available connection');
    }
    return operation(conn);
  }

  /**
   * Replace a failed connection at the given index.
   *
   * @param {number} index - Index in the pool to replace.
   * @returns {Promise<boolean>} Whether the replacement succeeded.
   */
  async replace(index) {
    if (index < 0 || index >= this._connections.length) {
      return false;
    }

    // Destroy old connection if it exists
    const old = this._connections[index];
    if (old && typeof old.destroy === 'function') {
      try {
        await old.destroy();
      } catch (_err) {
        // Ignore cleanup errors
      }
    }

    try {
      const transport = await this._factory();
      this._connections[index] = transport;
      return true;
    } catch (err) {
      this._connections[index] = null;
      this._emitError(err);
      return false;
    }
  }

  /**
   * Drain the pool: close all connections and reset state.
   *
   * @returns {Promise<void>}
   */
  async drain() {
    this._draining = true;

    const closePromises = this._connections.map(async (conn) => {
      if (conn && typeof conn.destroy === 'function') {
        try {
          await conn.destroy();
        } catch (_err) {
          // Ignore cleanup errors during drain
        }
      }
    });

    await Promise.all(closePromises);

    this._connections = [];
    this._roundRobinIndex = 0;
    this._initialized = false;
    this._draining = false;
    this.emit('drained');
  }

  /**
   * Get the status of each connection in the pool.
   *
   * @returns {Array<{index: number, active: boolean}>}
   */
  getStatus() {
    return this._connections.map((conn, index) => ({
      index,
      active: conn !== null && typeof conn.isOpen === 'function' && conn.isOpen()
    }));
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

module.exports = ConnectionPool;
