'use strict';

const { EventEmitter } = require('events');
const tls = require('node:tls');
const fs = require('node:fs');
const ModbusRTU = require('modbus-serial');
const crypto = require('crypto');
const { RegisterCache } = require('../../lib/cache/register-cache');
const { CertificateValidator } = require('../../lib/security/certificate-validator');
const { parseIntSafe } = require('../../lib/utils');

const ServerTCP = ModbusRTU.ServerTCP;

/**
 * Map function code numbers to human-readable request type names.
 * @readonly
 */
const FC_TYPE_MAP = {
  1: 'readCoils',
  2: 'readDiscreteInputs',
  3: 'readHoldingRegisters',
  4: 'readInputRegisters',
  5: 'writeSingleCoil',
  6: 'writeSingleRegister',
  15: 'writeMultipleCoils',
  16: 'writeMultipleRegisters'
};

/**
 * Modbus Server Config node for Node-RED.
 *
 * Acts as a TCP listener using modbus-serial's ServerTCP. Incoming Modbus
 * requests are emitted as events that Modbus-In nodes subscribe to.
 * Responses are sent back when Modbus-Out nodes provide data via
 * the resolveRequest() method.
 *
 * Supports Modbus/TCP Security (TLS 1.2/1.3, mTLS) via WP 4.1–4.3.
 * When TLS is enabled, the server listens on a TLS-secured port
 * and requires client certificate authentication (mTLS).
 *
 * This implements the Dynamic Server Proxy pattern described in
 * THEORETICAL_FOUNDATIONS.md §8.
 *
 * @param {object} RED - Node-RED runtime API.
 */
module.exports = function (RED) {

  function ModbusServerConfig(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Store configuration
    node.name = config.name || '';
    node.host = config.host || '0.0.0.0';
    node.port = parseIntSafe(config.port, 8502);
    node.unitId = parseIntSafe(config.unitId, 255);
    node.responseTimeout = parseIntSafe(config.responseTimeout, 5000);

    // TLS configuration (WP 4.1–4.3: Modbus/TCP Security)
    node.tlsEnabled = config.tlsEnabled === true || config.tlsEnabled === 'true';
    node.rejectUnauthorized = config.rejectUnauthorized !== false && config.rejectUnauthorized !== 'false';

    // Validate TLS credentials on startup if TLS is enabled
    if (node.tlsEnabled) {
      const validator = new CertificateValidator();
      const creds = node.credentials || {};
      const result = validator.validateConfig({
        caPath: creds.serverCaPath || null,
        certPath: creds.serverCertPath || null,
        keyPath: creds.serverKeyPath || null,
        passphrase: creds.serverPassphrase || null
      });

      for (const warning of result.warnings) {
        node.warn(`TLS: ${warning}`);
      }
      if (!result.valid) {
        for (const error of result.errors) {
          node.error(`TLS: ${error}`);
        }
      }
    }

    // Cache configuration (WP 3.4)
    node._cache = new RegisterCache({
      enabled: config.cacheEnabled === true || config.cacheEnabled === 'true',
      maxSize: parseIntSafe(config.cacheMaxSize, 10000),
      defaultTTL: parseIntSafe(config.cacheTTL, 60000),
      cleanupInterval: 30000
    });

    // Forward cache events as node log messages
    node._cache.on('evict', function (info) {
      if (info.reason === 'size') {
        node.warn(`Cache eviction: max size reached (key: ${info.key})`);
      }
    });

    // Internal event bus for Modbus-In nodes
    node._requestEmitter = new EventEmitter();
    node._requestEmitter.setMaxListeners(50);

    // Pending requests map: requestId → { callback, timer }
    node._pendingRequests = new Map();

    // Server instance
    node._server = null;
    node._started = false;

    /**
     * Generate a unique request ID.
     * @returns {string}
     */
    function generateRequestId() {
      return crypto.randomUUID();
    }

    /**
     * Create a promise-based handler for a Modbus vector callback.
     * When a request arrives, it first checks the cache for read requests.
     * On cache miss, it emits an event and waits for the Modbus-Out node
     * to resolve it via resolveRequest().
     *
     * @param {number} fc - The function code.
     * @param {number} address - Start address.
     * @param {number} quantityOrValue - Quantity for reads, value for writes.
     * @param {number} unitId - Unit/slave ID from the request.
     * @returns {Promise<*>} - Resolved with response data or rejected on timeout.
     */
    function handleRequest(fc, address, quantityOrValue, unitId) {
      const isWrite = fc === 5 || fc === 6 || fc === 15 || fc === 16;

      // Check cache for read requests
      if (!isWrite && node._cache.enabled) {
        const cached = node._cache.get(fc, unitId, address, quantityOrValue);
        if (cached !== undefined) {
          return Promise.resolve(cached);
        }
      }

      // Invalidate cache on write requests
      if (isWrite && node._cache.enabled) {
        const count = (fc === 15 || fc === 16)
          ? (Array.isArray(quantityOrValue) ? quantityOrValue.length : 1)
          : 1;
        node._cache.invalidateOnWrite(fc, unitId, address, count);
      }

      return new Promise(function (promiseResolve, reject) {
        const requestId = generateRequestId();

        const timer = setTimeout(function () {
          node._pendingRequests.delete(requestId);
          const err = new Error('Response timeout');
          err.modbusErrorCode = 0x0B; // Gateway target device failed to respond
          reject(err);
        }, node.responseTimeout);

        node._pendingRequests.set(requestId, {
          resolve: function (data) {
            // Cache the response for read requests
            if (!isWrite && node._cache.enabled) {
              node._cache.set(fc, unitId, address, quantityOrValue, data);
            }
            promiseResolve(data);
          },
          reject,
          timer
        });

        const requestPayload = {
          type: FC_TYPE_MAP[fc] || `fc${fc}`,
          fc: fc,
          address: address,
          unitId: unitId,
          requestId: requestId
        };

        if (isWrite) {
          requestPayload.value = quantityOrValue;
        } else {
          requestPayload.quantity = quantityOrValue;
        }

        node._requestEmitter.emit('modbusRequest', requestPayload);
      });
    }

    /**
     * Resolve a pending request with response data from the flow.
     *
     * @param {string} requestId - The request ID to resolve.
     * @param {*} data - Response data (array of register values, boolean, etc.).
     * @returns {boolean} - True if the request was found and resolved.
     */
    node.resolveRequest = function (requestId, data) {
      const pending = node._pendingRequests.get(requestId);
      if (!pending) {
        return false;
      }
      clearTimeout(pending.timer);
      node._pendingRequests.delete(requestId);
      pending.resolve(data);
      return true;
    };

    /**
     * Reject a pending request with an error.
     *
     * @param {string} requestId - The request ID to reject.
     * @param {Error|object} error - The error or an object with modbusErrorCode.
     * @returns {boolean} - True if the request was found and rejected.
     */
    node.rejectRequest = function (requestId, error) {
      const pending = node._pendingRequests.get(requestId);
      if (!pending) {
        return false;
      }
      clearTimeout(pending.timer);
      node._pendingRequests.delete(requestId);
      if (!(error instanceof Error)) {
        const err = new Error(error.message || 'Request rejected by flow');
        err.modbusErrorCode = error.modbusErrorCode || 0x04;
        pending.reject(err);
      } else {
        if (error.modbusErrorCode === undefined) {
          error.modbusErrorCode = 0x04; // slave device failure
        }
        pending.reject(error);
      }
      return true;
    };

    /**
     * Build the modbus-serial vector object.
     * The vector uses callback-style (4-argument) signatures for multi-register
     * reads so modbus-serial can handle the response array correctly.
     * Single-value reads and writes use the 2/3-argument Promise style
     * where modbus-serial handles them via _handlePromiseOrValue.
     */
    function buildVector() {
      return {
        // FC 01 – Read Coils (called per address, 2-arg → promise style)
        getCoil: function (address, unitID) {
          return handleRequest(1, address, 1, unitID);
        },
        // FC 02 – Read Discrete Inputs (called per address, 2-arg → promise style)
        getDiscreteInput: function (address, unitID) {
          return handleRequest(2, address, 1, unitID);
        },
        // FC 03 – Read Holding Registers (batch, 4-arg → callback style)
        getMultipleHoldingRegisters: function (address, length, unitID, callback) {
          handleRequest(3, address, length, unitID).then(function (data) {
            callback(null, data);
          }).catch(function (err) {
            callback(err);
          });
        },
        // FC 03 – Read single Holding Register fallback (2-arg → promise style)
        getHoldingRegister: function (address, unitID) {
          return handleRequest(3, address, 1, unitID).then(function (data) {
            return Array.isArray(data) ? data[0] : data;
          });
        },
        // FC 04 – Read Input Registers (batch, 4-arg → callback style)
        getMultipleInputRegisters: function (address, length, unitID, callback) {
          handleRequest(4, address, length, unitID).then(function (data) {
            callback(null, data);
          }).catch(function (err) {
            callback(err);
          });
        },
        // FC 04 – Read single Input Register fallback (2-arg → promise style)
        getInputRegister: function (address, unitID) {
          return handleRequest(4, address, 1, unitID).then(function (data) {
            return Array.isArray(data) ? data[0] : data;
          });
        },
        // FC 05 – Write Single Coil (3-arg → promise style)
        setCoil: function (address, value, unitID) {
          return handleRequest(5, address, value, unitID);
        },
        // FC 06 – Write Single Register (3-arg → promise style)
        setRegister: function (address, value, unitID) {
          return handleRequest(6, address, value, unitID);
        },
        // FC 15 – Write Multiple Coils (3-arg → promise style, receives boolean array)
        setCoilArray: function (address, values, unitID) {
          return handleRequest(15, address, values, unitID);
        },
        // FC 16 – Write Multiple Registers (3-arg → promise style, receives register array)
        setRegisterArray: function (address, values, unitID) {
          return handleRequest(16, address, values, unitID);
        }
      };
    }

    /**
     * Start the Modbus TCP server.
     * When TLS is enabled, wraps the server in a TLS layer.
     */
    node.startServer = function () {
      if (node._started) {
        return;
      }

      try {
        const vector = buildVector();
        const serverOptions = {
          host: node.host,
          port: node.port,
          unitID: node.unitId,
          debug: false
        };

        if (node.tlsEnabled) {
          const creds = node.credentials || {};
          const tlsOptions = {
            minVersion: 'TLSv1.2'
          };

          if (creds.serverCaPath) {
            tlsOptions.ca = fs.readFileSync(creds.serverCaPath);
            tlsOptions.requestCert = true;
            tlsOptions.rejectUnauthorized = node.rejectUnauthorized;
          }
          if (creds.serverCertPath) {
            tlsOptions.cert = fs.readFileSync(creds.serverCertPath);
          }
          if (creds.serverKeyPath) {
            tlsOptions.key = fs.readFileSync(creds.serverKeyPath);
          }
          if (creds.serverPassphrase) {
            tlsOptions.passphrase = creds.serverPassphrase;
          }

          // Create TLS server and pass to ServerTCP via serverOptions
          const tlsServer = tls.createServer(tlsOptions);
          serverOptions.server = tlsServer;

          // Start TLS server listening
          tlsServer.listen(node.port, node.host, function () {
            node._started = true;
            node.log(`Modbus TCP+TLS server listening on ${node.host}:${node.port} (unitId: ${node.unitId})`);
            node._requestEmitter.emit('serverStatus', {
              fill: 'green',
              shape: 'dot',
              text: `TLS Listening on ${node.host}:${node.port}`
            });
          });

          node._tlsServer = tlsServer;
        }

        node._server = new ServerTCP(vector, serverOptions);

        if (!node.tlsEnabled) {
          node._server.on('initialized', function () {
            node._started = true;
            node.log(`Modbus TCP server listening on ${node.host}:${node.port} (unitId: ${node.unitId})`);
            node._requestEmitter.emit('serverStatus', {
              fill: 'green',
              shape: 'dot',
              text: `Listening on ${node.host}:${node.port}`
            });
          });
        }

        node._server.on('socketError', function (err) {
          node.warn(`Modbus server socket error: ${err.message}`);
        });

        node._server.on('serverError', function (err) {
          node.error(`Modbus server error: ${err.message}`);
          node._requestEmitter.emit('serverStatus', {
            fill: 'red',
            shape: 'ring',
            text: `Error: ${err.message}`
          });
        });

        node._server.on('error', function (err) {
          node.warn(`Modbus server error: ${err.message}`);
        });
      } catch (err) {
        node.error(`Failed to start Modbus server: ${err.message}`);
        node._requestEmitter.emit('serverStatus', {
          fill: 'red',
          shape: 'ring',
          text: `Failed: ${err.message}`
        });
      }
    };

    /**
     * Stop the Modbus TCP server and clean up all pending requests.
     * @returns {Promise<void>}
     */
    node.stopServer = function () {
      return new Promise(function (resolve) {
        // Clear all pending requests
        for (const pending of node._pendingRequests.values()) {
          clearTimeout(pending.timer);
          const err = new Error('Server shutting down');
          err.modbusErrorCode = 0x04;
          pending.reject(err);
        }
        node._pendingRequests.clear();

        // Safety timeout – resolve after 10s even if close callbacks hang
        const safetyTimer = setTimeout(function () {
          node.warn('Server stop: close callback timed out, forcing shutdown');
          node._server = null;
          node._tlsServer = null;
          node._started = false;
          resolve();
        }, 10000);
        if (safetyTimer.unref) safetyTimer.unref();

        const closeModbusServer = function (next) {
          if (node._server) {
            try {
              node._server.close(function () {
                node._server = null;
                next();
              });
            } catch (_err) {
              node._server = null;
              next();
            }
          } else {
            next();
          }
        };

        const closeTlsServer = function (next) {
          if (node._tlsServer) {
            try {
              node._tlsServer.close(function () {
                node._tlsServer = null;
                next();
              });
            } catch (_err) {
              node._tlsServer = null;
              next();
            }
          } else {
            next();
          }
        };

        closeModbusServer(function () {
          closeTlsServer(function () {
            clearTimeout(safetyTimer);
            node._started = false;
            resolve();
          });
        });
      });
    };

    // Auto-start the server when there are subscribers
    // (deferred to allow Modbus-In nodes to register first)
    node._startDeferred = setTimeout(function () {
      if (node._requestEmitter.listenerCount('modbusRequest') > 0) {
        node.startServer();
      }
    }, 100);
    if (node._startDeferred.unref) node._startDeferred.unref();

    // Cleanup on close
    node.on('close', function (done) {
      clearTimeout(node._startDeferred);
      node._cache.destroy();
      node.stopServer().then(function () {
        node._requestEmitter.removeAllListeners();
        done();
      }).catch(function (err) {
        node.warn(`Error during server cleanup: ${err.message}`);
        done();
      });
    });
  }

  RED.nodes.registerType('modbus-server-config', ModbusServerConfig, {
    credentials: {
      serverCaPath: { type: 'text' },
      serverCertPath: { type: 'text' },
      serverKeyPath: { type: 'password' },
      serverPassphrase: { type: 'password' }
    }
  });
};
