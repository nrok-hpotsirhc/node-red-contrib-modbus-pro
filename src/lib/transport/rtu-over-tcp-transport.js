'use strict';

const BaseTransport = require('./base-transport');

/**
 * Default configuration for RTU-over-TCP transport.
 */
const RTU_OVER_TCP_DEFAULTS = {
  host: '127.0.0.1',
  port: 4001,
  timeout: 5000,
  unitId: 1,
  // Some gateways need a software-side inter-frame delay (ms).
  // 0 means "let the gateway handle the t3.5 silence".
  interFrameDelay: 0
};

/**
 * RTU-over-TCP transport: sends raw RTU frames (slave address + PDU + CRC)
 * over a TCP socket instead of the standard Modbus TCP MBAP framing.
 *
 * This is the wire format used by many industrial TCP-to-serial gateways
 * (Moxa NPort, Lantronix, Wago 750-352, Digi PortServer, ADAM-4571 …) when
 * configured in their default "raw socket" / "TCP server" mode.
 *
 * Internally it uses modbus-serial's `connectTcpRTUBuffered()` API, which
 * preserves all the validation behavior of the regular RTU transport.
 *
 * @extends BaseTransport
 *
 * @see THEORETICAL_FOUNDATIONS.md §16 Modbus RTU over TCP Encapsulation
 */
class RtuOverTcpTransport extends BaseTransport {
  /**
   * @param {object} config - Transport configuration.
   * @param {string} [config.host='127.0.0.1'] - Gateway host IP or hostname.
   * @param {number} [config.port=4001] - TCP port (Moxa default 4001).
   * @param {number} [config.timeout=5000] - Response timeout in ms.
   * @param {number} [config.unitId=1] - Modbus unit/slave ID.
   * @param {number} [config.interFrameDelay=0] - Optional software t3.5 delay in ms.
   */
  constructor(config = {}) {
    super({ ...RTU_OVER_TCP_DEFAULTS, ...config });
  }

  /**
   * Returns the transport type identifier.
   * @returns {string}
   */
  get type() {
    return 'rtu-over-tcp';
  }

  /**
   * The configured inter-frame delay (ms). Exposed for diagnostics and so
   * higher layers (queue, scheduler) can throttle if required.
   * @returns {number}
   */
  get interFrameDelay() {
    return this._config.interFrameDelay || 0;
  }

  /**
   * Establish the TCP connection and switch the underlying client into
   * RTU framing mode.
   * @returns {Promise<void>}
   */
  async connect() {
    if (this._connected) {
      return;
    }
    try {
      await this._client.connectTcpRTUBuffered(this._config.host, {
        port: this._config.port
      });
      this.setID(this._config.unitId);
      this._client.setTimeout(this._config.timeout);
      this._connected = true;
      this.emit('connect');
    } catch (err) {
      this._connected = false;
      this._emitError(err);
      throw err;
    }
  }
}

module.exports = RtuOverTcpTransport;
