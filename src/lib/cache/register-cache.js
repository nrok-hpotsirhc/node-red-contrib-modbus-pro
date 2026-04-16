'use strict';

const { EventEmitter } = require('events');

/**
 * Default configuration for RegisterCache.
 * @readonly
 */
const DEFAULTS = Object.freeze({
  enabled: false,
  maxSize: 10000,
  defaultTTL: 60000,
  cleanupInterval: 30000
});

/**
 * Generate a composite key for a cache entry.
 * Uniquely identifies a register/coil by function code group, unit ID,
 * and address.
 *
 * @param {number} fc - Function code (1-4 for read types).
 * @param {number} unitId - Modbus unit/slave ID.
 * @param {number} address - Start address.
 * @returns {string} Composite key string.
 */
function cacheKey(fc, unitId, address) {
  return `${fc}:${unitId}:${address}`;
}

/**
 * Map write function codes to the corresponding read function codes
 * that should be invalidated.
 *
 * FC 05 (Write Single Coil) → FC 01 (Read Coils)
 * FC 06 (Write Single Register) → FC 03 (Read Holding Registers)
 * FC 15 (Write Multiple Coils) → FC 01 (Read Coils)
 * FC 16 (Write Multiple Registers) → FC 03 (Read Holding Registers)
 *
 * @readonly
 */
const WRITE_TO_READ_FC = Object.freeze({
  5: 1,
  6: 3,
  15: 1,
  16: 3
});

/**
 * In-memory hashmap-based register cache for the Modbus server proxy.
 *
 * Stores responses for Modbus read requests in a Map keyed by
 * function code, unit ID, and address. Supports configurable TTL,
 * max size with LRU-like eviction, and automatic invalidation
 * on write operations.
 *
 * Implements WP 3.4 from WORK_PACKAGES.md.
 *
 * @extends EventEmitter
 *
 * Events:
 * - 'hit'  → { fc, unitId, address } – Cache hit
 * - 'miss' → { fc, unitId, address } – Cache miss
 * - 'evict' → { key, reason } – Entry evicted ('ttl', 'size', 'write', 'manual')
 * - 'stats' → { size, hits, misses, hitRate } – Periodic stats
 */
class RegisterCache extends EventEmitter {
  /**
   * @param {object} [options] - Cache configuration.
   * @param {boolean} [options.enabled=false] - Whether caching is active.
   * @param {number} [options.maxSize=10000] - Maximum number of cache entries.
   * @param {number} [options.defaultTTL=60000] - Default TTL in milliseconds.
   * @param {number} [options.cleanupInterval=30000] - Interval for expired entry cleanup (ms).
   */
  constructor(options) {
    super();
    const opts = Object.assign({}, DEFAULTS, options);

    if (typeof opts.enabled !== 'boolean') {
      throw new TypeError('enabled must be a boolean');
    }
    if (!Number.isFinite(opts.maxSize) || opts.maxSize < 1 || opts.maxSize > 1000000) {
      throw new RangeError('maxSize must be between 1 and 1000000');
    }
    if (!Number.isFinite(opts.defaultTTL) || opts.defaultTTL < 0) {
      throw new RangeError('defaultTTL must be a non-negative finite number');
    }
    if (!Number.isFinite(opts.cleanupInterval) || opts.cleanupInterval < 1000) {
      throw new RangeError('cleanupInterval must be at least 1000ms');
    }

    /** @type {boolean} */
    this._enabled = opts.enabled;

    /** @type {number} */
    this._maxSize = Math.floor(opts.maxSize);

    /** @type {number} */
    this._defaultTTL = Math.floor(opts.defaultTTL);

    /** @type {number} */
    this._cleanupInterval = Math.floor(opts.cleanupInterval);

    /**
     * Internal store: key → { value, expiresAt, fc, unitId, address }
     * @type {Map<string, object>}
     */
    this._store = new Map();

    /** @type {number} */
    this._hits = 0;

    /** @type {number} */
    this._misses = 0;

    /** @type {NodeJS.Timeout|null} */
    this._cleanupTimer = null;

    /** @type {boolean} */
    this._destroyed = false;

    if (this._enabled) {
      this._startCleanup();
    }
  }

  /**
   * Whether the cache is currently enabled.
   * @returns {boolean}
   */
  get enabled() {
    return this._enabled;
  }

  /**
   * Current number of entries in the cache.
   * @returns {number}
   */
  get size() {
    return this._store.size;
  }

  /**
   * Look up a cached response for a Modbus read request.
   *
   * @param {number} fc - Function code (1-4).
   * @param {number} unitId - Unit/slave ID.
   * @param {number} address - Start address.
   * @param {number} quantity - Number of registers/coils requested.
   * @returns {*|undefined} Cached value if found and not expired, undefined otherwise.
   */
  get(fc, unitId, address, quantity) {
    if (!this._enabled) {
      return undefined;
    }

    const key = cacheKey(fc, unitId, address);
    const entry = this._store.get(key);

    if (!entry) {
      this._misses++;
      this.emit('miss', { fc, unitId, address });
      return undefined;
    }

    // Check TTL expiration
    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
      this._store.delete(key);
      this._misses++;
      this.emit('evict', { key, reason: 'ttl' });
      this.emit('miss', { fc, unitId, address });
      return undefined;
    }

    // Verify quantity matches (prevents returning partial data)
    if (entry.quantity !== quantity) {
      this._misses++;
      this.emit('miss', { fc, unitId, address });
      return undefined;
    }

    this._hits++;
    this.emit('hit', { fc, unitId, address });
    return entry.value;
  }

  /**
   * Store a response value in the cache.
   *
   * @param {number} fc - Function code (1-4).
   * @param {number} unitId - Unit/slave ID.
   * @param {number} address - Start address.
   * @param {number} quantity - Number of registers/coils.
   * @param {*} value - The response data to cache.
   * @param {number} [ttl] - TTL in ms. Defaults to defaultTTL. 0 = no expiration.
   */
  set(fc, unitId, address, quantity, value, ttl) {
    if (!this._enabled) {
      return;
    }

    const key = cacheKey(fc, unitId, address);
    const effectiveTTL = ttl !== undefined ? ttl : this._defaultTTL;
    const expiresAt = effectiveTTL > 0 ? Date.now() + effectiveTTL : 0;

    // Evict if at capacity and this is a new key
    if (!this._store.has(key) && this._store.size >= this._maxSize) {
      this._evictOldest();
    }

    // Delete and re-insert to maintain insertion order (Map preserves order)
    this._store.delete(key);
    this._store.set(key, {
      value,
      expiresAt,
      quantity,
      fc,
      unitId,
      address
    });
  }

  /**
   * Invalidate cache entries affected by a write operation.
   * When a write FC (05/06/15/16) occurs, the corresponding read FC
   * entries at the affected addresses are removed.
   *
   * @param {number} fc - Write function code (5, 6, 15, 16).
   * @param {number} unitId - Unit/slave ID.
   * @param {number} address - Start address.
   * @param {number} [count=1] - Number of registers/coils written.
   */
  invalidateOnWrite(fc, unitId, address, count) {
    if (!this._enabled) {
      return;
    }

    const readFc = WRITE_TO_READ_FC[fc];
    if (readFc === undefined) {
      return;
    }

    const num = count || 1;
    for (let i = 0; i < num; i++) {
      const key = cacheKey(readFc, unitId, address + i);
      if (this._store.has(key)) {
        this._store.delete(key);
        this.emit('evict', { key, reason: 'write' });
      }
    }
  }

  /**
   * Invalidate all entries for a specific unit ID.
   *
   * @param {number} unitId - Unit/slave ID to clear.
   */
  invalidateUnit(unitId) {
    if (!this._enabled) {
      return;
    }

    for (const [key, entry] of this._store) {
      if (entry.unitId === unitId) {
        this._store.delete(key);
        this.emit('evict', { key, reason: 'manual' });
      }
    }
  }

  /**
   * Clear all cache entries.
   */
  clear() {
    const previousSize = this._store.size;
    this._store.clear();
    this._hits = 0;
    this._misses = 0;
    if (previousSize > 0) {
      this.emit('evict', { key: '*', reason: 'manual' });
    }
  }

  /**
   * Enable or disable the cache at runtime.
   *
   * @param {boolean} enabled - New enabled state.
   */
  setEnabled(enabled) {
    if (typeof enabled !== 'boolean') {
      throw new TypeError('enabled must be a boolean');
    }
    const wasEnabled = this._enabled;
    this._enabled = enabled;

    if (enabled && !wasEnabled) {
      this._startCleanup();
    } else if (!enabled && wasEnabled) {
      this._stopCleanup();
      this.clear();
    }
  }

  /**
   * Get cache performance statistics.
   *
   * @returns {{ enabled: boolean, size: number, maxSize: number, hits: number, misses: number, hitRate: number, defaultTTL: number }}
   */
  getStats() {
    const total = this._hits + this._misses;
    return {
      enabled: this._enabled,
      size: this._store.size,
      maxSize: this._maxSize,
      hits: this._hits,
      misses: this._misses,
      hitRate: total > 0 ? this._hits / total : 0,
      defaultTTL: this._defaultTTL
    };
  }

  /**
   * Destroy the cache, stopping timers and clearing all data.
   */
  destroy() {
    if (this._destroyed) {
      return;
    }
    this._destroyed = true;
    this._stopCleanup();
    this._store.clear();
    this._hits = 0;
    this._misses = 0;
    this.removeAllListeners();
  }

  /**
   * Evict the oldest entry (first inserted, Map iteration order).
   * @private
   */
  _evictOldest() {
    const firstKey = this._store.keys().next().value;
    if (firstKey !== undefined) {
      this._store.delete(firstKey);
      this.emit('evict', { key: firstKey, reason: 'size' });
    }
  }

  /**
   * Remove all expired entries from the store.
   * @private
   */
  _cleanupExpired() {
    const now = Date.now();
    for (const [key, entry] of this._store) {
      if (entry.expiresAt > 0 && now > entry.expiresAt) {
        this._store.delete(key);
        this.emit('evict', { key, reason: 'ttl' });
      }
    }
  }

  /**
   * Start the periodic cleanup timer.
   * @private
   */
  _startCleanup() {
    if (this._cleanupTimer) {
      return;
    }
    this._cleanupTimer = setInterval(() => {
      this._cleanupExpired();
    }, this._cleanupInterval);

    // Unref to not prevent Node.js from exiting
    if (this._cleanupTimer.unref) {
      this._cleanupTimer.unref();
    }
  }

  /**
   * Stop the periodic cleanup timer.
   * @private
   */
  _stopCleanup() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
  }
}

module.exports = { RegisterCache, DEFAULTS, WRITE_TO_READ_FC, cacheKey };
