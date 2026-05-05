'use strict';

const { expect } = require('chai');
const {
  BYTE_ORDER,
  parseFloat64,
  parseInt64,
  parseUInt64,
  parseString,
  parseBCD16,
  parseBCD32,
  parseUnixTimestamp
} = require('../../../src/lib/parser/buffer-parser');

describe('buffer-parser – extended data types (WP 7.2)', function () {

  // ---------------------------------------------------------------
  // Float64
  // ---------------------------------------------------------------
  describe('parseFloat64', function () {
    // TEST-DATA: pi as IEEE 754 double = 0x400921FB54442D18
    const PI_REGISTERS_BE = [0x4009, 0x21FB, 0x5444, 0x2D18];

    it('should reconstruct pi from 4 registers in BE order', function () {
      const v = parseFloat64(PI_REGISTERS_BE, BYTE_ORDER.BE);
      expect(v).to.be.closeTo(Math.PI, 1e-15);
    });

    it('should reconstruct pi when registers are word-reversed (LE order)', function () {
      const reversed = [...PI_REGISTERS_BE].reverse();
      expect(parseFloat64(reversed, BYTE_ORDER.LE)).to.be.closeTo(Math.PI, 1e-15);
    });

    it('should handle byte-swap inside each register (BE_BS)', function () {
      // Each register has its bytes swapped; word order preserved
      const swapped = PI_REGISTERS_BE.map(function (r) {
        return ((r & 0xFF) << 8) | ((r >> 8) & 0xFF);
      });
      expect(parseFloat64(swapped, BYTE_ORDER.BE_BS)).to.be.closeTo(Math.PI, 1e-15);
    });

    it('should round-trip 1.0', function () {
      // 1.0 = 0x3FF0000000000000
      expect(parseFloat64([0x3FF0, 0x0000, 0x0000, 0x0000])).to.equal(1.0);
    });

    it('should reject arrays of wrong length', function () {
      expect(() => parseFloat64([0, 0])).to.throw(RangeError);
      expect(() => parseFloat64([0, 0, 0, 0, 0])).to.throw(RangeError);
    });

    it('should reject out-of-range register values', function () {
      expect(() => parseFloat64([0x10000, 0, 0, 0])).to.throw(RangeError);
      expect(() => parseFloat64([-1, 0, 0, 0])).to.throw(RangeError);
    });
  });

  // ---------------------------------------------------------------
  // Int64 / UInt64
  // ---------------------------------------------------------------
  describe('parseInt64 / parseUInt64', function () {
    it('should return a BigInt', function () {
      expect(typeof parseInt64([0, 0, 0, 0])).to.equal('bigint');
      expect(typeof parseUInt64([0, 0, 0, 0])).to.equal('bigint');
    });

    it('should parse zero', function () {
      expect(parseInt64([0, 0, 0, 0])).to.equal(0n);
      expect(parseUInt64([0, 0, 0, 0])).to.equal(0n);
    });

    it('should parse small positive values', function () {
      // 1 = 0x0000000000000001
      expect(parseInt64([0, 0, 0, 1])).to.equal(1n);
      expect(parseUInt64([0, 0, 0, 1])).to.equal(1n);
    });

    it('should parse Number.MAX_SAFE_INTEGER + 1 exactly (BigInt territory)', function () {
      // 2^53 = 0x0020 0000 0000 0000
      const result = parseUInt64([0x0020, 0x0000, 0x0000, 0x0000]);
      expect(result).to.equal(9007199254740992n);
    });

    it('should parse max UInt64 (0xFFFFFFFFFFFFFFFF)', function () {
      expect(parseUInt64([0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF]))
        .to.equal(18446744073709551615n);
    });

    it('should parse negative Int64 values via two-complement representation', function () {
      // -1 in 64-bit two's complement = 0xFFFFFFFFFFFFFFFF
      expect(parseInt64([0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF])).to.equal(-1n);
    });

    it('should respect LE byte order', function () {
      // Big-endian 1n = [0,0,0,1]; reversed registers under LE should also yield 1n
      expect(parseInt64([1, 0, 0, 0], BYTE_ORDER.LE)).to.equal(1n);
    });
  });

  // ---------------------------------------------------------------
  // String
  // ---------------------------------------------------------------
  describe('parseString', function () {
    it('should decode "Hello" from 3 registers', function () {
      // TEST-DATA: 'H'=0x48 'e'=0x65 'l'=0x6C 'l'=0x6C 'o'=0x6F NUL=0x00
      const regs = [0x4865, 0x6C6C, 0x6F00];
      expect(parseString(regs)).to.equal('Hello');
    });

    it('should trim trailing NULs', function () {
      const regs = [0x4142, 0x4300, 0x0000]; // 'A','B','C',NUL,...
      expect(parseString(regs)).to.equal('ABC');
    });

    it('should support byte-swapped strings', function () {
      // Each pair stored low-byte-first
      const regs = [0x6548, 0x6C6C, 0x006F]; // 'eH','ll','\0o'
      expect(parseString(regs, { byteSwap: true })).to.equal('Hello');
    });

    it('should reject empty register arrays', function () {
      expect(() => parseString([])).to.throw(RangeError);
    });

    it('should reject out-of-range registers', function () {
      expect(() => parseString([0x10000])).to.throw(RangeError);
    });

    it('should default to ascii encoding but accept other encodings', function () {
      const regs = [0x4865, 0x6C6C, 0x6F00];
      expect(parseString(regs, { encoding: 'utf8' })).to.equal('Hello');
    });
  });

  // ---------------------------------------------------------------
  // BCD
  // ---------------------------------------------------------------
  describe('parseBCD16', function () {
    it('should decode 0x1234 as 1234', function () {
      expect(parseBCD16(0x1234)).to.equal(1234);
    });

    it('should decode 0x0000 as 0', function () {
      expect(parseBCD16(0x0000)).to.equal(0);
    });

    it('should decode 0x9999 as 9999', function () {
      expect(parseBCD16(0x9999)).to.equal(9999);
    });

    it('should reject invalid BCD nibbles', function () {
      expect(() => parseBCD16(0x12A3)).to.throw(RangeError);
      expect(() => parseBCD16(0xFFFF)).to.throw(RangeError);
    });

    it('should reject out-of-range register values', function () {
      expect(() => parseBCD16(0x10000)).to.throw(RangeError);
      expect(() => parseBCD16(-1)).to.throw(RangeError);
    });
  });

  describe('parseBCD32', function () {
    it('should decode [0x1234, 0x5678] as 12345678 (BE)', function () {
      expect(parseBCD32([0x1234, 0x5678])).to.equal(12345678);
    });

    it('should decode in LE word order', function () {
      expect(parseBCD32([0x5678, 0x1234], BYTE_ORDER.LE)).to.equal(12345678);
    });

    it('should reject invalid BCD digit in either register', function () {
      expect(() => parseBCD32([0x1234, 0xABCD])).to.throw(RangeError);
    });
  });

  // ---------------------------------------------------------------
  // Unix timestamp
  // ---------------------------------------------------------------
  describe('parseUnixTimestamp', function () {
    it('should reconstruct epoch start from [0, 0]', function () {
      const d = parseUnixTimestamp([0, 0]);
      expect(d.toISOString()).to.equal('1970-01-01T00:00:00.000Z');
    });

    it('should reconstruct 2026-01-01T00:00:00Z from registers', function () {
      // 2026-01-01T00:00:00Z = 1767225600 = 0x6955B900
      expect(parseUnixTimestamp([0x6955, 0xB900]).toISOString())
        .to.equal('2026-01-01T00:00:00.000Z');
    });

    it('should respect LE word order', function () {
      // Same timestamp, registers reversed
      expect(parseUnixTimestamp([0xB900, 0x6955], BYTE_ORDER.LE).toISOString())
        .to.equal('2026-01-01T00:00:00.000Z');
    });
  });
});
