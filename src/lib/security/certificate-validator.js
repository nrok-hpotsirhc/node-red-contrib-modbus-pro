'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');

/**
 * Default warning threshold for certificate expiry (30 days in ms).
 */
const DEFAULT_EXPIRY_WARNING_DAYS = 30;

/**
 * PEM header/footer patterns for certificate and key detection.
 */
const PEM_CERT_HEADER = '-----BEGIN CERTIFICATE-----';
const PEM_KEY_HEADER_RSA = '-----BEGIN RSA PRIVATE KEY-----';
const PEM_KEY_HEADER_EC = '-----BEGIN EC PRIVATE KEY-----';
const PEM_KEY_HEADER_PKCS8 = '-----BEGIN PRIVATE KEY-----';
const PEM_KEY_HEADER_ENCRYPTED = '-----BEGIN ENCRYPTED PRIVATE KEY-----';

/**
 * Certificate validation result object.
 * @typedef {object} ValidationResult
 * @property {boolean} valid - Whether the certificate is valid.
 * @property {string[]} errors - List of validation errors.
 * @property {string[]} warnings - List of warnings (e.g., expiry approaching).
 * @property {object|null} info - Parsed certificate information.
 */

/**
 * Certificate information extracted from X.509v3.
 * @typedef {object} CertificateInfo
 * @property {string} subject - Certificate subject string.
 * @property {string} issuer - Certificate issuer string.
 * @property {Date} validFrom - Not-before date.
 * @property {Date} validTo - Not-after date.
 * @property {string} serialNumber - Certificate serial number.
 * @property {string} fingerprint256 - SHA-256 fingerprint.
 * @property {string[]} roles - RBAC roles extracted from OU fields.
 * @property {boolean} selfSigned - Whether the certificate is self-signed.
 */

/**
 * Certificate validator for Modbus/TCP Security.
 *
 * Validates PEM-encoded X.509v3 certificates and private keys,
 * checks expiry, and extracts RBAC roles from organizational unit (OU)
 * fields in the certificate subject.
 *
 * Credential file paths are stored in the Node-RED Credential Store
 * and never in flow.json.
 */
class CertificateValidator {
  /**
   * @param {object} [options]
   * @param {number} [options.expiryWarningDays=30] - Days before expiry to warn.
   */
  constructor(options = {}) {
    this._expiryWarningDays = options.expiryWarningDays || DEFAULT_EXPIRY_WARNING_DAYS;
  }

  /**
   * Validate a complete TLS configuration with CA, certificate, and key.
   *
   * @param {object} config - TLS configuration.
   * @param {string} [config.caPath] - Path to CA certificate file.
   * @param {string} [config.certPath] - Path to client/server certificate file.
   * @param {string} [config.keyPath] - Path to private key file.
   * @param {string} [config.passphrase] - Optional passphrase for encrypted key.
   * @param {boolean} [config.rejectUnauthorized=true] - Whether to reject unauthorized certs.
   * @returns {ValidationResult}
   */
  validateConfig(config) {
    const errors = [];
    const warnings = [];
    let info = null;

    if (!config || typeof config !== 'object') {
      return { valid: false, errors: ['Configuration object is required'], warnings, info };
    }

    // Validate CA certificate if provided
    if (config.caPath) {
      const caResult = this.validateCertificateFile(config.caPath);
      if (!caResult.valid) {
        errors.push(...caResult.errors.map(e => `CA: ${e}`));
      }
      warnings.push(...caResult.warnings.map(w => `CA: ${w}`));
    }

    // Validate client/server certificate if provided
    if (config.certPath) {
      const certResult = this.validateCertificateFile(config.certPath);
      if (!certResult.valid) {
        errors.push(...certResult.errors.map(e => `Certificate: ${e}`));
      }
      warnings.push(...certResult.warnings.map(w => `Certificate: ${w}`));
      info = certResult.info;
    }

    // Validate private key if provided
    if (config.keyPath) {
      const keyResult = this.validateKeyFile(config.keyPath, config.passphrase);
      if (!keyResult.valid) {
        errors.push(...keyResult.errors.map(e => `Key: ${e}`));
      }
    }

    // mTLS requires both cert and key
    if (config.certPath && !config.keyPath) {
      errors.push('Private key is required when a certificate is provided (mTLS)');
    }
    if (config.keyPath && !config.certPath) {
      errors.push('Certificate is required when a private key is provided (mTLS)');
    }

    // Verify cert and key match if both provided
    if (config.certPath && config.keyPath && errors.length === 0) {
      const matchResult = this.verifyKeyPair(config.certPath, config.keyPath, config.passphrase);
      if (!matchResult.valid) {
        errors.push(...matchResult.errors);
      }
    }

    if (config.rejectUnauthorized === false) {
      warnings.push('rejectUnauthorized is disabled – TLS peer certificates will NOT be verified');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      info
    };
  }

  /**
   * Validate a PEM-encoded certificate file.
   *
   * @param {string} filePath - Path to the certificate file.
   * @returns {ValidationResult}
   */
  validateCertificateFile(filePath) {
    const errors = [];
    const warnings = [];
    let info = null;

    // Check file existence and readability
    if (!filePath || typeof filePath !== 'string') {
      return { valid: false, errors: ['File path is required'], warnings, info };
    }

    let pem;
    try {
      pem = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        return { valid: false, errors: [`File not found: ${filePath}`], warnings, info };
      }
      if (err.code === 'EACCES') {
        return { valid: false, errors: [`Permission denied: ${filePath}`], warnings, info };
      }
      return { valid: false, errors: [`Cannot read file: ${err.message}`], warnings, info };
    }

    // Validate PEM format
    if (!pem.includes(PEM_CERT_HEADER)) {
      return {
        valid: false,
        errors: ['File is not a PEM-encoded certificate (missing BEGIN CERTIFICATE header)'],
        warnings,
        info
      };
    }

    // Parse certificate using Node.js crypto
    try {
      const x509 = new crypto.X509Certificate(pem);
      info = this._extractCertInfo(x509);

      // Check expiry
      const now = new Date();
      if (now < info.validFrom) {
        errors.push(`Certificate is not yet valid (valid from: ${info.validFrom.toISOString()})`);
      }
      if (now > info.validTo) {
        errors.push(`Certificate has expired (expired: ${info.validTo.toISOString()})`);
      }

      // Check approaching expiry
      const warningThreshold = this._expiryWarningDays * 24 * 60 * 60 * 1000;
      const timeUntilExpiry = info.validTo.getTime() - now.getTime();
      if (timeUntilExpiry > 0 && timeUntilExpiry < warningThreshold) {
        const daysLeft = Math.ceil(timeUntilExpiry / (24 * 60 * 60 * 1000));
        warnings.push(`Certificate expires in ${daysLeft} day(s)`);
      }
    } catch (err) {
      errors.push(`Invalid certificate: ${err.message}`);
    }

    return { valid: errors.length === 0, errors, warnings, info };
  }

  /**
   * Validate a PEM-encoded private key file.
   *
   * @param {string} filePath - Path to the private key file.
   * @param {string} [passphrase] - Passphrase for encrypted keys.
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validateKeyFile(filePath, passphrase) {
    const errors = [];

    if (!filePath || typeof filePath !== 'string') {
      return { valid: false, errors: ['File path is required'] };
    }

    let pem;
    try {
      pem = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        return { valid: false, errors: [`File not found: ${filePath}`] };
      }
      if (err.code === 'EACCES') {
        return { valid: false, errors: [`Permission denied: ${filePath}`] };
      }
      return { valid: false, errors: [`Cannot read file: ${err.message}`] };
    }

    // Validate PEM format
    const isKey = pem.includes(PEM_KEY_HEADER_RSA) ||
      pem.includes(PEM_KEY_HEADER_EC) ||
      pem.includes(PEM_KEY_HEADER_PKCS8) ||
      pem.includes(PEM_KEY_HEADER_ENCRYPTED);

    if (!isKey) {
      return {
        valid: false,
        errors: ['File is not a PEM-encoded private key (missing key header)']
      };
    }

    // Verify key can be loaded
    try {
      const keyOptions = { key: pem };
      if (passphrase) {
        keyOptions.passphrase = passphrase;
      }
      crypto.createPrivateKey(keyOptions);
    } catch (err) {
      const msg = err.message.toLowerCase();
      const code = (err.code || '').toLowerCase();
      if (msg.includes('passphrase') || msg.includes('decrypt') ||
          msg.includes('interrupted') || msg.includes('cancelled') ||
          code.includes('interrupted') || code.includes('cancelled') ||
          (pem.includes(PEM_KEY_HEADER_ENCRYPTED) && !passphrase)) {
        errors.push('Private key is encrypted – passphrase required or incorrect');
      } else {
        errors.push(`Invalid private key: ${err.message}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Verify that a certificate and private key form a valid pair.
   *
   * @param {string} certPath - Path to certificate file.
   * @param {string} keyPath - Path to private key file.
   * @param {string} [passphrase] - Passphrase for encrypted key.
   * @returns {{ valid: boolean, errors: string[] }}
   */
  verifyKeyPair(certPath, keyPath, passphrase) {
    const errors = [];

    try {
      const certPem = fs.readFileSync(certPath, 'utf8');
      const keyPem = fs.readFileSync(keyPath, 'utf8');

      const cert = new crypto.X509Certificate(certPem);
      const keyOptions = { key: keyPem };
      if (passphrase) {
        keyOptions.passphrase = passphrase;
      }
      const privateKey = crypto.createPrivateKey(keyOptions);
      const publicKey = crypto.createPublicKey(privateKey);

      // Compare public keys
      const certPublicKey = cert.publicKey;
      const certPubExport = certPublicKey.export({ type: 'spki', format: 'der' });
      const keyPubExport = publicKey.export({ type: 'spki', format: 'der' });

      if (!certPubExport.equals(keyPubExport)) {
        errors.push('Certificate and private key do not match');
      }
    } catch (err) {
      errors.push(`Key pair verification failed: ${err.message}`);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Extract RBAC roles from a certificate's subject OU fields.
   *
   * In the Modbus/TCP Security model, roles are encoded in the
   * Organizational Unit (OU) fields of the X.509v3 subject.
   * Example: OU=ModbusOperator, OU=AdminRole → roles: ['ModbusOperator', 'AdminRole']
   *
   * @param {string} certPath - Path to certificate file.
   * @returns {string[]} Array of role names.
   */
  extractRoles(certPath) {
    try {
      const pem = fs.readFileSync(certPath, 'utf8');
      const x509 = new crypto.X509Certificate(pem);
      return this._parseOURoles(x509.subject);
    } catch (_err) {
      return [];
    }
  }

  /**
   * Extract certificate information from a PEM file.
   *
   * @param {string} certPath - Path to certificate file.
   * @returns {CertificateInfo|null}
   */
  getCertificateInfo(certPath) {
    try {
      const pem = fs.readFileSync(certPath, 'utf8');
      const x509 = new crypto.X509Certificate(pem);
      return this._extractCertInfo(x509);
    } catch (_err) {
      return null;
    }
  }

  /**
   * Extract structured info from an X509Certificate object.
   * @param {crypto.X509Certificate} x509
   * @returns {CertificateInfo}
   * @private
   */
  _extractCertInfo(x509) {
    const subject = x509.subject;
    const issuer = x509.issuer;

    return {
      subject: subject,
      issuer: issuer,
      validFrom: new Date(x509.validFrom),
      validTo: new Date(x509.validTo),
      serialNumber: x509.serialNumber,
      fingerprint256: x509.fingerprint256,
      roles: this._parseOURoles(subject),
      selfSigned: subject === issuer
    };
  }

  /**
   * Parse OU (Organizational Unit) fields from an X.509 subject string.
   * The subject is formatted as: "CN=name\nOU=role1\nOU=role2\nO=org"
   *
   * @param {string} subject - X.509 subject string.
   * @returns {string[]}
   * @private
   */
  _parseOURoles(subject) {
    if (!subject || typeof subject !== 'string') {
      return [];
    }

    const roles = [];
    const lines = subject.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('OU=')) {
        const role = trimmed.substring(3).trim();
        if (role) {
          roles.push(role);
        }
      }
    }
    return roles;
  }
}

module.exports = { CertificateValidator, DEFAULT_EXPIRY_WARNING_DAYS };
