'use strict';

const TransportFactory = require('../../lib/transport/transport-factory');
const { CertificateValidator } = require('../../lib/security/certificate-validator');
const { parseIntSafe } = require('../../lib/utils');

/**
 * Modbus Client Config node for Node-RED.
 *
 * This is a config node that stores TCP or RTU connection parameters
 * and provides a transport configuration to child nodes.
 *
 * Supports Modbus/TCP Security (TLS 1.2/1.3, mTLS) via WP 4.1–4.3.
 * Certificate paths are stored in the Node-RED Credential Store,
 * never in flow.json.
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

    // RTU-over-TCP parameters (WP 7.4)
    node.interFrameDelay = parseIntSafe(config.interFrameDelay, 0);

    // Common parameters
    node.unitId = parseIntSafe(config.unitId, 1);
    node.timeout = parseIntSafe(config.timeout, 1000);

    // TLS parameters (WP 4.1–4.3: Modbus/TCP Security)
    node.tlsEnabled = config.tlsEnabled === true || config.tlsEnabled === 'true';
    node.rejectUnauthorized = config.rejectUnauthorized !== false && config.rejectUnauthorized !== 'false';

    // Transport instance placeholder (created on demand in MS-2)
    node._transport = null;

    // Validate TLS credentials on startup if TLS is enabled
    if (node.tlsEnabled && node.connectionType === 'tcp') {
      const validator = new CertificateValidator();
      const creds = node.credentials || {};
      const result = validator.validateConfig({
        caPath: creds.caPath || null,
        certPath: creds.certPath || null,
        keyPath: creds.keyPath || null,
        passphrase: creds.passphrase || null,
        rejectUnauthorized: node.rejectUnauthorized
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

      if (node.connectionType === 'rtu-over-tcp') {
        return {
          type: 'rtu-over-tcp',
          host: node.host,
          port: node.port,
          unitId: node.unitId,
          timeout: node.timeout,
          interFrameDelay: node.interFrameDelay
        };
      }

      const tcpConfig = {
        type: 'tcp',
        host: node.host,
        port: node.port,
        unitId: node.unitId,
        timeout: node.timeout
      };

      // Add TLS configuration when enabled
      if (node.tlsEnabled) {
        const creds = node.credentials || {};
        tcpConfig.tls = true;
        tcpConfig.caPath = creds.caPath || undefined;
        tcpConfig.certPath = creds.certPath || undefined;
        tcpConfig.keyPath = creds.keyPath || undefined;
        tcpConfig.passphrase = creds.passphrase || undefined;
        tcpConfig.rejectUnauthorized = node.rejectUnauthorized;
      }

      return tcpConfig;
    };

    /**
     * Create a transport instance via the factory.
     *
     * @returns {import('../../lib/transport/tcp-transport')|import('../../lib/transport/rtu-transport')}
     */
    node.createTransport = function () {
      return TransportFactory.create(node.getTransportConfig());
    };

    /**
     * Return an open transport, creating and connecting it on demand.
     *
     * @returns {Promise<import('../../lib/transport/tcp-transport')|import('../../lib/transport/rtu-transport')>}
     */
    node.getConnectedTransport = async function () {
      if (!node._transport) {
        node._transport = node.createTransport();
      }
      if (!node._transport.isOpen()) {
        await node._transport.connect();
      }
      return node._transport;
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
          ? ` ${node.host}:${node.port}${node.tlsEnabled ? ' (TLS)' : ''}`
          : node.connectionType === 'rtu-over-tcp'
            ? ` ${node.host}:${node.port}` +
              (node.interFrameDelay > 0 ? ` (t3.5 ${node.interFrameDelay}ms)` : '')
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
      caPath: { type: 'text' },
      certPath: { type: 'text' },
      keyPath: { type: 'password' },
      passphrase: { type: 'password' }
    }
  });
};
