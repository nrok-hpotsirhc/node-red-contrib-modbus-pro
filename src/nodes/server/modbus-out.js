'use strict';

/**
 * Modbus-Out Node for Node-RED.
 *
 * Collects response data from the flow and sends it back to the waiting
 * external Modbus client via the Server Config node.
 *
 * This node is the exit point for the Dynamic Server Proxy pattern:
 *   Flow → Modbus-Out → Server Config → TCP Response → External Client
 *
 * The incoming msg.payload must contain the requestId from the original
 * Modbus-In message and the data to send back.
 *
 * @param {object} RED - Node-RED runtime API.
 */
module.exports = function (RED) {

  function ModbusOut(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Retrieve the server config node
    node.server = RED.nodes.getNode(config.server);

    // Configuration
    node.name = config.name || '';

    // Validate server config reference
    if (!node.server) {
      node.status({ fill: 'red', shape: 'ring', text: 'No server config' });
      node.error('Modbus Out: No server config node selected');
      return;
    }

    node.status({ fill: 'grey', shape: 'dot', text: 'Ready' });

    // Track pending status-reset timers for cleanup
    node._statusTimers = [];

    /**
     * Schedule a status reset and track the timer for cleanup.
     * @private
     */
    function scheduleStatusReset() {
      const timer = setTimeout(function () {
        node._statusTimers = node._statusTimers.filter(function (t) { return t !== timer; });
        node._lastStatus = 'idle';
        node.status({ fill: 'green', shape: 'dot', text: 'Ready' });
      }, 200);
      node._statusTimers.push(timer);
    }

    /**
     * Handle server status change events.
     * @param {object} status - The status object { fill, shape, text }.
     */
    function onServerStatus(status) {
      // Only update if we're in the default state
      if (node._lastStatus !== 'active') {
        node.status(status);
      }
    }
    node._lastStatus = 'idle';

    if (node.server._requestEmitter) {
      node.server._requestEmitter.on('serverStatus', onServerStatus);
    }

    // Handle incoming messages from the flow
    node.on('input', function (msg, send, done) {
      // Node-RED >= 1.0 provides send/done callbacks
      send = send || function () { node.send.apply(node, arguments); };
      done = done || function (err) { if (err) node.error(err, msg); };

      const payload = msg.payload;

      // Validate payload
      if (!payload || typeof payload !== 'object') {
        node.status({ fill: 'red', shape: 'ring', text: 'Invalid payload' });
        scheduleStatusReset();
        done(new Error('Modbus Out: msg.payload must be an object with requestId and data'));
        return;
      }

      const requestId = payload.requestId;
      if (!requestId || typeof requestId !== 'string') {
        node.status({ fill: 'red', shape: 'ring', text: 'Missing requestId' });
        scheduleStatusReset();
        done(new Error('Modbus Out: msg.payload.requestId is required (from modbus-in)'));
        return;
      }

      // Check for error response
      if (payload.error) {
        const err = {
          message: payload.error.message || 'Flow error',
          modbusErrorCode: payload.error.modbusErrorCode || 0x04
        };

        const rejected = node.server.rejectRequest(requestId, err);
        if (rejected) {
          node.status({ fill: 'yellow', shape: 'dot', text: `Error response: ${requestId.substring(0, 8)}` });
          node._lastStatus = 'active';
        } else {
          node.status({ fill: 'red', shape: 'ring', text: 'Request expired' });
          node.warn(`Modbus Out: Request ${requestId} not found (timeout or already resolved)`);
        }

        scheduleStatusReset();

        done();
        return;
      }

      // Validate data field
      const data = payload.data;
      if (data === undefined || data === null) {
        node.status({ fill: 'red', shape: 'ring', text: 'Missing data' });
        scheduleStatusReset();
        done(new Error('Modbus Out: msg.payload.data is required'));
        return;
      }

      // Resolve the pending request with the response data
      const resolved = node.server.resolveRequest(requestId, data);

      if (resolved) {
        node.status({
          fill: 'green',
          shape: 'dot',
          text: `OK: ${requestId.substring(0, 8)}...`
        });
        node._lastStatus = 'active';
      } else {
        node.status({ fill: 'red', shape: 'ring', text: 'Request expired' });
        node.warn(`Modbus Out: Request ${requestId} not found (timeout or already resolved)`);
      }

      // Reset status after a short delay
      scheduleStatusReset();

      // Forward the message for chaining
      send(msg);
      done();
    });

    // Cleanup on close
    node.on('close', function (done) {
      // Clear any pending status-reset timers
      if (node._statusTimers) {
        node._statusTimers.forEach(clearTimeout);
        node._statusTimers = [];
      }
      if (node.server && node.server._requestEmitter) {
        node.server._requestEmitter.removeListener('serverStatus', onServerStatus);
      }
      done();
    });
  }

  RED.nodes.registerType('modbus-out', ModbusOut);
};
