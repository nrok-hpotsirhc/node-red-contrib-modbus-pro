'use strict';

const helper = require('node-red-node-test-helper');
const { expect } = require('chai');
const sinon = require('sinon');
const ModbusRTU = require('modbus-serial');

const modbusFileNode = require('../../src/nodes/client/modbus-file');
const modbusClientConfig = require('../../src/nodes/config/modbus-client-config');

helper.init(require.resolve('node-red'));

describe('modbus-file (integration)', function () {
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

    sandbox.stub(ModbusRTU.prototype, 'customFunction').callsFake(function (fc /* , payload */) {
      if (fc === 0x14) {
        // FC 20 response: byteCount=5 + sub-resp(subLen=5,refType=0x06,data=2 regs 0x1234 0x5678)
        // We use the headerless variant tolerated by the parser
        // TEST-DATA: one record with two registers
        return Promise.resolve({ buffer: Buffer.from([5, 0x06, 0x12, 0x34, 0x56, 0x78]) });
      }
      if (fc === 0x15) {
        // FC 21 response: echo of request – simulate a non-empty buffer
        return Promise.resolve({ buffer: Buffer.from([0x06, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0xAA, 0xBB, 0xCC, 0xDD]) });
      }
      if (fc === 0x18) {
        // FC 24 response: byteCount=8, fifoCount=3, values=[0x1111,0x2222,0x3333]
        return Promise.resolve({ buffer: Buffer.from([0x00, 0x08, 0x00, 0x03, 0x11, 0x11, 0x22, 0x22, 0x33, 0x33]) });
      }
      return Promise.resolve({ buffer: Buffer.alloc(0) });
    });

    helper.startServer(done);
  });

  afterEach(function (done) {
    sandbox.restore();
    helper.unload().then(function () {
      helper.stopServer(done);
    });
  });

  function createFlow(fileConfig) {
    return [
      { id: 'config1', type: 'modbus-client-config', name: 'Test', connectionType: 'tcp',
        host: '127.0.0.1', port: 502, unitId: 1, timeout: 1000 },
      { id: 'file1', type: 'modbus-file', name: 'Test File', server: 'config1',
        mode: fileConfig.mode || 'readFile',
        fileNumber: fileConfig.fileNumber || 1,
        recordNumber: fileConfig.recordNumber || 0,
        recordLength: fileConfig.recordLength || 2,
        fifoAddress: fileConfig.fifoAddress || 0,
        wires: [['helper1']] },
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

  it('should load the modbus-file node', function (done) {
    helper.load([modbusClientConfig, modbusFileNode], createFlow({ mode: 'readFile' }), function () {
      const n = helper.getNode('file1');
      expect(n).to.exist;
      expect(n.type).to.equal('modbus-file');
      done();
    });
  });

  it('FC 20 should read a file record', function (done) {
    helper.load([modbusClientConfig, modbusFileNode], createFlow({ mode: 'readFile', recordLength: 2 }), function () {
      const cfg = helper.getNode('config1');
      const fnode = helper.getNode('file1');
      const h = helper.getNode('helper1');
      simulateConnectedTransport(cfg);
      h.on('input', function (msg) {
        expect(msg.payload.fc).to.equal(20);
        expect(msg.payload.records).to.have.lengthOf(1);
        expect(msg.payload.records[0]).to.deep.equal([0x1234, 0x5678]);
        done();
      });
      fnode.receive({});
    });
  });

  it('FC 21 should write a file record from msg.payload.values', function (done) {
    helper.load([modbusClientConfig, modbusFileNode], createFlow({ mode: 'writeFile' }), function () {
      const cfg = helper.getNode('config1');
      const fnode = helper.getNode('file1');
      const h = helper.getNode('helper1');
      simulateConnectedTransport(cfg);
      h.on('input', function (msg) {
        expect(msg.payload.fc).to.equal(21);
        expect(msg.payload.valuesWritten).to.equal(2);
        // Verify request bytes contained the values 0xAABB / 0xCCDD
        const args = ModbusRTU.prototype.customFunction.firstCall.args;
        expect(args[0]).to.equal(0x15);
        const req = args[1];
        // refType + fileNumber(2) + recordNumber(2) + recordLength(2) + 2*2 bytes
        expect(req.slice(-4)).to.deep.equal([0xAA, 0xBB, 0xCC, 0xDD]);
        done();
      });
      fnode.receive({ payload: { values: [0xAABB, 0xCCDD] } });
    });
  });

  it('FC 21 should reject empty values array', function (done) {
    helper.load([modbusClientConfig, modbusFileNode], createFlow({ mode: 'writeFile' }), function () {
      const cfg = helper.getNode('config1');
      const fnode = helper.getNode('file1');
      simulateConnectedTransport(cfg);
      fnode.error = function (err) {
        expect(String(err)).to.match(/non-empty array/i);
        done();
      };
      fnode.receive({ payload: { values: [] } });
    });
  });

  it('FC 24 should read FIFO queue', function (done) {
    helper.load([modbusClientConfig, modbusFileNode], createFlow({ mode: 'readFifo', fifoAddress: 100 }), function () {
      const cfg = helper.getNode('config1');
      const fnode = helper.getNode('file1');
      const h = helper.getNode('helper1');
      simulateConnectedTransport(cfg);
      h.on('input', function (msg) {
        expect(msg.payload.fc).to.equal(24);
        expect(msg.payload.count).to.equal(3);
        expect(msg.payload.values).to.deep.equal([0x1111, 0x2222, 0x3333]);
        done();
      });
      fnode.receive({});
    });
  });

  it('should accept per-message override of fileNumber', function (done) {
    helper.load([modbusClientConfig, modbusFileNode], createFlow({ mode: 'readFile', recordLength: 2 }), function () {
      const cfg = helper.getNode('config1');
      const fnode = helper.getNode('file1');
      const h = helper.getNode('helper1');
      simulateConnectedTransport(cfg);
      h.on('input', function (msg) {
        expect(msg.payload.fileNumber).to.equal(7);
        // Verify request bytes encoded fileNumber=7 in big-endian
        const args = ModbusRTU.prototype.customFunction.firstCall.args;
        expect(args[1].slice(1, 3)).to.deep.equal([0x00, 0x07]);
        done();
      });
      fnode.receive({ payload: { fileNumber: 7 } });
    });
  });

  it('should error when transport is not connected', function (done) {
    helper.load([modbusClientConfig, modbusFileNode], createFlow({ mode: 'readFile' }), function () {
      const fnode = helper.getNode('file1');
      fnode.error = function (err) {
        expect(String(err)).to.match(/not connected/i);
        done();
      };
      fnode.receive({});
    });
  });
});
