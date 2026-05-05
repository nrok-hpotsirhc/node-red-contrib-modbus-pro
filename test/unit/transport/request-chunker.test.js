'use strict';

const { expect } = require('chai');
const {
  FC_MAX,
  chunkReadRequest,
  chunkWriteRequest,
  reassembleReadResults,
  isBroadcast,
  isBroadcastableFC
} = require('../../../src/lib/transport/request-chunker');

describe('request-chunker', function () {

  describe('FC_MAX', function () {
    it('should declare per-FC limits per Modbus spec', function () {
      expect(FC_MAX[1]).to.equal(2000);
      expect(FC_MAX[2]).to.equal(2000);
      expect(FC_MAX[3]).to.equal(125);
      expect(FC_MAX[4]).to.equal(125);
      expect(FC_MAX[15]).to.equal(1968);
      expect(FC_MAX[16]).to.equal(123);
    });
  });

  describe('chunkReadRequest', function () {
    it('should return a single chunk when quantity fits in one PDU', function () {
      const chunks = chunkReadRequest({ fc: 3, address: 100, quantity: 50 });
      expect(chunks).to.have.lengthOf(1);
      expect(chunks[0]).to.deep.equal({ address: 100, length: 50, offset: 0 });
    });

    it('should split 300 holding registers into 3 chunks (125+125+50)', function () {
      const chunks = chunkReadRequest({ fc: 3, address: 100, quantity: 300 });
      expect(chunks).to.have.lengthOf(3);
      expect(chunks[0]).to.deep.equal({ address: 100, length: 125, offset: 0 });
      expect(chunks[1]).to.deep.equal({ address: 225, length: 125, offset: 125 });
      expect(chunks[2]).to.deep.equal({ address: 350, length: 50, offset: 250 });
    });

    it('should split 250 input registers into 2 chunks of exactly 125', function () {
      const chunks = chunkReadRequest({ fc: 4, address: 0, quantity: 250 });
      expect(chunks).to.have.lengthOf(2);
      expect(chunks.reduce((a, c) => a + c.length, 0)).to.equal(250);
    });

    it('should split 5000 coils into 3 chunks (2000+2000+1000)', function () {
      const chunks = chunkReadRequest({ fc: 1, address: 0, quantity: 5000 });
      expect(chunks).to.have.lengthOf(3);
      expect(chunks[0].length).to.equal(2000);
      expect(chunks[1].length).to.equal(2000);
      expect(chunks[2].length).to.equal(1000);
    });

    it('should honour custom maxPerRequest override', function () {
      const chunks = chunkReadRequest({ fc: 3, address: 0, quantity: 30, maxPerRequest: 10 });
      expect(chunks).to.have.lengthOf(3);
      chunks.forEach((c) => expect(c.length).to.be.at.most(10));
    });

    it('should reject invalid FC', function () {
      expect(() => chunkReadRequest({ fc: 99, address: 0, quantity: 1 }))
        .to.throw(RangeError, /unsupported read FC/);
    });

    it('should reject negative quantity', function () {
      expect(() => chunkReadRequest({ fc: 3, address: 0, quantity: 0 }))
        .to.throw(RangeError);
    });

    it('should reject address > 65535', function () {
      expect(() => chunkReadRequest({ fc: 3, address: 65536, quantity: 1 }))
        .to.throw(RangeError);
    });

    it('should reject ranges that overflow the 16-bit address space', function () {
      expect(() => chunkReadRequest({ fc: 3, address: 65500, quantity: 200 }))
        .to.throw(RangeError, /exceeds Modbus 16-bit address space/);
    });

    it('should require an options object', function () {
      expect(() => chunkReadRequest(null)).to.throw(TypeError);
    });
  });

  describe('chunkWriteRequest', function () {
    it('should keep small writes as a single chunk (FC 16)', function () {
      const values = [1, 2, 3, 4, 5];
      const chunks = chunkWriteRequest({ fc: 16, address: 100, values });
      expect(chunks).to.have.lengthOf(1);
      expect(chunks[0].values).to.deep.equal(values);
      expect(chunks[0].address).to.equal(100);
    });

    it('should split 300 register values into chunks of <=123 (FC 16)', function () {
      const values = new Array(300).fill(0).map((_, i) => i & 0xFFFF);
      const chunks = chunkWriteRequest({ fc: 16, address: 0, values });
      expect(chunks).to.have.lengthOf(3);
      expect(chunks[0].values.length).to.equal(123);
      expect(chunks[1].values.length).to.equal(123);
      expect(chunks[2].values.length).to.equal(54);
      expect(chunks[2].address).to.equal(246);
      // Concatenation must reproduce input
      const merged = chunks.reduce((a, c) => a.concat(c.values), []);
      expect(merged).to.deep.equal(values);
    });

    it('should split 4000 coils into chunks of <=1968 (FC 15)', function () {
      const values = new Array(4000).fill(true);
      const chunks = chunkWriteRequest({ fc: 15, address: 0, values });
      expect(chunks).to.have.lengthOf(3);
      expect(chunks[0].values.length).to.equal(1968);
      expect(chunks[1].values.length).to.equal(1968);
      expect(chunks[2].values.length).to.equal(64);
    });

    it('should reject FCs other than 15 / 16', function () {
      expect(() => chunkWriteRequest({ fc: 6, address: 0, values: [1] }))
        .to.throw(RangeError);
    });

    it('should reject empty values', function () {
      expect(() => chunkWriteRequest({ fc: 16, address: 0, values: [] }))
        .to.throw(RangeError);
    });
  });

  describe('reassembleReadResults', function () {
    it('should concatenate data arrays in order', function () {
      const merged = reassembleReadResults([
        { data: [1, 2, 3], buffer: Buffer.from([0, 1, 0, 2, 0, 3]) },
        { data: [4, 5], buffer: Buffer.from([0, 4, 0, 5]) }
      ]);
      expect(merged.data).to.deep.equal([1, 2, 3, 4, 5]);
      expect(merged.buffer.length).to.equal(10);
    });

    it('should tolerate missing buffers (booleans for coils)', function () {
      const merged = reassembleReadResults([
        { data: [true, false] },
        { data: [true] }
      ]);
      expect(merged.data).to.deep.equal([true, false, true]);
      expect(merged.buffer.length).to.equal(0);
    });

    it('should reject empty input', function () {
      expect(() => reassembleReadResults([])).to.throw(TypeError);
    });

    it('should reject results with no data array', function () {
      expect(() => reassembleReadResults([{ buffer: Buffer.alloc(0) }]))
        .to.throw(/missing data array/);
    });
  });

  describe('isBroadcast', function () {
    it('should return true for Unit ID 0', function () {
      expect(isBroadcast(0)).to.be.true;
    });
    it('should return false for any other unit ID', function () {
      [1, 2, 247, 255].forEach((id) => expect(isBroadcast(id)).to.be.false);
    });
  });

  describe('isBroadcastableFC', function () {
    it('should accept 5, 6, 15, 16', function () {
      [5, 6, 15, 16].forEach((fc) => expect(isBroadcastableFC(fc)).to.be.true);
    });
    it('should reject read FCs', function () {
      [1, 2, 3, 4].forEach((fc) => expect(isBroadcastableFC(fc)).to.be.false);
    });
  });
});
