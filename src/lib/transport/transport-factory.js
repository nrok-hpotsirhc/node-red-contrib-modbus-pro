'use strict';

const TcpTransport = require('./tcp-transport');
const RtuTransport = require('./rtu-transport');

/**
 * Required configuration fields by transport type.
 */
const REQUIRED_FIELDS = {
  tcp: ['host', 'port'],
  rtu: ['serialPort', 'baudRate']
};

/**
 * Factory for creating transport instances based on configuration.
 *
 * Usage:
 *   const transport = TransportFactory.create({ type: 'tcp', host: '10.0.0.1', port: 502 });
 *   await transport.connect();
 */
class TransportFactory {
  /**
   * Create a transport instance based on the given configuration.
   *
   * @param {object} config - Transport configuration.
   * @param {string} config.type - Transport type: 'tcp' or 'rtu'.
   * @param {string} [config.host] - TCP host (required for type 'tcp').
   * @param {number} [config.port] - TCP port (required for type 'tcp').
   * @param {number} [config.timeout] - Response timeout in ms.
   * @param {number} [config.unitId] - Modbus unit/slave ID.
   * @param {string} [config.serialPort] - Serial port path (required for type 'rtu').
   * @param {number} [config.baudRate] - Baud rate (required for type 'rtu').
   * @param {string} [config.parity] - Parity setting for RTU.
   * @param {number} [config.dataBits] - Data bits for RTU.
   * @param {number} [config.stopBits] - Stop bits for RTU.
   * @returns {TcpTransport|RtuTransport}
   * @throws {Error} If config.type is invalid or required fields are missing.
   */
  static create(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('TransportFactory: config object is required');
    }

    const type = config.type;
    if (!type || !REQUIRED_FIELDS[type]) {
      throw new Error(
        `TransportFactory: invalid transport type '${type}'. Must be 'tcp' or 'rtu'.`
      );
    }

    const missing = REQUIRED_FIELDS[type].filter(
      (field) => config[field] === undefined || config[field] === null
    );
    if (missing.length > 0) {
      throw new Error(
        `TransportFactory: missing required fields for '${type}' transport: ${missing.join(', ')}`
      );
    }

    if (type === 'tcp') {
      return new TcpTransport(config);
    }

    return new RtuTransport(config);
  }

  /**
   * Check whether the serialport package is installed,
   * indicating that RTU transport is available.
   *
   * @returns {boolean}
   */
  static isRtuAvailable() {
    return RtuTransport.isSerialPortAvailable();
  }
}

module.exports = TransportFactory;
