'use strict';

const BaseTransport = require('./base-transport');

/**
 * Default configuration for TCP transport.
 */
const TCP_DEFAULTS = {
  host: '127.0.0.1',
  port: 502,
  timeout: 5000,
  unitId: 1
};

/**
 * TCP transport abstraction wrapping modbus-serial's TCP connectivity.
 *
 * Provides a unified interface for Modbus TCP communication and emits
 * lifecycle events: 'connect', 'disconnect', 'error'.
 *
 * @extends BaseTransport
 */
class TcpTransport extends BaseTransport {
  /**
   * @param {object} config - Transport configuration.
   * @param {string} [config.host='127.0.0.1'] - Target host IP or hostname.
   * @param {number} [config.port=502] - Target TCP port.
   * @param {number} [config.timeout=5000] - Response timeout in milliseconds.
   * @param {number} [config.unitId=1] - Modbus unit/slave ID.
   */
  constructor(config = {}) {
    super({ ...TCP_DEFAULTS, ...config });
  }

  /**
   * Returns the transport type identifier.
   * @returns {string}
   */
  get type() {
    return 'tcp';
  }

  /**
   * Connect to the Modbus TCP device.
   * @returns {Promise<void>}
   */
  async connect() {
    if (this._connected) {
      return;
    }

    try {
      await this._client.connectTCP(this._config.host, {
        port: this._config.port
      });
      this.setID(this._config.unitId);
      this._client.setTimeout(this._config.timeout);
      this._connected = true;
      this.emit('connect');
    } catch (err) {
      this._connected = false;
      this.emit('error', err);
      throw err;
    }
  }
}

module.exports = TcpTransport;
