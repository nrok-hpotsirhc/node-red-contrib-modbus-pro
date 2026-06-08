'use strict';

/**
 * LIVE RTU SMOKE TEST - COM11 FC23 device access
 *
 * USAGE (Windows PowerShell):
 *   $env:RTU_LIVE_TESTS="true"
 *   $env:RTU_PORT="\\.\COM11"
 *   $env:RTU_BAUDRATE="19200"
 *   $env:RTU_PARITY="even"
 *   $env:RTU_DATABITS="8"
 *   $env:RTU_STOPBITS="1"
 *   $env:RTU_UNITID="4"
 *   npm run test:rtu-com11
 *
 * Optional write override:
 *   $env:RTU_WRITE_VALUES="1234,5678"
 *
 * If RTU_WRITE_VALUES is not set, the test writes the current values of
 * registers 3 and 4 back to the device. This still performs an FC23 write
 * transaction without changing the process value.
 *
 * LAST UPDATED: 2026-06-08
 */

const { expect } = require('chai');
const RtuTransport = require('../../src/lib/transport/rtu-transport');

const ENABLE_LIVE_TESTS = process.env.RTU_LIVE_TESTS === 'true' &&
  process.env.RTU_SKIP_LIVE !== 'true';

function parseIntegerEnv(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer, got: ${value}`);
  }
  return parsed;
}

function parseWriteValues(defaultValues) {
  const value = process.env.RTU_WRITE_VALUES;
  if (!value) {
    return defaultValues;
  }

  const parsedValues = value.split(',').map((entry) => {
    const parsed = parseInt(entry.trim(), 10);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
      throw new Error(`RTU_WRITE_VALUES must contain 16-bit register values, got: ${value}`);
    }
    return parsed;
  });

  if (parsedValues.length !== 2) {
    throw new Error(`RTU_WRITE_VALUES must contain exactly 2 values, got: ${value}`);
  }

  return parsedValues;
}

describe('RtuTransport - COM11 Slave 4 FC23 Smoke Test', function () {
  this.timeout(30000);

  const config = {
    serialPort: process.env.RTU_PORT || '\\\\.\\COM11',
    baudRate: parseIntegerEnv('RTU_BAUDRATE', 19200),
    dataBits: parseIntegerEnv('RTU_DATABITS', 8),
    stopBits: parseIntegerEnv('RTU_STOPBITS', 1),
    parity: process.env.RTU_PARITY || 'even',
    unitId: parseIntegerEnv('RTU_UNITID', 4),
    timeout: parseIntegerEnv('RTU_TIMEOUT', 5000)
  };

  const readAddress = parseIntegerEnv('RTU_READ_ADDRESS', 1);
  const readQuantity = 2;
  const writeAddress = parseIntegerEnv('RTU_WRITE_ADDRESS', 3);
  const writeQuantity = 2;

  let transport;

  before(function () {
    if (!ENABLE_LIVE_TESTS) {
      this.skip();
    }
    console.log('\n[RTU COM11 Smoke] Config:', config);
  });

  afterEach(async function () {
    if (transport && transport._connected) {
      await transport.disconnect();
    }
  });

  it('writes registers 3-4 and reads registers 1-2 with FC23 on slave 4', async function () {
    expect(RtuTransport.isSerialPortAvailable()).to.equal(true);

    transport = new RtuTransport(config);
    await transport.connect();

    const currentWriteRegisters = await transport.readHoldingRegisters(writeAddress, writeQuantity);
    expect(currentWriteRegisters.data).to.have.length(writeQuantity);

    const writeValues = parseWriteValues(currentWriteRegisters.data);

    const fc23Result = await transport.readWriteRegisters(
      readAddress,
      readQuantity,
      writeAddress,
      writeValues
    );

    expect(fc23Result.data).to.have.length(readQuantity);
    fc23Result.data.forEach((value) => {
      expect(value).to.be.a('number');
      expect(value).to.be.within(0, 65535);
    });

    const verifyResult = await transport.readHoldingRegisters(writeAddress, writeQuantity);
    expect(verifyResult.data).to.deep.equal(writeValues);
    console.log(`[RTU COM11 Smoke] FC23 read registers ${readAddress}-${readAddress + readQuantity - 1}:`, fc23Result.data);
    console.log(`[RTU COM11 Smoke] FC23 wrote registers ${writeAddress}-${writeAddress + writeQuantity - 1}:`, writeValues);
    console.log(`[RTU COM11 Smoke] Verified registers ${writeAddress}-${writeAddress + writeQuantity - 1}:`, verifyResult.data);
  });
});
