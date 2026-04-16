'use strict';

const { expect } = require('chai');
const sinon = require('sinon');
const ConnectionPool = require('../../../src/lib/queue/connection-pool');

describe('ConnectionPool', function () {
  // Helper to create a mock transport
  function createMockTransport(open = true) {
    return {
      isOpen: sinon.stub().returns(open),
      destroy: sinon.stub().resolves(),
      readHoldingRegisters: sinon.stub().resolves({ data: [1, 2, 3] })
    };
  }

  // Helper factory that returns connected mock transports
  function connectedFactory() {
    return async () => createMockTransport(true);
  }

  // Helper factory that always fails
  function failingFactory() {
    return async () => { throw new Error('Connection failed'); };
  }

  describe('Constructor', function () {
    it('should throw if factory is not provided', function () {
      expect(() => new ConnectionPool()).to.throw('factory function is required');
    });

    it('should throw if factory is not a function', function () {
      expect(() => new ConnectionPool({ factory: 'not-a-function' })).to.throw('factory function is required');
    });

    it('should accept valid configuration', function () {
      const pool = new ConnectionPool({ factory: connectedFactory(), size: 3 });
      expect(pool.size).to.equal(3);
      expect(pool.initialized).to.be.false;
    });

    it('should enforce minimum pool size of 1', function () {
      const pool = new ConnectionPool({ factory: connectedFactory(), size: 0 });
      expect(pool.size).to.equal(1);
    });

    it('should enforce maximum pool size', function () {
      const pool = new ConnectionPool({ factory: connectedFactory(), size: 20, maxSize: 5 });
      expect(pool.size).to.equal(5);
    });

    it('should default size to 1', function () {
      const pool = new ConnectionPool({ factory: connectedFactory() });
      expect(pool.size).to.equal(1);
    });
  });

  describe('initialize()', function () {
    it('should create the configured number of connections', async function () {
      const pool = new ConnectionPool({ factory: connectedFactory(), size: 3 });
      const count = await pool.initialize();
      expect(count).to.equal(3);
      expect(pool.totalCount).to.equal(3);
      expect(pool.activeCount).to.equal(3);
      expect(pool.initialized).to.be.true;
    });

    it('should handle partial failures gracefully', async function () {
      let callCount = 0;
      const factory = async () => {
        callCount++;
        if (callCount === 2) throw new Error('Connection 2 failed');
        return createMockTransport(true);
      };

      const pool = new ConnectionPool({ factory, size: 3 });
      const count = await pool.initialize();
      expect(count).to.equal(2); // 2 out of 3 succeeded
      expect(pool.totalCount).to.equal(3);
      expect(pool.activeCount).to.equal(2);
    });

    it('should emit initialized event', async function () {
      const pool = new ConnectionPool({ factory: connectedFactory(), size: 2 });
      const spy = sinon.spy();
      pool.on('initialized', spy);
      await pool.initialize();
      expect(spy.calledOnce).to.be.true;
      expect(spy.firstCall.args[0]).to.deep.equal({ total: 2, active: 2 });
    });

    it('should emit error events for failed connections', async function () {
      const pool = new ConnectionPool({ factory: failingFactory(), size: 2 });
      const spy = sinon.spy();
      pool.on('error', spy);
      await pool.initialize();
      expect(spy.calledTwice).to.be.true;
    });

    it('should throw if pool is draining', async function () {
      const pool = new ConnectionPool({ factory: connectedFactory(), size: 1 });
      await pool.initialize();
      const drainPromise = pool.drain();
      // Try to initialize while draining - create a new pool for this
      const pool2 = new ConnectionPool({ factory: connectedFactory(), size: 1 });
      await pool2.initialize();
      await pool2.drain();
      // After drain completes, re-init should work
      const count = await pool2.initialize();
      expect(count).to.equal(1);
      await drainPromise;
    });
  });

  describe('acquire()', function () {
    it('should return a connection via round-robin', async function () {
      const transports = [];
      const factory = async () => {
        const t = createMockTransport(true);
        transports.push(t);
        return t;
      };

      const pool = new ConnectionPool({ factory, size: 3 });
      await pool.initialize();

      const c1 = pool.acquire();
      const c2 = pool.acquire();
      const c3 = pool.acquire();
      const c4 = pool.acquire(); // wraps around

      expect(c1).to.equal(transports[0]);
      expect(c2).to.equal(transports[1]);
      expect(c3).to.equal(transports[2]);
      expect(c4).to.equal(transports[0]);
    });

    it('should return null if no connections are available', function () {
      const pool = new ConnectionPool({ factory: connectedFactory(), size: 1 });
      // Not initialized - no connections
      expect(pool.acquire()).to.be.null;
    });

    it('should skip closed connections', async function () {
      const transports = [];
      const factory = async () => {
        const t = createMockTransport(true);
        transports.push(t);
        return t;
      };

      const pool = new ConnectionPool({ factory, size: 3 });
      await pool.initialize();

      // Mark second connection as closed
      transports[1].isOpen.returns(false);

      const c1 = pool.acquire();
      const c2 = pool.acquire(); // should skip index 1
      expect(c1).to.equal(transports[0]);
      expect(c2).to.equal(transports[2]);
    });

    it('should return null if all connections are closed', async function () {
      const pool = new ConnectionPool({
        factory: async () => createMockTransport(false),
        size: 2
      });
      await pool.initialize();
      expect(pool.acquire()).to.be.null;
    });
  });

  describe('execute()', function () {
    it('should execute an operation on an acquired connection', async function () {
      const pool = new ConnectionPool({ factory: connectedFactory(), size: 1 });
      await pool.initialize();

      const result = await pool.execute(async (conn) => {
        return conn.readHoldingRegisters(0, 10);
      });

      expect(result).to.deep.equal({ data: [1, 2, 3] });
    });

    it('should throw if no connection is available', async function () {
      const pool = new ConnectionPool({ factory: connectedFactory(), size: 1 });
      // Not initialized

      try {
        await pool.execute(async () => 'test');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.message).to.equal('ConnectionPool: no available connection');
      }
    });
  });

  describe('replace()', function () {
    it('should replace a failed connection', async function () {
      let callCount = 0;
      const factory = async () => {
        callCount++;
        return createMockTransport(callCount > 1); // first one fails to open
      };

      const pool = new ConnectionPool({ factory, size: 1 });
      await pool.initialize();

      const success = await pool.replace(0);
      expect(success).to.be.true;
      expect(pool.activeCount).to.equal(1);
    });

    it('should return false for out-of-range index', async function () {
      const pool = new ConnectionPool({ factory: connectedFactory(), size: 1 });
      await pool.initialize();
      expect(await pool.replace(-1)).to.be.false;
      expect(await pool.replace(5)).to.be.false;
    });

    it('should destroy the old connection before replacing', async function () {
      const transport = createMockTransport(true);
      const pool = new ConnectionPool({
        factory: async () => transport,
        size: 1
      });
      await pool.initialize();

      await pool.replace(0);
      expect(transport.destroy.calledOnce).to.be.true;
    });

    it('should handle replacement failure gracefully', async function () {
      let callCount = 0;
      const factory = async () => {
        callCount++;
        if (callCount > 1) throw new Error('Replacement failed');
        return createMockTransport(true);
      };

      const pool = new ConnectionPool({ factory, size: 1 });
      await pool.initialize();

      const success = await pool.replace(0);
      expect(success).to.be.false;
    });
  });

  describe('drain()', function () {
    it('should close all connections', async function () {
      const transports = [];
      const factory = async () => {
        const t = createMockTransport(true);
        transports.push(t);
        return t;
      };

      const pool = new ConnectionPool({ factory, size: 3 });
      await pool.initialize();

      await pool.drain();

      transports.forEach(t => {
        expect(t.destroy.calledOnce).to.be.true;
      });
      expect(pool.totalCount).to.equal(0);
      expect(pool.initialized).to.be.false;
    });

    it('should emit drained event', async function () {
      const pool = new ConnectionPool({ factory: connectedFactory(), size: 1 });
      await pool.initialize();
      const spy = sinon.spy();
      pool.on('drained', spy);
      await pool.drain();
      expect(spy.calledOnce).to.be.true;
    });

    it('should handle destroy errors gracefully during drain', async function () {
      const factory = async () => {
        const t = createMockTransport(true);
        t.destroy = sinon.stub().rejects(new Error('destroy failed'));
        return t;
      };

      const pool = new ConnectionPool({ factory, size: 2 });
      await pool.initialize();

      // Should not throw
      await pool.drain();
      expect(pool.totalCount).to.equal(0);
    });

    it('should allow re-initialization after drain', async function () {
      const pool = new ConnectionPool({ factory: connectedFactory(), size: 2 });
      await pool.initialize();
      expect(pool.activeCount).to.equal(2);

      await pool.drain();
      expect(pool.activeCount).to.equal(0);

      const count = await pool.initialize();
      expect(count).to.equal(2);
      expect(pool.activeCount).to.equal(2);
    });
  });

  describe('getStatus()', function () {
    it('should return status of all connections', async function () {
      const transports = [];
      const factory = async () => {
        const t = createMockTransport(true);
        transports.push(t);
        return t;
      };

      const pool = new ConnectionPool({ factory, size: 3 });
      await pool.initialize();

      // Mark one as closed
      transports[1].isOpen.returns(false);

      const status = pool.getStatus();
      expect(status).to.deep.equal([
        { index: 0, active: true },
        { index: 1, active: false },
        { index: 2, active: true }
      ]);
    });

    it('should return empty array when not initialized', function () {
      const pool = new ConnectionPool({ factory: connectedFactory() });
      expect(pool.getStatus()).to.deep.equal([]);
    });
  });
});
