'use strict';

const TransportFactory = require('../../lib/transport/transport-factory');

/**
 * Parse a string to an integer, returning the default value
 * if the result is not a finite number. Unlike `parseInt(x) || default`,
 * this correctly handles 0 as a valid value (e.g. unitId 0 for TCP broadcast).
 * @param {*} value - Value to parse.
 * @param {number} defaultValue - Fallback if parsing fails.
 * @returns {number}
 */
function parseIntSafe(value, defaultValue) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

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

    // Store TCP parameters
    node.host = config.host || '127.0.0.1';
    node.port = parseIntSafe(config.port, 502);

    // Store RTU parameters
    node.serialPort = config.serialPort || '/dev/ttyUSB0';
    node.baudRate = parseIntSafe(config.baudRate, 9600);
    node.parity = config.parity || 'none';
    node.dataBits = parseIntSafe(config.dataBits, 8);
    node.stopBits = parseIntSafe(config.stopBits, 1);

    // Common parameters
    node.unitId = parseIntSafe(config.unitId, 1);
    node.timeout = parseIntSafe(config.timeout, 1000);

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
