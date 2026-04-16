'use strict';

const helper = require('node-red-node-test-helper');
const { expect } = require('chai');
const sinon = require('sinon');
const ModbusRTU = require('modbus-serial');

const modbusWriteNode = require('../../src/nodes/client/modbus-write');
const modbusClientConfig = require('../../src/nodes/config/modbus-client-config');

helper.init(require.resolve('node-red'));

describe('modbus-write (integration)', function () {
  let sandbox;

  beforeEach(function (done) {
    sandbox = sinon.createSandbox();

    // Stub modbus-serial prototype methods
    sandbox.stub(ModbusRTU.prototype, 'connectTCP').resolves();
    sandbox.stub(ModbusRTU.prototype, 'setID');
    sandbox.stub(ModbusRTU.prototype, 'getID').returns(1);
    sandbox.stub(ModbusRTU.prototype, 'setTimeout');
    sandbox.stub(ModbusRTU.prototype, 'close').callsFake(function (cb) {
      if (typeof cb === 'function') cb();
    });
    sandbox.stub(ModbusRTU.prototype, 'removeAllListeners');

    // Write stubs
    sandbox.stub(ModbusRTU.prototype, 'writeCoil').resolves(); // TEST-DATA: FC 05
    sandbox.stub(ModbusRTU.prototype, 'writeRegister').resolves(); // TEST-DATA: FC 06
    sandbox.stub(ModbusRTU.prototype, 'writeCoils').resolves(); // TEST-DATA: FC 15
    sandbox.stub(ModbusRTU.prototype, 'writeRegisters').resolves(); // TEST-DATA: FC 16

    helper.startServer(done);
  });

  afterEach(function (done) {
    sandbox.restore();
    helper.unload().then(function () {
      helper.stopServer(done);
    });
  });

  /**
   * Helper to create a minimal flow with a config node, a modbus-write node,
   * and a helper node to capture output messages.
   */
  function createFlow(writeConfig) {
    return [
      {
        id: 'config1',
        type: 'modbus-client-config',
        name: 'Test TCP',
        connectionType: 'tcp',
        host: '127.0.0.1',
        port: 502,
        unitId: 1,
        timeout: 1000
      },
      {
        id: 'write1',
        type: 'modbus-write',
        name: writeConfig.name || 'Test Write',
        server: 'config1',
        fc: String(writeConfig.fc || 6),
        address: writeConfig.address || 0,
        addressOffset: writeConfig.addressOffset || 'zero-based',
        queueMaxSize: writeConfig.queueMaxSize || 100,
        queueDropStrategy: writeConfig.queueDropStrategy || 'fifo',
        wires: [['helper1']]
      },
      {
        id: 'helper1',
        type: 'helper'
      }
    ];
  }

  /**
   * Simulate a connected transport on the config node.
   */
  function simulateConnectedTransport(configNode) {
    const transport = configNode.createTransport();
    transport._connected = true;
    Object.defineProperty(transport._client, 'isOpen', { get: () => true });
    configNode._transport = transport;
    return transport;
  }

  // ---- Node Loading ----

  it('should load the modbus-write node', function (done) {
    const flow = createFlow({ fc: 6, address: 0 });
    helper.load([modbusClientConfig, modbusWriteNode], flow, function () {
      const writeNode = helper.getNode('write1');
      expect(writeNode).to.exist;
      expect(writeNode.type).to.equal('modbus-write');
      done();
    });
  });

  it('should show error status when no config node is selected', function (done) {
    const flow = [
      {
        id: 'write1',
        type: 'modbus-write',
        name: 'No Config',
        server: '',
        fc: '6',
        address: 0,
        addressOffset: 'zero-based',
        queueMaxSize: 100,
        queueDropStrategy: 'fifo',
        wires: [[]]
      }
    ];

    helper.load([modbusWriteNode], flow, function () {
      const writeNode = helper.getNode('write1');
      expect(writeNode).to.exist;
      done();
    });
  });

  // ---- FC 05: Write Single Coil ----

  it('should write single coil (FC 05) with boolean true', function (done) {
    const flow = createFlow({ fc: 5, address: 0 });

    helper.load([modbusClientConfig, modbusWriteNode], flow, function () {
      const configNode = helper.getNode('config1');
      const writeNode = helper.getNode('write1');
      const helperNode = helper.getNode('helper1');

      simulateConnectedTransport(configNode);

      helperNode.on('input', function (msg) {
        expect(msg.payload).to.be.an('object');
        expect(msg.payload.fc).to.equal(5);
        expect(msg.payload.fcName).to.equal('writeSingleCoil');
        expect(msg.payload.value).to.equal(true);
        expect(msg.payload.address).to.equal(0);
        expect(msg.payload.unitId).to.equal(1);
        expect(msg.payload.timestamp).to.be.a('string');
        expect(msg.payload.connection).to.match(/^tcp:\/\//);
        expect(msg.modbusWrite).to.be.an('object');
        expect(msg.modbusWrite.fc).to.equal(5);
        expect(msg.modbusWrite.value).to.equal(true);
        done();
      });

      writeNode.receive({ payload: true }); // TEST-DATA: boolean true
    });
  });

  it('should write single coil (FC 05) with 0xFF00', function (done) {
    const flow = createFlow({ fc: 5, address: 10 });

    helper.load([modbusClientConfig, modbusWriteNode], flow, function () {
      const configNode = helper.getNode('config1');
      const writeNode = helper.getNode('write1');
      const helperNode = helper.getNode('helper1');

      simulateConnectedTransport(configNode);

      helperNode.on('input', function (msg) {
        expect(msg.payload.value).to.equal(true);
        done();
      });

      writeNode.receive({ payload: 0xFF00 }); // TEST-DATA: coil ON value
    });
  });

  it('should write single coil (FC 05) with false', function (done) {
    const flow = createFlow({ fc: 5, address: 0 });

    helper.load([modbusClientConfig, modbusWriteNode], flow, function () {
      const configNode = helper.getNode('config1');
      const writeNode = helper.getNode('write1');
      const helperNode = helper.getNode('helper1');

      simulateConnectedTransport(configNode);

      helperNode.on('input', function (msg) {
        expect(msg.payload.value).to.equal(false);
        done();
      });

      writeNode.receive({ payload: false }); // TEST-DATA: boolean false
    });
  });

  // ---- FC 06: Write Single Register ----

  it('should write single register (FC 06) with integer value', function (done) {
    const flow = createFlow({ fc: 6, address: 100 });

    helper.load([modbusClientConfig, modbusWriteNode], flow, function () {
      const configNode = helper.getNode('config1');
      const writeNode = helper.getNode('write1');
      const helperNode = helper.getNode('helper1');

      simulateConnectedTransport(configNode);

      helperNode.on('input', function (msg) {
        expect(msg.payload.fc).to.equal(6);
        expect(msg.payload.fcName).to.equal('writeSingleRegister');
        expect(msg.payload.value).to.equal(42);
        expect(msg.payload.address).to.equal(100);
        done();
      });

      writeNode.receive({ payload: 42 }); // TEST-DATA: register value
    });
  });

  it('should write single register (FC 06) with value 0', function (done) {
    const flow = createFlow({ fc: 6, address: 0 });

    helper.load([modbusClientConfig, modbusWriteNode], flow, function () {
      const configNode = helper.getNode('config1');
      const writeNode = helper.getNode('write1');
      const helperNode = helper.getNode('helper1');

      simulateConnectedTransport(configNode);

      helperNode.on('input', function (msg) {
        expect(msg.payload.value).to.equal(0);
        done();
      });

      writeNode.receive({ payload: 0 }); // TEST-DATA: zero value
    });
  });

  it('should write single register (FC 06) with max value 65535', function (done) {
    const flow = createFlow({ fc: 6, address: 0 });

    helper.load([modbusClientConfig, modbusWriteNode], flow, function () {
      const configNode = helper.getNode('config1');
      const writeNode = helper.getNode('write1');
      const helperNode = helper.getNode('helper1');

      simulateConnectedTransport(configNode);

      helperNode.on('input', function (msg) {
        expect(msg.payload.value).to.equal(65535);
        done();
      });

      writeNode.receive({ payload: 65535 }); // TEST-DATA: max 16-bit value
    });
  });

  // ---- FC 15: Write Multiple Coils ----

  it('should write multiple coils (FC 15) with boolean array', function (done) {
    const flow = createFlow({ fc: 15, address: 0 });

    helper.load([modbusClientConfig, modbusWriteNode], flow, function () {
      const configNode = helper.getNode('config1');
      const writeNode = helper.getNode('write1');
      const helperNode = helper.getNode('helper1');

      simulateConnectedTransport(configNode);

      helperNode.on('input', function (msg) {
        expect(msg.payload.fc).to.equal(15);
        expect(msg.payload.fcName).to.equal('writeMultipleCoils');
        expect(msg.payload.value).to.deep.equal([true, false, true]);
        expect(msg.payload.quantity).to.equal(3);
        done();
      });

      writeNode.receive({ payload: [true, false, true] }); // TEST-DATA: coil array
    });
  });

  it('should convert truthy values to boolean for FC 15', function (done) {
    const flow = createFlow({ fc: 15, address: 0 });

    helper.load([modbusClientConfig, modbusWriteNode], flow, function () {
      const configNode = helper.getNode('config1');
      const writeNode = helper.getNode('write1');
      const helperNode = helper.getNode('helper1');

      simulateConnectedTransport(configNode);

      helperNode.on('input', function (msg) {
        expect(msg.payload.value).to.deep.equal([true, false, true, false]);
        done();
      });

      writeNode.receive({ payload: [1, 0, 1, 0] }); // TEST-DATA: truthy/falsy values
    });
  });

  // ---- FC 16: Write Multiple Registers ----

  it('should write multiple registers (FC 16) with integer array', function (done) {
    const flow = createFlow({ fc: 16, address: 0 });

    helper.load([modbusClientConfig, modbusWriteNode], flow, function () {
      const configNode = helper.getNode('config1');
      const writeNode = helper.getNode('write1');
      const helperNode = helper.getNode('helper1');

      simulateConnectedTransport(configNode);

      helperNode.on('input', function (msg) {
        expect(msg.payload.fc).to.equal(16);
        expect(msg.payload.fcName).to.equal('writeMultipleRegisters');
        expect(msg.payload.value).to.deep.equal([100, 200, 300]);
        expect(msg.payload.quantity).to.equal(3);
        done();
      });

      writeNode.receive({ payload: [100, 200, 300] }); // TEST-DATA: register array
    });
  });

  // ---- Address Offset (one-based) ----

  it('should apply one-based address offset correctly', function (done) {
    const flow = createFlow({ fc: 6, address: 108, addressOffset: 'one-based' });

    helper.load([modbusClientConfig, modbusWriteNode], flow, function () {
      const configNode = helper.getNode('config1');
      const writeNode = helper.getNode('write1');
      const helperNode = helper.getNode('helper1');

      simulateConnectedTransport(configNode);

      helperNode.on('input', function (msg) {
        expect(msg.payload.address).to.equal(107);
        expect(msg.modbusWrite.address).to.equal(108);
        expect(msg.modbusWrite.protocolAddress).to.equal(107);
        expect(msg.modbusWrite.addressOffset).to.equal('one-based');
        done();
      });

      writeNode.receive({ payload: 42 }); // TEST-DATA: register value
    });
  });

  // ---- Topic handling ----

  it('should preserve incoming message topic', function (done) {
    const flow = createFlow({ fc: 6, address: 0 });

    helper.load([modbusClientConfig, modbusWriteNode], flow, function () {
      const configNode = helper.getNode('config1');
      const writeNode = helper.getNode('write1');
      const helperNode = helper.getNode('helper1');

      simulateConnectedTransport(configNode);

      helperNode.on('input', function (msg) {
        expect(msg.topic).to.equal('custom/write/topic');
        done();
      });

      writeNode.receive({ payload: 42, topic: 'custom/write/topic' }); // TEST-DATA: custom topic
    });
  });

  it('should generate default topic when none provided', function (done) {
    const flow = createFlow({ fc: 6, address: 0 });

    helper.load([modbusClientConfig, modbusWriteNode], flow, function () {
      const configNode = helper.getNode('config1');
      const writeNode = helper.getNode('write1');
      const helperNode = helper.getNode('helper1');

      simulateConnectedTransport(configNode);

      helperNode.on('input', function (msg) {
        expect(msg.topic).to.equal('modbus:Single Register');
        done();
      });

      writeNode.receive({ payload: 42 }); // TEST-DATA: register value
    });
  });

  // ---- Validation Errors ----

  it('should reject null payload', function (done) {
    const flow = createFlow({ fc: 6, address: 0 });

    helper.load([modbusClientConfig, modbusWriteNode], flow, function () {
      const configNode = helper.getNode('config1');
      const writeNode = helper.getNode('write1');

      simulateConnectedTransport(configNode);

      writeNode.on('call:error', function () {
        done();
      });

      writeNode.receive({ payload: null }); // TEST-DATA: null payload
    });
  });

  it('should reject invalid FC 06 value (string)', function (done) {
    const flow = createFlow({ fc: 6, address: 0 });

    helper.load([modbusClientConfig, modbusWriteNode], flow, function () {
      const configNode = helper.getNode('config1');
      const writeNode = helper.getNode('write1');

      simulateConnectedTransport(configNode);

      writeNode.on('call:error', function () {
        done();
      });

      writeNode.receive({ payload: 'not a number' }); // TEST-DATA: invalid string
    });
  });

  it('should reject FC 06 value out of range (negative)', function (done) {
    const flow = createFlow({ fc: 6, address: 0 });

    helper.load([modbusClientConfig, modbusWriteNode], flow, function () {
      const configNode = helper.getNode('config1');
      const writeNode = helper.getNode('write1');

      simulateConnectedTransport(configNode);

      writeNode.on('call:error', function () {
        done();
      });

      writeNode.receive({ payload: -1 }); // TEST-DATA: negative value
    });
  });

  it('should reject FC 06 value out of range (>65535)', function (done) {
    const flow = createFlow({ fc: 6, address: 0 });

    helper.load([modbusClientConfig, modbusWriteNode], flow, function () {
      const configNode = helper.getNode('config1');
      const writeNode = helper.getNode('write1');

      simulateConnectedTransport(configNode);

      writeNode.on('call:error', function () {
        done();
      });

      writeNode.receive({ payload: 70000 }); // TEST-DATA: out of range value
    });
  });

  it('should reject FC 16 with non-array payload', function (done) {
    const flow = createFlow({ fc: 16, address: 0 });

    helper.load([modbusClientConfig, modbusWriteNode], flow, function () {
      const configNode = helper.getNode('config1');
      const writeNode = helper.getNode('write1');

      simulateConnectedTransport(configNode);

      writeNode.on('call:error', function () {
        done();
      });

      writeNode.receive({ payload: 42 }); // TEST-DATA: not an array for FC 16
    });
  });

  it('should reject FC 15 with empty array', function (done) {
    const flow = createFlow({ fc: 15, address: 0 });

    helper.load([modbusClientConfig, modbusWriteNode], flow, function () {
      const configNode = helper.getNode('config1');
      const writeNode = helper.getNode('write1');

      simulateConnectedTransport(configNode);

      writeNode.on('call:error', function () {
        done();
      });

      writeNode.receive({ payload: [] }); // TEST-DATA: empty array for FC 15
    });
  });

  // ---- Error handling ----

  it('should report error when transport is not connected', function (done) {
    const flow = createFlow({ fc: 6, address: 0 });

    helper.load([modbusClientConfig, modbusWriteNode], flow, function () {
      const writeNode = helper.getNode('write1');

      writeNode.on('call:error', function () {
        done();
      });

      writeNode.receive({ payload: 42 }); // TEST-DATA: trigger with no transport
    });
  });

  it('should report error when transport write fails', function (done) {
    const flow = createFlow({ fc: 6, address: 0 });

    helper.load([modbusClientConfig, modbusWriteNode], flow, function () {
      const configNode = helper.getNode('config1');
      const writeNode = helper.getNode('write1');

      simulateConnectedTransport(configNode);

      ModbusRTU.prototype.writeRegister.rejects(new Error('Write timeout'));

      writeNode.on('call:error', function () {
        done();
      });

      writeNode.receive({ payload: 42 }); // TEST-DATA: trigger with failing transport
    });
  });

  // ---- Queue behavior ----

  it('should process multiple writes sequentially via queue', function (done) {
    const flow = createFlow({ fc: 6, address: 0, queueMaxSize: 10 });
    let outputCount = 0;

    helper.load([modbusClientConfig, modbusWriteNode], flow, function () {
      const configNode = helper.getNode('config1');
      const writeNode = helper.getNode('write1');
      const helperNode = helper.getNode('helper1');

      simulateConnectedTransport(configNode);

      helperNode.on('input', function (msg) {
        outputCount++;
        if (outputCount === 3) {
          done();
        }
      });

      writeNode.receive({ payload: 10 }); // TEST-DATA: sequential write 1
      writeNode.receive({ payload: 20 }); // TEST-DATA: sequential write 2
      writeNode.receive({ payload: 30 }); // TEST-DATA: sequential write 3
    });
  });

  // ---- Cleanup ----

  it('should clean up queue on close', function (done) {
    const flow = createFlow({ fc: 6, address: 0 });

    helper.load([modbusClientConfig, modbusWriteNode], flow, function () {
      const writeNode = helper.getNode('write1');
      expect(writeNode._queue).to.not.be.null;

      helper.unload().then(function () {
        done();
      });
    });
  });
});
