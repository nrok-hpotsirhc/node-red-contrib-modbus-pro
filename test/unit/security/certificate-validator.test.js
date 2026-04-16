'use strict';

const { expect } = require('chai');
const sinon = require('sinon');
const path = require('path');
const fs = require('fs');
const { CertificateValidator, DEFAULT_EXPIRY_WARNING_DAYS } = require('../../../src/lib/security/certificate-validator');

const CERTS_DIR = path.join(__dirname, '../../fixtures/certs');

describe('CertificateValidator', function () {
  let validator;

  beforeEach(function () {
    validator = new CertificateValidator();
  });

  // -- Constructor --

  describe('constructor', function () {
    it('should create an instance with default options', function () {
      const v = new CertificateValidator();
      expect(v).to.be.an.instanceOf(CertificateValidator);
    });

    it('should accept custom expiryWarningDays', function () {
      const v = new CertificateValidator({ expiryWarningDays: 90 });
      expect(v._expiryWarningDays).to.equal(90);
    });

    it('should use default expiryWarningDays when not provided', function () {
      expect(validator._expiryWarningDays).to.equal(DEFAULT_EXPIRY_WARNING_DAYS);
    });
  });

  // -- validateCertificateFile --

  describe('validateCertificateFile', function () {
    it('should validate a valid CA certificate', function () {
      const result = validator.validateCertificateFile(path.join(CERTS_DIR, 'ca-cert.pem'));
      expect(result.valid).to.be.true;
      expect(result.errors).to.be.an('array').with.lengthOf(0);
      expect(result.info).to.be.an('object');
      expect(result.info.subject).to.include('TestCA');
    });

    it('should validate a valid server certificate', function () {
      const result = validator.validateCertificateFile(path.join(CERTS_DIR, 'server-cert.pem'));
      expect(result.valid).to.be.true;
      expect(result.info.subject).to.include('localhost');
      expect(result.info.selfSigned).to.be.false;
    });

    it('should validate a valid client certificate', function () {
      const result = validator.validateCertificateFile(path.join(CERTS_DIR, 'client-cert.pem'));
      expect(result.valid).to.be.true;
      expect(result.info.subject).to.include('TestClient');
    });

    it('should return error for non-existent file', function () {
      const result = validator.validateCertificateFile('/nonexistent/cert.pem');
      expect(result.valid).to.be.false;
      expect(result.errors[0]).to.include('File not found');
    });

    it('should return error for empty path', function () {
      const result = validator.validateCertificateFile('');
      expect(result.valid).to.be.false;
      expect(result.errors[0]).to.include('File path is required');
    });

    it('should return error for null path', function () {
      const result = validator.validateCertificateFile(null);
      expect(result.valid).to.be.false;
      expect(result.errors[0]).to.include('File path is required');
    });

    it('should return error for non-PEM file', function () {
      // Use package.json as a non-PEM file
      const result = validator.validateCertificateFile(
        path.join(__dirname, '../../../package.json')
      );
      expect(result.valid).to.be.false;
      expect(result.errors[0]).to.include('not a PEM-encoded certificate');
    });

    it('should return error for a key file instead of cert', function () {
      const result = validator.validateCertificateFile(path.join(CERTS_DIR, 'ca-key.pem'));
      expect(result.valid).to.be.false;
      expect(result.errors[0]).to.include('not a PEM-encoded certificate');
    });

    it('should detect self-signed certificate', function () {
      const result = validator.validateCertificateFile(path.join(CERTS_DIR, 'ca-cert.pem'));
      expect(result.info.selfSigned).to.be.true;
    });

    it('should extract certificate dates', function () {
      const result = validator.validateCertificateFile(path.join(CERTS_DIR, 'ca-cert.pem'));
      expect(result.info.validFrom).to.be.an.instanceOf(Date);
      expect(result.info.validTo).to.be.an.instanceOf(Date);
      expect(result.info.validTo.getTime()).to.be.greaterThan(result.info.validFrom.getTime());
    });

    it('should extract serial number and fingerprint', function () {
      const result = validator.validateCertificateFile(path.join(CERTS_DIR, 'ca-cert.pem'));
      expect(result.info.serialNumber).to.be.a('string').that.is.not.empty;
      expect(result.info.fingerprint256).to.be.a('string').that.includes(':');
    });

    it('should warn for certificate expiring soon', function () {
      // The expired-cert.pem is valid for only 1 day from creation
      const v = new CertificateValidator({ expiryWarningDays: 365 * 11 });
      const result = v.validateCertificateFile(path.join(CERTS_DIR, 'ca-cert.pem'));
      // CA cert valid for 10 years, 11 years warning threshold will trigger
      expect(result.warnings.length).to.be.greaterThan(0);
      expect(result.warnings[0]).to.include('expires in');
    });

    it('should detect expired certificate using fake timers', function () {
      // The expired-cert.pem is valid for only 1 day
      const clock = sinon.useFakeTimers(new Date('2030-01-01').getTime());
      try {
        const result = validator.validateCertificateFile(path.join(CERTS_DIR, 'expired-cert.pem'));
        expect(result.valid).to.be.false;
        expect(result.errors[0]).to.include('expired');
      } finally {
        clock.restore();
      }
    });
  });

  // -- validateKeyFile --

  describe('validateKeyFile', function () {
    it('should validate a valid RSA private key', function () {
      const result = validator.validateKeyFile(path.join(CERTS_DIR, 'ca-key.pem'));
      expect(result.valid).to.be.true;
      expect(result.errors).to.be.an('array').with.lengthOf(0);
    });

    it('should validate server private key', function () {
      const result = validator.validateKeyFile(path.join(CERTS_DIR, 'server-key.pem'));
      expect(result.valid).to.be.true;
    });

    it('should validate client private key', function () {
      const result = validator.validateKeyFile(path.join(CERTS_DIR, 'client-key.pem'));
      expect(result.valid).to.be.true;
    });

    it('should validate encrypted key with correct passphrase', function () {
      const result = validator.validateKeyFile(
        path.join(CERTS_DIR, 'client-key-encrypted.pem'),
        'testpass123'
      );
      expect(result.valid).to.be.true;
    });

    it('should reject encrypted key without passphrase', function () {
      const result = validator.validateKeyFile(
        path.join(CERTS_DIR, 'client-key-encrypted.pem')
      );
      expect(result.valid).to.be.false;
      expect(result.errors[0]).to.include('passphrase');
    });

    it('should reject encrypted key with wrong passphrase', function () {
      const result = validator.validateKeyFile(
        path.join(CERTS_DIR, 'client-key-encrypted.pem'),
        'wrongpassword'
      );
      expect(result.valid).to.be.false;
      expect(result.errors[0]).to.include('passphrase');
    });

    it('should return error for non-existent file', function () {
      const result = validator.validateKeyFile('/nonexistent/key.pem');
      expect(result.valid).to.be.false;
      expect(result.errors[0]).to.include('File not found');
    });

    it('should return error for empty path', function () {
      const result = validator.validateKeyFile('');
      expect(result.valid).to.be.false;
      expect(result.errors[0]).to.include('File path is required');
    });

    it('should return error for non-PEM key file', function () {
      const result = validator.validateKeyFile(
        path.join(__dirname, '../../../package.json')
      );
      expect(result.valid).to.be.false;
      expect(result.errors[0]).to.include('not a PEM-encoded private key');
    });

    it('should return error for certificate file instead of key', function () {
      const result = validator.validateKeyFile(path.join(CERTS_DIR, 'ca-cert.pem'));
      expect(result.valid).to.be.false;
      expect(result.errors[0]).to.include('not a PEM-encoded private key');
    });
  });

  // -- verifyKeyPair --

  describe('verifyKeyPair', function () {
    it('should verify matching cert and key pair (CA)', function () {
      const result = validator.verifyKeyPair(
        path.join(CERTS_DIR, 'ca-cert.pem'),
        path.join(CERTS_DIR, 'ca-key.pem')
      );
      expect(result.valid).to.be.true;
    });

    it('should verify matching cert and key pair (server)', function () {
      const result = validator.verifyKeyPair(
        path.join(CERTS_DIR, 'server-cert.pem'),
        path.join(CERTS_DIR, 'server-key.pem')
      );
      expect(result.valid).to.be.true;
    });

    it('should verify matching cert and key pair (client)', function () {
      const result = validator.verifyKeyPair(
        path.join(CERTS_DIR, 'client-cert.pem'),
        path.join(CERTS_DIR, 'client-key.pem')
      );
      expect(result.valid).to.be.true;
    });

    it('should verify matching cert and encrypted key pair', function () {
      const result = validator.verifyKeyPair(
        path.join(CERTS_DIR, 'client-cert.pem'),
        path.join(CERTS_DIR, 'client-key-encrypted.pem'),
        'testpass123'
      );
      expect(result.valid).to.be.true;
    });

    it('should reject mismatched cert and key pair', function () {
      const result = validator.verifyKeyPair(
        path.join(CERTS_DIR, 'server-cert.pem'),
        path.join(CERTS_DIR, 'client-key.pem')
      );
      expect(result.valid).to.be.false;
      expect(result.errors[0]).to.include('do not match');
    });

    it('should reject CA cert with server key', function () {
      const result = validator.verifyKeyPair(
        path.join(CERTS_DIR, 'ca-cert.pem'),
        path.join(CERTS_DIR, 'server-key.pem')
      );
      expect(result.valid).to.be.false;
    });
  });

  // -- validateConfig --

  describe('validateConfig', function () {
    it('should validate full TLS config with CA, cert, and key', function () {
      const result = validator.validateConfig({
        caPath: path.join(CERTS_DIR, 'ca-cert.pem'),
        certPath: path.join(CERTS_DIR, 'client-cert.pem'),
        keyPath: path.join(CERTS_DIR, 'client-key.pem')
      });
      expect(result.valid).to.be.true;
      expect(result.errors).to.have.lengthOf(0);
      expect(result.info).to.be.an('object');
    });

    it('should validate config with only CA path', function () {
      const result = validator.validateConfig({
        caPath: path.join(CERTS_DIR, 'ca-cert.pem')
      });
      expect(result.valid).to.be.true;
    });

    it('should reject cert without key', function () {
      const result = validator.validateConfig({
        certPath: path.join(CERTS_DIR, 'client-cert.pem')
      });
      expect(result.valid).to.be.false;
      expect(result.errors).to.include('Private key is required when a certificate is provided (mTLS)');
    });

    it('should reject key without cert', function () {
      const result = validator.validateConfig({
        keyPath: path.join(CERTS_DIR, 'client-key.pem')
      });
      expect(result.valid).to.be.false;
      expect(result.errors).to.include('Certificate is required when a private key is provided (mTLS)');
    });

    it('should detect mismatched cert and key', function () {
      const result = validator.validateConfig({
        certPath: path.join(CERTS_DIR, 'server-cert.pem'),
        keyPath: path.join(CERTS_DIR, 'client-key.pem')
      });
      expect(result.valid).to.be.false;
      expect(result.errors.some(e => e.includes('do not match'))).to.be.true;
    });

    it('should warn when rejectUnauthorized is disabled', function () {
      const result = validator.validateConfig({
        caPath: path.join(CERTS_DIR, 'ca-cert.pem'),
        rejectUnauthorized: false
      });
      expect(result.warnings.some(w => w.includes('rejectUnauthorized'))).to.be.true;
    });

    it('should return error for null config', function () {
      const result = validator.validateConfig(null);
      expect(result.valid).to.be.false;
      expect(result.errors[0]).to.include('Configuration object is required');
    });

    it('should validate config with encrypted key and passphrase', function () {
      const result = validator.validateConfig({
        certPath: path.join(CERTS_DIR, 'client-cert.pem'),
        keyPath: path.join(CERTS_DIR, 'client-key-encrypted.pem'),
        passphrase: 'testpass123'
      });
      expect(result.valid).to.be.true;
    });

    it('should reject config with encrypted key without passphrase', function () {
      const result = validator.validateConfig({
        certPath: path.join(CERTS_DIR, 'client-cert.pem'),
        keyPath: path.join(CERTS_DIR, 'client-key-encrypted.pem')
      });
      expect(result.valid).to.be.false;
      expect(result.errors.some(e => e.includes('passphrase'))).to.be.true;
    });

    it('should propagate CA errors', function () {
      const result = validator.validateConfig({
        caPath: '/nonexistent/ca.pem'
      });
      expect(result.valid).to.be.false;
      expect(result.errors.some(e => e.includes('CA:'))).to.be.true;
    });

    it('should propagate certificate errors', function () {
      const result = validator.validateConfig({
        certPath: '/nonexistent/cert.pem',
        keyPath: path.join(CERTS_DIR, 'client-key.pem')
      });
      expect(result.valid).to.be.false;
      expect(result.errors.some(e => e.includes('Certificate:'))).to.be.true;
    });

    it('should propagate key errors', function () {
      const result = validator.validateConfig({
        certPath: path.join(CERTS_DIR, 'client-cert.pem'),
        keyPath: '/nonexistent/key.pem'
      });
      expect(result.valid).to.be.false;
      expect(result.errors.some(e => e.includes('Key:'))).to.be.true;
    });
  });

  // -- extractRoles --

  describe('extractRoles', function () {
    it('should extract OU roles from client certificate', function () {
      const roles = validator.extractRoles(path.join(CERTS_DIR, 'client-cert.pem'));
      expect(roles).to.be.an('array');
      expect(roles).to.include('ModbusOperator');
    });

    it('should return empty array for certificate without OU', function () {
      // CA cert has no OU field
      const roles = validator.extractRoles(path.join(CERTS_DIR, 'server-cert.pem'));
      expect(roles).to.be.an('array').with.lengthOf(0);
    });

    it('should return empty array for non-existent file', function () {
      const roles = validator.extractRoles('/nonexistent/cert.pem');
      expect(roles).to.be.an('array').with.lengthOf(0);
    });

    it('should return empty array for invalid file', function () {
      const roles = validator.extractRoles(path.join(__dirname, '../../../package.json'));
      expect(roles).to.be.an('array').with.lengthOf(0);
    });
  });

  // -- getCertificateInfo --

  describe('getCertificateInfo', function () {
    it('should extract full certificate info', function () {
      const info = validator.getCertificateInfo(path.join(CERTS_DIR, 'client-cert.pem'));
      expect(info).to.be.an('object');
      expect(info.subject).to.include('TestClient');
      expect(info.issuer).to.include('TestCA');
      expect(info.validFrom).to.be.an.instanceOf(Date);
      expect(info.validTo).to.be.an.instanceOf(Date);
      expect(info.serialNumber).to.be.a('string');
      expect(info.fingerprint256).to.be.a('string');
      expect(info.roles).to.include('ModbusOperator');
      expect(info.selfSigned).to.be.false;
    });

    it('should detect self-signed CA cert', function () {
      const info = validator.getCertificateInfo(path.join(CERTS_DIR, 'ca-cert.pem'));
      expect(info.selfSigned).to.be.true;
    });

    it('should return null for non-existent file', function () {
      const info = validator.getCertificateInfo('/nonexistent/cert.pem');
      expect(info).to.be.null;
    });

    it('should return null for invalid file', function () {
      const info = validator.getCertificateInfo(path.join(__dirname, '../../../package.json'));
      expect(info).to.be.null;
    });
  });

  // -- _parseOURoles (internal) --

  describe('_parseOURoles (internal)', function () {
    it('should parse single OU role', function () {
      const roles = validator._parseOURoles('CN=Test\nOU=Operator\nO=Org');
      expect(roles).to.deep.equal(['Operator']);
    });

    it('should parse multiple OU roles', function () {
      const roles = validator._parseOURoles('CN=Test\nOU=Admin\nOU=Operator\nO=Org');
      expect(roles).to.deep.equal(['Admin', 'Operator']);
    });

    it('should return empty array for subject without OU', function () {
      const roles = validator._parseOURoles('CN=Test\nO=Org');
      expect(roles).to.deep.equal([]);
    });

    it('should return empty array for empty string', function () {
      const roles = validator._parseOURoles('');
      expect(roles).to.deep.equal([]);
    });

    it('should return empty array for null', function () {
      const roles = validator._parseOURoles(null);
      expect(roles).to.deep.equal([]);
    });

    it('should handle whitespace in OU values', function () {
      const roles = validator._parseOURoles('OU= Operator Role ');
      expect(roles).to.deep.equal(['Operator Role']);
    });
  });

  // -- DEFAULT_EXPIRY_WARNING_DAYS --

  describe('DEFAULT_EXPIRY_WARNING_DAYS', function () {
    it('should be 30 days', function () {
      expect(DEFAULT_EXPIRY_WARNING_DAYS).to.equal(30);
    });
  });
});
