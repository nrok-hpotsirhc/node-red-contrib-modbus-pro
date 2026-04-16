'use strict';

const { expect } = require('chai');
const sinon = require('sinon');
const RtuSemaphore = require('../../../src/lib/queue/rtu-semaphore');

describe('RtuSemaphore', function () {

  describe('Constructor', function () {
    it('should create with default options', function () {
      const sem = new RtuSemaphore();
      expect(sem.busy).to.be.false;
      expect(sem.queueLength).to.equal(0);
      expect(sem.completedCount).to.equal(0);
      expect(sem.droppedCount).to.equal(0);
    });

    it('should accept custom options', function () {
      const sem = new RtuSemaphore({ timeout: 10000, interFrameDelay: 100 });
      expect(sem.busy).to.be.false;
    });
  });

  describe('execute()', function () {
    it('should execute an operation and return its result', async function () {
      const sem = new RtuSemaphore({ interFrameDelay: 1 });
      const result = await sem.execute(async () => 42);
      expect(result).to.equal(42);
      expect(sem.completedCount).to.equal(1);
    });

    it('should reject if operation is not a function', async function () {
      const sem = new RtuSemaphore();
      try {
        await sem.execute('not-a-function');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.message).to.include('operation must be a function');
      }
    });

    it('should serialize concurrent operations', async function () {
      const sem = new RtuSemaphore({ interFrameDelay: 1 });
      const executionOrder = [];

      const op1 = sem.execute(async () => {
        executionOrder.push('start-1');
        await new Promise(r => setTimeout(r, 50));
        executionOrder.push('end-1');
        return 1;
      });

      const op2 = sem.execute(async () => {
        executionOrder.push('start-2');
        await new Promise(r => setTimeout(r, 10));
        executionOrder.push('end-2');
        return 2;
      });

      const op3 = sem.execute(async () => {
        executionOrder.push('start-3');
        executionOrder.push('end-3');
        return 3;
      });

      const [r1, r2, r3] = await Promise.all([op1, op2, op3]);

      expect(r1).to.equal(1);
      expect(r2).to.equal(2);
      expect(r3).to.equal(3);

      // Verify strict serialization
      expect(executionOrder[0]).to.equal('start-1');
      expect(executionOrder[1]).to.equal('end-1');
      expect(executionOrder[2]).to.equal('start-2');
      expect(executionOrder[3]).to.equal('end-2');
      expect(executionOrder[4]).to.equal('start-3');
      expect(executionOrder[5]).to.equal('end-3');
    });

    it('should propagate operation errors', async function () {
      const sem = new RtuSemaphore({ interFrameDelay: 1 });

      try {
        await sem.execute(async () => {
          throw new Error('Bus error');
        });
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.message).to.equal('Bus error');
      }
    });

    it('should continue processing after an error', async function () {
      const sem = new RtuSemaphore({ interFrameDelay: 1 });

      // First operation fails
      const p1 = sem.execute(async () => {
        throw new Error('fail');
      }).catch(() => 'caught');

      // Wait for first operation to complete
      await p1;

      // Second operation should still work
      const r2 = await sem.execute(async () => 'success');
      expect(r2).to.equal('success');
      expect(sem.completedCount).to.equal(1); // Only one succeeded
    });

    it('should report correct queue length', async function () {
      const sem = new RtuSemaphore({ interFrameDelay: 1 });
      let resolveFirst;

      const p1 = sem.execute(() => new Promise(r => { resolveFirst = r; }));

      // Wait for microtask to start the operation
      await new Promise(r => setTimeout(r, 10));

      // p1 is now running, queue the next two
      const p2 = sem.execute(async () => 'b');
      const p3 = sem.execute(async () => 'c');

      expect(sem.busy).to.be.true;
      expect(sem.queueLength).to.equal(2);

      resolveFirst('a');
      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
      expect(r1).to.equal('a');
      expect(r2).to.equal('b');
      expect(r3).to.equal('c');
    });

    it('should emit complete event on success', async function () {
      const sem = new RtuSemaphore({ interFrameDelay: 1 });
      const spy = sinon.spy();
      sem.on('complete', spy);

      await sem.execute(async () => 'done');
      expect(spy.calledOnce).to.be.true;
      expect(spy.firstCall.args[0]).to.equal('done');
    });

    it('should emit error event on failure', async function () {
      const sem = new RtuSemaphore({ interFrameDelay: 1 });
      const spy = sinon.spy();
      sem.on('error', spy);

      try {
        await sem.execute(async () => { throw new Error('oops'); });
      } catch (_e) {
        // expected
      }
      expect(spy.calledOnce).to.be.true;
    });
  });

  describe('Timeout handling', function () {
    it('should timeout if operation takes too long', async function () {
      this.timeout(3000);
      const sem = new RtuSemaphore({ timeout: 100, interFrameDelay: 1 });

      try {
        await sem.execute(() => new Promise(resolve => {
          // Never resolves within timeout
          setTimeout(resolve, 5000);
        }));
        expect.fail('should have timed out');
      } catch (err) {
        expect(err.message).to.include('timed out');
      }

      expect(sem.droppedCount).to.equal(1);
    });

    it('should emit timeout event', async function () {
      this.timeout(3000);
      const sem = new RtuSemaphore({ timeout: 100, interFrameDelay: 1 });
      const spy = sinon.spy();
      sem.on('timeout', spy);

      try {
        await sem.execute(() => new Promise(resolve => setTimeout(resolve, 5000)));
      } catch (_e) {
        // expected
      }

      expect(spy.calledOnce).to.be.true;
    });

    it('should process next item after timeout', async function () {
      this.timeout(3000);
      const sem = new RtuSemaphore({ timeout: 100, interFrameDelay: 1 });

      const p1 = sem.execute(() => new Promise(resolve => setTimeout(resolve, 5000)))
        .catch(() => 'timed-out');
      const p2 = sem.execute(async () => 'second-ok');

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).to.equal('timed-out');
      expect(r2).to.equal('second-ok');
    });
  });

  describe('drain()', function () {
    it('should reject all pending operations', async function () {
      const sem = new RtuSemaphore({ interFrameDelay: 1 });
      let resolveFirst;

      const p1 = sem.execute(() => new Promise(r => { resolveFirst = r; }));
      const p2 = sem.execute(async () => 'should-be-rejected').catch(e => e.message);
      const p3 = sem.execute(async () => 'should-be-rejected').catch(e => e.message);

      // Give time for queue to populate
      await new Promise(r => setTimeout(r, 10));

      const drainPromise = sem.drain();
      resolveFirst('ok');

      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
      expect(r1).to.equal('ok');
      expect(r2).to.include('drained');
      expect(r3).to.include('drained');

      await drainPromise;
      expect(sem.droppedCount).to.equal(2);
    });

    it('should emit drained event', async function () {
      const sem = new RtuSemaphore();
      const spy = sinon.spy();
      sem.on('drained', spy);
      await sem.drain();
      expect(spy.calledOnce).to.be.true;
    });

    it('should reject new operations during drain', async function () {
      const sem = new RtuSemaphore({ interFrameDelay: 1 });
      let resolveOp;

      // Start a long-running operation to keep the semaphore busy
      const p1 = sem.execute(() => new Promise(r => { resolveOp = r; }));

      // Wait for operation to start
      await new Promise(r => setTimeout(r, 10));

      // Start draining while operation is still running
      const drainPromise = sem.drain();

      try {
        await sem.execute(async () => 'should-fail');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.message).to.include('draining');
      }

      resolveOp('done');
      await p1;
      await drainPromise;
    });

    it('should allow operations after drain completes', async function () {
      const sem = new RtuSemaphore({ interFrameDelay: 1 });
      await sem.drain();

      const result = await sem.execute(async () => 'post-drain');
      expect(result).to.equal('post-drain');
    });
  });

  describe('getStatus()', function () {
    it('should return current status', async function () {
      const sem = new RtuSemaphore({ interFrameDelay: 1 });
      await sem.execute(async () => 'done');

      const status = sem.getStatus();
      expect(status).to.deep.equal({
        busy: false,
        queueLength: 0,
        completedCount: 1,
        droppedCount: 0,
        draining: false
      });
    });
  });

  describe('Inter-frame delay', function () {
    it('should respect inter-frame delay between operations', async function () {
      const delay = 50;
      const sem = new RtuSemaphore({ interFrameDelay: delay });
      const timestamps = [];

      const p1 = sem.execute(async () => { timestamps.push(Date.now()); return 1; });
      const p2 = sem.execute(async () => { timestamps.push(Date.now()); return 2; });
      const p3 = sem.execute(async () => { timestamps.push(Date.now()); return 3; });

      await Promise.all([p1, p2, p3]);

      // Each subsequent operation should be at least ~interFrameDelay apart
      for (let i = 1; i < timestamps.length; i++) {
        const diff = timestamps[i] - timestamps[i - 1];
        // Allow some tolerance for timer imprecision
        expect(diff).to.be.at.least(delay - 15);
      }
    });
  });
});
