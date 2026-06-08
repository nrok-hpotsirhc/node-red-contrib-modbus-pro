'use strict';

const BaseTransport = require('./base-transport');
const { TlsWrapper } = require('../security/tls-wrapper');

/**
 * Default configuration for TCP transport.
 */
const TCP_DEFAULTS = {
  host: '127.0.0.1',
  port: 502,
  timeout: 5000,
  unitId: 1,
  tls: false
};

/**
 * TCP transport abstraction wrapping modbus-serial's TCP connectivity.
 *
 * Provides a unified interface for Modbus TCP communication and emits
 * lifecycle events: 'connect', 'disconnect', 'error'.
 *
 * When TLS is enabled (Modbus/TCP Security), the transport creates a
 * TLS socket via TlsWrapper and passes it to modbus-serial's connectTCP.
 * Default port changes to 802 (IANA-registered Modbus/TCP Security port).
 *
 * @extends BaseTransport
 */
class TcpTransport extends BaseTransport {
  /**
   * @param {object} config - Transport configuration.
   * @param {string} [config.host='127.0.0.1'] - Target host IP or hostname.
   * @param {number} [config.port=502] - Target TCP port (802 when TLS enabled).
   * @param {number} [config.timeout=5000] - Response timeout in milliseconds.
   * @param {number} [config.unitId=1] - Modbus unit/slave ID.
   * @param {boolean} [config.tls=false] - Enable Modbus/TCP Security (TLS).
   * @param {string} [config.caPath] - Path to CA certificate PEM file.
   * @param {string} [config.certPath] - Path to client certificate PEM file (mTLS).
   * @param {string} [config.keyPath] - Path to client private key PEM file (mTLS).
   * @param {string} [config.passphrase] - Passphrase for encrypted private key.
   * @param {boolean} [config.rejectUnauthorized=true] - Reject unauthorized TLS certs.
   */
  constructor(config = {}) {
    const merged = { ...TCP_DEFAULTS, ...config };
    // Auto-set port to 802 when TLS enabled and port not explicitly set
    if (merged.tls && config.port === undefined) {
      merged.port = 802;
    }
    super(merged);
    this._tlsWrapper = null;
  }

  /**
   * Returns the transport type identifier.
   * @returns {string}
   */
  get type() {
    return this._config.tls ? 'tcp+tls' : 'tcp';
  }

  /**
   * Get TLS validation warnings (empty array if TLS not enabled).
   * @returns {string[]}
   */
  get tlsWarnings() {
    return this._tlsWrapper ? this._tlsWrapper.warnings : [];
  }

  /**
   * Connect to the Modbus TCP device.
   * When TLS is enabled, creates a secure socket first, then passes
   * it to modbus-serial's connectTCP.
   * @returns {Promise<void>}
   */
  async connect() {
    if (this._connected) {
      return;
    }

    try {
      const connectOptions = { port: this._config.port };

      if (this._config.tls) {
        this._tlsWrapper = new TlsWrapper({
          host: this._config.host,
          port: this._config.port,
          caPath: this._config.caPath,
          certPath: this._config.certPath,
          keyPath: this._config.keyPath,
          passphrase: this._config.passphrase,
          rejectUnauthorized: this._config.rejectUnauthorized
        });

        const tlsSocket = await this._tlsWrapper.connect();
        connectOptions.socket = tlsSocket;
      }

      await this._client.connectTCP(this._config.host, connectOptions);
      this.setID(this._config.unitId);
      this._client.setTimeout(this._config.timeout);
      this._connected = true;
      this.emit('connect');
    } catch (err) {
      this._connected = false;
      // Release the TLS wrapper so a subsequent reconnect starts clean.
      // Swallow cleanup errors – they must not mask the original connect error.
      if (this._tlsWrapper) {
        try {
          await this._tlsWrapper.destroy();
        } catch (_cleanupErr) { /* ignore */ }
        this._tlsWrapper = null;
      }
      this._emitError(err);
      throw err;
    }
  }

  /**
   * Destroy the transport, cleaning up TLS resources.
   * @returns {Promise<void>}
   */
  async destroy() {
    await super.destroy();
    if (this._tlsWrapper) {
      await this._tlsWrapper.destroy();
      this._tlsWrapper = null;
    }
  }
}

module.exports = TcpTransport;
