'use strict';

const { buildReadPayload, buildConnectionString } = require('../../lib/parser/payload-builder');
const { parseException } = require('../../lib/parser/exception-parser');
const { parseIntSafe } = require('../../lib/utils');

/**
 * Modbus Scanner Node for Node-RED.
 *
 * Replaces a constellation of cyclic `modbus-read` nodes with a single
 * scheduled scanner that maintains a configurable list of read groups,
 * each with its own polling interval. Requests are serialized through
 * the existing transport, preserving the connection pool / RTU semaphore
 * arbitration.
 *
 * Scan group format (config.groups: array):
 *   [
 *     { id: 'fast',  intervalMs: 100,  fc: 3, address: 100, quantity: 10, unitId: 1 },
 *     { id: 'slow',  intervalMs: 5000, fc: 4, address: 500, quantity: 50 }
 *   ]
 *
 * Output: one message per group per cycle, with the same shape as `modbus-read`.
 *
 * @see THEORETICAL_FOUNDATIONS.md §17.2 Multi-Rate Scan Scheduling
 *
 * @param {object} RED
 */
module.exports = function (RED) {

  const VALID_FCS = [1, 2, 3, 4];

  function ModbusScanner(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.server = RED.nodes.getNode(config.server);
    node.name = config.name || '';
    node.autoStart = config.autoStart !== false; // default true

    // Parse and validate scan groups
    let groups;
    try {
      groups = parseGroups(config.groups);
    } catch (err) {
      node.status({ fill: 'red', shape: 'ring', text: 'Invalid groups' });
      node.error(`Modbus Scanner: ${err.message}`);
      return;
    }

    node._groups = groups;
    node._timers = new Map(); // groupId → timer
    node._inFlight = new Map(); // groupId → boolean
    node._stats = { cycles: 0, errors: 0 };

    if (!node.server) {
      node.status({ fill: 'red', shape: 'ring', text: 'No config' });
      node.error('Modbus Scanner: No config node selected');
      return;
    }

    node.status({ fill: 'grey', shape: 'dot', text: 'Idle' });

    /**
     * Execute one scan for the given group.
     */
    async function scanGroup(group) {
      if (node._inFlight.get(group.id)) {
        // Skip overlapping cycles to avoid backpressure
        return;
      }
      node._inFlight.set(group.id, true);
      try {
        const transport = node.server._transport;
        if (!transport || !transport.isOpen()) {
          throw new Error('Transport not connected');
        }
        const unitId = group.unitId || node.server.unitId;
        transport.setID(unitId);

        let result;
        switch (group.fc) {
          case 1: result = await transport.readCoils(group.address, group.quantity); break;
          case 2: result = await transport.readDiscreteInputs(group.address, group.quantity); break;
          case 3: result = await transport.readHoldingRegisters(group.address, group.quantity); break;
          case 4: result = await transport.readInputRegisters(group.address, group.quantity); break;
          // istanbul ignore next: validated at construction
          default: throw new RangeError(`Invalid FC ${group.fc}`);
        }

        node._stats.cycles++;
        const payload = buildReadPayload({
          fc: group.fc,
          address: group.address,
          quantity: group.quantity,
          unitId,
          data: result.data,
          buffer: result.buffer,
          connection: buildConnectionString(node.server.getTransportConfig())
        });

        node.send({
          topic: `scan/${group.id}`,
          payload,
          modbusScanner: { groupId: group.id, intervalMs: group.intervalMs, cycle: node._stats.cycles }
        });
        node.status({ fill: 'green', shape: 'dot', text: `${group.id}: ${result.data.length} regs` });
      } catch (err) {
        node._stats.errors++;
        const ex = parseException(err, { fc: group.fc, unitId: group.unitId, address: group.address });
        node.warn(`Scanner group "${group.id}" error: ${ex.message}`);
        node.status({ fill: 'red', shape: 'ring', text: `${group.id}: error` });
      } finally {
        node._inFlight.set(group.id, false);
      }
    }

    /**
     * Start polling all configured groups.
     */
    node.start = function () {
      if (node._timers.size > 0) return;
      node._groups.forEach(function (g) {
        const t = setInterval(function () { scanGroup(g); }, g.intervalMs);
        if (t.unref) t.unref();
        node._timers.set(g.id, t);
        // Run an immediate first scan so the flow gets data before the first interval.
        setImmediate(function () { scanGroup(g); });
      });
      node.status({ fill: 'blue', shape: 'dot', text: `Scanning ${node._groups.length} groups` });
    };

    /**
     * Stop polling.
     */
    node.stop = function () {
      node._timers.forEach(function (t) { clearInterval(t); });
      node._timers.clear();
      node.status({ fill: 'grey', shape: 'dot', text: 'Stopped' });
    };

    /**
     * Trigger a one-shot scan of the given group (or all groups when no id).
     */
    node.triggerOnce = function (groupId) {
      if (groupId) {
        const g = node._groups.find(function (x) { return x.id === groupId; });
        if (g) scanGroup(g);
      } else {
        node._groups.forEach(scanGroup);
      }
    };

    node.on('input', function (msg, send, done) {
      send = send || function () { node.send.apply(node, arguments); };
      done = done || function (err) { if (err) node.error(err, msg); };

      const cmd = (msg && msg.payload && typeof msg.payload === 'object' && msg.payload.command)
        || msg.command || (typeof msg.payload === 'string' ? msg.payload : null);

      if (cmd === 'start') node.start();
      else if (cmd === 'stop') node.stop();
      else if (cmd === 'trigger') node.triggerOnce(msg.groupId || (msg.payload && msg.payload.groupId));
      else if (cmd === 'stats') {
        send({ payload: { ...node._stats, groups: node._groups.map(function (g) { return g.id; }) } });
      }
      done();
    });

    node.on('close', function (done) {
      node.stop();
      done();
    });

    if (node.autoStart) {
      // Delay start until next tick so the flow finishes wiring up
      setImmediate(function () { node.start(); });
    }
  }

  /**
   * Validate and normalise the configured group list.
   * @param {*} raw
   * @returns {Array<{id, intervalMs, fc, address, quantity, unitId|undefined}>}
   */
  function parseGroups(raw) {
    let list = raw;
    if (typeof list === 'string') {
      try {
        list = JSON.parse(list);
      } catch (e) {
        throw new Error('groups must be valid JSON');
      }
    }
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error('At least one scan group must be configured');
    }
    const seen = new Set();
    return list.map(function (g, i) {
      const id = g.id || `g${i}`;
      if (seen.has(id)) {
        throw new Error(`Duplicate group id: ${id}`);
      }
      seen.add(id);
      const intervalMs = parseIntSafe(g.intervalMs, 1000);
      if (intervalMs < 50) throw new Error(`Group "${id}" intervalMs must be ≥ 50ms`);
      const fc = parseIntSafe(g.fc, 3);
      if (VALID_FCS.indexOf(fc) === -1) throw new Error(`Group "${id}" fc must be 1, 2, 3 or 4`);
      const address = parseIntSafe(g.address, 0);
      if (address < 0 || address > 0xFFFF) throw new Error(`Group "${id}" address out of range`);
      const quantity = parseIntSafe(g.quantity, 1);
      if (quantity < 1 || quantity > 2000) throw new Error(`Group "${id}" quantity out of range`);
      const unitId = (g.unitId !== undefined && g.unitId !== null && g.unitId !== '')
        ? parseIntSafe(g.unitId, 1) : undefined;
      return { id, intervalMs, fc, address, quantity, unitId };
    });
  }

  ModbusScanner._parseGroups = parseGroups;
  RED.nodes.registerType('modbus-scanner', ModbusScanner);
};
