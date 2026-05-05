'use strict';

const { parseIntSafe } = require('../../lib/utils');

/**
 * Modbus Report-by-Exception (RBE) Node for Node-RED.
 *
 * Suppresses unchanged values from a cyclic Modbus read flow. Forwards a
 * downstream message only if at least one register/coil exceeds the
 * configured dead-band threshold relative to its last reported value.
 *
 * Filtering modes:
 *   - 'absolute'   : |v_new - v_last| > deadband
 *   - 'percentage' : |v_new - v_last| / |v_last| > deadband (deadband in %)
 *   - 'boolean'    : forward on any state change (auto-applied to coil reads)
 *
 * The node operates on the standard `msg.payload` shape produced by
 * `modbus-read`:
 *   { fc, address, quantity, data: [...] }
 * where `data` is an array of numbers (registers) or booleans (coils).
 *
 * Output: original `msg.payload` plus `msg.changed`, an array of absolute
 * Modbus addresses that triggered the report.
 *
 * @see THEORETICAL_FOUNDATIONS.md §17.1 RBE and Dead-Band Filtering
 *
 * @param {object} RED
 */
module.exports = function (RED) {

  /**
   * Apply the configured dead-band test to a single value pair.
   * @param {object} state - { lastValue, lastReportedAt, mode, deadband }
   * @param {number|boolean} newValue
   * @param {number} now
   * @param {number} inhibitMs
   * @returns {boolean} true if the value should be reported
   */
  function shouldReport(state, newValue, now, inhibitMs) {
    if (state.lastValue === undefined) {
      return true;
    }
    if (inhibitMs > 0 && state.lastReportedAt &&
        (now - state.lastReportedAt) < inhibitMs) {
      return false;
    }
    if (state.mode === 'boolean' || typeof newValue === 'boolean') {
      return newValue !== state.lastValue;
    }
    const delta = Math.abs(Number(newValue) - Number(state.lastValue));
    if (state.mode === 'percentage') {
      const ref = Math.abs(Number(state.lastValue));
      if (ref === 0) {
        // Always report transitions away from zero
        return delta > 0;
      }
      return (delta / ref) * 100 > state.deadband;
    }
    // Absolute mode (default)
    return delta > state.deadband;
  }

  function ModbusRbe(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.name = config.name || '';
    node.mode = config.mode === 'percentage' ? 'percentage'
      : config.mode === 'boolean' ? 'boolean'
        : 'absolute';
    node.deadband = Number(config.deadband);
    if (!Number.isFinite(node.deadband) || node.deadband < 0) {
      node.deadband = 0;
    }
    node.inhibitMs = parseIntSafe(config.inhibitMs, 0);
    if (node.inhibitMs < 0) node.inhibitMs = 0;
    node.passThroughInitial = config.passThroughInitial !== false; // default true

    /**
     * Per-address state:
     *   Map<addressKey, { lastValue, lastReportedAt, mode, deadband }>
     * Address key is the absolute Modbus address as a string.
     */
    node._state = new Map();

    node.status({ fill: 'grey', shape: 'dot', text: 'Ready' });

    /**
     * Reset internal state.
     */
    node.resetState = function () {
      node._state.clear();
    };

    node.on('input', function (msg, send, done) {
      send = send || function () { node.send.apply(node, arguments); };
      done = done || function (err) { if (err) node.error(err, msg); };

      // External reset signal
      if (msg && msg.reset === true) {
        node.resetState();
        node.status({ fill: 'grey', shape: 'dot', text: 'Reset' });
        done();
        return;
      }

      const payload = msg && msg.payload;
      if (!payload || !Array.isArray(payload.data)) {
        // No data array – pass through unchanged
        send(msg);
        done();
        return;
      }

      const baseAddress = (typeof payload.address === 'number') ? payload.address : 0;
      const data = payload.data;
      const now = Date.now();
      const fc = payload.fc;
      const isCoilFC = fc === 1 || fc === 2 || fc === 5 || fc === 15;
      const effectiveMode = isCoilFC ? 'boolean' : node.mode;

      const changed = [];
      for (let i = 0; i < data.length; i++) {
        const addr = baseAddress + i;
        const key = String(addr);
        let state = node._state.get(key);
        if (!state) {
          state = {
            lastValue: undefined,
            lastReportedAt: 0,
            mode: effectiveMode,
            deadband: node.deadband
          };
          node._state.set(key, state);
        }
        if (shouldReport(state, data[i], now, node.inhibitMs)) {
          state.lastValue = data[i];
          state.lastReportedAt = now;
          changed.push(addr);
        }
      }

      const isFirstReport = changed.length === data.length &&
        Array.from(node._state.values()).every(function (s) {
          return s.lastReportedAt === now;
        });

      if (changed.length === 0) {
        node.status({ fill: 'grey', shape: 'dot', text: 'No change' });
        done();
        return;
      }

      // Suppress the very first report unless explicitly enabled
      if (isFirstReport && !node.passThroughInitial) {
        node.status({ fill: 'grey', shape: 'dot', text: 'Initial baseline' });
        done();
        return;
      }

      msg.changed = changed;
      msg.rbe = {
        mode: effectiveMode,
        deadband: node.deadband,
        changedCount: changed.length,
        totalCount: data.length
      };
      node.status({ fill: 'green', shape: 'dot', text: `Δ ${changed.length}/${data.length}` });
      send(msg);
      done();
    });

    node.on('close', function (done) {
      node.resetState();
      done();
    });
  }

  RED.nodes.registerType('modbus-rbe', ModbusRbe);
};
