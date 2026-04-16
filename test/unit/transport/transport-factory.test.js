'use strict';

const { expect } = require('chai');
const sinon = require('sinon');
const ModbusRTU = require('modbus-serial');
const TransportFactory = require('../../../src/lib/transport/transport-factory');
const TcpTransport = require('../../../src/lib/transport/tcp-transport');
const RtuTransport = require('../../../src/lib/transport/rtu-transport');

describe('TransportFactory', function () {
  let sandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    // Stub prototype methods to prevent real connections during construction
    sandbox.stub(ModbusRTU.prototype, 'connectTCP').resolves();
    sandbox.stub(ModbusRTU.prototype, 'connectRTUBuffered').resolves();
    sandbox.stub(ModbusRTU.prototype, 'setID');
    sandbox.stub(ModbusRTU.prototype, 'getID').returns(1);
    sandbox.stub(ModbusRTU.prototype, 'setTimeout');
    sandbox.stub(ModbusRTU.prototype, 'close').callsFake(function (cb) {
      if (typeof cb === 'function') cb();
    });
    sandbox.stub(ModbusRTU.prototype, 'removeAllListeners');
  });

  afterEach(function () {
    sandbox.restore();
  });

  // ---- create() with type 'tcp' ----

  describe('create() with type "tcp"', function () {
    it('should return a TcpTransport instance', function () {
      const transport = TransportFactory.create({
        type: 'tcp',
        host: '10.0.0.1',
        port: 502
      });
      expect(transport).to.be.instanceOf(TcpTransport);
    });

    it('should pass config through to TcpTransport', function () {
      const transport = TransportFactory.create({
        type: 'tcp',
        host: '192.168.1.100',
        port: 5020,
        timeout: 3000,
        unitId: 7
      });
      expect(transport._config.host).to.equal('192.168.1.100');
      expect(transport._config.port).to.equal(5020);
      expect(transport._config.timeout).to.equal(3000);
      expect(transport._config.unitId).to.equal(7);
    });
  });

  // ---- create() with type 'rtu' ----

  describe('create() with type "rtu"', function () {
    it('should return an RtuTransport instance', function () {
      const transport = TransportFactory.create({
        type: 'rtu',
        serialPort: '/dev/ttyUSB0',
        baudRate: 9600
      });
      expect(transport).to.be.instanceOf(RtuTransport);
    });

    it('should pass config through to RtuTransport', function () {
      const transport = TransportFactory.create({
        type: 'rtu',
        serialPort: '/dev/ttyS1',
        baudRate: 19200,
        parity: 'even',
        unitId: 3
      });
      expect(transport._config.serialPort).to.equal('/dev/ttyS1');
      expect(transport._config.baudRate).to.equal(19200);
      expect(transport._config.parity).to.equal('even');
      expect(transport._config.unitId).to.equal(3);
    });
  });

  // ---- Invalid type ----

  describe('create() with invalid type', function () {
    it('should throw for unknown transport type', function () {
      expect(() => TransportFactory.create({ type: 'udp', host: '1.2.3.4', port: 502 }))
        .to.throw("invalid transport type 'udp'");
    });

    it('should throw when type is missing', function () {
      expect(() => TransportFactory.create({ host: '1.2.3.4', port: 502 }))
        .to.throw('invalid transport type');
    });

    it('should throw when type is empty string', function () {
      expect(() => TransportFactory.create({ type: '', host: '1.2.3.4', port: 502 }))
        .to.throw('invalid transport type');
    });
  });

  // ---- Missing config ----

  describe('create() with missing config', function () {
    it('should throw when config is null', function () {
      expect(() => TransportFactory.create(null))
        .to.throw('config object is required');
    });

    it('should throw when config is undefined', function () {
      expect(() => TransportFactory.create(undefined))
        .to.throw('config object is required');
    });

    it('should throw when config is a non-object', function () {
      expect(() => TransportFactory.create('tcp'))
        .to.throw('config object is required');
    });
  });

  // ---- Missing required fields ----

  describe('create() with missing required fields', function () {
    it('should throw when tcp config is missing host', function () {
      expect(() => TransportFactory.create({ type: 'tcp', port: 502 }))
        .to.throw('missing required fields');
    });

    it('should throw when tcp config is missing port', function () {
      expect(() => TransportFactory.create({ type: 'tcp', host: '10.0.0.1' }))
        .to.throw('missing required fields');
    });

    it('should list all missing fields in the error message', function () {
      expect(() => TransportFactory.create({ type: 'tcp' }))
        .to.throw(/host.*port|port.*host/);
    });

    it('should throw when rtu config is missing serialPort', function () {
      expect(() => TransportFactory.create({ type: 'rtu', baudRate: 9600 }))
        .to.throw('missing required fields');
    });

    it('should throw when rtu config is missing baudRate', function () {
      expect(() => TransportFactory.create({ type: 'rtu', serialPort: '/dev/ttyUSB0' }))
        .to.throw('missing required fields');
    });

    it('should treat null values as missing', function () {
      expect(() => TransportFactory.create({ type: 'tcp', host: null, port: null }))
        .to.throw('missing required fields');
    });
  });

  // ---- isRtuAvailable() ----

  describe('isRtuAvailable()', function () {
    it('should return a boolean', function () {
      const result = TransportFactory.isRtuAvailable();
      expect(typeof result).to.equal('boolean');
    });

    it('should delegate to RtuTransport.isSerialPortAvailable', function () {
      const stub = sandbox.stub(RtuTransport, 'isSerialPortAvailable').returns(false);
      expect(TransportFactory.isRtuAvailable()).to.be.false;
      expect(stub.calledOnce).to.be.true;

      stub.returns(true);
      expect(TransportFactory.isRtuAvailable()).to.be.true;
    });
  });
});
