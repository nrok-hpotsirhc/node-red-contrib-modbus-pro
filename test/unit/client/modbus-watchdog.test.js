'use strict';

const helper = require('node-red-node-test-helper');
const { expect } = require('chai');
const sinon = require('sinon');
const ModbusRTU = require('modbus-serial');

const modbusWatchdogNode = require('../../../src/nodes/client/modbus-watchdog');
const modbusClientConfig = require('../../../src/nodes/config/modbus-client-config');

helper.init(require.resolve('node-red'));

describe('modbus-watchdog', function () {
  let sandbox;
  let writeRegisterStub;
  let writeCoilStub;

  beforeEach(function (done) {
    sandbox = sinon.createSandbox();
    sandbox.stub(ModbusRTU.prototype, 'connectTCP').resolves();
    sandbox.stub(ModbusRTU.prototype, 'setID');
    sandbox.stub(ModbusRTU.prototype, 'getID').returns(1);
    sandbox.stub(ModbusRTU.prototype, 'setTimeout');
    sandbox.stub(ModbusRTU.prototype, 'close').callsFake(function (cb) { if (cb) cb(); });
    sandbox.stub(ModbusRTU.prototype, 'removeAllListeners');
    writeRegisterStub = sandbox.stub(ModbusRTU.prototype, 'writeRegister').resolves({});
    writeCoilStub = sandbox.stub(ModbusRTU.prototype, 'writeCoil').resolves({});
    helper.startServer(done);
  });

  afterEach(function (done) {
    sandbox.restore();
    helper.unload().then(function () { helper.stopServer(done); });
  });

  function flow(cfg) {
    return [
      { id: 'config1', type: 'modbus-client-config', name: 'Test', connectionType: 'tcp',
        host: '127.0.0.1', port: 502, unitId: 1, timeout: 1000 },
      Object.assign({ id: 'wd1', type: 'modbus-watchdog', server: 'config1',
        wires: [['out1']] }, cfg),
      { id: 'out1', type: 'helper' }
    ];
  }

  function simulateConnectedTransport(configNode) {
    const transport = configNode.createTransport();
    transport._connected = true;
    Object.defineProperty(transport._client, 'isOpen', { get: () => true });
    configNode._transport = transport;
    return transport;
  }

  it('should load with default config', function (done) {
    helper.load([modbusClientConfig, modbusWatchdogNode],
      flow({ heartbeatInterval: 1000, heartbeatFc: 6, heartbeatAddress: 0, heartbeatValue: 1 }),
      function () {
        const n = helper.getNode('wd1');
        expect(n).to.exist;
        expect(n.type).to.equal('modbus-watchdog');
        done();
      });
  });

  it('should write heartbeat on start', function (done) {
    helper.load([modbusClientConfig, modbusWatchdogNode],
      flow({ heartbeatInterval: 5000, heartbeatFc: 6, heartbeatAddress: 100, heartbeatValue: 42 }),
      function () {
        const cfg = helper.getNode('config1');
        const wd = helper.getNode('wd1');
        simulateConnectedTransport(cfg);
        wd.start();
        setTimeout(function () {
          expect(writeRegisterStub.called).to.be.true;
          const args = writeRegisterStub.firstCall.args;
          expect(args[0]).to.equal(100);
          expect(args[1]).to.equal(42);
          wd.stop();
          done();
        }, 50);
      });
  });

  it('should trigger safe-state on transport disconnect', function (done) {
    writeRegisterStub.onCall(0).resolves({});
    writeRegisterStub.onCall(1).rejects(new Error('ECONNRESET')); // heartbeat fails
    writeRegisterStub.onCall(2).resolves({}); // safe-state write
    helper.load([modbusClientConfig, modbusWatchdogNode],
      flow({ heartbeatInterval: 100, heartbeatFc: 6, heartbeatAddress: 0, heartbeatValue: 1,
        safeStateFc: 6, safeStateAddress: 0, safeStateValue: 0 }),
      function () {
        const cfg = helper.getNode('config1');
        const wd = helper.getNode('wd1');
        simulateConnectedTransport(cfg);
        wd.on('safeState', function (info) {
          expect(info.reason).to.match(/heartbeat failed/);
          expect(wd._safeStateLatched).to.be.true;
          wd.stop();
          done();
        });
        wd.start();
      });
  }).timeout(2000);

  it('should expose status on "status" command', function (done) {
    helper.load([modbusClientConfig, modbusWatchdogNode],
      flow({ heartbeatInterval: 5000 }),
      function () {
        const wd = helper.getNode('wd1');
        const out = helper.getNode('out1');
        out.on('input', function (msg) {
          expect(msg.payload).to.have.property('state');
          expect(msg.payload).to.have.property('safeStateLatched');
          done();
        });
        wd.receive({ payload: 'status' });
      });
  });

  it('should manually trigger safe-state via command', function (done) {
    helper.load([modbusClientConfig, modbusWatchdogNode],
      flow({ heartbeatInterval: 5000, safeStateFc: 6, safeStateAddress: 0, safeStateValue: 0 }),
      function () {
        const cfg = helper.getNode('config1');
        const wd = helper.getNode('wd1');
        simulateConnectedTransport(cfg);
        wd.on('safeState', function (info) {
          expect(info.reason).to.match(/manual/);
          done();
        });
        wd.receive({ payload: 'safeState' });
      });
  });

  it('should support FC 5 heartbeat (boolean coil)', function (done) {
    helper.load([modbusClientConfig, modbusWatchdogNode],
      flow({ heartbeatInterval: 5000, heartbeatFc: 5, heartbeatAddress: 10, heartbeatValue: 1 }),
      function () {
        const cfg = helper.getNode('config1');
        const wd = helper.getNode('wd1');
        simulateConnectedTransport(cfg);
        wd.start();
        setTimeout(function () {
          expect(writeCoilStub.called).to.be.true;
          const args = writeCoilStub.firstCall.args;
          expect(args[0]).to.equal(10);
          expect(args[1]).to.equal(true);
          wd.stop();
          done();
        }, 50);
      });
  });

  it('should stop the heartbeat loop on "stop" command', function (done) {
    helper.load([modbusClientConfig, modbusWatchdogNode],
      flow({ heartbeatInterval: 5000 }),
      function () {
        const cfg = helper.getNode('config1');
        const wd = helper.getNode('wd1');
        simulateConnectedTransport(cfg);
        wd.start();
        expect(wd._heartbeatTimer).to.exist;
        wd.receive({ payload: 'stop' });
        setTimeout(function () {
          expect(wd._heartbeatTimer).to.equal(null);
          done();
        }, 30);
      });
  });

  it('should perform restore write on reconnect when enabled', function (done) {
    helper.load([modbusClientConfig, modbusWatchdogNode],
      flow({ heartbeatInterval: 100, heartbeatFc: 6, heartbeatAddress: 0, heartbeatValue: 1,
        safeStateFc: 6, safeStateAddress: 0, safeStateValue: 0,
        restoreEnabled: true, restoreFc: 6, restoreAddress: 50, restoreValue: 99 }),
      function () {
        const cfg = helper.getNode('config1');
        const wd = helper.getNode('wd1');
        simulateConnectedTransport(cfg);
        // Force a fail-then-succeed sequence
        let calls = 0;
        writeRegisterStub.callsFake(function (addr, val) {
          calls++;
          if (calls === 1) return Promise.reject(new Error('disconnect')); // first heartbeat fails
          if (calls === 2) {
            // Safe-state write itself
            expect(addr).to.equal(0);
            expect(val).to.equal(0);
            return Promise.resolve({});
          }
          // Subsequent heartbeats succeed
          return Promise.resolve({});
        });
        wd.on('reconnect', function () {
          // Allow the async restore write to fire
          setTimeout(function () {
            const restoreCall = writeRegisterStub.getCalls().find(function (c) {
              return c.args[0] === 50 && c.args[1] === 99;
            });
            expect(restoreCall, 'restore write should have been issued').to.exist;
            wd.stop();
            done();
          }, 30);
        });
        wd.start();
      });
  }).timeout(3000);
});
