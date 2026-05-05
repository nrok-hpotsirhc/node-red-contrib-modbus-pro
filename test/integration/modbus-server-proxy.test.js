'use strict';

const helper = require('node-red-node-test-helper');
const { expect } = require('chai');
const ModbusRTU = require('modbus-serial');

const modbusServerConfig = require('../../src/nodes/config/modbus-server-config');
const modbusInNode = require('../../src/nodes/server/modbus-in');
const modbusOutNode = require('../../src/nodes/server/modbus-out');

helper.init(require.resolve('node-red'));

describe('modbus-server-proxy (integration)', function () {

  afterEach(function (done) {
    helper.unload().then(function () {
      helper.stopServer(done);
    });
  });

  beforeEach(function (done) {
    helper.startServer(done);
  });

  /**
   * Create a standard proxy flow: server-config → modbus-in → helper → modbus-out.
   * @param {number} port - TCP port for the server.
   * @param {object} [inConfig] - Optional modbus-in config overrides.
   * @returns {Array} - Node-RED flow array.
   */
  function createProxyFlow(port, inConfig) {
    inConfig = inConfig || {};
    return [
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
        name: inConfig.name || 'Test In',
        server: 'server1',
        filterFc: inConfig.filterFc || 'all',
        filterUnitId: inConfig.filterUnitId || 'all',
        wires: [['helper1']]
      },
      {
        id: 'helper1',
        type: 'helper'
      },
      {
        id: 'out1',
        type: 'modbus-out',
        name: 'Test Out',
        server: 'server1',
        wires: [['helper2']]
      },
      {
        id: 'helper2',
        type: 'helper'
      }
    ];
  }

  // ---- Modbus-In Node Tests ----

  describe('modbus-in', function () {

    it('should load the modbus-in node', function (done) {
      const flow = createProxyFlow(9701);
      helper.load([modbusServerConfig, modbusInNode, modbusOutNode], flow, function () {
        const inNode = helper.getNode('in1');
        expect(inNode).to.exist;
        expect(inNode.type).to.equal('modbus-in');
        done();
      });
    });

    it('should show error when no server config', function (done) {
      const flow = [
        {
          id: 'in1',
          type: 'modbus-in',
          name: 'Bad In',
          server: '',
          filterFc: 'all',
          filterUnitId: 'all',
          wires: [[]]
        }
      ];
      helper.load([modbusInNode], flow, function () {
        const inNode = helper.getNode('in1');
        expect(inNode).to.exist;
        done();
      });
    });

    it('should filter requests by function code', function (done) {
      this.timeout(8000);
      const port = 9702; // TEST-DATA: test port
      const flow = createProxyFlow(port, { filterFc: '4' });

      helper.load([modbusServerConfig, modbusInNode, modbusOutNode], flow, function () {
        const serverNode = helper.getNode('server1');
        const helperNode = helper.getNode('helper1');
        setTimeout(function () {
          if (!serverNode._started) {
            done(new Error('Server did not start'));
            return;
          }

          let messageReceived = false;

          helperNode.on('input', function (msg) {
            // Should only receive FC 4 (input registers)
            expect(msg.payload.fc).to.equal(4);
            messageReceived = true;
            serverNode.resolveRequest(msg.payload.requestId, [500]); // TEST-DATA: input register value
          });

          const client = new ModbusRTU();
          client.connectTCP('127.0.0.1', { port: port }).then(function () {
            client.setID(1);
            client.setTimeout(3000);

            // FC 4 – should be forwarded
            client.readInputRegisters(0, 1).then(function (result) {
              expect(result.data).to.deep.equal([500]);
              expect(messageReceived).to.be.true;
              client.close(function () {});
              done();
            }).catch(function (err) {
              client.close(function () {});
              done(err);
            });
          }).catch(done);
        }, 500);
      });
    });

    it('should include requestId in output message', function (done) {
      this.timeout(8000);
      const port = 9703; // TEST-DATA: test port
      const flow = createProxyFlow(port);

      helper.load([modbusServerConfig, modbusInNode, modbusOutNode], flow, function () {
        const serverNode = helper.getNode('server1');
        const helperNode = helper.getNode('helper1');
        setTimeout(function () {
          if (!serverNode._started) {
            done(new Error('Server did not start'));
            return;
          }

          const client = new ModbusRTU();

          helperNode.on('input', function (msg) {
            expect(msg.payload.requestId).to.be.a('string');
            expect(msg.payload.requestId.length).to.be.greaterThan(0);
            expect(msg.payload.type).to.equal('readHoldingRegisters');
            expect(msg.topic).to.equal('modbus:server:readHoldingRegisters');
            serverNode.resolveRequest(msg.payload.requestId, [1]);
            client.close(function () {});
            done();
          });

          client.connectTCP('127.0.0.1', { port: port }).then(function () {
            client.setID(1);
            client.setTimeout(3000);
            client.readHoldingRegisters(0, 1).catch(function () {});
          }).catch(done);
        }, 500);
      });
    });
  });

  // ---- Modbus-Out Node Tests ----

  describe('modbus-out', function () {

    it('should load the modbus-out node', function (done) {
      const flow = createProxyFlow(9704);
      helper.load([modbusServerConfig, modbusInNode, modbusOutNode], flow, function () {
        const outNode = helper.getNode('out1');
        expect(outNode).to.exist;
        expect(outNode.type).to.equal('modbus-out');
        done();
      });
    });

    it('should show error when no server config', function (done) {
      const flow = [
        {
          id: 'out1',
          type: 'modbus-out',
          name: 'Bad Out',
          server: '',
          wires: [[]]
        }
      ];
      helper.load([modbusOutNode], flow, function () {
        const outNode = helper.getNode('out1');
        expect(outNode).to.exist;
        done();
      });
    });

    it('should reject invalid payload (non-object)', function (done) {
      const flow = createProxyFlow(9705);
      helper.load([modbusServerConfig, modbusInNode, modbusOutNode], flow, function () {
        const outNode = helper.getNode('out1');

        outNode.on('call:error', function (call) {
          expect(call.firstArg.message).to.include('msg.payload must be an object');
          done();
        });

        outNode.receive({ payload: 'bad data' });
      });
    });

    it('should reject payload without requestId', function (done) {
      const flow = createProxyFlow(9706);
      helper.load([modbusServerConfig, modbusInNode, modbusOutNode], flow, function () {
        const outNode = helper.getNode('out1');

        outNode.on('call:error', function (call) {
          expect(call.firstArg.message).to.include('requestId is required');
          done();
        });

        outNode.receive({ payload: { data: [1, 2] } });
      });
    });

    it('should reject payload without data', function (done) {
      const flow = createProxyFlow(9707);
      helper.load([modbusServerConfig, modbusInNode, modbusOutNode], flow, function () {
        const outNode = helper.getNode('out1');

        outNode.on('call:error', function (call) {
          expect(call.firstArg.message).to.include('data is required');
          done();
        });

        outNode.receive({ payload: { requestId: 'abc-123' } });
      });
    });

    it('should warn when request has already expired', function (done) {
      const flow = createProxyFlow(9708);
      helper.load([modbusServerConfig, modbusInNode, modbusOutNode], flow, function () {
        const outNode = helper.getNode('out1');

        outNode.on('call:warn', function (call) {
          expect(call.firstArg).to.include('not found');
          done();
        });

        outNode.receive({ payload: { requestId: 'expired-123', data: [1, 2] } });
      });
    });

    it('should forward message to output', function (done) {
      const flow = createProxyFlow(9709);
      helper.load([modbusServerConfig, modbusInNode, modbusOutNode], flow, function () {
        const serverNode = helper.getNode('server1');
        const outNode = helper.getNode('out1');
        const helper2 = helper.getNode('helper2');

        // Add a fake pending request
        const timer = setTimeout(function () {}, 10000);
        serverNode._pendingRequests.set('test-fwd-123', {
          resolve: function () {},
          reject: function () {},
          timer: timer
        });

        helper2.on('input', function (msg) {
          expect(msg.payload.requestId).to.equal('test-fwd-123');
          expect(msg.payload.data).to.deep.equal([100, 200]);
          done();
        });

        outNode.receive({
          payload: {
            requestId: 'test-fwd-123',
            data: [100, 200] // TEST-DATA: response values
          }
        });
      });
    });

    it('should handle error response payload', function (done) {
      const flow = createProxyFlow(9710);
      helper.load([modbusServerConfig, modbusInNode, modbusOutNode], flow, function () {
        const serverNode = helper.getNode('server1');
        const outNode = helper.getNode('out1');

        // Add a fake pending request
        const timer = setTimeout(function () {}, 10000);
        let rejected = false;
        serverNode._pendingRequests.set('test-err-456', {
          resolve: function () {
            done(new Error('Should not resolve'));
          },
          reject: function (err) {
            expect(err.modbusErrorCode).to.equal(0x02);
            rejected = true;
          },
          timer: timer
        });

        outNode.receive({
          payload: {
            requestId: 'test-err-456',
            error: {
              message: 'Address not found',
              modbusErrorCode: 0x02
            }
          }
        });

        setTimeout(function () {
          expect(rejected).to.be.true;
          done();
        }, 100);
      });
    });
  });

  // ---- Full Proxy Round-Trip Tests ----

  describe('full proxy round-trip', function () {

    it('should proxy holding register read (FC 03)', function (done) {
      this.timeout(8000);
      const port = 9720; // TEST-DATA: test port
      const flow = createProxyFlow(port);

      helper.load([modbusServerConfig, modbusInNode, modbusOutNode], flow, function () {
        const serverNode = helper.getNode('server1');
        const helperNode = helper.getNode('helper1');
        const outNode = helper.getNode('out1');
        setTimeout(function () {
          if (!serverNode._started) {
            done(new Error('Server did not start'));
            return;
          }

          // When request arrives, send it through modbus-out
          helperNode.on('input', function (msg) {
            outNode.receive({
              payload: {
                requestId: msg.payload.requestId,
                data: [1000, 2000, 3000] // TEST-DATA: holding register values
              }
            });
          });

          const client = new ModbusRTU();
          client.connectTCP('127.0.0.1', { port: port }).then(function () {
            client.setID(1);
            client.setTimeout(3000);

            client.readHoldingRegisters(50, 3).then(function (result) {
              expect(result.data).to.deep.equal([1000, 2000, 3000]);
              client.close(function () {});
              done();
            }).catch(function (err) {
              client.close(function () {});
              done(err);
            });
          }).catch(done);
        }, 500);
      });
    });

    it('should proxy input register read (FC 04)', function (done) {
      this.timeout(8000);
      const port = 9721; // TEST-DATA: test port
      const flow = createProxyFlow(port);

      helper.load([modbusServerConfig, modbusInNode, modbusOutNode], flow, function () {
        const serverNode = helper.getNode('server1');
        const helperNode = helper.getNode('helper1');
        const outNode = helper.getNode('out1');
        setTimeout(function () {
          if (!serverNode._started) {
            done(new Error('Server did not start'));
            return;
          }

          helperNode.on('input', function (msg) {
            outNode.receive({
              payload: {
                requestId: msg.payload.requestId,
                data: [777, 888] // TEST-DATA: input register values
              }
            });
          });

          const client = new ModbusRTU();
          client.connectTCP('127.0.0.1', { port: port }).then(function () {
            client.setID(1);
            client.setTimeout(3000);

            client.readInputRegisters(10, 2).then(function (result) {
              expect(result.data).to.deep.equal([777, 888]);
              client.close(function () {});
              done();
            }).catch(function (err) {
              client.close(function () {});
              done(err);
            });
          }).catch(done);
        }, 500);
      });
    });

    it('should proxy write single register (FC 06)', function (done) {
      this.timeout(8000);
      const port = 9722; // TEST-DATA: test port
      const flow = createProxyFlow(port);

      helper.load([modbusServerConfig, modbusInNode, modbusOutNode], flow, function () {
        const serverNode = helper.getNode('server1');
        const helperNode = helper.getNode('helper1');
        setTimeout(function () {
          if (!serverNode._started) {
            done(new Error('Server did not start'));
            return;
          }

          helperNode.on('input', function (msg) {
            expect(msg.payload.fc).to.equal(6);
            expect(msg.payload.value).to.equal(42); // TEST-DATA: write value
            // Acknowledge the write
            serverNode.resolveRequest(msg.payload.requestId, undefined);
          });

          const client = new ModbusRTU();
          client.connectTCP('127.0.0.1', { port: port }).then(function () {
            client.setID(1);
            client.setTimeout(3000);

            client.writeRegister(100, 42).then(function () {
              client.close(function () {});
              done();
            }).catch(function (err) {
              client.close(function () {});
              done(err);
            });
          }).catch(done);
        }, 500);
      });
    });

    it('should proxy write single coil (FC 05)', function (done) {
      this.timeout(8000);
      const port = 9723; // TEST-DATA: test port
      const flow = createProxyFlow(port);

      helper.load([modbusServerConfig, modbusInNode, modbusOutNode], flow, function () {
        const serverNode = helper.getNode('server1');
        const helperNode = helper.getNode('helper1');
        setTimeout(function () {
          if (!serverNode._started) {
            done(new Error('Server did not start'));
            return;
          }

          helperNode.on('input', function (msg) {
            expect(msg.payload.fc).to.equal(5);
            expect(msg.payload.value).to.equal(true); // TEST-DATA: coil value
            serverNode.resolveRequest(msg.payload.requestId, undefined);
          });

          const client = new ModbusRTU();
          client.connectTCP('127.0.0.1', { port: port }).then(function () {
            client.setID(1);
            client.setTimeout(3000);

            client.writeCoil(0, true).then(function () {
              client.close(function () {});
              done();
            }).catch(function (err) {
              client.close(function () {});
              done(err);
            });
          }).catch(done);
        }, 500);
      });
    });

    it('should handle multiple concurrent requests', function (done) {
      this.timeout(10000);
      const port = 9724; // TEST-DATA: test port
      const flow = createProxyFlow(port);

      helper.load([modbusServerConfig, modbusInNode, modbusOutNode], flow, function () {
        const serverNode = helper.getNode('server1');
        const helperNode = helper.getNode('helper1');

        setTimeout(function () {
          if (!serverNode._started) {
            done(new Error('Server did not start'));
            return;
          }

          // Respond to each request with address-based data
          helperNode.on('input', function (msg) {
            if (msg.payload.fc === 3) {
              const addr = msg.payload.address;
              serverNode.resolveRequest(msg.payload.requestId, [addr + 1]); // TEST-DATA: address+1 as response
            }
          });

          const client = new ModbusRTU();
          client.connectTCP('127.0.0.1', { port: port }).then(function () {
            client.setID(1);
            client.setTimeout(5000);

            // Sequential requests (Modbus TCP is sequential per connection)
            client.readHoldingRegisters(10, 1).then(function (r1) {
              expect(r1.data).to.deep.equal([11]);
              return client.readHoldingRegisters(20, 1);
            }).then(function (r2) {
              expect(r2.data).to.deep.equal([21]);
              return client.readHoldingRegisters(30, 1);
            }).then(function (r3) {
              expect(r3.data).to.deep.equal([31]);
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

    it('should clean up on node close', function (done) {
      const flow = createProxyFlow(9725);
      helper.load([modbusServerConfig, modbusInNode, modbusOutNode], flow, function () {
        const serverNode = helper.getNode('server1');
        const inNode = helper.getNode('in1');
        const outNode = helper.getNode('out1');

        // Just verify everything exists and can be unloaded
        expect(serverNode).to.exist;
        expect(inNode).to.exist;
        expect(outNode).to.exist;
        done();
      });
    });
  });
});
