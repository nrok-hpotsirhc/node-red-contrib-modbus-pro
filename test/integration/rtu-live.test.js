'use strict';

/**
 * LIVE RTU TESTS - Real Hardware Communication
 * 
 * USAGE (Windows PowerShell):
 *   $env:RTU_LIVE_TESTS = "true"
 *   $env:RTU_PORT = "\\.\COM11"
 *   $env:RTU_BAUDRATE = "9600"
 *   $env:RTU_UNITID = "1"
 *   node .\node_modules\mocha\bin\mocha.js --timeout 30000 --exit "test/integration/rtu-live.test.js"
 * 
 * PREREQUISITES:
 *   - Modbus RTU slave/gateway connected to COM11
 *   - Set RTU_LIVE_TESTS=true to enable these tests
 *   - Set RTU_SKIP_LIVE=true to force-skip these tests in CI/CD
 * 
 * WSL PORT MAPPING, if needed later:
 *   Windows COM1  -> WSL /dev/ttyS0
 *   Windows COM2  -> WSL /dev/ttyS1
 *   Windows COM11 -> WSL /dev/ttyS10
 *   USB adapters  -> WSL /dev/ttyUSB0, /dev/ttyUSB1, ...
 * 
 * LAST UPDATED: 2026-06-08
 */

const { expect } = require('chai');
const RtuTransport = require('../../src/lib/transport/rtu-transport');

// Live hardware tests are opt-in to avoid touching real devices during normal test runs.
const ENABLE_LIVE_TESTS = process.env.RTU_LIVE_TESTS === 'true' &&
  process.env.RTU_SKIP_LIVE !== 'true';

describe('RtuTransport - Live Hardware Tests', function () {
  // Increase timeout for serial communication.
  this.timeout(30000);

  let transport;

  // Read configuration from environment variables.
  const liveConfig = {
    serialPort: process.env.RTU_PORT || 'COM11',
    baudRate: parseInt(process.env.RTU_BAUDRATE || '19200', 10),
    dataBits: parseInt(process.env.RTU_DATABITS || '8', 10),
    stopBits: parseInt(process.env.RTU_STOPBITS || '1', 10),
    parity: process.env.RTU_PARITY || 'even',
    unitId: parseInt(process.env.RTU_UNITID || '1', 10),
    timeout: 5000
  };

  before(function () {
    if (!ENABLE_LIVE_TESTS) {
      this.skip();
    }
    console.log('\n[RTU Live Test] Connecting with config:', liveConfig);
  });

  afterEach(async function () {
    if (transport && transport._connected) {
      try {
        await transport.disconnect();
      } catch (err) {
        console.warn('[RTU Live Test] Disconnect error:', err.message);
      }
    }
  });

  // ============= Connection Tests =============

  describe('Live Connection', function () {
    it('should connect to COM11 and verify serialport is available', async function () {
      expect(RtuTransport.isSerialPortAvailable()).to.be.true;

      transport = new RtuTransport(liveConfig);
      await transport.connect();

      expect(transport._connected).to.be.true;
      console.log('OK Connected to', liveConfig.serialPort);
    });

    it('should retrieve unit ID after connect', async function () {
      transport = new RtuTransport(liveConfig);
      await transport.connect();

      const unitId = transport.getID();
      expect(unitId).to.equal(liveConfig.unitId);
      console.log('OK Unit ID:', unitId);
    });

    it('should disconnect cleanly', async function () {
      transport = new RtuTransport(liveConfig);
      await transport.connect();
      expect(transport._connected).to.be.true;

      await transport.disconnect();
      expect(transport._connected).to.be.false;
      console.log('OK Disconnected cleanly');
    });
  });

  // ============= FC 03 (Read Holding Registers) Tests =============

  describe('FC 03 - Read Holding Registers', function () {
    beforeEach(async function () {
      transport = new RtuTransport(liveConfig);
      await transport.connect();
    });

    it('should read 1 holding register from address 0', async function () {
      const result = await transport.readHoldingRegisters(0, 1);

      expect(result).to.have.property('data');
      expect(Array.isArray(result.data)).to.be.true;
      expect(result.data.length).to.equal(1);
      expect(result.data[0]).to.be.a('number');

      console.log('OK FC 03 Read Address 0: Value =', result.data[0]);
    });

    it('should read multiple holding registers (0-9)', async function () {
      const result = await transport.readHoldingRegisters(0, 10);

      expect(result.data).to.have.length(10);
      result.data.forEach((val, idx) => {
        expect(val).to.be.a('number');
        expect(val).to.be.within(0, 65535);
      });

      console.log('OK FC 03 Read Address 0-9:', result.data);
    });
  });

  // ============= FC 06 (Write Single Register) Tests =============

  describe('FC 06 - Write Single Register', function () {
    beforeEach(async function () {
      transport = new RtuTransport(liveConfig);
      await transport.connect();
    });

    it('should write value 1234 to register 100', async function () {
      const testAddress = 100;
      const testValue = 1234;

      await transport.writeRegister(testAddress, testValue);
      console.log(`OK FC 06 Write Address ${testAddress}: Value ${testValue}`);

      // Verify by reading back
      const readResult = await transport.readHoldingRegisters(testAddress, 1);
      expect(readResult.data[0]).to.equal(testValue);
      console.log('OK Verified: Read back =', readResult.data[0]);
    });
  });

  // ============= FC 16 (Write Multiple Registers) Tests =============

  describe('FC 16 - Write Multiple Registers', function () {
    beforeEach(async function () {
      transport = new RtuTransport(liveConfig);
      await transport.connect();
    });

    it('should write 3 values to registers 200-202', async function () {
      const testAddress = 200;
      const testValues = [5555, 6666, 7777];

      await transport.writeRegisters(testAddress, testValues);
      console.log(`OK FC 16 Write Address ${testAddress}: Values ${testValues}`);

      // Verify by reading back
      const readResult = await transport.readHoldingRegisters(testAddress, 3);
      expect(readResult.data).to.deep.equal(testValues);
      console.log('OK Verified: Read back =', readResult.data);
    });
  });

  // ============= FC 23 (Read/Write Multiple Registers) Tests =============

  describe('FC 23 - Read/Write Multiple Registers (NEW)', function () {
    beforeEach(async function () {
      transport = new RtuTransport(liveConfig);
      await transport.connect();
    });

    it('should write and read in one command (FC 23)', async function () {
      // FC 23 writes to addresses 100-101 and reads from addresses 200-201.
      const writeAddress = 100;
      const writeValues = [9999, 8888];
      const readAddress = 200;
      const readQuantity = 2;

      const result = await transport.readWriteRegisters(
        readAddress,
        readQuantity,
        writeAddress,
        writeValues
      );

      expect(result).to.have.property('data');
      expect(Array.isArray(result.data)).to.be.true;
      expect(result.data).to.have.length(readQuantity);

      console.log(`OK FC 23 Write to ${writeAddress}: ${writeValues}`);
      console.log(`OK FC 23 Read from ${readAddress}: ${result.data}`);
    });

    it('should write single value and read multiple (FC 23)', async function () {
      const result = await transport.readWriteRegisters(
        10,  // Read from address 10
        5,   // Read 5 registers
        50,  // Write to address 50
        [4444]  // Write single value
      );

      expect(result.data).to.have.length(5);
      console.log('OK FC 23 Mixed Read/Write:', result.data);
    });
  });

  // ============= FC 22 (Mask Write Register) Tests =============

  describe('FC 22 - Mask Write Register (NEW)', function () {
    beforeEach(async function () {
      transport = new RtuTransport(liveConfig);
      await transport.connect();
    });

    it('should apply AND/OR mask to register 75', async function () {
      // Read current value first.
      const readBefore = await transport.readHoldingRegisters(75, 1);
      const originalValue = readBefore.data[0];
      console.log('Original value at address 75:', originalValue);

      // FC 22: AND_mask = 0xFFFF, OR_mask = 0x0001 sets bit 0.
      const andMask = 0xFFFF;
      const orMask = 0x0001;

      await transport.maskWriteRegister(75, andMask, orMask);
      console.log(`OK FC 22 Mask Write Address 75: AND=${andMask.toString(16)}, OR=${orMask.toString(16)}`);

      // Verify by reading back
      const readAfter = await transport.readHoldingRegisters(75, 1);
      const newValue = readAfter.data[0];
      expect(newValue).to.not.equal(originalValue);
      console.log('OK Verified: New value =', newValue);
    });
  });

  // ============= FC 01 (Read Coils) Tests =============

  describe('FC 01 - Read Coils', function () {
    beforeEach(async function () {
      transport = new RtuTransport(liveConfig);
      await transport.connect();
    });

    it('should read 8 coils from address 0', async function () {
      const result = await transport.readCoils(0, 8);

      expect(Array.isArray(result.data)).to.be.true;
      expect(result.data.length).to.be.within(1, 8);
      result.data.forEach(coil => {
        expect(typeof coil).to.equal('boolean');
      });

      console.log('OK FC 01 Read Coils 0-7:', result.data);
    });
  });

  // ============= FC 05 (Write Single Coil) Tests =============

  describe('FC 05 - Write Single Coil', function () {
    beforeEach(async function () {
      transport = new RtuTransport(liveConfig);
      await transport.connect();
    });

    it('should write coil ON to address 100', async function () {
      await transport.writeCoil(100, true);
      console.log('OK FC 05 Write Coil 100: ON');
    });

    it('should write coil OFF to address 100', async function () {
      await transport.writeCoil(100, false);
      console.log('OK FC 05 Write Coil 100: OFF');
    });
  });

});
