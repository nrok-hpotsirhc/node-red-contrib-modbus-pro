'use strict';

const tls = require('node:tls');
const fs = require('node:fs');
const { EventEmitter } = require('events');
const { CertificateValidator } = require('./certificate-validator');

/**
 * Default TLS configuration values.
 */
const TLS_DEFAULTS = {
  port: 802,
  minVersion: 'TLSv1.2',
  rejectUnauthorized: true,
  handshakeTimeout: 10000
};

/**
 * Timeout in ms before force-destroying a socket that didn't close gracefully.
 */
const DESTROY_TIMEOUT = 5000;

/**
 * TLS wrapper for Modbus/TCP Security connections.
 *
 * Creates and manages TLS sockets compliant with the Modbus/TCP Security
 * specification (port 802, TLS 1.2/1.3, mTLS with X.509v3 certificates).
 *
 * Uses the Node-RED Credential Store for sensitive data (key paths, passphrases).
 * Certificate file paths are read from credentials, content is loaded at
 * connection time, and never stored in flow.json.
 *
 * @extends EventEmitter
 * @fires TlsWrapper#connect - When TLS handshake completes successfully.
 * @fires TlsWrapper#error - When a TLS error occurs.
 * @fires TlsWrapper#close - When the TLS socket closes.
 */
class TlsWrapper extends EventEmitter {
  /**
   * @param {object} options - TLS options.
   * @param {string} options.host - Target hostname or IP.
   * @param {number} [options.port=802] - Target port (IANA Modbus/TCP Security port).
   * @param {string} [options.caPath] - Path to CA certificate PEM file.
   * @param {string} [options.certPath] - Path to client certificate PEM file (for mTLS).
   * @param {string} [options.keyPath] - Path to client private key PEM file (for mTLS).
   * @param {string} [options.passphrase] - Passphrase for encrypted private key.
   * @param {string} [options.minVersion='TLSv1.2'] - Minimum TLS protocol version.
   * @param {boolean} [options.rejectUnauthorized=true] - Reject unauthorized certificates.
   * @param {number} [options.handshakeTimeout=10000] - TLS handshake timeout in ms.
   * @param {boolean} [options.validateOnCreate=true] - Validate certificates before connecting.
   */
  constructor(options = {}) {
    super();

    if (!options.host || typeof options.host !== 'string') {
      throw new Error('TlsWrapper: host is required');
    }

    this._options = {
      host: options.host,
      port: options.port || TLS_DEFAULTS.port,
      caPath: options.caPath || null,
      certPath: options.certPath || null,
      keyPath: options.keyPath || null,
      passphrase: options.passphrase || null,
      minVersion: options.minVersion || TLS_DEFAULTS.minVersion,
      rejectUnauthorized: options.rejectUnauthorized !== undefined
        ? options.rejectUnauthorized
        : TLS_DEFAULTS.rejectUnauthorized,
      handshakeTimeout: options.handshakeTimeout || TLS_DEFAULTS.handshakeTimeout,
      validateOnCreate: options.validateOnCreate !== false
    };

    this._socket = null;
    this._validator = new CertificateValidator();

    // Validate certificates at construction time if enabled
    if (this._options.validateOnCreate) {
      this._preValidate();
    }
  }

  /**
   * Pre-validate certificate configuration.
   * Throws on critical errors, logs warnings.
   * @private
   */
  _preValidate() {
    const config = {
      caPath: this._options.caPath,
      certPath: this._options.certPath,
      keyPath: this._options.keyPath,
      passphrase: this._options.passphrase,
      rejectUnauthorized: this._options.rejectUnauthorized
    };

    const result = this._validator.validateConfig(config);

    if (!result.valid) {
      throw new Error(`TLS configuration invalid: ${result.errors.join('; ')}`);
    }

    // Store warnings for later retrieval
    this._warnings = result.warnings;
    this._certInfo = result.info;
  }

  /**
   * Get validation warnings from the last pre-validation.
   * @returns {string[]}
   */
  get warnings() {
    return this._warnings || [];
  }

  /**
   * Get certificate info from the last pre-validation.
   * @returns {object|null}
   */
  get certInfo() {
    return this._certInfo || null;
  }

  /**
   * Build TLS connection options from the stored configuration.
   * Reads certificate file contents at connection time.
   *
   * @returns {object} Options suitable for tls.connect().
   * @private
   */
  _buildTlsOptions() {
    const opts = {
      host: this._options.host,
      port: this._options.port,
      minVersion: this._options.minVersion,
      rejectUnauthorized: this._options.rejectUnauthorized,
      timeout: this._options.handshakeTimeout
    };

    if (this._options.caPath) {
      opts.ca = fs.readFileSync(this._options.caPath);
    }

    if (this._options.certPath) {
      opts.cert = fs.readFileSync(this._options.certPath);
    }

    if (this._options.keyPath) {
      opts.key = fs.readFileSync(this._options.keyPath);
    }

    if (this._options.passphrase) {
      opts.passphrase = this._options.passphrase;
    }

    return opts;
  }

  /**
   * Create a TLS-secured socket connection.
   *
   * Returns a Promise that resolves with the connected TLS socket
   * when the handshake completes, or rejects on error/timeout.
   *
   * @returns {Promise<tls.TLSSocket>} The connected TLS socket.
   */
  connect() {
    return new Promise((resolve, reject) => {
      if (this._socket) {
        reject(new Error('TlsWrapper: already connected'));
        return;
      }

      let tlsOptions;
      try {
        tlsOptions = this._buildTlsOptions();
      } catch (err) {
        reject(new Error(`TLS options error: ${err.message}`));
        return;
      }

      const socket = tls.connect(tlsOptions);
      let settled = false;

      const handshakeTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.destroy();
          reject(new Error(`TLS handshake timeout after ${this._options.handshakeTimeout}ms`));
        }
      }, this._options.handshakeTimeout);

      socket.once('secureConnect', () => {
        if (settled) return;
        settled = true;
        clearTimeout(handshakeTimer);

        // Verify the peer certificate if rejectUnauthorized is true
        if (this._options.rejectUnauthorized && !socket.authorized) {
          const err = new Error(`TLS peer certificate rejected: ${socket.authorizationError}`);
          socket.destroy();
          reject(err);
          return;
        }

        this._socket = socket;
        this._attachSocketListeners();
        this.emit('connect', socket);
        resolve(socket);
      });

      socket.once('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(handshakeTimer);
          reject(err);
        } else {
          this.emit('error', err);
        }
      });
    });
  }

  /**
   * Attach event listeners to the active socket.
   * @private
   */
  _attachSocketListeners() {
    if (!this._socket) return;

    this._socket.on('error', (err) => {
      this.emit('error', err);
    });

    this._socket.on('close', () => {
      this._socket = null;
      this.emit('close');
    });
  }

  /**
   * Get the active TLS socket.
   * @returns {tls.TLSSocket|null}
   */
  get socket() {
    return this._socket;
  }

  /**
   * Check whether the TLS socket is connected and authorized.
   * @returns {boolean}
   */
  isConnected() {
    return this._socket !== null &&
      !this._socket.destroyed &&
      this._socket.encrypted === true;
  }

  /**
   * Get the peer certificate from the active connection.
   * @returns {object|null} Peer certificate details.
   */
  getPeerCertificate() {
    if (!this._socket) return null;
    try {
      return this._socket.getPeerCertificate(true);
    } catch (_err) {
      return null;
    }
  }

  /**
   * Get the negotiated TLS protocol version.
   * @returns {string|null} e.g., 'TLSv1.3'
   */
  getProtocol() {
    if (!this._socket) return null;
    return this._socket.getProtocol();
  }

  /**
   * Get the negotiated cipher suite.
   * @returns {object|null} { name, standardName, version }
   */
  getCipher() {
    if (!this._socket) return null;
    return this._socket.getCipher();
  }

  /**
   * Extract RBAC roles from the peer certificate's OU fields.
   * @returns {string[]} Array of role names.
   */
  getPeerRoles() {
    const peerCert = this.getPeerCertificate();
    if (!peerCert || !peerCert.subject) return [];

    const ou = peerCert.subject.OU;
    if (!ou) return [];
    return Array.isArray(ou) ? ou : [ou];
  }

  /**
   * Disconnect the TLS socket.
   * @returns {Promise<void>}
   */
  disconnect() {
    return new Promise((resolve) => {
      if (!this._socket) {
        resolve();
        return;
      }

      const socket = this._socket;
      this._socket = null;

      let settled = false;
      const destroyTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          if (!socket.destroyed) socket.destroy();
          resolve();
        }
      }, DESTROY_TIMEOUT);

      socket.once('close', () => {
        if (!settled) {
          settled = true;
          clearTimeout(destroyTimer);
          resolve();
        }
      });
      socket.end();
    });
  }

  /**
   * Destroy the wrapper, removing all listeners.
   * @returns {Promise<void>}
   */
  async destroy() {
    await this.disconnect();
    this.removeAllListeners();
  }
}

module.exports = { TlsWrapper, TLS_DEFAULTS };
