'use strict';

const { expect } = require('chai');
const helper = require('node-red-node-test-helper');
const ModbusRTU = require('modbus-serial');

const modbusServerConfig = require('../../../src/nodes/config/modbus-server-config');
const modbusInNode = require('../../../src/nodes/server/modbus-in');

helper.init(require.resolve('node-red'));

describe('modbus-server-config (unit)', function () {

  afterEach(function (done) {
    helper.unload().then(function () {
      helper.stopServer(done);
    });
  });

  beforeEach(function (done) {
    helper.startServer(done);
  });

  function createServerFlow(overrides) {
    return [
      {
        id: 'server1',
        type: 'modbus-server-config',
        name: overrides.name || 'Test Server',
        host: overrides.host || '127.0.0.1',
        port: overrides.port || 9502,
        unitId: overrides.unitId !== undefined ? overrides.unitId : 255,
        responseTimeout: overrides.responseTimeout || 2000
      }
    ];
  }

  // ---- Node Loading ----

  it('should load the modbus-server-config node', function (done) {
    const flow = createServerFlow({ port: 9601 });
    helper.load([modbusServerConfig], flow, function () {
      const serverNode = helper.getNode('server1');
      expect(serverNode).to.exist;
      expect(serverNode.type).to.equal('modbus-server-config');
      expect(serverNode.name).to.equal('Test Server');
      done();
    });
  });

  it('should store configuration properties', function (done) {
    const flow = createServerFlow({
      host: '127.0.0.1',
      port: 9602,
      unitId: 10,
      responseTimeout: 3000
    });
    helper.load([modbusServerConfig], flow, function () {
      const serverNode = helper.getNode('server1');
      expect(serverNode.host).to.equal('127.0.0.1');
      expect(serverNode.port).to.equal(9602);
      expect(serverNode.unitId).to.equal(10);
      expect(serverNode.responseTimeout).to.equal(3000);
      done();
    });
  });

  it('should use default values for missing config', function (done) {
    const flow = [{
      id: 'server1',
      type: 'modbus-server-config',
      name: ''
    }];
    helper.load([modbusServerConfig], flow, function () {
      const serverNode = helper.getNode('server1');
      expect(serverNode.host).to.equal('0.0.0.0');
      expect(serverNode.port).to.equal(8502);
      expect(serverNode.unitId).to.equal(255);
      expect(serverNode.responseTimeout).to.equal(5000);
      done();
    });
  });

  // ---- Request Emitter ----

  it('should have a request emitter', function (done) {
    const flow = createServerFlow({ port: 9603 });
    helper.load([modbusServerConfig], flow, function () {
      const serverNode = helper.getNode('server1');
      expect(serverNode._requestEmitter).to.exist;
      expect(typeof serverNode._requestEmitter.on).to.equal('function');
      expect(typeof serverNode._requestEmitter.emit).to.equal('function');
      done();
    });
  });

  // ---- Resolve/Reject ----

  it('should resolve a pending request', function (done) {
    const flow = createServerFlow({ port: 9604 });
    helper.load([modbusServerConfig], flow, function () {
      const serverNode = helper.getNode('server1');

      // Simulate a pending request
      const requestId = 'test-request-123';
      const timer = setTimeout(function () {}, 10000);
      serverNode._pendingRequests.set(requestId, {
        resolve: function (data) {
          expect(data).to.deep.equal([100, 200]);
          done();
        },
        reject: function () {
          done(new Error('Should not reject'));
        },
        timer: timer
      });

      const result = serverNode.resolveRequest(requestId, [100, 200]);
      expect(result).to.equal(true);
      expect(serverNode._pendingRequests.has(requestId)).to.be.false;
    });
  });

  it('should return false when resolving non-existent request', function (done) {
    const flow = createServerFlow({ port: 9605 });
    helper.load([modbusServerConfig], flow, function () {
      const serverNode = helper.getNode('server1');
      const result = serverNode.resolveRequest('non-existent', [1, 2, 3]);
      expect(result).to.equal(false);
      done();
    });
  });

  it('should reject a pending request', function (done) {
    const flow = createServerFlow({ port: 9606 });
    helper.load([modbusServerConfig], flow, function () {
      const serverNode = helper.getNode('server1');

      const requestId = 'test-reject-456';
      const timer = setTimeout(function () {}, 10000);
      serverNode._pendingRequests.set(requestId, {
        resolve: function () {
          done(new Error('Should not resolve'));
        },
        reject: function (err) {
          expect(err).to.be.instanceOf(Error);
          expect(err.modbusErrorCode).to.equal(0x02);
          done();
        },
        timer: timer
      });

      const err = new Error('Address not found');
      err.modbusErrorCode = 0x02;
      const result = serverNode.rejectRequest(requestId, err);
      expect(result).to.equal(true);
    });
  });

  it('should reject with plain object error', function (done) {
    const flow = createServerFlow({ port: 9607 });
    helper.load([modbusServerConfig], flow, function () {
      const serverNode = helper.getNode('server1');

      const requestId = 'test-reject-obj';
      const timer = setTimeout(function () {}, 10000);
      serverNode._pendingRequests.set(requestId, {
        resolve: function () {
          done(new Error('Should not resolve'));
        },
        reject: function (err) {
          expect(err).to.be.instanceOf(Error);
          expect(err.message).to.equal('Data not available');
          expect(err.modbusErrorCode).to.equal(0x03);
          done();
        },
        timer: timer
      });

      serverNode.rejectRequest(requestId, {
        message: 'Data not available',
        modbusErrorCode: 0x03
      });
    });
  });

  it('should return false when rejecting non-existent request', function (done) {
    const flow = createServerFlow({ port: 9608 });
    helper.load([modbusServerConfig], flow, function () {
      const serverNode = helper.getNode('server1');
      const result = serverNode.rejectRequest('non-existent', new Error('test'));
      expect(result).to.equal(false);
      done();
    });
  });

  // ---- Server Lifecycle ----

  it('should start server and emit initialized', function (done) {
    const flow = createServerFlow({ port: 9609 });
    // Add an in-node so the server auto-starts
    flow.push({
      id: 'in1',
      type: 'modbus-in',
      name: 'Test In',
      server: 'server1',
      filterFc: 'all',
      filterUnitId: 'all',
      wires: [[]]
    });

    helper.load([modbusServerConfig, modbusInNode], flow, function () {
      const serverNode = helper.getNode('server1');

      // Give the server time to start
      setTimeout(function () {
        expect(serverNode._started).to.be.true;
        done();
      }, 500);
    });
  });

  it('should clean up pending requests on close', function (done) {
    const flow = createServerFlow({ port: 9610 });
    helper.load([modbusServerConfig], flow, function () {
      const serverNode = helper.getNode('server1');

      // Add some fake pending requests
      const timer1 = setTimeout(function () {}, 10000);
      const timer2 = setTimeout(function () {}, 10000);
      serverNode._pendingRequests.set('req1', {
        resolve: function () {},
        reject: function () {},
        timer: timer1
      });
      serverNode._pendingRequests.set('req2', {
        resolve: function () {},
        reject: function () {},
        timer: timer2
      });

      expect(serverNode._pendingRequests.size).to.equal(2);

      // Trigger close
      serverNode.stopServer().then(function () {
        expect(serverNode._pendingRequests.size).to.equal(0);
        done();
      });
    });
  });

  // ---- TCP Integration ----

  it('should accept TCP connections and emit requests', function (done) {
    this.timeout(8000);
    const port = 9611; // TEST-DATA: test port
    const flow = [
      {
        id: 'server1',
        type: 'modbus-server-config',
        name: 'Test Server',
        host: '127.0.0.1',
        port: port,
        unitId: 255,
        responseTimeout: 3000
      },
      {
        id: 'in1',
        type: 'modbus-in',
        name: 'Test In',
        server: 'server1',
        filterFc: 'all',
        filterUnitId: 'all',
        wires: [['helper1']]
      },
      {
        id: 'helper1',
        type: 'helper'
      }
    ];

    helper.load([modbusServerConfig, modbusInNode], flow, function () {
      const serverNode = helper.getNode('server1');
      const helperNode = helper.getNode('helper1');

      // Wait for server to start
      setTimeout(function () {
        if (!serverNode._started) {
          done(new Error('Server did not start'));
          return;
        }

        // Use a Modbus client to send a request
        const client = new ModbusRTU();
        client.connectTCP('127.0.0.1', { port: port }).then(function () {
          client.setID(1);

          helperNode.on('input', function (msg) {
            expect(msg.payload).to.exist;
            expect(msg.payload.fc).to.equal(3);
            expect(msg.payload.address).to.equal(100);
            expect(msg.payload.quantity).to.equal(2);
            expect(msg.payload.unitId).to.equal(1);
            expect(msg.payload.requestId).to.be.a('string');

            // Resolve the request to avoid timeout errors
            serverNode.resolveRequest(msg.payload.requestId, [1234, 5678]); // TEST-DATA: register values

            client.close(function () {});
            done();
          });

          // Read 2 holding registers starting at address 100
          client.readHoldingRegisters(100, 2).catch(function () {
            // May throw if response arrives after close, that's OK
          });
        }).catch(function (err) {
          done(err);
        });
      }, 500);
    });
  });

  it('should handle full proxy round-trip (request → flow → response)', function (done) {
    this.timeout(8000);
    const port = 9612; // TEST-DATA: test port
    const flow = [
      {
        id: 'server1',
        type: 'modbus-server-config',
        name: 'Test Server',
        host: '127.0.0.1',
        port: port,
        unitId: 255,
        responseTimeout: 3000
      },
      {
        id: 'in1',
        type: 'modbus-in',
        name: 'Test In',
        server: 'server1',
        filterFc: 'all',
        filterUnitId: 'all',
        wires: [['helper1']]
      },
      {
        id: 'helper1',
        type: 'helper'
      }
    ];

    helper.load([modbusServerConfig, modbusInNode], flow, function () {
      const serverNode = helper.getNode('server1');
      const helperNode = helper.getNode('helper1');

      setTimeout(function () {
        if (!serverNode._started) {
          done(new Error('Server did not start'));
          return;
        }

        const client = new ModbusRTU();
        client.connectTCP('127.0.0.1', { port: port }).then(function () {
          client.setID(1);
          client.setTimeout(3000);

          // When a request arrives, resolve it with test data
          helperNode.on('input', function (msg) {
            serverNode.resolveRequest(msg.payload.requestId, [42, 99]); // TEST-DATA: response values
          });

          // Read 2 holding registers – should get our response
          client.readHoldingRegisters(0, 2).then(function (result) {
            expect(result.data).to.deep.equal([42, 99]);
            client.close(function () {});
            done();
          }).catch(function (err) {
            client.close(function () {});
            done(err);
          });
        }).catch(function (err) {
          done(err);
        });
      }, 500);
    });
  });

  it('should handle coil read round-trip', function (done) {
    this.timeout(8000);
    const port = 9613; // TEST-DATA: test port
    const flow = [
      {
        id: 'server1',
        type: 'modbus-server-config',
        name: 'Test Server',
        host: '127.0.0.1',
        port: port,
        unitId: 255,
        responseTimeout: 3000
      },
      {
        id: 'in1',
        type: 'modbus-in',
        server: 'server1',
        filterFc: 'all',
        filterUnitId: 'all',
        wires: [['helper1']]
      },
      {
        id: 'helper1',
        type: 'helper'
      }
    ];

    helper.load([modbusServerConfig, modbusInNode], flow, function () {
      const serverNode = helper.getNode('server1');
      const helperNode = helper.getNode('helper1');

      setTimeout(function () {
        if (!serverNode._started) {
          done(new Error('Server did not start'));
          return;
        }

        const client = new ModbusRTU();
        client.connectTCP('127.0.0.1', { port: port }).then(function () {
          client.setID(1);
          client.setTimeout(3000);

          helperNode.on('input', function (msg) {
            expect(msg.payload.fc).to.equal(1);
            // For coils, the vector calls getCoil per address
            // Resolve with a boolean value
            serverNode.resolveRequest(msg.payload.requestId, true); // TEST-DATA: coil value
          });

          client.readCoils(0, 1).then(function (result) {
            expect(result.data[0]).to.equal(true);
            client.close(function () {});
            done();
          }).catch(function (err) {
            client.close(function () {});
            done(err);
          });
        }).catch(function (err) {
          done(err);
        });
      }, 500);
    });
  });
});
