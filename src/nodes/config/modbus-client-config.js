'use strict';

const TransportFactory = require('../../lib/transport/transport-factory');

/**
 * Default TCP transport configuration.
 */
const TCP_DEFAULTS = {
  host: '127.0.0.1',
  port: 502,
  unitId: 1,
  timeout: 1000
};

/**
 * Default RTU transport configuration.
 */
const RTU_DEFAULTS = {
  serialPort: '/dev/ttyUSB0',
  baudRate: 9600,
  parity: 'none',
  dataBits: 8,
  stopBits: 1,
  unitId: 1,
  timeout: 1000
};

/**
 * Modbus Client Config node for Node-RED.
 *
 * This is a config node that stores TCP or RTU connection parameters
 * and provides a transport configuration to child nodes. In MS-1 it
 * does NOT establish connections (that is handled in MS-2 via XState).
 *
 * @param {object} RED - Node-RED runtime API.
 */
module.exports = function (RED) {
  function ModbusClientConfig(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Store connection type
    node.connectionType = config.connectionType || 'tcp';
    node.name = config.name || '';

    // Store TCP parameters with defaults
    node.host = config.host || TCP_DEFAULTS.host;
    node.port = parseInt(config.port, 10) || TCP_DEFAULTS.port;

    // Store RTU parameters with defaults
    node.serialPort = config.serialPort || RTU_DEFAULTS.serialPort;
    node.baudRate = parseInt(config.baudRate, 10) || RTU_DEFAULTS.baudRate;
    node.parity = config.parity || RTU_DEFAULTS.parity;
    node.dataBits = parseInt(config.dataBits, 10) || RTU_DEFAULTS.dataBits;
    node.stopBits = parseInt(config.stopBits, 10) || RTU_DEFAULTS.stopBits;

    // Common parameters
    node.unitId = parseInt(config.unitId, 10) || TCP_DEFAULTS.unitId;
    node.timeout = parseInt(config.timeout, 10) || TCP_DEFAULTS.timeout;

    // Transport instance placeholder (created on demand in MS-2)
    node._transport = null;

    /**
     * Build a transport configuration object from the stored node properties.
     *
     * @returns {object} Configuration suitable for TransportFactory.create().
     */
    node.getTransportConfig = function () {
      if (node.connectionType === 'rtu') {
        return {
          type: 'rtu',
          serialPort: node.serialPort,
          baudRate: node.baudRate,
          parity: node.parity,
          dataBits: node.dataBits,
          stopBits: node.stopBits,
          unitId: node.unitId,
          timeout: node.timeout
        };
      }

      return {
        type: 'tcp',
        host: node.host,
        port: node.port,
        unitId: node.unitId,
        timeout: node.timeout
      };
    };

    /**
     * Create a transport instance via the factory.
     * Does NOT connect – connection lifecycle is managed in MS-2.
     *
     * @returns {import('../../lib/transport/tcp-transport')|import('../../lib/transport/rtu-transport')}
     */
    node.createTransport = function () {
      return TransportFactory.create(node.getTransportConfig());
    };

    /**
     * Check whether RTU transport is available on this system.
     *
     * @returns {boolean}
     */
    node.isRtuAvailable = function () {
      return TransportFactory.isRtuAvailable();
    };

    node.log(
      `Modbus client config initialized: ${node.connectionType}` +
        (node.connectionType === 'tcp'
          ? ` ${node.host}:${node.port}`
          : ` ${node.serialPort}@${node.baudRate}`) +
        ` unit=${node.unitId}`
    );

    node.on('close', async function (done) {
      try {
        if (node._transport) {
          await node._transport.destroy();
          node._transport = null;
        }
      } catch (err) {
        node.warn(`Error during cleanup: ${err.message}`);
      }
      done();
    });
  }

  RED.nodes.registerType('modbus-client-config', ModbusClientConfig, {
    credentials: {
      password: { type: 'password' },
      certPath: { type: 'text' },
      keyPath: { type: 'password' },
      caPath: { type: 'text' }
    }
  });
};
