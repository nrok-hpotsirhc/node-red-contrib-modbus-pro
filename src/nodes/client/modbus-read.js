'use strict';

const { buildReadPayload, buildConnectionString } = require('../../lib/parser/payload-builder');

/**
 * Modbus Read Node for Node-RED.
 *
 * Reads data from a Modbus device using one of the four read function codes:
 *   FC 01 – Read Coils
 *   FC 02 – Read Discrete Inputs
 *   FC 03 – Read Holding Registers
 *   FC 04 – Read Input Registers
 *
 * Supports:
 *   - Trigger-based or interval-based polling
 *   - Zero-based and one-based address offset
 *   - Standardized payload with metadata
 *
 * @param {object} RED - Node-RED runtime API.
 */
module.exports = function (RED) {

  /**
   * Map function code numbers to transport method names.
   * @readonly
   */
  const FC_METHOD_MAP = {
    1: 'readCoils',
    2: 'readDiscreteInputs',
    3: 'readHoldingRegisters',
    4: 'readInputRegisters'
  };

  /**
   * Map function code numbers to human-readable data types.
   * @readonly
   */
  const FC_LABEL_MAP = {
    1: 'Coils',
    2: 'Discrete Inputs',
    3: 'Holding Registers',
    4: 'Input Registers'
  };

  function ModbusRead(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Retrieve the config node
    node.server = RED.nodes.getNode(config.server);

    const { parseIntSafe } = require('../../lib/utils');

    // Store configuration
    node.name = config.name || '';
    node.fc = parseIntSafe(config.fc, 3);
    node.address = parseIntSafe(config.address, 0);
    node.quantity = parseIntSafe(config.quantity, 1);
    node.addressOffset = config.addressOffset === 'one-based' ? 'one-based' : 'zero-based';
    const rawPoll = parseIntSafe(config.pollInterval, 0);
    // Clamp pollInterval: negative / non-finite values are coerced to 0 (trigger-only).
    // Upper bound (24h) prevents accidental overflow from misconfigured flows.
    node.pollInterval = rawPoll > 0 && rawPoll <= 86400000 ? rawPoll : 0;
    if (rawPoll < 0 || rawPoll > 86400000) {
      node.warn(`Modbus Read: pollInterval out of range (${rawPoll}ms), disabling polling`);
    }

    // Compute the effective zero-based address for the protocol
    node._protocolAddress = node.addressOffset === 'one-based'
      ? Math.max(0, node.address - 1)
      : node.address;

    // Internal state
    node._pollTimer = null;
    node._statusTimer = null;
    node._reading = false;

    // Validate config node reference
    if (!node.server) {
      node.status({ fill: 'red', shape: 'ring', text: 'No config' });
      node.error('Modbus Read: No config node selected');
      return;
    }

    // Validate function code
    if (!FC_METHOD_MAP[node.fc]) {
      node.status({ fill: 'red', shape: 'ring', text: 'Invalid FC' });
      node.error(`Modbus Read: Invalid function code: ${node.fc}`);
      return;
    }

    node.status({ fill: 'grey', shape: 'dot', text: 'Ready' });

    function scheduleStatusReset() {
      if (node._statusTimer) {
        clearTimeout(node._statusTimer);
      }
      node._statusTimer = setTimeout(function () {
        node._statusTimer = null;
        if (!node._reading) {
          node.status({ fill: 'grey', shape: 'dot', text: 'Ready' });
        }
      }, 200);
      if (node._statusTimer.unref) node._statusTimer.unref();
    }

    /**
     * Perform a single Modbus read operation and return the output message.
     * @param {object} [triggerMsg] - Optional incoming message for trigger-based reads.
     * @returns {Promise<object|null>} Output message or null if skipped.
     */
    async function doRead(triggerMsg) {
      if (node._reading) {
        node.warn('Modbus Read: Previous read still in progress, skipping');
        return null;
      }

      const transport = typeof node.server.getConnectedTransport === 'function'
        ? await node.server.getConnectedTransport()
        : node.server._transport;
      if (!transport || !transport.isOpen()) {
        node.status({ fill: 'red', shape: 'ring', text: 'Not connected' });
        throw new Error('Modbus Read: Transport not connected');
      }
      const method = FC_METHOD_MAP[node.fc];

      node._reading = true;
      node.status({ fill: 'blue', shape: 'dot', text: 'Reading...' });

      try {
        // Set unit ID from config node
        transport.setID(node.server.unitId);

        const result = await transport[method](node._protocolAddress, node.quantity);

        const connectionStr = buildConnectionString(node.server.getTransportConfig());

        const payload = buildReadPayload({
          data: result.data,
          buffer: result.buffer || null,
          fc: node.fc,
          address: node._protocolAddress,
          quantity: node.quantity,
          unitId: node.server.unitId,
          connection: connectionStr
        });

        const msg = {
          topic: triggerMsg && triggerMsg.topic ? triggerMsg.topic : `modbus:${FC_LABEL_MAP[node.fc]}`,
          payload: payload,
          modbusRead: {
            fc: node.fc,
            address: node.address,
            protocolAddress: node._protocolAddress,
            quantity: node.quantity,
            unitId: node.server.unitId,
            addressOffset: node.addressOffset
          }
        };

        node.status({
          fill: 'green',
          shape: 'dot',
          text: `OK: ${result.data.length} ${node.fc <= 2 ? 'bits' : 'regs'} @ ${node._protocolAddress}`
        });
        scheduleStatusReset();
        return msg;
      } finally {
        node._reading = false;
      }
    }

    // Handle incoming messages (trigger-based polling)
    node.on('input', function (msg, send, done) {
      // Node-RED >= 1.0 provides send/done callbacks
      send = send || function () { node.send.apply(node, arguments); };
      done = done || function (err) { if (err) node.error(err, msg); };

      doRead(msg).then(function (outMsg) {
        if (outMsg) {
          send(outMsg);
        }
        done();
      }).catch(function (err) {
        node.status({ fill: 'red', shape: 'ring', text: `Error: ${err.message}` });
        done(err);
      });
    });

    // Start interval-based polling if configured
    if (node.pollInterval > 0) {
      node._lastPollError = null;
      node._pollTimer = setInterval(function () {
        doRead(null).then(function (outMsg) {
          if (outMsg) {
            node._lastPollError = null;
            node.send(outMsg);
          }
        }).catch(function (err) {
          node.status({ fill: 'red', shape: 'ring', text: `Error: ${err.message}` });
          // Throttle repeated identical errors to avoid flooding the log
          if (node._lastPollError !== err.message) {
            node._lastPollError = err.message;
            node.error(`Modbus Read: ${err.message}`);
          }
        });
      }, node.pollInterval);
      if (node._pollTimer.unref) node._pollTimer.unref();
      node.log(`Modbus Read: Polling every ${node.pollInterval}ms (FC ${node.fc} @ ${node._protocolAddress})`);
    }

    // Cleanup on close
    node.on('close', function (done) {
      if (node._pollTimer) {
        clearInterval(node._pollTimer);
        node._pollTimer = null;
      }
      if (node._statusTimer) {
        clearTimeout(node._statusTimer);
        node._statusTimer = null;
      }
      node._reading = false;
      done();
    });
  }

  RED.nodes.registerType('modbus-read', ModbusRead);
};
