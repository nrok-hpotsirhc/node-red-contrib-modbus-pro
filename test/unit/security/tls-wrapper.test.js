'use strict';

const { expect } = require('chai');
const sinon = require('sinon');
const tls = require('node:tls');
const fs = require('node:fs');
const path = require('path');
const { TlsWrapper, TLS_DEFAULTS } = require('../../../src/lib/security/tls-wrapper');

const CERTS_DIR = path.join(__dirname, '../../fixtures/certs');

describe('TlsWrapper', function () {

  // -- Constructor --

  describe('constructor', function () {
    it('should create an instance with valid host and CA path', function () {
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        caPath: path.join(CERTS_DIR, 'ca-cert.pem'),
        validateOnCreate: true
      });
      expect(wrapper).to.be.an.instanceOf(TlsWrapper);
    });

    it('should throw when host is not provided', function () {
      expect(() => new TlsWrapper({})).to.throw('host is required');
    });

    it('should throw when host is empty string', function () {
      expect(() => new TlsWrapper({ host: '' })).to.throw('host is required');
    });

    it('should use default port 802', function () {
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        validateOnCreate: false
      });
      expect(wrapper._options.port).to.equal(802);
    });

    it('should allow custom port override', function () {
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        port: 8802,
        validateOnCreate: false
      });
      expect(wrapper._options.port).to.equal(8802);
    });

    it('should default rejectUnauthorized to true', function () {
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        validateOnCreate: false
      });
      expect(wrapper._options.rejectUnauthorized).to.be.true;
    });

    it('should allow rejectUnauthorized to be set to false', function () {
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        rejectUnauthorized: false,
        validateOnCreate: false
      });
      expect(wrapper._options.rejectUnauthorized).to.be.false;
    });

    it('should default minVersion to TLSv1.2', function () {
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        validateOnCreate: false
      });
      expect(wrapper._options.minVersion).to.equal('TLSv1.2');
    });

    it('should store all TLS options', function () {
      const wrapper = new TlsWrapper({
        host: '10.0.0.1',
        port: 9802,
        caPath: '/path/to/ca.pem',
        certPath: '/path/to/cert.pem',
        keyPath: '/path/to/key.pem',
        passphrase: 'secret',
        minVersion: 'TLSv1.3',
        rejectUnauthorized: false,
        handshakeTimeout: 5000,
        validateOnCreate: false
      });
      expect(wrapper._options.host).to.equal('10.0.0.1');
      expect(wrapper._options.port).to.equal(9802);
      expect(wrapper._options.caPath).to.equal('/path/to/ca.pem');
      expect(wrapper._options.certPath).to.equal('/path/to/cert.pem');
      expect(wrapper._options.keyPath).to.equal('/path/to/key.pem');
      expect(wrapper._options.passphrase).to.equal('secret');
      expect(wrapper._options.minVersion).to.equal('TLSv1.3');
      expect(wrapper._options.rejectUnauthorized).to.be.false;
      expect(wrapper._options.handshakeTimeout).to.equal(5000);
    });

    it('should throw on invalid certificate configuration during pre-validation', function () {
      expect(() => new TlsWrapper({
        host: '127.0.0.1',
        certPath: '/nonexistent/cert.pem',
        keyPath: '/nonexistent/key.pem',
        validateOnCreate: true
      })).to.throw('TLS configuration invalid');
    });

    it('should skip validation when validateOnCreate is false', function () {
      expect(() => new TlsWrapper({
        host: '127.0.0.1',
        certPath: '/nonexistent/cert.pem',
        keyPath: '/nonexistent/key.pem',
        validateOnCreate: false
      })).to.not.throw();
    });
  });

  // -- Warnings and info --

  describe('warnings and certInfo', function () {
    it('should provide empty warnings for valid config', function () {
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        caPath: path.join(CERTS_DIR, 'ca-cert.pem'),
        validateOnCreate: true
      });
      expect(wrapper.warnings).to.be.an('array');
    });

    it('should provide certInfo for valid cert+key config', function () {
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        certPath: path.join(CERTS_DIR, 'client-cert.pem'),
        keyPath: path.join(CERTS_DIR, 'client-key.pem'),
        validateOnCreate: true
      });
      expect(wrapper.certInfo).to.be.an('object');
      expect(wrapper.certInfo.subject).to.include('TestClient');
    });

    it('should return null certInfo when no cert configured', function () {
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        validateOnCreate: false
      });
      expect(wrapper.certInfo).to.be.null;
    });
  });

  // -- _buildTlsOptions --

  describe('_buildTlsOptions', function () {
    it('should build minimal TLS options', function () {
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        validateOnCreate: false
      });
      const opts = wrapper._buildTlsOptions();
      expect(opts.host).to.equal('127.0.0.1');
      expect(opts.port).to.equal(802);
      expect(opts.minVersion).to.equal('TLSv1.2');
      expect(opts.rejectUnauthorized).to.be.true;
      expect(opts.ca).to.be.undefined;
      expect(opts.cert).to.be.undefined;
      expect(opts.key).to.be.undefined;
    });

    it('should load CA certificate content', function () {
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        caPath: path.join(CERTS_DIR, 'ca-cert.pem'),
        validateOnCreate: false
      });
      const opts = wrapper._buildTlsOptions();
      expect(opts.ca).to.be.an.instanceOf(Buffer);
      expect(opts.ca.toString()).to.include('BEGIN CERTIFICATE');
    });

    it('should load client cert and key content', function () {
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        certPath: path.join(CERTS_DIR, 'client-cert.pem'),
        keyPath: path.join(CERTS_DIR, 'client-key.pem'),
        validateOnCreate: false
      });
      const opts = wrapper._buildTlsOptions();
      expect(opts.cert).to.be.an.instanceOf(Buffer);
      expect(opts.key).to.be.an.instanceOf(Buffer);
    });

    it('should include passphrase when provided', function () {
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        keyPath: path.join(CERTS_DIR, 'client-key-encrypted.pem'),
        certPath: path.join(CERTS_DIR, 'client-cert.pem'),
        passphrase: 'testpass123',
        validateOnCreate: false
      });
      const opts = wrapper._buildTlsOptions();
      expect(opts.passphrase).to.equal('testpass123');
    });

    it('should not include passphrase when not provided', function () {
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        validateOnCreate: false
      });
      const opts = wrapper._buildTlsOptions();
      expect(opts.passphrase).to.be.undefined;
    });
  });

  // -- isConnected --

  describe('isConnected', function () {
    it('should return false when no socket', function () {
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        validateOnCreate: false
      });
      expect(wrapper.isConnected()).to.be.false;
    });
  });

  // -- socket getter --

  describe('socket getter', function () {
    it('should return null when no connection', function () {
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        validateOnCreate: false
      });
      expect(wrapper.socket).to.be.null;
    });
  });

  // -- getPeerCertificate --

  describe('getPeerCertificate', function () {
    it('should return null when not connected', function () {
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        validateOnCreate: false
      });
      expect(wrapper.getPeerCertificate()).to.be.null;
    });
  });

  // -- getProtocol --

  describe('getProtocol', function () {
    it('should return null when not connected', function () {
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        validateOnCreate: false
      });
      expect(wrapper.getProtocol()).to.be.null;
    });
  });

  // -- getCipher --

  describe('getCipher', function () {
    it('should return null when not connected', function () {
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        validateOnCreate: false
      });
      expect(wrapper.getCipher()).to.be.null;
    });
  });

  // -- getPeerRoles --

  describe('getPeerRoles', function () {
    it('should return empty array when not connected', function () {
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        validateOnCreate: false
      });
      expect(wrapper.getPeerRoles()).to.deep.equal([]);
    });
  });

  // -- disconnect --

  describe('disconnect', function () {
    it('should resolve immediately when not connected', async function () {
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        validateOnCreate: false
      });
      await wrapper.disconnect();
      expect(wrapper.socket).to.be.null;
    });
  });

  // -- destroy --

  describe('destroy', function () {
    it('should remove all listeners', async function () {
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        validateOnCreate: false
      });
      wrapper.on('connect', function () {});
      wrapper.on('error', function () {});
      expect(wrapper.listenerCount('connect')).to.equal(1);
      await wrapper.destroy();
      expect(wrapper.listenerCount('connect')).to.equal(0);
    });
  });

  // -- connect with real TLS server --

  describe('connect (integration with local TLS server)', function () {
    let tlsServer;
    let serverPort;

    beforeEach(function (done) {
      const options = {
        key: fs.readFileSync(path.join(CERTS_DIR, 'server-key.pem')),
        cert: fs.readFileSync(path.join(CERTS_DIR, 'server-cert.pem')),
        ca: fs.readFileSync(path.join(CERTS_DIR, 'ca-cert.pem')),
        requestCert: true,
        rejectUnauthorized: true
      };
      tlsServer = tls.createServer(options, function (socket) {
        socket.end();
      });
      tlsServer.listen(0, '127.0.0.1', function () {
        serverPort = tlsServer.address().port;
        done();
      });
    });

    afterEach(function (done) {
      if (tlsServer) {
        tlsServer.close(done);
      } else {
        done();
      }
    });

    it('should connect to TLS server with valid mTLS certificates', async function () {
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        port: serverPort,
        caPath: path.join(CERTS_DIR, 'ca-cert.pem'),
        certPath: path.join(CERTS_DIR, 'client-cert.pem'),
        keyPath: path.join(CERTS_DIR, 'client-key.pem'),
        validateOnCreate: true
      });

      const socket = await wrapper.connect();
      expect(socket).to.exist;
      expect(wrapper.isConnected()).to.be.true;
      expect(wrapper.getProtocol()).to.be.a('string');
      expect(wrapper.getCipher()).to.be.an('object');

      await wrapper.destroy();
    });

    it('should emit connect event on successful connection', async function () {
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        port: serverPort,
        caPath: path.join(CERTS_DIR, 'ca-cert.pem'),
        certPath: path.join(CERTS_DIR, 'client-cert.pem'),
        keyPath: path.join(CERTS_DIR, 'client-key.pem'),
        validateOnCreate: true
      });

      const spy = sinon.spy();
      wrapper.on('connect', spy);

      await wrapper.connect();
      expect(spy.calledOnce).to.be.true;

      await wrapper.destroy();
    });

    it('should reject connecting twice', async function () {
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        port: serverPort,
        caPath: path.join(CERTS_DIR, 'ca-cert.pem'),
        certPath: path.join(CERTS_DIR, 'client-cert.pem'),
        keyPath: path.join(CERTS_DIR, 'client-key.pem'),
        validateOnCreate: true
      });

      await wrapper.connect();

      try {
        await wrapper.connect();
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.message).to.include('already connected');
      }

      await wrapper.destroy();
    });

    it('should get peer certificate from connection', async function () {
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        port: serverPort,
        caPath: path.join(CERTS_DIR, 'ca-cert.pem'),
        certPath: path.join(CERTS_DIR, 'client-cert.pem'),
        keyPath: path.join(CERTS_DIR, 'client-key.pem'),
        validateOnCreate: true
      });

      await wrapper.connect();
      const peerCert = wrapper.getPeerCertificate();
      expect(peerCert).to.be.an('object');
      expect(peerCert.subject).to.be.an('object');
      expect(peerCert.subject.CN).to.equal('localhost');

      await wrapper.destroy();
    });

    it('should disconnect gracefully', async function () {
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        port: serverPort,
        caPath: path.join(CERTS_DIR, 'ca-cert.pem'),
        certPath: path.join(CERTS_DIR, 'client-cert.pem'),
        keyPath: path.join(CERTS_DIR, 'client-key.pem'),
        validateOnCreate: true
      });

      await wrapper.connect();
      expect(wrapper.isConnected()).to.be.true;

      await wrapper.disconnect();
      expect(wrapper.socket).to.be.null;
    });

    it('should reject connection with untrusted certificate', async function () {
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        port: serverPort,
        caPath: path.join(CERTS_DIR, 'ca-cert.pem'),
        certPath: path.join(CERTS_DIR, 'untrusted-cert.pem'),
        keyPath: path.join(CERTS_DIR, 'untrusted-key.pem'),
        rejectUnauthorized: true,
        validateOnCreate: false
      });

      try {
        await wrapper.connect();
        expect.fail('Should have rejected');
      } catch (err) {
        // Server rejects untrusted client cert
        expect(err).to.be.an.instanceOf(Error);
      }

      await wrapper.destroy();
    });
  });

  // -- connect error scenarios --

  describe('connect (error scenarios)', function () {
    it('should fail when connecting to non-existent host', async function () {
      this.timeout(15000);
      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        port: 59999,
        handshakeTimeout: 2000,
        validateOnCreate: false
      });

      try {
        await wrapper.connect();
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).to.be.an.instanceOf(Error);
      }
    });

    it('should time out on handshake', async function () {
      this.timeout(15000);
      // Create a server that accepts but never completes TLS handshake
      const net = require('net');
      const fakeServer = net.createServer(function (socket) {
        // Don't send anything – let it hang
      });

      await new Promise(function (resolve) {
        fakeServer.listen(0, '127.0.0.1', resolve);
      });
      const port = fakeServer.address().port;

      const wrapper = new TlsWrapper({
        host: '127.0.0.1',
        port: port,
        rejectUnauthorized: false,
        handshakeTimeout: 500,
        validateOnCreate: false
      });

      try {
        await wrapper.connect();
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err.message).to.include('timeout');
      }

      fakeServer.close();
      await wrapper.destroy();
    });
  });

  // -- TLS_DEFAULTS --

  describe('TLS_DEFAULTS', function () {
    it('should have correct default values', function () {
      expect(TLS_DEFAULTS.port).to.equal(802);
      expect(TLS_DEFAULTS.minVersion).to.equal('TLSv1.2');
      expect(TLS_DEFAULTS.rejectUnauthorized).to.be.true;
      expect(TLS_DEFAULTS.handshakeTimeout).to.equal(10000);
    });
  });
});
