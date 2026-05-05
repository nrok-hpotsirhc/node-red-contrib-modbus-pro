'use strict';

const helper = require('node-red-node-test-helper');
const { expect } = require('chai');
const sinon = require('sinon');
const ModbusRTU = require('modbus-serial');

const modbusStatsNode = require('../../../src/nodes/client/modbus-stats');
const modbusClientConfig = require('../../../src/nodes/config/modbus-client-config');

helper.init(require.resolve('node-red'));

describe('modbus-stats', function () {
  let sandbox;

  beforeEach(function (done) {
    sandbox = sinon.createSandbox();
    sandbox.stub(ModbusRTU.prototype, 'connectTCP').resolves();
    sandbox.stub(ModbusRTU.prototype, 'setID');
    sandbox.stub(ModbusRTU.prototype, 'getID').returns(1);
    sandbox.stub(ModbusRTU.prototype, 'setTimeout');
    sandbox.stub(ModbusRTU.prototype, 'close').callsFake(function (cb) { if (cb) cb(); });
    sandbox.stub(ModbusRTU.prototype, 'removeAllListeners');
    sandbox.stub(ModbusRTU.prototype, 'readHoldingRegisters').resolves({
      data: [1, 2, 3], buffer: Buffer.from([0, 1, 0, 2, 0, 3])
    });
    helper.startServer(done);
  });

  afterEach(function (done) {
    sandbox.restore();
    helper.unload().then(function () { helper.stopServer(done); });
  });

  function flow(cfg) {
    return [
      { id: 'config1', type: 'modbus-client-config', name: 'Test', connectionType: 'tcp',
        host: '127.0.0.1', port: 502, unitId: 1, timeout: 1000 },
      Object.assign({ id: 'st1', type: 'modbus-stats', server: 'config1',
        mode: 'onDemand', wires: [['out1']] }, cfg),
      { id: 'out1', type: 'helper' }
    ];
  }

  function simulateConnectedTransport(configNode) {
    const transport = configNode.createTransport();
    transport._connected = true;
    Object.defineProperty(transport._client, 'isOpen', { get: () => true });
    configNode._transport = transport;
    return transport;
  }

  it('should load with default config', function (done) {
    helper.load([modbusClientConfig, modbusStatsNode], flow({}), function () {
      const n = helper.getNode('st1');
      expect(n).to.exist;
      expect(n.type).to.equal('modbus-stats');
      done();
    });
  });

  it('should emit a snapshot on demand', function (done) {
    helper.load([modbusClientConfig, modbusStatsNode], flow({}), function () {
      const cfg = helper.getNode('config1');
      const stats = helper.getNode('st1');
      const out = helper.getNode('out1');
      simulateConnectedTransport(cfg);
      // give setImmediate time to hook
      setImmediate(function () {
        out.on('input', function (msg) {
          expect(msg.payload).to.have.property('requests');
          expect(msg.payload).to.have.property('errors');
          expect(msg.payload).to.have.property('latencyMs');
          expect(msg.payload).to.have.property('uptimeMs');
          done();
        });
        stats.receive({ payload: 'snapshot' });
      });
    });
  });

  it('should count requests when transport methods are invoked', function (done) {
    helper.load([modbusClientConfig, modbusStatsNode], flow({}), function () {
      const cfg = helper.getNode('config1');
      const stats = helper.getNode('st1');
      simulateConnectedTransport(cfg);

      // Wait for the stats node to hook the transport (via setImmediate)
      setTimeout(async function () {
        const transport = cfg._transport;
        await transport.readHoldingRegisters(0, 3);
        await transport.readHoldingRegisters(0, 3);
        const snap = stats.snapshot();
        expect(snap.requests.total).to.equal(2);
        expect(snap.requests.byFc[3]).to.equal(2);
        expect(snap.errors.total).to.equal(0);
        expect(snap.latencyMs.count).to.equal(2);
        done();
      }, 30);
    });
  });

  it('should count errors and exception codes', function (done) {
    helper.load([modbusClientConfig, modbusStatsNode], flow({}), function () {
      const cfg = helper.getNode('config1');
      const stats = helper.getNode('st1');
      simulateConnectedTransport(cfg);

      // Replace stub for this test to reject with a Modbus exception
      ModbusRTU.prototype.readHoldingRegisters.restore();
      sandbox.stub(ModbusRTU.prototype, 'readHoldingRegisters').callsFake(function () {
        const err = new Error('Modbus exception 2');
        err.modbusCode = 2;
        return Promise.reject(err);
      });

      setTimeout(async function () {
        const transport = cfg._transport;
        try { await transport.readHoldingRegisters(0, 3); } catch (e) { /* ignore */ }
        const snap = stats.snapshot();
        expect(snap.errors.total).to.equal(1);
        expect(snap.errors.byFc[3]).to.equal(1);
        expect(snap.exceptions[2]).to.equal(1);
        done();
      }, 30);
    });
  });

  it('should reset counters on "reset" command', function (done) {
    helper.load([modbusClientConfig, modbusStatsNode], flow({}), function () {
      const cfg = helper.getNode('config1');
      const stats = helper.getNode('st1');
      simulateConnectedTransport(cfg);

      setTimeout(async function () {
        const transport = cfg._transport;
        await transport.readHoldingRegisters(0, 3);
        expect(stats.snapshot().requests.total).to.equal(1);
        stats.receive({ payload: 'reset' });
        setTimeout(function () {
          expect(stats.snapshot().requests.total).to.equal(0);
          expect(stats.snapshot().latencyMs.count).to.equal(0);
          done();
        }, 10);
      }, 30);
    });
  });

  it('should expose latency percentiles', function (done) {
    helper.load([modbusClientConfig, modbusStatsNode], flow({ bufferSize: 100 }), function () {
      const cfg = helper.getNode('config1');
      const stats = helper.getNode('st1');
      simulateConnectedTransport(cfg);
      setTimeout(async function () {
        const transport = cfg._transport;
        for (let i = 0; i < 50; i++) {
          await transport.readHoldingRegisters(0, 3);
        }
        const snap = stats.snapshot();
        expect(snap.latencyMs.count).to.equal(50);
        expect(snap.latencyMs.p95).to.be.at.least(snap.latencyMs.p50);
        expect(snap.latencyMs.p99).to.be.at.least(snap.latencyMs.p95);
        expect(snap.latencyMs.max).to.be.at.least(snap.latencyMs.p99);
        done();
      }, 30);
    });
  });
});
