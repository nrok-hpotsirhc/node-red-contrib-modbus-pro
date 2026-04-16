'use strict';

const { expect } = require('chai');
const sinon = require('sinon');
const BackpressureQueue = require('../../../src/lib/queue/backpressure-queue');
const { DROP_STRATEGY, DEFAULTS } = BackpressureQueue;

describe('BackpressureQueue', function () {

  // ---- Constructor / Defaults ----

  describe('constructor', function () {
    it('should create a queue with default options', function () {
      const q = new BackpressureQueue();
      expect(q.maxSize).to.equal(100);
      expect(q.dropStrategy).to.equal('fifo');
      expect(q.length).to.equal(0);
      expect(q.isEmpty()).to.be.true;
      expect(q.isFull()).to.be.false;
    });

    it('should accept custom maxSize', function () {
      const q = new BackpressureQueue({ maxSize: 50 });
      expect(q.maxSize).to.equal(50);
    });

    it('should accept custom dropStrategy', function () {
      const q = new BackpressureQueue({ dropStrategy: 'lifo' });
      expect(q.dropStrategy).to.equal('lifo');
    });

    it('should accept custom highWaterMark', function () {
      const q = new BackpressureQueue({ highWaterMark: 0.5 });
      // highWaterMark is internal, verify via behavior later
      expect(q).to.be.instanceOf(BackpressureQueue);
    });

    it('should throw RangeError for maxSize < 1', function () {
      expect(() => new BackpressureQueue({ maxSize: 0 })).to.throw(RangeError);
    });

    it('should throw RangeError for maxSize > 10000', function () {
      expect(() => new BackpressureQueue({ maxSize: 10001 })).to.throw(RangeError);
    });

    it('should throw RangeError for non-integer maxSize', function () {
      expect(() => new BackpressureQueue({ maxSize: 1.5 })).to.throw(RangeError);
    });

    it('should throw TypeError for invalid dropStrategy', function () {
      expect(() => new BackpressureQueue({ dropStrategy: 'random' })).to.throw(TypeError);
    });

    it('should throw RangeError for highWaterMark < 0', function () {
      expect(() => new BackpressureQueue({ highWaterMark: -0.1 })).to.throw(RangeError);
    });

    it('should throw RangeError for highWaterMark > 1', function () {
      expect(() => new BackpressureQueue({ highWaterMark: 1.1 })).to.throw(RangeError);
    });
  });

  // ---- Constants ----

  describe('DROP_STRATEGY', function () {
    it('should export FIFO and LIFO', function () {
      expect(DROP_STRATEGY.FIFO).to.equal('fifo');
      expect(DROP_STRATEGY.LIFO).to.equal('lifo');
    });

    it('should be frozen', function () {
      expect(Object.isFrozen(DROP_STRATEGY)).to.be.true;
    });
  });

  describe('DEFAULTS', function () {
    it('should have expected values', function () {
      expect(DEFAULTS.maxSize).to.equal(100);
      expect(DEFAULTS.dropStrategy).to.equal('fifo');
      expect(DEFAULTS.highWaterMark).to.equal(0.8);
    });

    it('should be frozen', function () {
      expect(Object.isFrozen(DEFAULTS)).to.be.true;
    });
  });

  // ---- Enqueue / Dequeue Basic ----

  describe('enqueue() and dequeue()', function () {
    it('should enqueue and dequeue in FIFO order', function () {
      const q = new BackpressureQueue({ maxSize: 10 });
      q.enqueue('a'); // TEST-DATA: queue item 'a'
      q.enqueue('b'); // TEST-DATA: queue item 'b'
      q.enqueue('c'); // TEST-DATA: queue item 'c'
      expect(q.length).to.equal(3);
      expect(q.dequeue()).to.equal('a');
      expect(q.dequeue()).to.equal('b');
      expect(q.dequeue()).to.equal('c');
      expect(q.length).to.equal(0);
    });

    it('should return enqueued: true when under limit', function () {
      const q = new BackpressureQueue({ maxSize: 5 });
      const result = q.enqueue('x'); // TEST-DATA: queue item 'x'
      expect(result.enqueued).to.be.true;
      expect(result.dropped).to.be.null;
    });

    it('should return undefined when dequeuing from empty queue', function () {
      const q = new BackpressureQueue();
      expect(q.dequeue()).to.be.undefined;
    });
  });

  // ---- peek() ----

  describe('peek()', function () {
    it('should return the front item without removing it', function () {
      const q = new BackpressureQueue({ maxSize: 5 });
      q.enqueue('first'); // TEST-DATA: queue item 'first'
      q.enqueue('second'); // TEST-DATA: queue item 'second'
      expect(q.peek()).to.equal('first');
      expect(q.length).to.equal(2);
    });

    it('should return undefined on empty queue', function () {
      const q = new BackpressureQueue();
      expect(q.peek()).to.be.undefined;
    });
  });

  // ---- isFull() / isEmpty() ----

  describe('isFull() and isEmpty()', function () {
    it('should report full when at capacity', function () {
      const q = new BackpressureQueue({ maxSize: 2 });
      q.enqueue(1); // TEST-DATA: item 1
      expect(q.isFull()).to.be.false;
      q.enqueue(2); // TEST-DATA: item 2
      expect(q.isFull()).to.be.true;
    });

    it('should report empty after draining', function () {
      const q = new BackpressureQueue({ maxSize: 2 });
      q.enqueue(1); // TEST-DATA: item 1
      q.dequeue();
      expect(q.isEmpty()).to.be.true;
    });
  });

  // ---- FIFO Drop Strategy ----

  describe('FIFO drop strategy', function () {
    it('should drop oldest item when full', function () {
      const q = new BackpressureQueue({ maxSize: 3, dropStrategy: 'fifo' });
      q.enqueue('a'); // TEST-DATA: item 'a'
      q.enqueue('b'); // TEST-DATA: item 'b'
      q.enqueue('c'); // TEST-DATA: item 'c'
      expect(q.isFull()).to.be.true;

      const result = q.enqueue('d'); // TEST-DATA: item 'd' (triggers drop)
      expect(result.enqueued).to.be.true;
      expect(result.dropped).to.equal('a'); // Oldest dropped
      expect(q.length).to.equal(3);
      expect(q.dequeue()).to.equal('b');
      expect(q.dequeue()).to.equal('c');
      expect(q.dequeue()).to.equal('d');
    });

    it('should emit drop event with fifo_overflow reason', function () {
      const q = new BackpressureQueue({ maxSize: 2, dropStrategy: 'fifo' });
      const spy = sinon.spy();
      q.on('drop', spy);

      q.enqueue(1); // TEST-DATA: fill
      q.enqueue(2); // TEST-DATA: fill
      q.enqueue(3); // TEST-DATA: overflow trigger

      expect(spy.calledOnce).to.be.true;
      expect(spy.firstCall.args[0].item).to.equal(1);
      expect(spy.firstCall.args[0].reason).to.equal('fifo_overflow');
    });

    it('should continuously drop oldest under flooding', function () {
      const q = new BackpressureQueue({ maxSize: 3, dropStrategy: 'fifo' });
      for (let i = 0; i < 100; i++) { // TEST-DATA: integers 0-99 as flood items
        q.enqueue(i);
      }
      expect(q.length).to.equal(3);
      expect(q.dequeue()).to.equal(97);
      expect(q.dequeue()).to.equal(98);
      expect(q.dequeue()).to.equal(99);
    });
  });

  // ---- LIFO Drop Strategy ----

  describe('LIFO drop strategy', function () {
    it('should reject new item when full', function () {
      const q = new BackpressureQueue({ maxSize: 3, dropStrategy: 'lifo' });
      q.enqueue('a'); // TEST-DATA: item 'a'
      q.enqueue('b'); // TEST-DATA: item 'b'
      q.enqueue('c'); // TEST-DATA: item 'c'

      const result = q.enqueue('d'); // TEST-DATA: rejected item
      expect(result.enqueued).to.be.false;
      expect(result.dropped).to.equal('d'); // Newest rejected
      expect(q.length).to.equal(3);
      expect(q.dequeue()).to.equal('a');
    });

    it('should emit drop event with lifo_overflow reason', function () {
      const q = new BackpressureQueue({ maxSize: 2, dropStrategy: 'lifo' });
      const spy = sinon.spy();
      q.on('drop', spy);

      q.enqueue(1); // TEST-DATA: fill
      q.enqueue(2); // TEST-DATA: fill
      q.enqueue(3); // TEST-DATA: overflow trigger

      expect(spy.calledOnce).to.be.true;
      expect(spy.firstCall.args[0].item).to.equal(3);
      expect(spy.firstCall.args[0].reason).to.equal('lifo_overflow');
    });

    it('should keep original items under flooding', function () {
      const q = new BackpressureQueue({ maxSize: 3, dropStrategy: 'lifo' });
      q.enqueue('x'); // TEST-DATA: initial fill
      q.enqueue('y'); // TEST-DATA: initial fill
      q.enqueue('z'); // TEST-DATA: initial fill

      for (let i = 0; i < 50; i++) { // TEST-DATA: overflow items 'overflow-0' to 'overflow-49'
        q.enqueue(`overflow-${i}`);
      }
      expect(q.length).to.equal(3);
      expect(q.dequeue()).to.equal('x');
      expect(q.dequeue()).to.equal('y');
      expect(q.dequeue()).to.equal('z');
    });
  });

  // ---- clear() ----

  describe('clear()', function () {
    it('should remove all items and return count', function () {
      const q = new BackpressureQueue({ maxSize: 10 });
      q.enqueue(1); // TEST-DATA: item
      q.enqueue(2); // TEST-DATA: item
      q.enqueue(3); // TEST-DATA: item
      const count = q.clear();
      expect(count).to.equal(3);
      expect(q.length).to.equal(0);
      expect(q.isEmpty()).to.be.true;
    });

    it('should return 0 on empty queue', function () {
      const q = new BackpressureQueue();
      expect(q.clear()).to.equal(0);
    });

    it('should emit drain event when clearing non-empty queue', function () {
      const q = new BackpressureQueue({ maxSize: 5 });
      const spy = sinon.spy();
      q.on('drain', spy);

      q.enqueue(1); // TEST-DATA: item
      q.clear();
      expect(spy.calledOnce).to.be.true;
    });
  });

  // ---- getStats() ----

  describe('getStats()', function () {
    it('should return accurate statistics', function () {
      const q = new BackpressureQueue({ maxSize: 5, dropStrategy: 'fifo' });
      q.enqueue('a'); // TEST-DATA: item
      q.enqueue('b'); // TEST-DATA: item
      q.dequeue();

      const stats = q.getStats();
      expect(stats.length).to.equal(1);
      expect(stats.maxSize).to.equal(5);
      expect(stats.dropStrategy).to.equal('fifo');
      expect(stats.totalEnqueued).to.equal(2);
      expect(stats.totalDequeued).to.equal(1);
      expect(stats.totalDropped).to.equal(0);
      expect(stats.utilization).to.equal(0.2);
    });

    it('should track dropped items in stats', function () {
      const q = new BackpressureQueue({ maxSize: 2, dropStrategy: 'fifo' });
      q.enqueue(1); // TEST-DATA: fill
      q.enqueue(2); // TEST-DATA: fill
      q.enqueue(3); // TEST-DATA: overflow

      const stats = q.getStats();
      expect(stats.totalDropped).to.equal(1);
      expect(stats.totalEnqueued).to.equal(3);
    });
  });

  // ---- High Water / Low Water Events ----

  describe('highWater and lowWater events', function () {
    it('should emit highWater when crossing threshold', function () {
      const q = new BackpressureQueue({ maxSize: 10, highWaterMark: 0.5 });
      const spy = sinon.spy();
      q.on('highWater', spy);

      for (let i = 0; i < 4; i++) q.enqueue(i);
      expect(spy.called).to.be.false;

      q.enqueue(4); // 5/10 = 0.5 → crosses threshold
      expect(spy.calledOnce).to.be.true;
      expect(spy.firstCall.args[0].queueLength).to.equal(5);
    });

    it('should not re-emit highWater while still above threshold', function () {
      const q = new BackpressureQueue({ maxSize: 10, highWaterMark: 0.5 });
      const spy = sinon.spy();
      q.on('highWater', spy);

      for (let i = 0; i < 8; i++) q.enqueue(i);
      expect(spy.calledOnce).to.be.true; // Only once at crossing
    });

    it('should emit lowWater when dropping below threshold', function () {
      const q = new BackpressureQueue({ maxSize: 10, highWaterMark: 0.5 });
      const hwSpy = sinon.spy();
      const lwSpy = sinon.spy();
      q.on('highWater', hwSpy);
      q.on('lowWater', lwSpy);

      for (let i = 0; i < 6; i++) q.enqueue(i);
      expect(hwSpy.calledOnce).to.be.true;

      q.dequeue();
      expect(lwSpy.called).to.be.false; // 5/10 = 0.5, still at mark

      q.dequeue(); // 4/10 = 0.4, below mark
      expect(lwSpy.calledOnce).to.be.true;
    });
  });

  // ---- Enqueue / Dequeue Events ----

  describe('enqueue and dequeue events', function () {
    it('should emit enqueue event with item and queue length', function () {
      const q = new BackpressureQueue({ maxSize: 5 });
      const spy = sinon.spy();
      q.on('enqueue', spy);

      q.enqueue('test'); // TEST-DATA: event test item
      expect(spy.calledOnce).to.be.true;
      expect(spy.firstCall.args[0].item).to.equal('test');
      expect(spy.firstCall.args[0].queueLength).to.equal(1);
    });

    it('should emit dequeue event with item and queue length', function () {
      const q = new BackpressureQueue({ maxSize: 5 });
      q.enqueue('test'); // TEST-DATA: event test item

      const spy = sinon.spy();
      q.on('dequeue', spy);

      q.dequeue();
      expect(spy.calledOnce).to.be.true;
      expect(spy.firstCall.args[0].item).to.equal('test');
      expect(spy.firstCall.args[0].queueLength).to.equal(0);
    });

    it('should emit drain event when last item is dequeued', function () {
      const q = new BackpressureQueue({ maxSize: 5 });
      q.enqueue('only'); // TEST-DATA: single item

      const spy = sinon.spy();
      q.on('drain', spy);

      q.dequeue();
      expect(spy.calledOnce).to.be.true;
    });

    it('should not emit drain when queue still has items', function () {
      const q = new BackpressureQueue({ maxSize: 5 });
      q.enqueue(1); // TEST-DATA: item
      q.enqueue(2); // TEST-DATA: item

      const spy = sinon.spy();
      q.on('drain', spy);

      q.dequeue();
      expect(spy.called).to.be.false;
    });
  });

  // ---- destroy() ----

  describe('destroy()', function () {
    it('should clear all items and remove listeners', function () {
      const q = new BackpressureQueue({ maxSize: 5 });
      const spy = sinon.spy();
      q.on('enqueue', spy);

      q.enqueue(1); // TEST-DATA: item
      q.destroy();

      expect(q.length).to.equal(0);
      expect(q.listenerCount('enqueue')).to.equal(0);
    });
  });

  // ---- Memory Consistency ----

  describe('memory consistency', function () {
    it('should maintain constant length under FIFO flooding', function () {
      const q = new BackpressureQueue({ maxSize: 50, dropStrategy: 'fifo' });
      for (let i = 0; i < 10000; i++) {
        q.enqueue(i);
      }
      expect(q.length).to.equal(50);

      const stats = q.getStats();
      expect(stats.totalEnqueued).to.equal(10000);
      expect(stats.totalDropped).to.equal(9950);
    });

    it('should maintain constant length under LIFO flooding', function () {
      const q = new BackpressureQueue({ maxSize: 50, dropStrategy: 'lifo' });
      for (let i = 0; i < 10000; i++) {
        q.enqueue(i);
      }
      expect(q.length).to.equal(50);

      const stats = q.getStats();
      expect(stats.totalEnqueued).to.equal(50); // Only first 50 enqueued
      expect(stats.totalDropped).to.equal(9950);
    });
  });

  // ---- Edge Cases ----

  describe('edge cases', function () {
    it('should work with maxSize of 1', function () {
      const q = new BackpressureQueue({ maxSize: 1, dropStrategy: 'fifo' });
      q.enqueue('a'); // TEST-DATA: item
      expect(q.length).to.equal(1);

      const result = q.enqueue('b'); // TEST-DATA: overflow item
      expect(result.enqueued).to.be.true;
      expect(result.dropped).to.equal('a');
      expect(q.dequeue()).to.equal('b');
    });

    it('should handle mixed enqueue/dequeue operations', function () {
      const q = new BackpressureQueue({ maxSize: 3, dropStrategy: 'fifo' });
      q.enqueue(1); // TEST-DATA: item
      q.enqueue(2); // TEST-DATA: item
      q.dequeue(); // removes 1
      q.enqueue(3); // TEST-DATA: item
      q.enqueue(4); // TEST-DATA: item
      expect(q.length).to.equal(3);
      expect(q.dequeue()).to.equal(2);
      expect(q.dequeue()).to.equal(3);
      expect(q.dequeue()).to.equal(4);
    });

    it('should handle objects as queue items', function () {
      const q = new BackpressureQueue({ maxSize: 5 });
      const item = { fc: 6, address: 100, value: 42 }; // TEST-DATA: Modbus write object
      q.enqueue(item);
      expect(q.dequeue()).to.deep.equal(item);
    });

    it('should not crash when emitting events with no listeners', function () {
      const q = new BackpressureQueue({ maxSize: 2 });
      // No listeners registered
      expect(() => {
        q.enqueue(1);
        q.enqueue(2);
        q.enqueue(3); // overflow, no drop listener
        q.dequeue();
        q.dequeue();  // drain, no drain listener
      }).to.not.throw();
    });
  });
});
