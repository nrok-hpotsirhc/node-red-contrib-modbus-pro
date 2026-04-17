'use strict';

const { buildWritePayload, buildConnectionString } = require('../../lib/parser/payload-builder');

/**
 * Modbus Write Node for Node-RED.
 *
 * Writes data to a Modbus device using one of the four write function codes:
 *   FC 05 – Write Single Coil
 *   FC 06 – Write Single Register
 *   FC 15 – Write Multiple Coils
 *   FC 16 – Write Multiple Registers
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
    16: 'writeRegisters'
  };

  /**
   * Map function code numbers to human-readable labels.
   * @readonly
   */
  const FC_LABEL_MAP = {
    5: 'Single Coil',
    6: 'Single Register',
    15: 'Multiple Coils',
    16: 'Multiple Registers'
  };

  function ModbusWrite(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Retrieve the config node
    node.server = RED.nodes.getNode(config.server);

    // Store configuration
    node.name = config.name || '';
    node.fc = parseInt(config.fc, 10) || 6;
    node.address = parseInt(config.address, 10) || 0;
    node.addressOffset = config.addressOffset === 'one-based' ? 'one-based' : 'zero-based';
    node.queueMaxSize = parseInt(config.queueMaxSize, 10) || 100;
    node.queueDropStrategy = config.queueDropStrategy === 'lifo' ? 'lifo' : 'fifo';

    // Compute the effective zero-based address for the protocol
    node._protocolAddress = node.addressOffset === 'one-based'
      ? Math.max(0, node.address - 1)
      : node.address;

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
      if (!node.server._transport || !node.server._transport.isOpen()) {
        node.status({ fill: 'red', shape: 'ring', text: 'Not connected' });
        throw new Error('Modbus Write: Transport not connected');
      }

      const transport = node.server._transport;
      const method = FC_METHOD_MAP[node.fc];

      node._writing = true;
      node.status({ fill: 'blue', shape: 'dot', text: 'Writing...' });

      try {
        // Set unit ID from config node
        transport.setID(node.server.unitId);

        // Execute the write (all FCs take address + value/values)
        await transport[method](node._protocolAddress, entry.value);

        const connectionStr = buildConnectionString(node.server.getTransportConfig());

        const payload = buildWritePayload({
          fc: node.fc,
          address: node._protocolAddress,
          value: entry.value,
          unitId: node.server.unitId,
          connection: connectionStr
        });

        const outMsg = {
          topic: entry.msg && entry.msg.topic ? entry.msg.topic : `modbus:${FC_LABEL_MAP[node.fc]}`,
          payload: payload,
          modbusWrite: {
            fc: node.fc,
            address: node.address,
            protocolAddress: node._protocolAddress,
            value: entry.value,
            unitId: node.server.unitId,
            addressOffset: node.addressOffset
          }
        };

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
