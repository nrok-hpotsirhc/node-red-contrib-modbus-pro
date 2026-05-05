'use strict';

const { expect } = require('chai');
const sinon = require('sinon');
const ModbusRTU = require('modbus-serial');

const RtuOverTcpTransport = require('../../../src/lib/transport/rtu-over-tcp-transport');
const TransportFactory = require('../../../src/lib/transport/transport-factory');
const BaseTransport = require('../../../src/lib/transport/base-transport');

describe('RtuOverTcpTransport', function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe('construction', function () {
    it('should default port to 4001 (Moxa default)', function () {
      const t = new RtuOverTcpTransport({ host: '10.0.0.1' });
      expect(t._config.port).to.equal(4001);
    });

    it('should expose type "rtu-over-tcp"', function () {
      const t = new RtuOverTcpTransport({ host: '10.0.0.1' });
      expect(t.type).to.equal('rtu-over-tcp');
    });

    it('should default interFrameDelay to 0', function () {
      const t = new RtuOverTcpTransport({ host: '10.0.0.1' });
      expect(t.interFrameDelay).to.equal(0);
    });

    it('should expose configured interFrameDelay', function () {
      const t = new RtuOverTcpTransport({ host: '10.0.0.1', interFrameDelay: 5 });
      expect(t.interFrameDelay).to.equal(5);
    });

    it('should be a BaseTransport subclass', function () {
      const t = new RtuOverTcpTransport({ host: '10.0.0.1' });
      expect(t).to.be.instanceOf(BaseTransport);
    });
  });

  describe('connect()', function () {
    it('should call connectTcpRTUBuffered with host and port', async function () {
      sandbox.stub(ModbusRTU.prototype, 'connectTcpRTUBuffered').resolves();
      sandbox.stub(ModbusRTU.prototype, 'setID');
      sandbox.stub(ModbusRTU.prototype, 'setTimeout');

      const t = new RtuOverTcpTransport({ host: '10.0.0.5', port: 4001, unitId: 7, timeout: 2000 });
      await t.connect();

      expect(ModbusRTU.prototype.connectTcpRTUBuffered.calledOnce).to.be.true;
      const args = ModbusRTU.prototype.connectTcpRTUBuffered.firstCall.args;
      expect(args[0]).to.equal('10.0.0.5');
      expect(args[1]).to.deep.equal({ port: 4001 });
      expect(ModbusRTU.prototype.setID.calledWith(7)).to.be.true;
      expect(ModbusRTU.prototype.setTimeout.calledWith(2000)).to.be.true;
      expect(t.isOpen).to.be.a('function');
    });

    it('should emit "connect" on success', async function () {
      sandbox.stub(ModbusRTU.prototype, 'connectTcpRTUBuffered').resolves();
      sandbox.stub(ModbusRTU.prototype, 'setID');
      sandbox.stub(ModbusRTU.prototype, 'setTimeout');

      const t = new RtuOverTcpTransport({ host: '10.0.0.1' });
      const connectSpy = sinon.spy();
      t.on('connect', connectSpy);
      await t.connect();
      expect(connectSpy.calledOnce).to.be.true;
    });

    it('should not reconnect when already connected', async function () {
      sandbox.stub(ModbusRTU.prototype, 'connectTcpRTUBuffered').resolves();
      sandbox.stub(ModbusRTU.prototype, 'setID');
      sandbox.stub(ModbusRTU.prototype, 'setTimeout');

      const t = new RtuOverTcpTransport({ host: '10.0.0.1' });
      await t.connect();
      await t.connect();
      expect(ModbusRTU.prototype.connectTcpRTUBuffered.calledOnce).to.be.true;
    });

    it('should emit "error" and rethrow on connection failure', async function () {
      const err = new Error('ECONNREFUSED');
      sandbox.stub(ModbusRTU.prototype, 'connectTcpRTUBuffered').rejects(err);

      const t = new RtuOverTcpTransport({ host: '10.0.0.1' });
      const errorSpy = sinon.spy();
      t.on('error', errorSpy);

      let thrown = null;
      try {
        await t.connect();
      } catch (e) {
        thrown = e;
      }
      expect(thrown).to.equal(err);
      expect(errorSpy.calledOnce).to.be.true;
    });
  });

  describe('TransportFactory integration', function () {
    it('should create an RtuOverTcpTransport for type "rtu-over-tcp"', function () {
      const t = TransportFactory.create({ type: 'rtu-over-tcp', host: '10.0.0.1', port: 4001 });
      expect(t).to.be.instanceOf(RtuOverTcpTransport);
    });

    it('should require host and port', function () {
      expect(() => TransportFactory.create({ type: 'rtu-over-tcp' }))
        .to.throw(/missing required fields/);
    });

    it('should reject unknown transport types with the new message', function () {
      expect(() => TransportFactory.create({ type: 'serial' }))
        .to.throw(/'tcp', 'rtu', or 'rtu-over-tcp'/);
    });
  });
});
