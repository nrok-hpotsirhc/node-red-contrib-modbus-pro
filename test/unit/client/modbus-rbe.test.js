'use strict';

const helper = require('node-red-node-test-helper');
const { expect } = require('chai');

const modbusRbeNode = require('../../../src/nodes/client/modbus-rbe');

helper.init(require.resolve('node-red'));

describe('modbus-rbe', function () {

  beforeEach(function (done) { helper.startServer(done); });
  afterEach(function (done) {
    helper.unload().then(function () { helper.stopServer(done); });
  });

  function flow(cfg) {
    return [
      Object.assign({ id: 'rbe1', type: 'modbus-rbe', wires: [['out1']] }, cfg),
      { id: 'out1', type: 'helper' }
    ];
  }

  it('should load with default config', function (done) {
    helper.load(modbusRbeNode, flow({}), function () {
      const n = helper.getNode('rbe1');
      expect(n).to.exist;
      expect(n.type).to.equal('modbus-rbe');
      done();
    });
  });

  it('should pass through the first message (initial baseline)', function (done) {
    helper.load(modbusRbeNode, flow({ mode: 'absolute', deadband: 5 }), function () {
      const n = helper.getNode('rbe1');
      const out = helper.getNode('out1');
      out.on('input', function (msg) {
        expect(msg.changed).to.deep.equal([100, 101, 102]);
        expect(msg.rbe.changedCount).to.equal(3);
        done();
      });
      n.receive({ payload: { fc: 3, address: 100, data: [10, 20, 30] } });
    });
  });

  it('should suppress unchanged second message', function (done) {
    helper.load(modbusRbeNode, flow({ mode: 'absolute', deadband: 5 }), function () {
      const n = helper.getNode('rbe1');
      const out = helper.getNode('out1');
      let count = 0;
      out.on('input', function () { count++; });
      n.receive({ payload: { fc: 3, address: 100, data: [10, 20, 30] } });
      n.receive({ payload: { fc: 3, address: 100, data: [10, 20, 30] } });
      n.receive({ payload: { fc: 3, address: 100, data: [12, 21, 31] } });
      setTimeout(function () {
        expect(count).to.equal(1);
        done();
      }, 50);
    });
  });

  it('should report when absolute dead-band is exceeded', function (done) {
    helper.load(modbusRbeNode, flow({ mode: 'absolute', deadband: 2 }), function () {
      const n = helper.getNode('rbe1');
      const out = helper.getNode('out1');
      const reports = [];
      out.on('input', function (msg) { reports.push(msg.changed); });
      n.receive({ payload: { fc: 3, address: 0, data: [100, 200] } });
      n.receive({ payload: { fc: 3, address: 0, data: [101, 200] } });
      n.receive({ payload: { fc: 3, address: 0, data: [104, 200] } });
      setTimeout(function () {
        expect(reports).to.have.lengthOf(2);
        expect(reports[0]).to.deep.equal([0, 1]);
        expect(reports[1]).to.deep.equal([0]);
        done();
      }, 50);
    });
  });

  it('should support percentage dead-band', function (done) {
    helper.load(modbusRbeNode, flow({ mode: 'percentage', deadband: 10 }), function () {
      const n = helper.getNode('rbe1');
      const out = helper.getNode('out1');
      const reports = [];
      out.on('input', function (msg) { reports.push(msg); });
      n.receive({ payload: { fc: 3, address: 0, data: [100] } });
      n.receive({ payload: { fc: 3, address: 0, data: [105] } });
      n.receive({ payload: { fc: 3, address: 0, data: [115] } });
      setTimeout(function () {
        expect(reports).to.have.lengthOf(2);
        expect(reports[1].payload.data).to.deep.equal([115]);
        done();
      }, 50);
    });
  });

  it('should treat coil reads (FC 1) as boolean change detection', function (done) {
    helper.load(modbusRbeNode, flow({ mode: 'absolute', deadband: 0 }), function () {
      const n = helper.getNode('rbe1');
      const out = helper.getNode('out1');
      const reports = [];
      out.on('input', function (msg) { reports.push(msg); });
      n.receive({ payload: { fc: 1, address: 0, data: [false, true] } });
      n.receive({ payload: { fc: 1, address: 0, data: [false, true] } });
      n.receive({ payload: { fc: 1, address: 0, data: [true, true] } });
      setTimeout(function () {
        expect(reports).to.have.lengthOf(2);
        expect(reports[1].changed).to.deep.equal([0]);
        done();
      }, 50);
    });
  });

  it('should respect inhibit time', function (done) {
    helper.load(modbusRbeNode, flow({ mode: 'absolute', deadband: 0, inhibitMs: 10000 }), function () {
      const n = helper.getNode('rbe1');
      const out = helper.getNode('out1');
      const reports = [];
      out.on('input', function () { reports.push(1); });
      n.receive({ payload: { fc: 3, address: 0, data: [100] } });
      n.receive({ payload: { fc: 3, address: 0, data: [200] } });
      setTimeout(function () {
        expect(reports).to.have.lengthOf(1);
        done();
      }, 50);
    });
  });

  it('should reset internal state on msg.reset = true', function (done) {
    helper.load(modbusRbeNode, flow({ mode: 'absolute', deadband: 5 }), function () {
      const n = helper.getNode('rbe1');
      const out = helper.getNode('out1');
      const reports = [];
      out.on('input', function (msg) { reports.push(msg); });

      n.receive({ payload: { fc: 3, address: 0, data: [100] } });
      n.receive({ payload: { fc: 3, address: 0, data: [101] } });
      n.receive({ reset: true });
      n.receive({ payload: { fc: 3, address: 0, data: [101] } });
      setTimeout(function () {
        expect(reports).to.have.lengthOf(2);
        done();
      }, 50);
    });
  });

  it('should pass through messages without payload.data unchanged', function (done) {
    helper.load(modbusRbeNode, flow({}), function () {
      const n = helper.getNode('rbe1');
      const out = helper.getNode('out1');
      out.on('input', function (msg) {
        expect(msg.foo).to.equal('bar');
        expect(msg.changed).to.be.undefined;
        done();
      });
      n.receive({ foo: 'bar' });
    });
  });

  it('should always report transitions away from zero in percentage mode', function (done) {
    helper.load(modbusRbeNode, flow({ mode: 'percentage', deadband: 50 }), function () {
      const n = helper.getNode('rbe1');
      const out = helper.getNode('out1');
      const reports = [];
      out.on('input', function (msg) { reports.push(msg); });
      n.receive({ payload: { fc: 3, address: 0, data: [0] } });
      n.receive({ payload: { fc: 3, address: 0, data: [1] } });
      setTimeout(function () {
        expect(reports).to.have.lengthOf(2);
        done();
      }, 50);
    });
  });
});
