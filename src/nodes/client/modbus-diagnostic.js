'use strict';

const { buildConnectionString } = require('../../lib/parser/payload-builder');
const { parseException } = require('../../lib/parser/exception-parser');
const { parseIntSafe } = require('../../lib/utils');

/**
 * Modbus Diagnostic Node for Node-RED.
 *
 * Provides access to the serial-line diagnostic and identification function
 * codes that are not covered by the regular read/write nodes:
 *
 *   FC 07 – Read Exception Status (mode: "exceptionStatus")
 *   FC 08 – Diagnostics, multiplexed via 16-bit sub-functions (mode: "diagnostics")
 *   FC 11 – Get Comm Event Counter (mode: "eventCounter")
 *   FC 12 – Get Comm Event Log (mode: "eventLog")
 *   FC 17 – Report Server ID (mode: "reportServerId")
 *
 * @see THEORETICAL_FOUNDATIONS.md §12.4–§12.7
 *
 * @param {object} RED - Node-RED runtime API.
 */
module.exports = function (RED) {

  /**
   * Mapping of mode name → function code label for human-readable output.
   * @readonly
   */
  const MODE_LABELS = {
    exceptionStatus: 'FC 07 Read Exception Status',
    diagnostics: 'FC 08 Diagnostics',
    eventCounter: 'FC 11 Comm Event Counter',
    eventLog: 'FC 12 Comm Event Log',
    reportServerId: 'FC 17 Report Server ID'
  };

  /**
   * Mapping of mode name → numeric function code for payload metadata.
   * @readonly
   */
  const MODE_FCS = {
    exceptionStatus: 7,
    diagnostics: 8,
    eventCounter: 11,
    eventLog: 12,
    reportServerId: 17
  };

  function ModbusDiagnostic(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.server = RED.nodes.getNode(config.server);
    node.name = config.name || '';
    node.mode = config.mode || 'exceptionStatus';
    node.subFunction = parseIntSafe(config.subFunction, 0);
    node.dataField = parseIntSafe(config.dataField, 0);
    node._busy = false;

    if (!node.server) {
      node.status({ fill: 'red', shape: 'ring', text: 'No config' });
      node.error('Modbus Diagnostic: No config node selected');
      return;
    }
    if (!MODE_LABELS[node.mode]) {
      node.status({ fill: 'red', shape: 'ring', text: 'Invalid mode' });
      node.error(`Modbus Diagnostic: Invalid mode: ${node.mode}`);
      return;
    }

    node.status({ fill: 'grey', shape: 'dot', text: 'Ready' });

    /**
     * Run the configured diagnostic operation.
     * @returns {Promise<{ payload: object, label: string }>}
     */
    async function execute(msg) {
      const transport = typeof node.server.getConnectedTransport === 'function'
        ? await node.server.getConnectedTransport()
        : node.server._transport;
      if (!transport || !transport.isOpen()) {
        node.status({ fill: 'red', shape: 'ring', text: 'Not connected' });
        throw new Error('Modbus Diagnostic: Transport not connected');
      }
      transport.setID(node.server.unitId);

      const connectionStr = buildConnectionString(node.server.getTransportConfig());
      const baseMeta = {
        unitId: node.server.unitId,
        connection: connectionStr,
        timestamp: new Date().toISOString(),
        fc: MODE_FCS[node.mode],
        mode: node.mode
      };

      let payload;
      switch (node.mode) {
        case 'exceptionStatus': {
          const r = await transport.readExceptionStatus();
          payload = {
            ...baseMeta,
            statusByte: r.statusByte,
            bits: r.bits,
            buffer: r.buffer || null
          };
          break;
        }
        case 'diagnostics': {
          const sub = (msg.subFunction !== undefined)
            ? parseIntSafe(msg.subFunction, node.subFunction)
            : node.subFunction;
          const data = (msg.dataField !== undefined)
            ? parseIntSafe(msg.dataField, node.dataField)
            : node.dataField;
          const r = await transport.diagnostics(sub, data);
          payload = {
            ...baseMeta,
            subFunction: r.subFunction,
            data: r.data,
            buffer: r.buffer || null
          };
          break;
        }
        case 'eventCounter': {
          const r = await transport.getCommEventCounter();
          payload = { ...baseMeta, status: r.status, eventCount: r.eventCount, buffer: r.buffer || null };
          break;
        }
        case 'eventLog': {
          const r = await transport.getCommEventLog();
          payload = {
            ...baseMeta,
            status: r.status,
            eventCount: r.eventCount,
            messageCount: r.messageCount,
            events: r.events,
            buffer: r.buffer || null
          };
          break;
        }
        case 'reportServerId': {
          const r = await transport.reportServerID();
          payload = {
            ...baseMeta,
            serverId: r.serverId,
            running: r.running,
            additionalData: r.additionalData,
            buffer: r.buffer || null
          };
          break;
        }
        // istanbul ignore next: guarded by validation above
        default:
          throw new Error('Modbus Diagnostic: Invalid mode: ' + node.mode);
      }

      return { payload, label: MODE_LABELS[node.mode] };
    }

    node.on('input', function (msg, send, done) {
      send = send || function () { node.send.apply(node, arguments); };
      done = done || function (err) { if (err) node.error(err, msg); };

      if (node._busy) {
        done(new Error('Modbus Diagnostic: Operation already in progress'));
        return;
      }
      node._busy = true;
      node.status({ fill: 'blue', shape: 'dot', text: MODE_LABELS[node.mode] });

      execute(msg).then(function (result) {
        node.status({ fill: 'green', shape: 'dot', text: 'OK: ' + result.label });
        send({
          topic: msg.topic || ('modbus:' + node.mode),
          payload: result.payload,
          modbusDiagnostic: { mode: node.mode, fc: MODE_FCS[node.mode], unitId: node.server.unitId }
        });
        done();
      }).catch(function (err) {
        const ex = parseException(err, { fc: MODE_FCS[node.mode], unitId: node.server.unitId });
        const label = ex.isException ? ex.name : err.message;
        node.status({ fill: 'red', shape: 'ring', text: 'Error: ' + label });
        msg.payload = { exception: ex };
        done(err);
      }).then(function () {
        node._busy = false;
      });
    });

    node.on('close', function (done) {
      node._busy = false;
      done();
    });
  }

  RED.nodes.registerType('modbus-diagnostic', ModbusDiagnostic);
};
