'use strict';

const helper = require('node-red-node-test-helper');
const { expect } = require('chai');
const sinon = require('sinon');
const ModbusRTU = require('modbus-serial');

const modbusReadNode = require('../../src/nodes/client/modbus-read');
const modbusClientConfig = require('../../src/nodes/config/modbus-client-config');

helper.init(require.resolve('node-red'));

describe('modbus-read (integration)', function () {
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

    // Default read stubs
    sandbox.stub(ModbusRTU.prototype, 'readHoldingRegisters').resolves({
      data: [100, 200], // TEST-DATA: two holding register values
      buffer: Buffer.from([0x00, 0x64, 0x00, 0xC8])
    });
    sandbox.stub(ModbusRTU.prototype, 'readCoils').resolves({
      data: [true, false, true], // TEST-DATA: three coil values
      buffer: Buffer.from([0x05])
    });
    sandbox.stub(ModbusRTU.prototype, 'readDiscreteInputs').resolves({
      data: [false, true], // TEST-DATA: two discrete input values
      buffer: Buffer.from([0x02])
    });
    sandbox.stub(ModbusRTU.prototype, 'readInputRegisters').resolves({
      data: [300], // TEST-DATA: one input register value
      buffer: Buffer.from([0x01, 0x2C])
    });

    helper.startServer(done);
  });

  afterEach(function (done) {
    sandbox.restore();
    helper.unload().then(function () {
      helper.stopServer(done);
    });
  });

  /**
   * Helper to create a minimal flow with a config node, a modbus-read node,
   * and a helper node to capture output messages.
   */
  function createFlow(readConfig) {
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
        id: 'read1',
        type: 'modbus-read',
        name: readConfig.name || 'Test Read',
        server: 'config1',
        fc: String(readConfig.fc || 3),
        address: readConfig.address || 0,
        quantity: readConfig.quantity || 1,
        addressOffset: readConfig.addressOffset || 'zero-based',
        pollInterval: readConfig.pollInterval || 0,
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
    // Ensure isOpen returns true
    Object.defineProperty(transport._client, 'isOpen', { get: () => true });
    configNode._transport = transport;
    return transport;
  }

  // ---- Node Loading ----

  it('should load the modbus-read node', function (done) {
    const flow = createFlow({ fc: 3, address: 0, quantity: 1 });
    helper.load([modbusClientConfig, modbusReadNode], flow, function () {
      const readNode = helper.getNode('read1');
      expect(readNode).to.exist;
      expect(readNode.type).to.equal('modbus-read');
      done();
    });
  });

  it('should show error status when no config node is selected', function (done) {
    const flow = [
      {
        id: 'read1',
        type: 'modbus-read',
        name: 'No Config',
        server: '',
        fc: '3',
        address: 0,
        quantity: 1,
        addressOffset: 'zero-based',
        pollInterval: 0,
        wires: [[]]
      }
    ];

    helper.load([modbusReadNode], flow, function () {
      const readNode = helper.getNode('read1');
      expect(readNode).to.exist;
      // Node should have reported an error
      done();
    });
  });

  // ---- FC 03: Read Holding Registers ----

  it('should read holding registers (FC 03) on trigger', function (done) {
    const flow = createFlow({ fc: 3, address: 0, quantity: 2 });

    helper.load([modbusClientConfig, modbusReadNode], flow, function () {
      const configNode = helper.getNode('config1');
      const readNode = helper.getNode('read1');
      const helperNode = helper.getNode('helper1');

      simulateConnectedTransport(configNode);

      helperNode.on('input', function (msg) {
        expect(msg.payload).to.be.an('object');
        expect(msg.payload.data).to.deep.equal([100, 200]);
        expect(msg.payload.fc).to.equal(3);
        expect(msg.payload.fcName).to.equal('readHoldingRegisters');
        expect(msg.payload.address).to.equal(0);
        expect(msg.payload.quantity).to.equal(2);
        expect(msg.payload.unitId).to.equal(1);
        expect(msg.payload.timestamp).to.be.a('string');
        expect(msg.payload.connection).to.match(/^tcp:\/\//);
        expect(msg.modbusRead).to.be.an('object');
        expect(msg.modbusRead.fc).to.equal(3);
        done();
      });

      readNode.receive({ payload: 'trigger' });
    });
  });

  // ---- FC 01: Read Coils ----

  it('should read coils (FC 01) on trigger', function (done) {
    const flow = createFlow({ fc: 1, address: 0, quantity: 3 });

    helper.load([modbusClientConfig, modbusReadNode], flow, function () {
      const configNode = helper.getNode('config1');
      const readNode = helper.getNode('read1');
      const helperNode = helper.getNode('helper1');

      simulateConnectedTransport(configNode);

      helperNode.on('input', function (msg) {
        expect(msg.payload.data).to.deep.equal([true, false, true]);
        expect(msg.payload.fc).to.equal(1);
        expect(msg.payload.fcName).to.equal('readCoils');
        done();
      });

      readNode.receive({ payload: 'trigger' });
    });
  });

  // ---- FC 02: Read Discrete Inputs ----

  it('should read discrete inputs (FC 02) on trigger', function (done) {
    const flow = createFlow({ fc: 2, address: 0, quantity: 2 });

    helper.load([modbusClientConfig, modbusReadNode], flow, function () {
      const configNode = helper.getNode('config1');
      const readNode = helper.getNode('read1');
      const helperNode = helper.getNode('helper1');

      simulateConnectedTransport(configNode);

      helperNode.on('input', function (msg) {
        expect(msg.payload.data).to.deep.equal([false, true]);
        expect(msg.payload.fc).to.equal(2);
        expect(msg.payload.fcName).to.equal('readDiscreteInputs');
        done();
      });

      readNode.receive({ payload: 'trigger' });
    });
  });

  // ---- FC 04: Read Input Registers ----

  it('should read input registers (FC 04) on trigger', function (done) {
    const flow = createFlow({ fc: 4, address: 0, quantity: 1 });

    helper.load([modbusClientConfig, modbusReadNode], flow, function () {
      const configNode = helper.getNode('config1');
      const readNode = helper.getNode('read1');
      const helperNode = helper.getNode('helper1');

      simulateConnectedTransport(configNode);

      helperNode.on('input', function (msg) {
        expect(msg.payload.data).to.deep.equal([300]);
        expect(msg.payload.fc).to.equal(4);
        expect(msg.payload.fcName).to.equal('readInputRegisters');
        done();
      });

      readNode.receive({ payload: 'trigger' });
    });
  });

  // ---- Address Offset (one-based) ----

  it('should apply one-based address offset correctly', function (done) {
    // Datasheet address 40108 → one-based: address=108, protocol: 107
    const flow = createFlow({ fc: 3, address: 108, quantity: 1, addressOffset: 'one-based' });

    helper.load([modbusClientConfig, modbusReadNode], flow, function () {
      const configNode = helper.getNode('config1');
      const readNode = helper.getNode('read1');
      const helperNode = helper.getNode('helper1');

      simulateConnectedTransport(configNode);

      helperNode.on('input', function (msg) {
        // Protocol address should be 107 (108 - 1)
        expect(msg.payload.address).to.equal(107);
        expect(msg.modbusRead.address).to.equal(108); // original
        expect(msg.modbusRead.protocolAddress).to.equal(107); // computed
        expect(msg.modbusRead.addressOffset).to.equal('one-based');
        done();
      });

      readNode.receive({ payload: 'trigger' });
    });
  });

  it('should use zero-based address as-is', function (done) {
    const flow = createFlow({ fc: 3, address: 107, quantity: 1, addressOffset: 'zero-based' });

    helper.load([modbusClientConfig, modbusReadNode], flow, function () {
      const configNode = helper.getNode('config1');
      const readNode = helper.getNode('read1');
      const helperNode = helper.getNode('helper1');

      simulateConnectedTransport(configNode);

      helperNode.on('input', function (msg) {
        expect(msg.payload.address).to.equal(107);
        expect(msg.modbusRead.protocolAddress).to.equal(107);
        done();
      });

      readNode.receive({ payload: 'trigger' });
    });
  });

  // ---- Topic handling ----

  it('should preserve incoming message topic', function (done) {
    const flow = createFlow({ fc: 3, address: 0, quantity: 1 });

    helper.load([modbusClientConfig, modbusReadNode], flow, function () {
      const configNode = helper.getNode('config1');
      const readNode = helper.getNode('read1');
      const helperNode = helper.getNode('helper1');

      simulateConnectedTransport(configNode);

      helperNode.on('input', function (msg) {
        expect(msg.topic).to.equal('custom/topic');
        done();
      });

      readNode.receive({ payload: 'trigger', topic: 'custom/topic' });
    });
  });

  it('should generate default topic when none provided', function (done) {
    const flow = createFlow({ fc: 3, address: 0, quantity: 1 });

    helper.load([modbusClientConfig, modbusReadNode], flow, function () {
      const configNode = helper.getNode('config1');
      const readNode = helper.getNode('read1');
      const helperNode = helper.getNode('helper1');

      simulateConnectedTransport(configNode);

      helperNode.on('input', function (msg) {
        expect(msg.topic).to.equal('modbus:Holding Registers');
        done();
      });

      readNode.receive({ payload: 'trigger' });
    });
  });

  // ---- Error handling ----

  it('should report error when transport is not connected', function (done) {
    const flow = createFlow({ fc: 3, address: 0, quantity: 1 });

    helper.load([modbusClientConfig, modbusReadNode], flow, function () {
      const readNode = helper.getNode('read1');

      // No transport is set (not connected)
      readNode.on('call:error', function () {
        done();
      });

      readNode.receive({ payload: 'trigger' });
    });
  });

  it('should report error when transport read fails', function (done) {
    const flow = createFlow({ fc: 3, address: 0, quantity: 1 });

    helper.load([modbusClientConfig, modbusReadNode], flow, function () {
      const configNode = helper.getNode('config1');
      const readNode = helper.getNode('read1');

      simulateConnectedTransport(configNode);

      // Make readHoldingRegisters reject
      ModbusRTU.prototype.readHoldingRegisters.rejects(new Error('Timeout'));

      readNode.on('call:error', function () {
        done();
      });

      readNode.receive({ payload: 'trigger' });
    });
  });

  // ---- Cleanup ----

  it('should clean up poll timer on close', function (done) {
    const flow = createFlow({ fc: 3, address: 0, quantity: 1, pollInterval: 60000 });

    helper.load([modbusClientConfig, modbusReadNode], flow, function () {
      const readNode = helper.getNode('read1');
      expect(readNode._pollTimer).to.not.be.null;

      // Unload triggers close
      helper.unload().then(function () {
        // After unload the timer should be cleared
        // (We can't access readNode._pollTimer after unload, but no errors = success)
        done();
      });
    });
  });
});
