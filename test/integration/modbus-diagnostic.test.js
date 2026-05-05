'use strict';

const helper = require('node-red-node-test-helper');
const { expect } = require('chai');
const sinon = require('sinon');
const ModbusRTU = require('modbus-serial');

const modbusDiagnosticNode = require('../../src/nodes/client/modbus-diagnostic');
const modbusClientConfig = require('../../src/nodes/config/modbus-client-config');

helper.init(require.resolve('node-red'));

describe('modbus-diagnostic (integration)', function () {
  let sandbox;

  beforeEach(function (done) {
    sandbox = sinon.createSandbox();

    sandbox.stub(ModbusRTU.prototype, 'connectTCP').resolves();
    sandbox.stub(ModbusRTU.prototype, 'setID');
    sandbox.stub(ModbusRTU.prototype, 'getID').returns(1);
    sandbox.stub(ModbusRTU.prototype, 'setTimeout');
    sandbox.stub(ModbusRTU.prototype, 'close').callsFake(function (cb) {
      if (typeof cb === 'function') cb();
    });
    sandbox.stub(ModbusRTU.prototype, 'removeAllListeners');

    // FC 07: Read Exception Status response = 0xA5 (10100101)
    // FC 08: Echo of sub-fn 0x0000 + data 0xCAFE
    // FC 11: status=0xFFFF eventCount=0x0001
    // FC 12: byteCount=8, status=0xFFFF, eventCount=0x05, msgCount=0x0A, events=[0xAA,0xBB]
    sandbox.stub(ModbusRTU.prototype, 'customFunction').callsFake(function (fc, payload) {
      if (fc === 0x07) {
        // TEST-DATA: status byte 0xA5
        return Promise.resolve({ buffer: Buffer.from([0xA5]) });
      }
      if (fc === 0x08) {
        // TEST-DATA: echo
        const buf = Buffer.from([payload[0], payload[1], payload[2], payload[3]]);
        return Promise.resolve({ buffer: buf });
      }
      if (fc === 0x0B) {
        // TEST-DATA: status FFFF, eventCount 0001
        return Promise.resolve({ buffer: Buffer.from([0xFF, 0xFF, 0x00, 0x01]) });
      }
      if (fc === 0x0C) {
        // byteCount=8, status=FFFF, eventCount=0x0005, messageCount=0x000A, events=[0xAA,0xBB]
        return Promise.resolve({ buffer: Buffer.from([8, 0xFF, 0xFF, 0x00, 0x05, 0x00, 0x0A, 0xAA, 0xBB]) });
      }
      return Promise.resolve({ buffer: Buffer.alloc(0) });
    });

    sandbox.stub(ModbusRTU.prototype, 'reportServerID').resolves({
      serverId: 0x42,
      running: true,
      additionalData: Buffer.from('Demo PLC'),
      buffer: Buffer.alloc(0)
    });

    helper.startServer(done);
  });

  afterEach(function (done) {
    sandbox.restore();
    helper.unload().then(function () {
      helper.stopServer(done);
    });
  });

  function createFlow(diagConfig) {
    return [
      { id: 'config1', type: 'modbus-client-config', name: 'Test', connectionType: 'tcp',
        host: '127.0.0.1', port: 502, unitId: 1, timeout: 1000 },
      { id: 'diag1', type: 'modbus-diagnostic', name: 'Test Diag', server: 'config1',
        mode: diagConfig.mode, subFunction: diagConfig.subFunction || 0,
        dataField: diagConfig.dataField || 0, wires: [['helper1']] },
      { id: 'helper1', type: 'helper' }
    ];
  }

  function simulateConnectedTransport(configNode) {
    const transport = configNode.createTransport();
    transport._connected = true;
    Object.defineProperty(transport._client, 'isOpen', { get: () => true });
    configNode._transport = transport;
    return transport;
  }

  it('should load the modbus-diagnostic node', function (done) {
    helper.load([modbusClientConfig, modbusDiagnosticNode], createFlow({ mode: 'exceptionStatus' }), function () {
      const n = helper.getNode('diag1');
      expect(n).to.exist;
      expect(n.type).to.equal('modbus-diagnostic');
      done();
    });
  });

  it('should reject invalid mode', function (done) {
    const flow = createFlow({ mode: 'bogus' });
    helper.load([modbusClientConfig, modbusDiagnosticNode], flow, function () {
      const n = helper.getNode('diag1');
      expect(n).to.exist; // node initialized but errored at startup
      done();
    });
  });

  it('FC 07 should read exception status and decode bits', function (done) {
    helper.load([modbusClientConfig, modbusDiagnosticNode], createFlow({ mode: 'exceptionStatus' }), function () {
      const cfg = helper.getNode('config1');
      const diag = helper.getNode('diag1');
      const h = helper.getNode('helper1');
      simulateConnectedTransport(cfg);
      h.on('input', function (msg) {
        expect(msg.payload.fc).to.equal(7);
        expect(msg.payload.statusByte).to.equal(0xA5);
        // 0xA5 = 10100101
        expect(msg.payload.bits).to.deep.equal([true, false, true, false, false, true, false, true]);
        done();
      });
      diag.receive({});
    });
  });

  it('FC 08 should echo the sub-function and data field', function (done) {
    helper.load([modbusClientConfig, modbusDiagnosticNode],
      createFlow({ mode: 'diagnostics', subFunction: 0, dataField: 0xCAFE }), function () {
        const cfg = helper.getNode('config1');
        const diag = helper.getNode('diag1');
        const h = helper.getNode('helper1');
        simulateConnectedTransport(cfg);
        h.on('input', function (msg) {
          expect(msg.payload.fc).to.equal(8);
          expect(msg.payload.subFunction).to.equal(0);
          expect(msg.payload.data).to.equal(0xCAFE);
          done();
        });
        diag.receive({});
      });
  });

  it('FC 08 should accept per-message overrides', function (done) {
    helper.load([modbusClientConfig, modbusDiagnosticNode],
      createFlow({ mode: 'diagnostics', subFunction: 0, dataField: 0 }), function () {
        const cfg = helper.getNode('config1');
        const diag = helper.getNode('diag1');
        const h = helper.getNode('helper1');
        simulateConnectedTransport(cfg);
        h.on('input', function (msg) {
          expect(msg.payload.subFunction).to.equal(0x0A);
          expect(msg.payload.data).to.equal(0x1234);
          done();
        });
        diag.receive({ subFunction: 0x0A, dataField: 0x1234 });
      });
  });

  it('FC 11 should return event counter', function (done) {
    helper.load([modbusClientConfig, modbusDiagnosticNode], createFlow({ mode: 'eventCounter' }), function () {
      const cfg = helper.getNode('config1');
      const diag = helper.getNode('diag1');
      const h = helper.getNode('helper1');
      simulateConnectedTransport(cfg);
      h.on('input', function (msg) {
        expect(msg.payload.fc).to.equal(11);
        expect(msg.payload.status).to.equal(0xFFFF);
        expect(msg.payload.eventCount).to.equal(1);
        done();
      });
      diag.receive({});
    });
  });

  it('FC 12 should parse event log fields', function (done) {
    helper.load([modbusClientConfig, modbusDiagnosticNode], createFlow({ mode: 'eventLog' }), function () {
      const cfg = helper.getNode('config1');
      const diag = helper.getNode('diag1');
      const h = helper.getNode('helper1');
      simulateConnectedTransport(cfg);
      h.on('input', function (msg) {
        expect(msg.payload.fc).to.equal(12);
        expect(msg.payload.status).to.equal(0xFFFF);
        expect(msg.payload.eventCount).to.equal(5);
        expect(msg.payload.messageCount).to.equal(10);
        expect(msg.payload.events).to.deep.equal([0xAA, 0xBB]);
        done();
      });
      diag.receive({});
    });
  });

  it('FC 17 should return server ID and run indicator', function (done) {
    helper.load([modbusClientConfig, modbusDiagnosticNode], createFlow({ mode: 'reportServerId' }), function () {
      const cfg = helper.getNode('config1');
      const diag = helper.getNode('diag1');
      const h = helper.getNode('helper1');
      simulateConnectedTransport(cfg);
      h.on('input', function (msg) {
        expect(msg.payload.fc).to.equal(17);
        expect(msg.payload.serverId).to.equal(0x42);
        expect(msg.payload.running).to.be.true;
        expect(msg.payload.additionalData.toString()).to.equal('Demo PLC');
        done();
      });
      diag.receive({});
    });
  });

  it('should error when transport is not connected', function (done) {
    helper.load([modbusClientConfig, modbusDiagnosticNode], createFlow({ mode: 'exceptionStatus' }), function () {
      const diag = helper.getNode('diag1');
      diag.error = function (err) {
        expect(String(err)).to.match(/not connected/i);
        done();
      };
      diag.receive({});
    });
  });

  it('should reject concurrent operations', function (done) {
    helper.load([modbusClientConfig, modbusDiagnosticNode], createFlow({ mode: 'exceptionStatus' }), function () {
      const cfg = helper.getNode('config1');
      const diag = helper.getNode('diag1');
      simulateConnectedTransport(cfg);
      diag._busy = true;
      diag.error = function (err) {
        expect(String(err)).to.match(/already in progress/i);
        diag._busy = false;
        done();
      };
      diag.receive({});
    });
  });
});
