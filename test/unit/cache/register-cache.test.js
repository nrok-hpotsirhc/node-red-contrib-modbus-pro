'use strict';

const { expect } = require('chai');
const sinon = require('sinon');
const { RegisterCache, DEFAULTS, WRITE_TO_READ_FC, cacheKey } = require('../../../src/lib/cache/register-cache');

describe('RegisterCache', function () {

  let clock;

  afterEach(function () {
    if (clock) {
      clock.restore();
      clock = null;
    }
  });

  // ── Constructor & Configuration ──────────────────────────────────

  describe('constructor', function () {

    it('should create a disabled cache with default options', function () {
      const cache = new RegisterCache();
      expect(cache.enabled).to.be.false;
      expect(cache.size).to.equal(0);
      cache.destroy();
    });

    it('should create an enabled cache with custom options', function () {
      const cache = new RegisterCache({
        enabled: true,
        maxSize: 500,
        defaultTTL: 30000,
        cleanupInterval: 5000
      });
      expect(cache.enabled).to.be.true;
      expect(cache._maxSize).to.equal(500);
      expect(cache._defaultTTL).to.equal(30000);
      cache.destroy();
    });

    it('should throw TypeError for non-boolean enabled', function () {
      expect(() => new RegisterCache({ enabled: 'yes' }))
        .to.throw(TypeError, 'enabled must be a boolean');
    });

    it('should throw RangeError for maxSize < 1', function () {
      expect(() => new RegisterCache({ maxSize: 0 }))
        .to.throw(RangeError, 'maxSize must be between 1 and 1000000');
    });

    it('should throw RangeError for maxSize > 1000000', function () {
      expect(() => new RegisterCache({ maxSize: 1000001 }))
        .to.throw(RangeError, 'maxSize must be between 1 and 1000000');
    });

    it('should throw RangeError for non-finite maxSize', function () {
      expect(() => new RegisterCache({ maxSize: NaN }))
        .to.throw(RangeError, 'maxSize must be between 1 and 1000000');
    });

    it('should throw RangeError for negative defaultTTL', function () {
      expect(() => new RegisterCache({ defaultTTL: -1 }))
        .to.throw(RangeError, 'defaultTTL must be a non-negative finite number');
    });

    it('should throw RangeError for non-finite defaultTTL', function () {
      expect(() => new RegisterCache({ defaultTTL: Infinity }))
        .to.throw(RangeError, 'defaultTTL must be a non-negative finite number');
    });

    it('should throw RangeError for cleanupInterval < 1000', function () {
      expect(() => new RegisterCache({ cleanupInterval: 500 }))
        .to.throw(RangeError, 'cleanupInterval must be at least 1000ms');
    });

    it('should accept maxSize = 1', function () {
      const cache = new RegisterCache({ maxSize: 1 });
      expect(cache._maxSize).to.equal(1);
      cache.destroy();
    });

    it('should accept defaultTTL = 0 (no expiration)', function () {
      const cache = new RegisterCache({ defaultTTL: 0 });
      expect(cache._defaultTTL).to.equal(0);
      cache.destroy();
    });

    it('should start cleanup timer when enabled', function () {
      const cache = new RegisterCache({ enabled: true, cleanupInterval: 5000 });
      expect(cache._cleanupTimer).to.not.be.null;
      cache.destroy();
    });

    it('should not start cleanup timer when disabled', function () {
      const cache = new RegisterCache({ enabled: false });
      expect(cache._cleanupTimer).to.be.null;
      cache.destroy();
    });
  });

  // ── cacheKey helper ──────────────────────────────────────────────

  describe('cacheKey()', function () {

    it('should generate a unique key from fc, unitId, address', function () {
      expect(cacheKey(3, 1, 100)).to.equal('3:1:100');
    });

    it('should produce different keys for different function codes', function () {
      expect(cacheKey(3, 1, 100)).to.not.equal(cacheKey(4, 1, 100));
    });

    it('should produce different keys for different unit IDs', function () {
      expect(cacheKey(3, 1, 100)).to.not.equal(cacheKey(3, 2, 100));
    });

    it('should produce different keys for different addresses', function () {
      expect(cacheKey(3, 1, 100)).to.not.equal(cacheKey(3, 1, 101));
    });
  });

  // ── WRITE_TO_READ_FC mapping ─────────────────────────────────────

  describe('WRITE_TO_READ_FC', function () {

    it('should map FC 05 (Write Single Coil) to FC 01 (Read Coils)', function () {
      expect(WRITE_TO_READ_FC[5]).to.equal(1);
    });

    it('should map FC 06 (Write Single Register) to FC 03 (Read Holding Registers)', function () {
      expect(WRITE_TO_READ_FC[6]).to.equal(3);
    });

    it('should map FC 15 (Write Multiple Coils) to FC 01 (Read Coils)', function () {
      expect(WRITE_TO_READ_FC[15]).to.equal(1);
    });

    it('should map FC 16 (Write Multiple Registers) to FC 03 (Read Holding Registers)', function () {
      expect(WRITE_TO_READ_FC[16]).to.equal(3);
    });
  });

  // ── get / set ────────────────────────────────────────────────────

  describe('get() and set()', function () {

    it('should return undefined when cache is disabled', function () {
      const cache = new RegisterCache({ enabled: false });
      cache._enabled = false; // ensure
      cache.set(3, 1, 100, 2, [1234, 5678]);
      expect(cache.get(3, 1, 100, 2)).to.be.undefined;
      cache.destroy();
    });

    it('should store and retrieve a value', function () {
      const cache = new RegisterCache({ enabled: true });
      const data = [1234, 5678]; // TEST-DATA: holding registers
      cache.set(3, 1, 100, 2, data);
      expect(cache.get(3, 1, 100, 2)).to.deep.equal(data);
      cache.destroy();
    });

    it('should return undefined for cache miss', function () {
      const cache = new RegisterCache({ enabled: true });
      expect(cache.get(3, 1, 999, 1)).to.be.undefined;
      cache.destroy();
    });

    it('should differentiate by function code', function () {
      const cache = new RegisterCache({ enabled: true });
      cache.set(3, 1, 100, 1, [111]); // TEST-DATA: FC 03 data
      cache.set(4, 1, 100, 1, [222]); // TEST-DATA: FC 04 data
      expect(cache.get(3, 1, 100, 1)).to.deep.equal([111]);
      expect(cache.get(4, 1, 100, 1)).to.deep.equal([222]);
      cache.destroy();
    });

    it('should differentiate by unit ID', function () {
      const cache = new RegisterCache({ enabled: true });
      cache.set(3, 1, 100, 1, [111]); // TEST-DATA: unit 1
      cache.set(3, 2, 100, 1, [222]); // TEST-DATA: unit 2
      expect(cache.get(3, 1, 100, 1)).to.deep.equal([111]);
      expect(cache.get(3, 2, 100, 1)).to.deep.equal([222]);
      cache.destroy();
    });

    it('should return undefined when quantity does not match', function () {
      const cache = new RegisterCache({ enabled: true });
      cache.set(3, 1, 100, 2, [1234, 5678]);
      expect(cache.get(3, 1, 100, 1)).to.be.undefined; // different quantity
      cache.destroy();
    });

    it('should overwrite existing entry with same key', function () {
      const cache = new RegisterCache({ enabled: true });
      cache.set(3, 1, 100, 2, [100, 200]);
      cache.set(3, 1, 100, 2, [300, 400]);
      expect(cache.get(3, 1, 100, 2)).to.deep.equal([300, 400]);
      expect(cache.size).to.equal(1);
      cache.destroy();
    });

    it('should store boolean values for coils (FC 01)', function () {
      const cache = new RegisterCache({ enabled: true });
      cache.set(1, 1, 0, 1, true); // TEST-DATA: coil on
      expect(cache.get(1, 1, 0, 1)).to.be.true;
      cache.destroy();
    });

    it('should store integer for single register', function () {
      const cache = new RegisterCache({ enabled: true });
      cache.set(3, 1, 100, 1, 42); // TEST-DATA: single register
      expect(cache.get(3, 1, 100, 1)).to.equal(42);
      cache.destroy();
    });
  });

  // ── TTL Expiration ───────────────────────────────────────────────

  describe('TTL expiration', function () {

    it('should expire entries after defaultTTL', function () {
      clock = sinon.useFakeTimers();
      const cache = new RegisterCache({ enabled: true, defaultTTL: 1000 });
      cache.set(3, 1, 100, 1, [42]);

      expect(cache.get(3, 1, 100, 1)).to.deep.equal([42]); // still fresh

      clock.tick(1001);
      expect(cache.get(3, 1, 100, 1)).to.be.undefined; // expired
      cache.destroy();
    });

    it('should expire entries with custom TTL', function () {
      clock = sinon.useFakeTimers();
      const cache = new RegisterCache({ enabled: true, defaultTTL: 60000 });
      cache.set(3, 1, 100, 1, [42], 500); // 500ms TTL

      clock.tick(501);
      expect(cache.get(3, 1, 100, 1)).to.be.undefined;
      cache.destroy();
    });

    it('should not expire entries with TTL = 0 (no expiration)', function () {
      clock = sinon.useFakeTimers();
      const cache = new RegisterCache({ enabled: true, defaultTTL: 1000 });
      cache.set(3, 1, 100, 1, [42], 0); // no expiration

      clock.tick(100000);
      expect(cache.get(3, 1, 100, 1)).to.deep.equal([42]);
      cache.destroy();
    });

    it('should not expire entries when defaultTTL is 0', function () {
      clock = sinon.useFakeTimers();
      const cache = new RegisterCache({ enabled: true, defaultTTL: 0 });
      cache.set(3, 1, 100, 1, [42]);

      clock.tick(100000);
      expect(cache.get(3, 1, 100, 1)).to.deep.equal([42]);
      cache.destroy();
    });

    it('should remove expired entries during cleanup', function () {
      clock = sinon.useFakeTimers();
      const cache = new RegisterCache({
        enabled: true,
        defaultTTL: 1000,
        cleanupInterval: 2000
      });

      cache.set(3, 1, 100, 1, [42]);
      expect(cache.size).to.equal(1);

      clock.tick(2001); // triggers cleanup after TTL expired
      expect(cache.size).to.equal(0);
      cache.destroy();
    });
  });

  // ── Max Size Eviction ────────────────────────────────────────────

  describe('max size eviction', function () {

    it('should evict oldest entry when maxSize is reached', function () {
      const cache = new RegisterCache({ enabled: true, maxSize: 3 });
      cache.set(3, 1, 0, 1, [10]); // oldest
      cache.set(3, 1, 1, 1, [20]);
      cache.set(3, 1, 2, 1, [30]);

      // Adding a 4th should evict the oldest (address 0)
      cache.set(3, 1, 3, 1, [40]);
      expect(cache.size).to.equal(3);
      expect(cache.get(3, 1, 0, 1)).to.be.undefined; // evicted
      expect(cache.get(3, 1, 3, 1)).to.deep.equal([40]); // newest
      cache.destroy();
    });

    it('should not evict when updating existing key at capacity', function () {
      const cache = new RegisterCache({ enabled: true, maxSize: 2 });
      cache.set(3, 1, 0, 1, [10]);
      cache.set(3, 1, 1, 1, [20]);

      // Update existing key should not evict
      cache.set(3, 1, 0, 1, [99]);
      expect(cache.size).to.equal(2);
      expect(cache.get(3, 1, 0, 1)).to.deep.equal([99]);
      expect(cache.get(3, 1, 1, 1)).to.deep.equal([20]);
      cache.destroy();
    });

    it('should emit evict event with reason "size"', function () {
      const cache = new RegisterCache({ enabled: true, maxSize: 1 });
      const events = [];
      cache.on('evict', (e) => events.push(e));

      cache.set(3, 1, 0, 1, [10]);
      cache.set(3, 1, 1, 1, [20]); // triggers eviction

      expect(events).to.have.length(1);
      expect(events[0].reason).to.equal('size');
      cache.destroy();
    });
  });

  // ── Write Invalidation ───────────────────────────────────────────

  describe('invalidateOnWrite()', function () {

    it('should invalidate FC 01 entries on FC 05 write', function () {
      const cache = new RegisterCache({ enabled: true });
      cache.set(1, 1, 10, 1, true); // FC 01 coil
      cache.invalidateOnWrite(5, 1, 10);
      expect(cache.get(1, 1, 10, 1)).to.be.undefined;
      cache.destroy();
    });

    it('should invalidate FC 03 entries on FC 06 write', function () {
      const cache = new RegisterCache({ enabled: true });
      cache.set(3, 1, 100, 1, [42]); // FC 03 register
      cache.invalidateOnWrite(6, 1, 100);
      expect(cache.get(3, 1, 100, 1)).to.be.undefined;
      cache.destroy();
    });

    it('should invalidate multiple FC 01 entries on FC 15 write', function () {
      const cache = new RegisterCache({ enabled: true });
      cache.set(1, 1, 0, 1, true);
      cache.set(1, 1, 1, 1, false);
      cache.set(1, 1, 2, 1, true);

      cache.invalidateOnWrite(15, 1, 0, 3); // write 3 coils starting at 0
      expect(cache.get(1, 1, 0, 1)).to.be.undefined;
      expect(cache.get(1, 1, 1, 1)).to.be.undefined;
      expect(cache.get(1, 1, 2, 1)).to.be.undefined;
      cache.destroy();
    });

    it('should invalidate multiple FC 03 entries on FC 16 write', function () {
      const cache = new RegisterCache({ enabled: true });
      cache.set(3, 1, 100, 1, [10]);
      cache.set(3, 1, 101, 1, [20]);

      cache.invalidateOnWrite(16, 1, 100, 2);
      expect(cache.get(3, 1, 100, 1)).to.be.undefined;
      expect(cache.get(3, 1, 101, 1)).to.be.undefined;
      cache.destroy();
    });

    it('should not invalidate entries from different unit ID', function () {
      const cache = new RegisterCache({ enabled: true });
      cache.set(3, 1, 100, 1, [42]); // unit 1
      cache.set(3, 2, 100, 1, [84]); // unit 2

      cache.invalidateOnWrite(6, 1, 100);
      expect(cache.get(3, 1, 100, 1)).to.be.undefined; // invalidated
      expect(cache.get(3, 2, 100, 1)).to.deep.equal([84]); // untouched
      cache.destroy();
    });

    it('should do nothing for non-write function codes', function () {
      const cache = new RegisterCache({ enabled: true });
      cache.set(3, 1, 100, 1, [42]);
      cache.invalidateOnWrite(3, 1, 100); // FC 03 is a read, no invalidation
      expect(cache.get(3, 1, 100, 1)).to.deep.equal([42]);
      cache.destroy();
    });

    it('should do nothing when cache is disabled', function () {
      const cache = new RegisterCache({ enabled: false });
      // no-op, should not throw
      cache.invalidateOnWrite(6, 1, 100);
      cache.destroy();
    });

    it('should emit evict event with reason "write"', function () {
      const cache = new RegisterCache({ enabled: true });
      const events = [];
      cache.on('evict', (e) => events.push(e));

      cache.set(3, 1, 100, 1, [42]);
      cache.invalidateOnWrite(6, 1, 100);

      expect(events).to.have.length(1);
      expect(events[0].reason).to.equal('write');
      cache.destroy();
    });
  });

  // ── invalidateUnit ───────────────────────────────────────────────

  describe('invalidateUnit()', function () {

    it('should clear all entries for a specific unit ID', function () {
      const cache = new RegisterCache({ enabled: true });
      cache.set(3, 1, 100, 1, [10]);
      cache.set(3, 1, 200, 1, [20]);
      cache.set(3, 2, 100, 1, [30]); // different unit

      cache.invalidateUnit(1);
      expect(cache.size).to.equal(1);
      expect(cache.get(3, 1, 100, 1)).to.be.undefined;
      expect(cache.get(3, 2, 100, 1)).to.deep.equal([30]);
      cache.destroy();
    });

    it('should do nothing when cache is disabled', function () {
      const cache = new RegisterCache({ enabled: false });
      cache.invalidateUnit(1);
      cache.destroy();
    });
  });

  // ── clear() ──────────────────────────────────────────────────────

  describe('clear()', function () {

    it('should remove all entries', function () {
      const cache = new RegisterCache({ enabled: true });
      cache.set(3, 1, 100, 1, [10]);
      cache.set(3, 1, 200, 1, [20]);
      cache.clear();
      expect(cache.size).to.equal(0);
      cache.destroy();
    });

    it('should reset hit/miss counters', function () {
      const cache = new RegisterCache({ enabled: true });
      cache.set(3, 1, 100, 1, [10]);
      cache.get(3, 1, 100, 1); // hit
      cache.get(3, 1, 999, 1); // miss
      cache.clear();
      const stats = cache.getStats();
      expect(stats.hits).to.equal(0);
      expect(stats.misses).to.equal(0);
      cache.destroy();
    });

    it('should emit evict event with key "*"', function () {
      const cache = new RegisterCache({ enabled: true });
      const events = [];
      cache.on('evict', (e) => events.push(e));

      cache.set(3, 1, 100, 1, [10]);
      cache.clear();
      expect(events).to.have.length(1);
      expect(events[0].key).to.equal('*');
      expect(events[0].reason).to.equal('manual');
      cache.destroy();
    });

    it('should not emit evict event when already empty', function () {
      const cache = new RegisterCache({ enabled: true });
      const events = [];
      cache.on('evict', (e) => events.push(e));

      cache.clear();
      expect(events).to.have.length(0);
      cache.destroy();
    });
  });

  // ── setEnabled() ─────────────────────────────────────────────────

  describe('setEnabled()', function () {

    it('should enable caching and start cleanup timer', function () {
      const cache = new RegisterCache({ enabled: false });
      expect(cache._cleanupTimer).to.be.null;

      cache.setEnabled(true);
      expect(cache.enabled).to.be.true;
      expect(cache._cleanupTimer).to.not.be.null;
      cache.destroy();
    });

    it('should disable caching, clear data, and stop cleanup timer', function () {
      const cache = new RegisterCache({ enabled: true });
      cache.set(3, 1, 100, 1, [42]);
      expect(cache.size).to.equal(1);

      cache.setEnabled(false);
      expect(cache.enabled).to.be.false;
      expect(cache.size).to.equal(0);
      expect(cache._cleanupTimer).to.be.null;
      cache.destroy();
    });

    it('should throw TypeError for non-boolean', function () {
      const cache = new RegisterCache();
      expect(() => cache.setEnabled(1))
        .to.throw(TypeError, 'enabled must be a boolean');
      cache.destroy();
    });

    it('should be idempotent when already enabled', function () {
      const cache = new RegisterCache({ enabled: true });
      const timer = cache._cleanupTimer;
      cache.setEnabled(true);
      expect(cache._cleanupTimer).to.equal(timer);
      cache.destroy();
    });
  });

  // ── Events ───────────────────────────────────────────────────────

  describe('events', function () {

    it('should emit "hit" on cache hit', function () {
      const cache = new RegisterCache({ enabled: true });
      const events = [];
      cache.on('hit', (e) => events.push(e));

      cache.set(3, 1, 100, 2, [42, 43]);
      cache.get(3, 1, 100, 2);

      expect(events).to.have.length(1);
      expect(events[0]).to.deep.equal({ fc: 3, unitId: 1, address: 100 });
      cache.destroy();
    });

    it('should emit "miss" on cache miss', function () {
      const cache = new RegisterCache({ enabled: true });
      const events = [];
      cache.on('miss', (e) => events.push(e));

      cache.get(3, 1, 999, 1);

      expect(events).to.have.length(1);
      expect(events[0]).to.deep.equal({ fc: 3, unitId: 1, address: 999 });
      cache.destroy();
    });

    it('should emit "miss" on expired entry access', function () {
      clock = sinon.useFakeTimers();
      const cache = new RegisterCache({ enabled: true, defaultTTL: 100 });
      const missEvents = [];
      const evictEvents = [];
      cache.on('miss', (e) => missEvents.push(e));
      cache.on('evict', (e) => evictEvents.push(e));

      cache.set(3, 1, 100, 1, [42]);
      clock.tick(101);
      cache.get(3, 1, 100, 1);

      expect(missEvents).to.have.length(1);
      expect(evictEvents).to.have.length(1);
      expect(evictEvents[0].reason).to.equal('ttl');
      cache.destroy();
    });
  });

  // ── getStats() ───────────────────────────────────────────────────

  describe('getStats()', function () {

    it('should return initial stats', function () {
      const cache = new RegisterCache({ enabled: true, maxSize: 500, defaultTTL: 30000 });
      const stats = cache.getStats();
      expect(stats).to.deep.equal({
        enabled: true,
        size: 0,
        maxSize: 500,
        hits: 0,
        misses: 0,
        hitRate: 0,
        defaultTTL: 30000
      });
      cache.destroy();
    });

    it('should track hits and misses correctly', function () {
      const cache = new RegisterCache({ enabled: true });
      cache.set(3, 1, 100, 1, [42]);
      cache.get(3, 1, 100, 1); // hit
      cache.get(3, 1, 100, 1); // hit
      cache.get(3, 1, 999, 1); // miss

      const stats = cache.getStats();
      expect(stats.hits).to.equal(2);
      expect(stats.misses).to.equal(1);
      expect(stats.hitRate).to.be.closeTo(0.6667, 0.001);
      cache.destroy();
    });

    it('should report hitRate as 0 when no operations', function () {
      const cache = new RegisterCache({ enabled: true });
      expect(cache.getStats().hitRate).to.equal(0);
      cache.destroy();
    });
  });

  // ── destroy() ────────────────────────────────────────────────────

  describe('destroy()', function () {

    it('should clear store and stop timer', function () {
      const cache = new RegisterCache({ enabled: true });
      cache.set(3, 1, 100, 1, [42]);
      cache.destroy();

      expect(cache.size).to.equal(0);
      expect(cache._cleanupTimer).to.be.null;
      expect(cache._destroyed).to.be.true;
    });

    it('should be idempotent', function () {
      const cache = new RegisterCache({ enabled: true });
      cache.destroy();
      cache.destroy(); // should not throw
      expect(cache._destroyed).to.be.true;
    });

    it('should remove all event listeners', function () {
      const cache = new RegisterCache({ enabled: true });
      cache.on('hit', () => {});
      cache.on('miss', () => {});
      cache.destroy();
      expect(cache.listenerCount('hit')).to.equal(0);
      expect(cache.listenerCount('miss')).to.equal(0);
    });
  });

  // ── DEFAULTS export ──────────────────────────────────────────────

  describe('DEFAULTS', function () {

    it('should export frozen default configuration', function () {
      expect(DEFAULTS).to.be.frozen;
      expect(DEFAULTS.enabled).to.be.false;
      expect(DEFAULTS.maxSize).to.equal(10000);
      expect(DEFAULTS.defaultTTL).to.equal(60000);
      expect(DEFAULTS.cleanupInterval).to.equal(30000);
    });
  });

  // ── Edge Cases ───────────────────────────────────────────────────

  describe('edge cases', function () {

    it('should handle address 0 correctly', function () {
      const cache = new RegisterCache({ enabled: true });
      cache.set(3, 0, 0, 1, [0]); // TEST-DATA: unit 0, address 0
      expect(cache.get(3, 0, 0, 1)).to.deep.equal([0]);
      cache.destroy();
    });

    it('should handle unit ID 255 (broadcast)', function () {
      const cache = new RegisterCache({ enabled: true });
      cache.set(3, 255, 100, 1, [42]);
      expect(cache.get(3, 255, 100, 1)).to.deep.equal([42]);
      cache.destroy();
    });

    it('should handle large address values', function () {
      const cache = new RegisterCache({ enabled: true });
      cache.set(3, 1, 65535, 1, [42]);
      expect(cache.get(3, 1, 65535, 1)).to.deep.equal([42]);
      cache.destroy();
    });

    it('should handle large arrays as values', function () {
      const cache = new RegisterCache({ enabled: true });
      const data = Array.from({ length: 125 }, (_, i) => i); // TEST-DATA: max register read
      cache.set(3, 1, 0, 125, data);
      expect(cache.get(3, 1, 0, 125)).to.deep.equal(data);
      cache.destroy();
    });

    it('should maintain constant memory under repeated set/get at maxSize', function () {
      const cache = new RegisterCache({ enabled: true, maxSize: 100 });
      for (let i = 0; i < 1000; i++) {
        cache.set(3, 1, i, 1, [i]);
      }
      expect(cache.size).to.equal(100);
      cache.destroy();
    });
  });
});
