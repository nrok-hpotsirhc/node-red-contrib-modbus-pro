'use strict';

const { buildConnectionString } = require('../../lib/parser/payload-builder');
const { parseException } = require('../../lib/parser/exception-parser');
const { parseIntSafe } = require('../../lib/utils');

/**
 * Modbus File Node for Node-RED.
 *
 * Provides access to the file/FIFO function codes:
 *   FC 20 – Read File Record
 *   FC 21 – Write File Record
 *   FC 24 – Read FIFO Queue
 *
 * @see THEORETICAL_FOUNDATIONS.md §12.8–§12.9
 *
 * @param {object} RED - Node-RED runtime API.
 */
module.exports = function (RED) {

  const MODE_FCS = {
    readFile: 20,
    writeFile: 21,
    readFifo: 24
  };

  const MODE_LABELS = {
    readFile: 'FC 20 Read File Record',
    writeFile: 'FC 21 Write File Record',
    readFifo: 'FC 24 Read FIFO Queue'
  };

  function ModbusFile(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.server = RED.nodes.getNode(config.server);
    node.name = config.name || '';
    node.mode = config.mode || 'readFile';
    node.fileNumber = parseIntSafe(config.fileNumber, 1);
    node.recordNumber = parseIntSafe(config.recordNumber, 0);
    node.recordLength = parseIntSafe(config.recordLength, 1);
    node.fifoAddress = parseIntSafe(config.fifoAddress, 0);
    node._busy = false;

    if (!node.server) {
      node.status({ fill: 'red', shape: 'ring', text: 'No config' });
      node.error('Modbus File: No config node selected');
      return;
    }
    if (!MODE_FCS[node.mode]) {
      node.status({ fill: 'red', shape: 'ring', text: 'Invalid mode' });
      node.error(`Modbus File: Invalid mode: ${node.mode}`);
      return;
    }

    node.status({ fill: 'grey', shape: 'dot', text: 'Ready' });

    /**
     * Resolve the operation parameters, allowing per-message overrides.
     * @returns {object}
     */
    function resolveParams(msg) {
      const params = {
        fileNumber: node.fileNumber,
        recordNumber: node.recordNumber,
        recordLength: node.recordLength,
        fifoAddress: node.fifoAddress,
        values: undefined
      };
      const p = (msg && msg.payload && typeof msg.payload === 'object') ? msg.payload : {};
      if (p.fileNumber !== undefined) params.fileNumber = parseIntSafe(p.fileNumber, params.fileNumber);
      if (p.recordNumber !== undefined) params.recordNumber = parseIntSafe(p.recordNumber, params.recordNumber);
      if (p.recordLength !== undefined) params.recordLength = parseIntSafe(p.recordLength, params.recordLength);
      if (p.fifoAddress !== undefined) params.fifoAddress = parseIntSafe(p.fifoAddress, params.fifoAddress);
      if (Array.isArray(p.values)) params.values = p.values;
      return params;
    }

    async function execute(msg) {
      const transport = typeof node.server.getConnectedTransport === 'function'
        ? await node.server.getConnectedTransport()
        : node.server._transport;
      if (!transport || !transport.isOpen()) {
        node.status({ fill: 'red', shape: 'ring', text: 'Not connected' });
        throw new Error('Modbus File: Transport not connected');
      }
      transport.setID(node.server.unitId);

      const params = resolveParams(msg);
      const baseMeta = {
        unitId: node.server.unitId,
        connection: buildConnectionString(node.server.getTransportConfig()),
        timestamp: new Date().toISOString(),
        fc: MODE_FCS[node.mode],
        mode: node.mode
      };

      if (node.mode === 'readFile') {
        const sub = [{
          fileNumber: params.fileNumber,
          recordNumber: params.recordNumber,
          recordLength: params.recordLength
        }];
        const r = await transport.readFileRecord(sub);
        return {
          payload: {
            ...baseMeta,
            fileNumber: params.fileNumber,
            recordNumber: params.recordNumber,
            recordLength: params.recordLength,
            records: r.records,
            buffer: r.buffer || null
          },
          label: `OK: ${r.records.length} record(s)`
        };
      }

      if (node.mode === 'writeFile') {
        if (!Array.isArray(params.values) || params.values.length === 0) {
          throw new RangeError('Modbus File (writeFile): msg.payload.values must be a non-empty array of register values');
        }
        const sub = [{
          fileNumber: params.fileNumber,
          recordNumber: params.recordNumber,
          values: params.values
        }];
        await transport.writeFileRecord(sub);
        return {
          payload: {
            ...baseMeta,
            fileNumber: params.fileNumber,
            recordNumber: params.recordNumber,
            valuesWritten: params.values.length
          },
          label: `OK: wrote ${params.values.length} regs`
        };
      }

      // readFifo
      const r = await transport.readFifoQueue(params.fifoAddress);
      return {
        payload: {
          ...baseMeta,
          fifoAddress: params.fifoAddress,
          count: r.count,
          values: r.values,
          buffer: r.buffer || null
        },
        label: `OK: ${r.count} entries`
      };
    }

    node.on('input', function (msg, send, done) {
      send = send || function () { node.send.apply(node, arguments); };
      done = done || function (err) { if (err) node.error(err, msg); };

      if (node._busy) {
        done(new Error('Modbus File: Operation already in progress'));
        return;
      }
      node._busy = true;
      node.status({ fill: 'blue', shape: 'dot', text: MODE_LABELS[node.mode] });

      execute(msg).then(function (result) {
        node.status({ fill: 'green', shape: 'dot', text: result.label });
        send({
          topic: msg.topic || ('modbus:' + node.mode),
          payload: result.payload,
          modbusFile: { mode: node.mode, fc: MODE_FCS[node.mode], unitId: node.server.unitId }
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

  RED.nodes.registerType('modbus-file', ModbusFile);
};
