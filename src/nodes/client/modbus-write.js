'use strict';

const { buildWritePayload, buildReadWritePayload, buildConnectionString } = require('../../lib/parser/payload-builder');
const { parseIntSafe } = require('../../lib/utils');

/**
 * Modbus Write Node for Node-RED.
 *
 * Writes data to a Modbus device using one of the supported write function codes:
 *   FC 05 – Write Single Coil
 *   FC 06 – Write Single Register
 *   FC 15 – Write Multiple Coils
 *   FC 16 – Write Multiple Registers
 *   FC 22 – Mask Write Register
 *   FC 23 – Read/Write Multiple Registers
 *
 * Supports:
 *   - Trigger-based write (msg.payload carries the value(s))
 *   - Zero-based and one-based address offset
 *   - Backpressure queue with configurable limit and drop strategy
 *   - Standardized payload output with metadata
 *
 * @param {object} RED - Node-RED runtime API.
 */
module.exports = function (RED) {
  const BackpressureQueue = require('../../lib/queue/backpressure-queue');

  /**
   * Map function code numbers to transport method names.
   * @readonly
   */
  const FC_METHOD_MAP = {
    5: 'writeCoil',
    6: 'writeRegister',
    15: 'writeCoils',
    16: 'writeRegisters',
    22: 'maskWriteRegister',
    23: 'readWriteRegisters'
  };

  /**
   * Map function code numbers to human-readable labels.
   * @readonly
   */
  const FC_LABEL_MAP = {
    5: 'Single Coil',
    6: 'Single Register',
    15: 'Multiple Coils',
    16: 'Multiple Registers',
    22: 'Mask Write Register',
    23: 'Read/Write Registers'
  };

  function ModbusWrite(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Retrieve the config node
    node.server = RED.nodes.getNode(config.server);

    // Store configuration
    node.name = config.name || '';
    node.fc = parseIntSafe(config.fc, 6);
    node.address = parseIntSafe(config.address, 0);
    node.addressOffset = config.addressOffset === 'one-based' ? 'one-based' : 'zero-based';
    node.queueMaxSize = parseIntSafe(config.queueMaxSize, 100);
    node.queueDropStrategy = config.queueDropStrategy === 'lifo' ? 'lifo' : 'fifo';

    // FC 23 specific: read address and quantity
    node.readAddress = parseIntSafe(config.readAddress, 0);
    node.readQuantity = parseIntSafe(config.readQuantity, 1);

    // Compute the effective zero-based address for the protocol
    node._protocolAddress = node.addressOffset === 'one-based'
      ? Math.max(0, node.address - 1)
      : node.address;
    node._protocolReadAddress = node.addressOffset === 'one-based'
      ? Math.max(0, node.readAddress - 1)
      : node.readAddress;

    // Internal state
    node._writing = false;
    node._queue = null;

    // Validate config node reference
    if (!node.server) {
      node.status({ fill: 'red', shape: 'ring', text: 'No config' });
      node.error('Modbus Write: No config node selected');
      return;
    }

    // Validate function code
    if (!FC_METHOD_MAP[node.fc]) {
      node.status({ fill: 'red', shape: 'ring', text: 'Invalid FC' });
      node.error(`Modbus Write: Invalid function code: ${node.fc}`);
      return;
    }

    // Initialize backpressure queue
    node._queue = new BackpressureQueue({
      maxSize: node.queueMaxSize,
      dropStrategy: node.queueDropStrategy
    });

    node._queue.on('drop', function (info) {
      node.warn(`Modbus Write: Queue overflow – ${info.reason} (queue: ${info.queueLength}/${node.queueMaxSize})`);
      // Only call done() for FIFO drops (old items whose input handler already returned).
      // LIFO drops are the current message – done() is called by the input handler.
      if (info.reason === 'fifo_overflow' && info.item && typeof info.item.done === 'function') {
        info.item.done(new Error(`Modbus Write: message dropped (${info.reason})`));
      }
    });

    node._queue.on('highWater', function (info) {
      node.status({ fill: 'yellow', shape: 'ring', text: `Queue: ${info.queueLength}/${node.queueMaxSize}` });
    });

    node._queue.on('lowWater', function () {
      if (!node._writing) {
        node.status({ fill: 'green', shape: 'dot', text: 'Ready' });
      }
    });

    node.status({ fill: 'grey', shape: 'dot', text: 'Ready' });

    /**
     * Validate and normalize the value from msg.payload based on the function code.
     *
     * @param {*} value - The raw value from msg.payload.
     * @param {number} fc - The function code.
     * @returns {{ value: *, error: string|null }}
     */
    function validateValue(value, fc) {
      switch (fc) {
        case 5: {
          // FC 05: Single coil – boolean, 0xFF00/0x0000, or 0/1
          if (typeof value === 'boolean') {
            return { value, error: null };
          }
          if (value === 0xFF00 || value === 1) {
            return { value: true, error: null };
          }
          if (value === 0x0000 || value === 0) {
            return { value: false, error: null };
          }
          return { value: null, error: 'FC 05 requires boolean, 0/1, or 0xFF00/0x0000' };
        }
        case 6: {
          // FC 06: Single register – integer 0-65535
          const num = Number(value);
          if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0 || num > 65535) {
            return { value: null, error: 'FC 06 requires integer 0-65535' };
          }
          return { value: num, error: null };
        }
        case 15: {
          // FC 15: Multiple coils – boolean array
          if (!Array.isArray(value) || value.length === 0) {
            return { value: null, error: 'FC 15 requires a non-empty boolean array' };
          }
          if (value.length > 1968) {
            return { value: null, error: 'FC 15 max 1968 coils per request' };
          }
          const boolArr = value.map(function (v) {
            return Boolean(v);
          });
          return { value: boolArr, error: null };
        }
        case 16: {
          // FC 16: Multiple registers – integer array (0-65535 each)
          if (!Array.isArray(value) || value.length === 0) {
            return { value: null, error: 'FC 16 requires a non-empty integer array' };
          }
          if (value.length > 123) {
            return { value: null, error: 'FC 16 max 123 registers per request' };
          }
          for (let i = 0; i < value.length; i++) {
            const n = Number(value[i]);
            if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 65535) {
              return { value: null, error: `FC 16 value at index ${i} must be integer 0-65535, got: ${value[i]}` };
            }
          }
          return { value: value.map(Number), error: null };
        }
        case 22: {
          // FC 22: Mask Write Register – object with andMask and orMask
          if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            return { value: null, error: 'FC 22 requires object { andMask, orMask }' };
          }
          const andMask = Number(value.andMask);
          const orMask = Number(value.orMask);
          if (!Number.isFinite(andMask) || !Number.isInteger(andMask) || andMask < 0 || andMask > 0xFFFF) {
            return { value: null, error: 'FC 22 andMask must be integer 0x0000-0xFFFF' };
          }
          if (!Number.isFinite(orMask) || !Number.isInteger(orMask) || orMask < 0 || orMask > 0xFFFF) {
            return { value: null, error: 'FC 22 orMask must be integer 0x0000-0xFFFF' };
          }
          return { value: { andMask, orMask }, error: null };
        }
        case 23: {
          // FC 23: Read/Write Multiple Registers – integer array (write values)
          if (!Array.isArray(value) || value.length === 0) {
            return { value: null, error: 'FC 23 requires a non-empty integer array (write values)' };
          }
          if (value.length > 121) {
            return { value: null, error: 'FC 23 max 121 write registers per request' };
          }
          for (let i = 0; i < value.length; i++) {
            const n = Number(value[i]);
            if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 65535) {
              return { value: null, error: `FC 23 write value at index ${i} must be integer 0-65535, got: ${value[i]}` };
            }
          }
          return { value: value.map(Number), error: null };
        }
        default:
          return { value: null, error: `Unsupported function code: ${fc}` };
      }
    }

    /**
     * Execute a single write operation from the queue.
     *
     * @param {{ msg: object, send: function, done: function, value: * }} entry
     * @returns {Promise<void>}
     */
    async function doWrite(entry) {
      const transport = typeof node.server.getConnectedTransport === 'function'
        ? await node.server.getConnectedTransport()
        : node.server._transport;
      if (!transport || !transport.isOpen()) {
        node.status({ fill: 'red', shape: 'ring', text: 'Not connected' });
        throw new Error('Modbus Write: Transport not connected');
      }

      node._writing = true;
      node.status({ fill: 'blue', shape: 'dot', text: 'Writing...' });

      try {
        // Set unit ID from config node
        transport.setID(node.server.unitId);

        const connectionStr = buildConnectionString(node.server.getTransportConfig());
        let outPayload;

        if (node.fc === 22) {
          // FC 22: Mask Write Register – special call signature
          await transport.maskWriteRegister(node._protocolAddress, entry.value.andMask, entry.value.orMask);
          outPayload = buildWritePayload({
            fc: node.fc,
            address: node._protocolAddress,
            value: entry.value,
            unitId: node.server.unitId,
            connection: connectionStr
          });
        } else if (node.fc === 23) {
          // FC 23: Read/Write Multiple Registers – combined operation
          const result = await transport.readWriteRegisters(
            node._protocolReadAddress, node.readQuantity,
            node._protocolAddress, entry.value
          );
          if (!result || !Array.isArray(result.data)) {
            throw new Error(`FC 23: invalid response from transport (missing data array)`);
          }
          outPayload = buildReadWritePayload({
            data: result.data,
            buffer: result.buffer || null,
            fc: node.fc,
            readAddress: node._protocolReadAddress,
            readQuantity: node.readQuantity,
            writeAddress: node._protocolAddress,
            writeValues: entry.value,
            unitId: node.server.unitId,
            connection: connectionStr
          });
        } else {
          // Standard FCs (5, 6, 15, 16)
          const method = FC_METHOD_MAP[node.fc];
          await transport[method](node._protocolAddress, entry.value);
          outPayload = buildWritePayload({
            fc: node.fc,
            address: node._protocolAddress,
            value: entry.value,
            unitId: node.server.unitId,
            connection: connectionStr
          });
        }

        const outMsg = {
          topic: entry.msg && entry.msg.topic ? entry.msg.topic : `modbus:${FC_LABEL_MAP[node.fc]}`,
          payload: outPayload,
          modbusWrite: {
            fc: node.fc,
            address: node.address,
            protocolAddress: node._protocolAddress,
            value: entry.value,
            unitId: node.server.unitId,
            addressOffset: node.addressOffset
          }
        };

        // FC 23: include read parameters in metadata
        if (node.fc === 23) {
          outMsg.modbusWrite.readAddress = node.readAddress;
          outMsg.modbusWrite.protocolReadAddress = node._protocolReadAddress;
          outMsg.modbusWrite.readQuantity = node.readQuantity;
        }

        const queueLen = node._queue.length;
        node.status({
          fill: 'green',
          shape: 'dot',
          text: `OK: FC${node.fc} @ ${node._protocolAddress}` + (queueLen > 0 ? ` (Q:${queueLen})` : '')
        });

        entry.send(outMsg);
        entry.done();
      } finally {
        node._writing = false;
      }
    }

    /**
     * Process the next item in the queue if not already writing.
     */
    function processQueue() {
      if (node._writing || node._queue.isEmpty()) {
        return;
      }

      const entry = node._queue.dequeue();
      if (!entry) {
        return;
      }

      doWrite(entry).then(function () {
        processQueue();
      }, function (err) {
        node.status({ fill: 'red', shape: 'ring', text: `Error: ${err.message}` });
        entry.done(err);
        processQueue();
      });
    }

    // Handle incoming messages
    node.on('input', function (msg, send, done) {
      // Node-RED >= 1.0 provides send/done callbacks
      send = send || function () { node.send.apply(node, arguments); };
      done = done || function (err) { if (err) node.error(err, msg); };

      // Allow dynamic value override via msg.payload
      const rawValue = msg.payload;

      if (rawValue === undefined || rawValue === null) {
        done(new Error('Modbus Write: msg.payload is required'));
        return;
      }

      // Validate and normalize the value
      const validation = validateValue(rawValue, node.fc);
      if (validation.error) {
        node.status({ fill: 'red', shape: 'ring', text: validation.error });
        done(new Error(`Modbus Write: ${validation.error}`));
        return;
      }

      // Enqueue the write request
      const result = node._queue.enqueue({
        msg: msg,
        send: send,
        done: done,
        value: validation.value
      });

      if (!result.enqueued) {
        node.status({ fill: 'yellow', shape: 'ring', text: `Queue full (${node.queueMaxSize})` });
        done(new Error('Modbus Write: Queue full, message dropped (LIFO)'));
        return;
      }

      // Kick off processing
      processQueue();
    });

    // Cleanup on close
    node.on('close', function (done) {
      node._writing = false;
      if (node._queue) {
        node._queue.destroy();
        node._queue = null;
      }
      done();
    });
  }

  RED.nodes.registerType('modbus-write', ModbusWrite);
};
