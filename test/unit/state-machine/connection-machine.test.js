'use strict';

const { expect } = require('chai');
const sinon = require('sinon');
const { connectionMachine, createConnectionActor, DEFAULT_CONTEXT } = require('../../../src/lib/state-machine/connection-machine');

describe('Connection State Machine', function () {
  let actor;

  afterEach(function () {
    if (actor) {
      try { actor.stop(); } catch (_e) { /* already stopped */ }
      actor = null;
    }
  });

  // Helper to create a mock transport
  function mockTransport(open = true) {
    return {
      isOpen: sinon.stub().returns(open),
      destroy: sinon.stub().resolves()
    };
  }

  // Helper to make a valid read request
  function readRequest(address = 0, length = 10) {
    return {
      type: 'READ_REQUEST',
      request: { operation: 'readHoldingRegisters', address, length }
    };
  }

  // Helper to make a valid write request
  function writeRequest(address = 0, value = 42) {
    return {
      type: 'WRITE_REQUEST',
      request: { operation: 'writeRegister', address, value }
    };
  }

  describe('Initial State', function () {
    it('should start in disconnected state', function () {
      actor = createConnectionActor();
      actor.start();
      expect(actor.getSnapshot().value).to.equal('disconnected');
    });

    it('should have default context values', function () {
      actor = createConnectionActor();
      actor.start();
      const ctx = actor.getSnapshot().context;
      expect(ctx.transport).to.be.null;
      expect(ctx.retryCount).to.equal(0);
      expect(ctx.maxRetries).to.equal(5);
      expect(ctx.baseDelay).to.equal(1000);
      expect(ctx.maxDelay).to.equal(30000);
      expect(ctx.lastError).to.be.null;
      expect(ctx.queue).to.be.an('array').that.is.empty;
      expect(ctx.maxQueueSize).to.equal(100);
      expect(ctx.currentRequest).to.be.null;
    });

    it('should accept custom context via input', function () {
      actor = createConnectionActor({ maxRetries: 10, maxQueueSize: 50 });
      actor.start();
      const ctx = actor.getSnapshot().context;
      expect(ctx.maxRetries).to.equal(10);
      expect(ctx.maxQueueSize).to.equal(50);
    });
  });

  describe('DISCONNECTED → CONNECTING', function () {
    it('should transition to connecting on CONNECT event', function () {
      actor = createConnectionActor();
      actor.start();
      actor.send({ type: 'CONNECT', transport: mockTransport() });
      expect(actor.getSnapshot().value).to.equal('connecting');
    });

    it('should store transport reference in context', function () {
      actor = createConnectionActor();
      actor.start();
      const transport = mockTransport();
      actor.send({ type: 'CONNECT', transport });
      expect(actor.getSnapshot().context.transport).to.equal(transport);
    });

    it('should clear any previous error on CONNECT', function () {
      actor = createConnectionActor();
      actor.start();
      // Go through connect -> fail -> error cycle first
      actor.send({ type: 'CONNECT', transport: mockTransport() });
      actor.send({ type: 'FAILURE', error: 'previous error' });
      expect(actor.getSnapshot().context.lastError).to.equal('previous error');
      // Now reconnect from error
      actor.send({ type: 'CONNECT', transport: mockTransport() });
      expect(actor.getSnapshot().context.lastError).to.be.null;
    });
  });

  describe('CONNECTING → CONNECTED', function () {
    it('should transition to connected on SUCCESS', function () {
      actor = createConnectionActor();
      actor.start();
      actor.send({ type: 'CONNECT', transport: mockTransport() });
      actor.send({ type: 'SUCCESS' });
      expect(actor.getSnapshot().value).to.equal('connected');
    });

    it('should reset retry count on successful connection', function () {
      actor = createConnectionActor();
      actor.start();
      actor.send({ type: 'CONNECT', transport: mockTransport() });
      actor.send({ type: 'SUCCESS' });
      expect(actor.getSnapshot().context.retryCount).to.equal(0);
    });
  });

  describe('CONNECTING → ERROR', function () {
    it('should transition to error on FAILURE', function () {
      actor = createConnectionActor();
      actor.start();
      actor.send({ type: 'CONNECT', transport: mockTransport() });
      actor.send({ type: 'FAILURE', error: 'connection refused' });
      expect(actor.getSnapshot().value).to.equal('error');
    });

    it('should store the error in context', function () {
      actor = createConnectionActor();
      actor.start();
      actor.send({ type: 'CONNECT', transport: mockTransport() });
      actor.send({ type: 'FAILURE', error: 'connection refused' });
      expect(actor.getSnapshot().context.lastError).to.equal('connection refused');
    });

    it('should transition to error on TIMEOUT', function () {
      actor = createConnectionActor();
      actor.start();
      actor.send({ type: 'CONNECT', transport: mockTransport() });
      actor.send({ type: 'TIMEOUT', error: 'timed out' });
      expect(actor.getSnapshot().value).to.equal('error');
      expect(actor.getSnapshot().context.lastError).to.equal('timed out');
    });
  });

  describe('CONNECTING → DISCONNECTED', function () {
    it('should transition to disconnected on DISCONNECT while connecting', function () {
      actor = createConnectionActor();
      actor.start();
      actor.send({ type: 'CONNECT', transport: mockTransport() });
      actor.send({ type: 'DISCONNECT' });
      expect(actor.getSnapshot().value).to.equal('disconnected');
    });
  });

  describe('CONNECTED → READING', function () {
    beforeEach(function () {
      actor = createConnectionActor();
      actor.start();
      actor.send({ type: 'CONNECT', transport: mockTransport() });
      actor.send({ type: 'SUCCESS' });
    });

    it('should transition to reading on valid READ_REQUEST', function () {
      actor.send(readRequest());
      expect(actor.getSnapshot().value).to.equal('reading');
    });

    it('should enqueue and dequeue the request', function () {
      actor.send(readRequest(100, 5));
      const ctx = actor.getSnapshot().context;
      expect(ctx.currentRequest).to.deep.equal({
        operation: 'readHoldingRegisters', address: 100, length: 5
      });
      expect(ctx.queue).to.be.an('array').that.is.empty;
    });

    it('should NOT transition on invalid request (missing operation)', function () {
      actor.send({ type: 'READ_REQUEST', request: { address: 0, length: 10 } });
      expect(actor.getSnapshot().value).to.equal('connected');
    });

    it('should NOT transition on invalid request (missing address)', function () {
      actor.send({ type: 'READ_REQUEST', request: { operation: 'readCoils', length: 10 } });
      expect(actor.getSnapshot().value).to.equal('connected');
    });

    it('should NOT transition on invalid request (negative address)', function () {
      actor.send({ type: 'READ_REQUEST', request: { operation: 'readCoils', address: -1, length: 10 } });
      expect(actor.getSnapshot().value).to.equal('connected');
    });
  });

  describe('CONNECTED → WRITING', function () {
    beforeEach(function () {
      actor = createConnectionActor();
      actor.start();
      actor.send({ type: 'CONNECT', transport: mockTransport() });
      actor.send({ type: 'SUCCESS' });
    });

    it('should transition to writing on valid WRITE_REQUEST', function () {
      actor.send(writeRequest());
      expect(actor.getSnapshot().value).to.equal('writing');
    });

    it('should accept write request with values array', function () {
      actor.send({
        type: 'WRITE_REQUEST',
        request: { operation: 'writeRegisters', address: 10, values: [1, 2, 3] }
      });
      expect(actor.getSnapshot().value).to.equal('writing');
    });
  });

  describe('READING → CONNECTED (SUCCESS)', function () {
    beforeEach(function () {
      actor = createConnectionActor();
      actor.start();
      actor.send({ type: 'CONNECT', transport: mockTransport() });
      actor.send({ type: 'SUCCESS' });
    });

    it('should return to connected on SUCCESS after read', function () {
      actor.send(readRequest());
      actor.send({ type: 'SUCCESS', data: [1, 2, 3] });
      expect(actor.getSnapshot().value).to.equal('connected');
    });

    it('should clear current request after success', function () {
      actor.send(readRequest());
      actor.send({ type: 'SUCCESS' });
      expect(actor.getSnapshot().context.currentRequest).to.be.null;
    });
  });

  describe('READING → ERROR (FAILURE)', function () {
    beforeEach(function () {
      actor = createConnectionActor();
      actor.start();
      actor.send({ type: 'CONNECT', transport: mockTransport() });
      actor.send({ type: 'SUCCESS' });
    });

    it('should transition to error on FAILURE during read', function () {
      actor.send(readRequest());
      actor.send({ type: 'FAILURE', error: 'CRC error' });
      expect(actor.getSnapshot().value).to.equal('error');
      expect(actor.getSnapshot().context.lastError).to.equal('CRC error');
    });

    it('should transition to error on TIMEOUT during read', function () {
      actor.send(readRequest());
      actor.send({ type: 'TIMEOUT', error: 'response timeout' });
      expect(actor.getSnapshot().value).to.equal('error');
    });
  });

  describe('WRITING → CONNECTED (SUCCESS)', function () {
    beforeEach(function () {
      actor = createConnectionActor();
      actor.start();
      actor.send({ type: 'CONNECT', transport: mockTransport() });
      actor.send({ type: 'SUCCESS' });
    });

    it('should return to connected on SUCCESS after write', function () {
      actor.send(writeRequest());
      actor.send({ type: 'SUCCESS' });
      expect(actor.getSnapshot().value).to.equal('connected');
    });
  });

  describe('Queue Management in READING/WRITING', function () {
    beforeEach(function () {
      actor = createConnectionActor();
      actor.start();
      actor.send({ type: 'CONNECT', transport: mockTransport() });
      actor.send({ type: 'SUCCESS' });
    });

    it('should enqueue requests received while reading', function () {
      actor.send(readRequest(0, 10));
      expect(actor.getSnapshot().value).to.equal('reading');

      // Send additional requests while reading
      actor.send(readRequest(100, 5));
      actor.send(writeRequest(200, 99));

      const ctx = actor.getSnapshot().context;
      expect(ctx.queue).to.have.length(2);
    });

    it('should process queued requests after SUCCESS', function () {
      actor.send(readRequest(0, 10));
      actor.send(readRequest(100, 5));

      // Complete first request
      actor.send({ type: 'SUCCESS' });

      // Should still be in reading state processing second request
      expect(actor.getSnapshot().value).to.equal('reading');
      expect(actor.getSnapshot().context.currentRequest).to.deep.equal({
        operation: 'readHoldingRegisters', address: 100, length: 5
      });
    });

    it('should return to connected when queue is emptied', function () {
      actor.send(readRequest(0, 10));
      actor.send(readRequest(100, 5));

      actor.send({ type: 'SUCCESS' }); // process first, dequeue second
      actor.send({ type: 'SUCCESS' }); // process second, queue empty

      expect(actor.getSnapshot().value).to.equal('connected');
      expect(actor.getSnapshot().context.queue).to.be.empty;
    });

    it('should reject enqueue when queue is full (canEnqueue guard)', function () {
      // Create actor with very small queue
      actor.stop();
      actor = createConnectionActor({ maxQueueSize: 2 });
      actor.start();
      actor.send({ type: 'CONNECT', transport: mockTransport() });
      actor.send({ type: 'SUCCESS' });

      // First request goes to reading state (enqueue + dequeue → currentRequest)
      actor.send(readRequest(0, 10));
      expect(actor.getSnapshot().value).to.equal('reading');

      // Fill the queue while reading
      actor.send(readRequest(100, 5));
      actor.send(readRequest(200, 5));
      expect(actor.getSnapshot().context.queue).to.have.length(2);

      // This request should be silently dropped (queue full)
      actor.send(readRequest(300, 5));
      expect(actor.getSnapshot().context.queue).to.have.length(2);
    });
  });

  describe('ERROR → BACKOFF → RECONNECTING', function () {
    it('should transition to backoff on RETRY with retries left', function () {
      actor = createConnectionActor({ maxRetries: 3 });
      actor.start();
      actor.send({ type: 'CONNECT', transport: mockTransport() });
      actor.send({ type: 'FAILURE', error: 'fail' });

      actor.send({ type: 'RETRY' });
      expect(actor.getSnapshot().value).to.equal('backoff');
    });

    it('should increment retry count', function () {
      actor = createConnectionActor({ maxRetries: 3 });
      actor.start();
      actor.send({ type: 'CONNECT', transport: mockTransport() });
      actor.send({ type: 'FAILURE', error: 'fail' });

      actor.send({ type: 'RETRY' });
      expect(actor.getSnapshot().context.retryCount).to.equal(1);
    });

    it('should calculate exponential backoff delay with jitter', function () {
      actor = createConnectionActor({ maxRetries: 5, baseDelay: 1000 });
      actor.start();
      actor.send({ type: 'CONNECT', transport: mockTransport() });
      actor.send({ type: 'FAILURE', error: 'fail' });

      // First retry: 1000 * 2^0 = 1000 ±25% jitter (calculated before increment)
      actor.send({ type: 'RETRY' });
      expect(actor.getSnapshot().context.backoffDelay).to.be.within(750, 1250);
      expect(actor.getSnapshot().context.retryCount).to.equal(1);

      // Move to reconnecting, then fail again
      actor.send({ type: 'RETRY' }); // backoff → reconnecting
      actor.send({ type: 'FAILURE', error: 'fail again' });

      // Second retry: 1000 * 2^1 = 2000 ±25% jitter
      actor.send({ type: 'RETRY' });
      expect(actor.getSnapshot().context.backoffDelay).to.be.within(1500, 2500);
      expect(actor.getSnapshot().context.retryCount).to.equal(2);
    });

    it('should cap backoff delay at maxDelay', function () {
      actor = createConnectionActor({ maxRetries: 10, baseDelay: 10000, maxDelay: 30000 });
      actor.start();
      actor.send({ type: 'CONNECT', transport: mockTransport() });

      // Run through multiple retry cycles
      for (let i = 0; i < 5; i++) {
        actor.send({ type: 'FAILURE', error: 'fail' });
        actor.send({ type: 'RETRY' }); // error → backoff
        actor.send({ type: 'RETRY' }); // backoff → reconnecting
      }

      expect(actor.getSnapshot().context.backoffDelay).to.be.at.most(30000);
    });

    it('should transition from backoff to reconnecting on RETRY', function () {
      actor = createConnectionActor({ maxRetries: 3 });
      actor.start();
      actor.send({ type: 'CONNECT', transport: mockTransport() });
      actor.send({ type: 'FAILURE', error: 'fail' });
      actor.send({ type: 'RETRY' }); // error → backoff
      actor.send({ type: 'RETRY' }); // backoff → reconnecting
      expect(actor.getSnapshot().value).to.equal('reconnecting');
    });

    it('should transition from reconnecting to connected on SUCCESS', function () {
      actor = createConnectionActor({ maxRetries: 3 });
      actor.start();
      actor.send({ type: 'CONNECT', transport: mockTransport() });
      actor.send({ type: 'FAILURE', error: 'fail' });
      actor.send({ type: 'RETRY' }); // error → backoff
      actor.send({ type: 'RETRY' }); // backoff → reconnecting
      actor.send({ type: 'SUCCESS' }); // reconnecting → connected
      expect(actor.getSnapshot().value).to.equal('connected');
    });
  });

  describe('ERROR → DISCONNECTED (max retries)', function () {
    it('should transition to disconnected when max retries exhausted', function () {
      actor = createConnectionActor({ maxRetries: 2 });
      actor.start();
      actor.send({ type: 'CONNECT', transport: mockTransport() });

      // Exhaust retries
      actor.send({ type: 'FAILURE', error: 'fail' });
      actor.send({ type: 'RETRY' }); // retry 1 → backoff
      actor.send({ type: 'RETRY' }); // backoff → reconnecting
      actor.send({ type: 'FAILURE', error: 'fail' });
      actor.send({ type: 'RETRY' }); // retry 2 → backoff
      actor.send({ type: 'RETRY' }); // backoff → reconnecting
      actor.send({ type: 'FAILURE', error: 'fail' });

      // retryCount is now 2, maxRetries is 2 → no retries left
      actor.send({ type: 'RETRY' });
      expect(actor.getSnapshot().value).to.equal('disconnected');
    });
  });

  describe('DISCONNECT from any state', function () {
    it('should disconnect from connected state', function () {
      actor = createConnectionActor();
      actor.start();
      actor.send({ type: 'CONNECT', transport: mockTransport() });
      actor.send({ type: 'SUCCESS' });
      actor.send({ type: 'DISCONNECT' });
      expect(actor.getSnapshot().value).to.equal('disconnected');
    });

    it('should disconnect from reading state', function () {
      actor = createConnectionActor();
      actor.start();
      actor.send({ type: 'CONNECT', transport: mockTransport() });
      actor.send({ type: 'SUCCESS' });
      actor.send(readRequest());
      actor.send({ type: 'DISCONNECT' });
      expect(actor.getSnapshot().value).to.equal('disconnected');
    });

    it('should disconnect from writing state', function () {
      actor = createConnectionActor();
      actor.start();
      actor.send({ type: 'CONNECT', transport: mockTransport() });
      actor.send({ type: 'SUCCESS' });
      actor.send(writeRequest());
      actor.send({ type: 'DISCONNECT' });
      expect(actor.getSnapshot().value).to.equal('disconnected');
    });

    it('should disconnect from error state', function () {
      actor = createConnectionActor();
      actor.start();
      actor.send({ type: 'CONNECT', transport: mockTransport() });
      actor.send({ type: 'FAILURE', error: 'fail' });
      actor.send({ type: 'DISCONNECT' });
      expect(actor.getSnapshot().value).to.equal('disconnected');
    });

    it('should disconnect from backoff state', function () {
      actor = createConnectionActor({ maxRetries: 3 });
      actor.start();
      actor.send({ type: 'CONNECT', transport: mockTransport() });
      actor.send({ type: 'FAILURE', error: 'fail' });
      actor.send({ type: 'RETRY' });
      expect(actor.getSnapshot().value).to.equal('backoff');
      actor.send({ type: 'DISCONNECT' });
      expect(actor.getSnapshot().value).to.equal('disconnected');
    });

    it('should disconnect from reconnecting state', function () {
      actor = createConnectionActor({ maxRetries: 3 });
      actor.start();
      actor.send({ type: 'CONNECT', transport: mockTransport() });
      actor.send({ type: 'FAILURE', error: 'fail' });
      actor.send({ type: 'RETRY' }); // → backoff
      actor.send({ type: 'RETRY' }); // → reconnecting
      actor.send({ type: 'DISCONNECT' });
      expect(actor.getSnapshot().value).to.equal('disconnected');
    });
  });

  describe('DEFAULT_CONTEXT export', function () {
    it('should export default context values', function () {
      expect(DEFAULT_CONTEXT).to.be.an('object');
      expect(DEFAULT_CONTEXT.maxRetries).to.equal(5);
      expect(DEFAULT_CONTEXT.baseDelay).to.equal(1000);
      expect(DEFAULT_CONTEXT.maxDelay).to.equal(30000);
      expect(DEFAULT_CONTEXT.maxQueueSize).to.equal(100);
    });
  });

  describe('Full reconnect cycle', function () {
    it('should complete a full connect → fail → retry → reconnect → connect cycle', function () {
      actor = createConnectionActor({ maxRetries: 3 });
      actor.start();
      expect(actor.getSnapshot().value).to.equal('disconnected');

      // 1. Connect attempt
      actor.send({ type: 'CONNECT', transport: mockTransport() });
      expect(actor.getSnapshot().value).to.equal('connecting');

      // 2. Connection fails
      actor.send({ type: 'FAILURE', error: 'ECONNREFUSED' });
      expect(actor.getSnapshot().value).to.equal('error');

      // 3. Retry
      actor.send({ type: 'RETRY' });
      expect(actor.getSnapshot().value).to.equal('backoff');
      expect(actor.getSnapshot().context.retryCount).to.equal(1);

      // 4. After backoff wait, retry
      actor.send({ type: 'RETRY' });
      expect(actor.getSnapshot().value).to.equal('reconnecting');

      // 5. Reconnect succeeds
      actor.send({ type: 'SUCCESS' });
      expect(actor.getSnapshot().value).to.equal('connected');

      // 6. Can now do read/write
      actor.send(readRequest());
      expect(actor.getSnapshot().value).to.equal('reading');

      actor.send({ type: 'SUCCESS' });
      expect(actor.getSnapshot().value).to.equal('connected');
    });
  });
});
