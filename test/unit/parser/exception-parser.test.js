'use strict';

const { expect } = require('chai');
const {
  EXCEPTION_CODES,
  parseException,
  isModbusException,
  extractExceptionCode
} = require('../../../src/lib/parser/exception-parser');

describe('exception-parser', function () {

  describe('EXCEPTION_CODES', function () {
    it('should expose all standard codes', function () {
      // TEST-DATA: per Modbus spec V1.1b3 §7
      const standard = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x0A, 0x0B];
      standard.forEach(function (code) {
        expect(EXCEPTION_CODES).to.have.property(String(code));
      });
    });

    it('should mark 0x05 and 0x06 as retryable', function () {
      expect(EXCEPTION_CODES[0x05].retryable).to.equal(true);
      expect(EXCEPTION_CODES[0x06].retryable).to.equal(true);
    });

    it('should mark 0x0B as retryable (gateway target may recover)', function () {
      expect(EXCEPTION_CODES[0x0B].retryable).to.equal(true);
    });

    it('should mark 0x04 and 0x08 as critical', function () {
      expect(EXCEPTION_CODES[0x04].severity).to.equal('critical');
      expect(EXCEPTION_CODES[0x08].severity).to.equal('critical');
    });

    it('should be frozen', function () {
      expect(Object.isFrozen(EXCEPTION_CODES)).to.be.true;
    });
  });

  describe('extractExceptionCode', function () {
    it('should extract from err.modbusCode', function () {
      expect(extractExceptionCode({ modbusCode: 0x02 })).to.equal(0x02);
    });

    it('should extract from nested err.err.modbusCode', function () {
      expect(extractExceptionCode({ err: { modbusCode: 0x06 } })).to.equal(0x06);
    });

    it('should extract from message text "Modbus exception 3"', function () {
      expect(extractExceptionCode(new Error('Modbus exception 3 (ILLEGAL_DATA_VALUE)'))).to.equal(3);
    });

    it('should extract from hex pattern "0x06"', function () {
      expect(extractExceptionCode(new Error('Server returned error 0x06'))).to.equal(0x06);
    });

    it('should accept a numeric code directly', function () {
      expect(extractExceptionCode(2)).to.equal(2);
    });

    it('should reject 0 and out-of-range numerics', function () {
      expect(extractExceptionCode(0)).to.equal(null);
      expect(extractExceptionCode(0x100)).to.equal(null);
    });

    it('should return null for null/undefined', function () {
      expect(extractExceptionCode(null)).to.equal(null);
      expect(extractExceptionCode(undefined)).to.equal(null);
    });

    it('should return null for plain socket errors', function () {
      expect(extractExceptionCode(new Error('ECONNRESET'))).to.equal(null);
      expect(extractExceptionCode(new Error('Timed out'))).to.equal(null);
    });
  });

  describe('parseException', function () {
    it('should produce a structured object for code 0x02', function () {
      const result = parseException({ modbusCode: 0x02 }, { fc: 3, address: 9999, unitId: 1 });
      expect(result.isException).to.equal(true);
      expect(result.code).to.equal(0x02);
      expect(result.codeHex).to.equal('0x02');
      expect(result.name).to.equal('ILLEGAL_DATA_ADDRESS');
      expect(result.severity).to.equal('error');
      expect(result.retryable).to.equal(false);
      expect(result.fc).to.equal(3);
      expect(result.address).to.equal(9999);
      expect(result.unitId).to.equal(1);
    });

    it('should produce isException=false for non-Modbus errors', function () {
      const result = parseException(new Error('Connection timed out'));
      expect(result.isException).to.equal(false);
      expect(result.code).to.equal(null);
      expect(result.name).to.equal('NOT_AN_EXCEPTION');
      expect(result.message).to.match(/timed out/i);
    });

    it('should still produce hex for unknown codes', function () {
      const result = parseException({ modbusCode: 0xFE });
      expect(result.isException).to.equal(true);
      expect(result.code).to.equal(0xFE);
      expect(result.codeHex).to.equal('0xFE');
      expect(result.name).to.equal('UNKNOWN_EXCEPTION');
    });

    it('should pad single-digit hex codes to two digits', function () {
      expect(parseException({ modbusCode: 1 }).codeHex).to.equal('0x01');
    });

    it('should preserve original error message when present', function () {
      const result = parseException(new Error('Modbus exception 6 (Slave Device Busy)'));
      expect(result.code).to.equal(6);
      expect(result.name).to.equal('SERVER_DEVICE_BUSY');
      expect(result.message).to.match(/Slave Device Busy/);
    });

    it('should fall back to a synthesized message when none provided', function () {
      const result = parseException(0x03);
      expect(result.message).to.match(/Modbus exception 3 \(ILLEGAL_DATA_VALUE\)/);
    });

    it('should default context fields to null when not provided', function () {
      const result = parseException({ modbusCode: 0x01 });
      expect(result.fc).to.equal(null);
      expect(result.address).to.equal(null);
      expect(result.unitId).to.equal(null);
    });
  });

  describe('isModbusException', function () {
    it('should return true for objects with modbusCode', function () {
      expect(isModbusException({ modbusCode: 0x02 })).to.be.true;
    });

    it('should return false for plain errors', function () {
      expect(isModbusException(new Error('Boom'))).to.be.false;
    });

    it('should return false for null', function () {
      expect(isModbusException(null)).to.be.false;
    });
  });
});
