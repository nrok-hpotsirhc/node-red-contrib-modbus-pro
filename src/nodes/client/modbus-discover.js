'use strict';

const { buildDiscoverPayload, buildConnectionString } = require('../../lib/parser/payload-builder');
const { parseIntSafe } = require('../../lib/utils');

/**
 * Modbus Discover Node for Node-RED.
 *
 * Reads device identification from a Modbus device using FC 43/14
 * (MEI Transport – Read Device Identification).
 *
 * Returns standardized device metadata including VendorName, ProductCode,
 * MajorMinorRevision, and optionally extended vendor-specific objects.
 *
 * Trigger-based (one-shot, not cyclic). Receives a trigger message and
 * outputs msg.payload with the device identification response.
 *
 * @param {object} RED - Node-RED runtime API.
 */
module.exports = function (RED) {

  /**
   * Device ID code labels.
   * @readonly
   */
  const DEVICE_ID_LABELS = {
    1: 'Basic',
    2: 'Regular',
    3: 'Extended',
    4: 'Individual'
  };

  /**
   * Standard Modbus device identification object names per specification.
   * @readonly
   */
  const OBJECT_NAMES = {
    0x00: 'VendorName',
    0x01: 'ProductCode',
    0x02: 'MajorMinorRevision',
    0x03: 'VendorURL',
    0x04: 'ProductName',
    0x05: 'ModelName',
    0x06: 'UserApplicationName'
  };

  function ModbusDiscover(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Retrieve the config node
    node.server = RED.nodes.getNode(config.server);

    // Store configuration
    node.name = config.name || '';
    node.deviceIdCode = parseIntSafe(config.deviceIdCode, 1);
    node.objectId = parseIntSafe(config.objectId, 0);
    node._discovering = false;

    // Validate config node reference
    if (!node.server) {
      node.status({ fill: 'red', shape: 'ring', text: 'No config' });
      node.error('Modbus Discover: No config node selected');
      return;
    }

    // Validate device ID code
    if (node.deviceIdCode < 1 || node.deviceIdCode > 4) {
      node.status({ fill: 'red', shape: 'ring', text: 'Invalid Device ID Code' });
      node.error(`Modbus Discover: Device ID code must be 1-4, got: ${node.deviceIdCode}`);
      return;
    }

    node.status({ fill: 'grey', shape: 'dot', text: 'Ready' });

    /**
     * Execute device identification request.
     *
     * @param {object} msg - Incoming Node-RED message.
     * @param {function} send - Node-RED send function.
     * @param {function} done - Node-RED done callback.
     * @returns {Promise<void>}
     */
    async function doDiscover(msg, send, done) {
      const transport = typeof node.server.getConnectedTransport === 'function'
        ? await node.server.getConnectedTransport()
        : node.server._transport;
      if (!transport || !transport.isOpen()) {
        node.status({ fill: 'red', shape: 'ring', text: 'Not connected' });
        throw new Error('Modbus Discover: Transport not connected');
      }

      // Allow dynamic overrides via msg properties
      const deviceIdCode = (msg.deviceIdCode !== undefined)
        ? parseIntSafe(msg.deviceIdCode, node.deviceIdCode)
        : node.deviceIdCode;
      const objectId = (msg.objectId !== undefined)
        ? parseIntSafe(msg.objectId, node.objectId)
        : node.objectId;

      node._discovering = true;
      node.status({ fill: 'blue', shape: 'dot', text: 'Discovering...' });

      try {
        // Set unit ID from config node
        transport.setID(node.server.unitId);

        const result = await transport.readDeviceIdentification(deviceIdCode, objectId);

        // Build device info object map from response data
        const deviceInfo = {};
        if (result && Array.isArray(result.data)) {
          result.data.forEach(function (value, index) {
            const objId = objectId + index;
            const name = OBJECT_NAMES[objId] || ('object_' + objId.toString(16).padStart(2, '0'));
            deviceInfo[name] = value;
          });
        }

        const connectionStr = buildConnectionString(node.server.getTransportConfig());

        const payload = buildDiscoverPayload({
          deviceIdCode: deviceIdCode,
          objectId: objectId,
          deviceInfo: deviceInfo,
          conformityLevel: (result && result.conformityLevel) || 0,
          unitId: node.server.unitId,
          connection: connectionStr
        });

        const outMsg = {
          topic: msg.topic || ('modbus:DeviceID:' + (DEVICE_ID_LABELS[deviceIdCode] || deviceIdCode)),
          payload: payload,
          modbusDiscover: {
            deviceIdCode: deviceIdCode,
            objectId: objectId,
            unitId: node.server.unitId,
            conformityLevel: (result && result.conformityLevel) || 0
          }
        };

        node.status({
          fill: 'green',
          shape: 'dot',
          text: 'OK: ' + Object.keys(deviceInfo).length + ' objects'
        });

        send(outMsg);
        done();
      } finally {
        node._discovering = false;
      }
    }

    // Handle incoming trigger messages
    node.on('input', function (msg, send, done) {
      // Node-RED >= 1.0 provides send/done callbacks
      send = send || function () { node.send.apply(node, arguments); };
      done = done || function (err) { if (err) node.error(err, msg); };

      if (node._discovering) {
        done(new Error('Modbus Discover: Discovery already in progress'));
        return;
      }

      doDiscover(msg, send, done).catch(function (err) {
        node.status({ fill: 'red', shape: 'ring', text: 'Error: ' + err.message });
        done(err);
      });
    });

    // Cleanup on close
    node.on('close', function (done) {
      node._discovering = false;
      done();
    });
  }

  RED.nodes.registerType('modbus-discover', ModbusDiscover);
};
