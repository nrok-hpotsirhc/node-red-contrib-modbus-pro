'use strict';

/**
 * Modbus-In Node for Node-RED.
 *
 * Subscribes to events from the Modbus Server Config node and injects
 * incoming Modbus requests as structured JSON messages into the flow.
 *
 * This node is the entry point for the Dynamic Server Proxy pattern:
 *   External Client → TCP → Server Config → Modbus-In → Flow
 *
 * Each incoming request contains a unique requestId that must be passed
 * through to a Modbus-Out node for the response to be sent back.
 *
 * @param {object} RED - Node-RED runtime API.
 */
module.exports = function (RED) {

  /**
   * Human-readable labels for function codes.
   * @readonly
   */
  const FC_LABEL_MAP = {
    1: 'Read Coils',
    2: 'Read Discrete Inputs',
    3: 'Read Holding Registers',
    4: 'Read Input Registers',
    5: 'Write Single Coil',
    6: 'Write Single Register',
    15: 'Write Multiple Coils',
    16: 'Write Multiple Registers'
  };

  function ModbusIn(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Retrieve the server config node
    node.server = RED.nodes.getNode(config.server);

    // Configuration
    node.name = config.name || '';
    node.filterFc = config.filterFc || 'all';
    node.filterUnitId = config.filterUnitId || 'all';

    // Validate server config reference
    if (!node.server) {
      node.status({ fill: 'red', shape: 'ring', text: 'No server config' });
      node.error('Modbus In: No server config node selected');
      return;
    }

    if (!node.server._requestEmitter) {
      node.status({ fill: 'red', shape: 'ring', text: 'Invalid server config' });
      node.error('Modbus In: Server config node does not have a request emitter');
      return;
    }

    node.status({ fill: 'grey', shape: 'dot', text: 'Waiting for server...' });

    // Track pending status-reset timers for cleanup
    node._statusTimers = [];

    /**
     * Handle incoming Modbus request events from the server config node.
     * @param {object} request - The Modbus request payload.
     */
    function onModbusRequest(request) {
      // Apply function code filter
      if (node.filterFc !== 'all') {
        const filterFcNum = parseInt(node.filterFc, 10);
        if (Number.isFinite(filterFcNum) && request.fc !== filterFcNum) {
          return;
        }
      }

      // Apply unit ID filter
      if (node.filterUnitId !== 'all') {
        const filterUnitNum = parseInt(node.filterUnitId, 10);
        if (Number.isFinite(filterUnitNum) && request.unitId !== filterUnitNum) {
          return;
        }
      }

      const fcLabel = FC_LABEL_MAP[request.fc] || `FC ${request.fc}`;
      node.status({
        fill: 'blue',
        shape: 'dot',
        text: `${fcLabel} @ ${request.address}`
      });

      const msg = {
        topic: `modbus:server:${request.type}`,
        payload: {
          type: request.type,
          fc: request.fc,
          address: request.address,
          unitId: request.unitId,
          requestId: request.requestId
        }
      };

      // Add quantity for read requests, value for write requests
      if (request.quantity !== undefined) {
        msg.payload.quantity = request.quantity;
      }
      if (request.value !== undefined) {
        msg.payload.value = request.value;
      }

      node.send(msg);

      // Reset status after a short delay
      const timer = setTimeout(function () {
        node._statusTimers = node._statusTimers.filter(function (t) { return t !== timer; });
        if (node.server && node.server._started) {
          node.status({ fill: 'green', shape: 'dot', text: 'Listening' });
        }
      }, 200);
      node._statusTimers.push(timer);
    }

    /**
     * Handle server status change events.
     * @param {object} status - The status object { fill, shape, text }.
     */
    function onServerStatus(status) {
      node.status(status);
    }

    // Subscribe to server events
    node.server._requestEmitter.on('modbusRequest', onModbusRequest);
    node.server._requestEmitter.on('serverStatus', onServerStatus);

    // Trigger server start if not already started
    if (!node.server._started) {
      // Clear the deferred start and start immediately
      clearTimeout(node.server._startDeferred);
      node.server.startServer();
    } else {
      node.status({ fill: 'green', shape: 'dot', text: 'Listening' });
    }

    // Cleanup on close
    node.on('close', function (done) {
      // Clear any pending status-reset timers
      if (node._statusTimers) {
        node._statusTimers.forEach(clearTimeout);
        node._statusTimers = [];
      }
      if (node.server && node.server._requestEmitter) {
        node.server._requestEmitter.removeListener('modbusRequest', onModbusRequest);
        node.server._requestEmitter.removeListener('serverStatus', onServerStatus);
      }
      done();
    });
  }

  RED.nodes.registerType('modbus-in', ModbusIn);
};
