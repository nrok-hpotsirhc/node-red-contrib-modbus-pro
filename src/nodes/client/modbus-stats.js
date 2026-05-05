'use strict';

const { parseIntSafe } = require('../../lib/utils');

/**
 * Modbus Stats Node for Node-RED.
 *
 * Aggregates runtime metrics across the Modbus client transport:
 *   - request count (total / per-FC)
 *   - error count   (total / per-FC, exception vs. transport)
 *   - latency       (last, avg, p95, p99) in milliseconds
 *   - exception code histogram
 *
 * Two modes:
 *   - 'periodic': emits a snapshot every `intervalMs` (default 5000)
 *   - 'onDemand': emits only when triggered with `msg.payload === "snapshot"`
 *
 * Wraps the transport's read/write methods in non-invasive proxies so existing
 * `modbus-read` / `modbus-write` flows are observed without modification.
 *
 * @see THEORETICAL_FOUNDATIONS.md §17.4 Runtime Metrics and Latency Histograms
 *
 * @param {object} RED
 */
module.exports = function (RED) {

  const TRACKED_METHODS = [
    { name: 'readCoils', fc: 1 },
    { name: 'readDiscreteInputs', fc: 2 },
    { name: 'readHoldingRegisters', fc: 3 },
    { name: 'readInputRegisters', fc: 4 },
    { name: 'writeCoil', fc: 5 },
    { name: 'writeRegister', fc: 6 },
    { name: 'writeCoils', fc: 15 },
    { name: 'writeRegisters', fc: 16 },
    { name: 'maskWriteRegister', fc: 22 },
    { name: 'readWriteRegisters', fc: 23 }
  ];

  /**
   * Maintain a fixed-size ring buffer of the most recent latencies and provide
   * O(n log n) percentile queries.
   */
  class LatencyBuffer {
    constructor(capacity) {
      this.capacity = capacity;
      this.buf = [];
      this.idx = 0;
    }
    add(value) {
      if (this.buf.length < this.capacity) {
        this.buf.push(value);
      } else {
        this.buf[this.idx] = value;
      }
      this.idx = (this.idx + 1) % this.capacity;
    }
    snapshot() {
      const sorted = [...this.buf].sort(function (a, b) { return a - b; });
      const n = sorted.length;
      if (n === 0) {
        return { count: 0, last: 0, min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
      }
      const sum = sorted.reduce(function (a, b) { return a + b; }, 0);
      const idxAt = function (p) {
        return sorted[Math.min(n - 1, Math.floor(p * n))];
      };
      return {
        count: n,
        last: this.buf.length > 0 ? this.buf[(this.idx - 1 + this.capacity) % this.capacity] || this.buf[this.buf.length - 1] : 0,
        min: sorted[0],
        max: sorted[n - 1],
        avg: sum / n,
        p50: idxAt(0.50),
        p95: idxAt(0.95),
        p99: idxAt(0.99)
      };
    }
    reset() {
      this.buf = [];
      this.idx = 0;
    }
  }

  function ModbusStats(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.server = RED.nodes.getNode(config.server);
    node.name = config.name || '';
    node.mode = config.mode === 'onDemand' ? 'onDemand' : 'periodic';
    node.intervalMs = parseIntSafe(config.intervalMs, 5000);
    if (node.intervalMs < 500) node.intervalMs = 500;
    node.bufferSize = parseIntSafe(config.bufferSize, 1000);
    if (node.bufferSize < 10) node.bufferSize = 10;

    if (!node.server) {
      node.status({ fill: 'red', shape: 'ring', text: 'No config' });
      node.error('Modbus Stats: No config node selected');
      return;
    }

    node._stats = createInitialStats();
    node._latency = new LatencyBuffer(node.bufferSize);
    node._unhooks = [];
    node._timer = null;

    /**
     * Wrap the transport methods. When the transport changes (e.g. on reconnect)
     * we re-hook automatically.
     */
    function hookTransport() {
      unhookTransport();
      const t = node.server._transport;
      if (!t) return;
      TRACKED_METHODS.forEach(function (entry) {
        if (typeof t[entry.name] !== 'function') return;
        const original = t[entry.name].bind(t);
        t[entry.name] = function () {
          const start = process.hrtime.bigint();
          const fc = entry.fc;
          node._stats.requests.total++;
          node._stats.requests.byFc[fc] = (node._stats.requests.byFc[fc] || 0) + 1;
          const promise = original.apply(t, arguments);
          return Promise.resolve(promise).then(function (result) {
            const ms = Number(process.hrtime.bigint() - start) / 1e6;
            node._latency.add(ms);
            return result;
          }).catch(function (err) {
            const ms = Number(process.hrtime.bigint() - start) / 1e6;
            node._latency.add(ms);
            node._stats.errors.total++;
            node._stats.errors.byFc[fc] = (node._stats.errors.byFc[fc] || 0) + 1;
            const code = (err && err.modbusCode) || (err && err.err && err.err.modbusCode);
            if (typeof code === 'number') {
              node._stats.exceptions[code] = (node._stats.exceptions[code] || 0) + 1;
            }
            throw err;
          });
        };
        node._unhooks.push(function () {
          // Restore only if we are still the active wrapper
          if (t[entry.name] !== original) {
            t[entry.name] = original;
          }
        });
      });
    }

    function unhookTransport() {
      node._unhooks.forEach(function (fn) {
        try { fn(); } catch (e) { /* ignore */ }
      });
      node._unhooks = [];
    }

    function createInitialStats() {
      return {
        startedAt: Date.now(),
        requests: { total: 0, byFc: {} },
        errors: { total: 0, byFc: {} },
        exceptions: {} // code → count
      };
    }

    /**
     * Build a serializable snapshot.
     */
    function snapshot() {
      return {
        timestamp: new Date().toISOString(),
        uptimeMs: Date.now() - node._stats.startedAt,
        requests: { ...node._stats.requests, byFc: { ...node._stats.requests.byFc } },
        errors: { ...node._stats.errors, byFc: { ...node._stats.errors.byFc } },
        exceptions: { ...node._stats.exceptions },
        latencyMs: node._latency.snapshot(),
        unitId: node.server.unitId
      };
    }

    node.snapshot = snapshot;
    node._hookTransport = hookTransport;
    node._unhookTransport = unhookTransport;

    node.reset = function () {
      node._stats = createInitialStats();
      node._latency.reset();
      node.status({ fill: 'grey', shape: 'dot', text: 'Reset' });
    };

    function emitSnapshot() {
      const s = snapshot();
      node.send({ topic: 'modbus/stats', payload: s });
      node.status({ fill: 'green', shape: 'dot',
        text: `req=${s.requests.total} err=${s.errors.total} avg=${s.latencyMs.avg.toFixed(1)}ms` });
    }

    node.on('input', function (msg, send, done) {
      send = send || function () { node.send.apply(node, arguments); };
      done = done || function (err) { if (err) node.error(err, msg); };

      const cmd = (msg && msg.payload && typeof msg.payload === 'object' && msg.payload.command)
        || msg.command || (typeof msg.payload === 'string' ? msg.payload : null);

      if (cmd === 'reset') node.reset();
      else if (cmd === 'snapshot' || cmd === 'get') {
        send({ topic: 'modbus/stats', payload: snapshot() });
      } else if (cmd === 'rehook') hookTransport();
      done();
    });

    node.on('close', function (done) {
      unhookTransport();
      if (node._timer) clearInterval(node._timer);
      node._timer = null;
      done();
    });

    // Hook on a small delay to let the config node initialize the transport first
    setImmediate(function () {
      hookTransport();
      // Re-hook periodically in case the transport was rebuilt (reconnect)
      const rehookTimer = setInterval(function () {
        if (node.server._transport && node._unhooks.length === 0) {
          hookTransport();
        }
      }, 5000);
      if (rehookTimer.unref) rehookTimer.unref();
      node._unhooks.push(function () { clearInterval(rehookTimer); });
    });

    if (node.mode === 'periodic') {
      node._timer = setInterval(emitSnapshot, node.intervalMs);
      if (node._timer.unref) node._timer.unref();
    }

    node.status({ fill: 'blue', shape: 'dot', text: `Tracking (${node.mode})` });
  }

  RED.nodes.registerType('modbus-stats', ModbusStats);
};
