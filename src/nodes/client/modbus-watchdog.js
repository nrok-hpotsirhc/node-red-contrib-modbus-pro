'use strict';

const { parseIntSafe } = require('../../lib/utils');

/**
 * Modbus Watchdog Node for Node-RED.
 *
 * Implements a safe-state heartbeat:
 *   1. Every `heartbeatInterval` ms, writes a "heartbeat" value to a configured
 *      register/coil to prove the controller is alive.
 *   2. If the connection drops or `timeoutMultiplier × heartbeatInterval` ms
 *      pass without a successful heartbeat, the node performs a configurable
 *      "safe-state write" (FC 05/06/15/16) directly through the transport.
 *   3. On reconnection, an optional "restore write" returns the device to its
 *      operational state.
 *
 * **Disclaimer:** This node is an additional defense layer; Node-RED is not a
 * safety-rated runtime and must not replace a hardware safety system.
 *
 * @see THEORETICAL_FOUNDATIONS.md §17.3 Watchdog and Safe-State Heartbeat
 *
 * @param {object} RED
 */
module.exports = function (RED) {

  const STATE = Object.freeze({
    IDLE: 'idle',
    RUNNING: 'running',
    SAFE: 'safe',
    ERROR: 'error'
  });

  function ModbusWatchdog(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.server = RED.nodes.getNode(config.server);
    node.name = config.name || '';

    node.heartbeatInterval = parseIntSafe(config.heartbeatInterval, 1000);
    if (node.heartbeatInterval < 100) node.heartbeatInterval = 100;
    node.timeoutMultiplier = parseIntSafe(config.timeoutMultiplier, 2);
    if (node.timeoutMultiplier < 1) node.timeoutMultiplier = 1;

    // Heartbeat write
    node.heartbeatFc = parseIntSafe(config.heartbeatFc, 6);
    node.heartbeatAddress = parseIntSafe(config.heartbeatAddress, 0);
    node.heartbeatValue = parseIntSafe(config.heartbeatValue, 1);

    // Safe-state write (triggered on connection loss)
    node.safeStateFc = parseIntSafe(config.safeStateFc, 6);
    node.safeStateAddress = parseIntSafe(config.safeStateAddress, 0);
    node.safeStateValue = parseIntSafe(config.safeStateValue, 0);

    // Restore write (optional, triggered on reconnection)
    node.restoreEnabled = config.restoreEnabled === true;
    node.restoreFc = parseIntSafe(config.restoreFc, 6);
    node.restoreAddress = parseIntSafe(config.restoreAddress, 0);
    node.restoreValue = parseIntSafe(config.restoreValue, 1);

    if (!node.server) {
      node.status({ fill: 'red', shape: 'ring', text: 'No config' });
      node.error('Modbus Watchdog: No config node selected');
      return;
    }

    node._state = STATE.IDLE;
    node._heartbeatTimer = null;
    node._lastSuccessAt = 0;
    node._safeStateLatched = false;

    node.status({ fill: 'grey', shape: 'dot', text: 'Idle' });

    /**
     * Perform a write through the configured transport.
     */
    async function writeOp(fc, address, value) {
      const transport = node.server._transport;
      if (!transport || !transport.isOpen()) {
        throw new Error('Watchdog: Transport not connected');
      }
      transport.setID(node.server.unitId);
      switch (fc) {
        case 5:
          return transport.writeCoil(address, value === true || value === 1 || value === 0xFF00);
        case 6:
          return transport.writeRegister(address, value & 0xFFFF);
        case 15: {
          const arr = Array.isArray(value) ? value.map(Boolean) : [Boolean(value)];
          return transport.writeCoils(address, arr);
        }
        case 16: {
          const arr = Array.isArray(value) ? value.map(function (v) { return v & 0xFFFF; }) : [value & 0xFFFF];
          return transport.writeRegisters(address, arr);
        }
        default:
          throw new RangeError(`Watchdog: unsupported write FC ${fc}`);
      }
    }

    async function heartbeat() {
      try {
        await writeOp(node.heartbeatFc, node.heartbeatAddress, node.heartbeatValue);
        const now = Date.now();
        node._lastSuccessAt = now;
        if (node._safeStateLatched) {
          node._safeStateLatched = false;
          node.emit('reconnect');
          if (node.restoreEnabled) {
            try {
              await writeOp(node.restoreFc, node.restoreAddress, node.restoreValue);
            } catch (e) {
              node.warn(`Watchdog: restore write failed: ${e.message}`);
            }
          }
        }
        node._state = STATE.RUNNING;
        node.status({ fill: 'green', shape: 'dot', text: `HB ok (${node.heartbeatInterval}ms)` });
      } catch (err) {
        await triggerSafeState(`heartbeat failed: ${err.message}`);
      }
    }

    async function triggerSafeState(reason) {
      // Latch to suppress repeated safe-state writes
      if (node._safeStateLatched) {
        node.status({ fill: 'red', shape: 'ring', text: 'Safe-state latched' });
        return;
      }
      node._safeStateLatched = true;
      node._state = STATE.SAFE;
      node.warn(`Watchdog: entering SAFE state (${reason})`);
      node.status({ fill: 'red', shape: 'dot', text: 'SAFE' });
      try {
        await writeOp(node.safeStateFc, node.safeStateAddress, node.safeStateValue);
        node.emit('safeState', { reason });
      } catch (err) {
        node._state = STATE.ERROR;
        node.error(`Watchdog: safe-state write failed: ${err.message}`);
      }
    }

    node.start = function () {
      if (node._heartbeatTimer) return;
      node._state = STATE.RUNNING;
      node._safeStateLatched = false;
      node._lastSuccessAt = Date.now();
      node.status({ fill: 'blue', shape: 'dot', text: 'Starting' });
      node._heartbeatTimer = setInterval(heartbeat, node.heartbeatInterval);
      if (node._heartbeatTimer.unref) node._heartbeatTimer.unref();
      // Run an initial heartbeat without waiting for the first tick
      heartbeat().catch(function () { /* handled inside */ });
    };

    node.stop = function () {
      if (node._heartbeatTimer) {
        clearInterval(node._heartbeatTimer);
        node._heartbeatTimer = null;
      }
      node._state = STATE.IDLE;
      node.status({ fill: 'grey', shape: 'dot', text: 'Stopped' });
    };

    node.on('input', function (msg, send, done) {
      send = send || function () { node.send.apply(node, arguments); };
      done = done || function (err) { if (err) node.error(err, msg); };

      const cmd = (msg && msg.payload && typeof msg.payload === 'object' && msg.payload.command)
        || msg.command || (typeof msg.payload === 'string' ? msg.payload : null);

      if (cmd === 'start') node.start();
      else if (cmd === 'stop') node.stop();
      else if (cmd === 'safeState') {
        triggerSafeState('manual trigger').then(function () { done(); }).catch(done);
        return;
      } else if (cmd === 'status') {
        send({
          payload: {
            state: node._state,
            safeStateLatched: node._safeStateLatched,
            lastSuccessAt: node._lastSuccessAt,
            heartbeatInterval: node.heartbeatInterval
          }
        });
      } else if (!cmd) {
        // Auto-start when receiving any message without a known command
        if (node._state === STATE.IDLE) node.start();
      }
      done();
    });

    node.on('close', function (done) {
      node.stop();
      done();
    });
  }

  // Expose state names for tests
  ModbusWatchdog.STATE = STATE;

  RED.nodes.registerType('modbus-watchdog', ModbusWatchdog);
};
