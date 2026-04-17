#!/usr/bin/env node
'use strict';

/**
 * Generate self-signed test certificates for unit/integration tests.
 * Uses Node.js crypto module (no external OpenSSL dependency).
 * Run: node test/fixtures/certs/generate-certs.js
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CERTS_DIR = path.join(__dirname);

function generateKeyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
}

function generateSelfSignedCert(subject, keyPair, options = {}) {
  // Use Node.js X509Certificate generation via crypto.createCertificate (Node 20+)
  // Fallback: use child_process with node -e for older versions
  const { privateKey, publicKey } = keyPair;
  const days = options.days || 3650;
  const extensions = options.extensions || [];
  const issuerKey = options.issuerKey || privateKey;
  const issuerSubject = options.issuerSubject || subject;

  // We need to use the forge-like approach or spawn openssl
  // Since openssl is not available, we use a pure JS approach via ASN1 construction
  // Actually, Node.js 20+ doesn't have built-in cert generation.
  // We'll use the 'selfsigned' approach via crypto.sign

  // Let's use a simpler approach - create certificates using the X509 API indirectly
  // by creating CSR and signing
  return null; // placeholder
}

// Since Node.js doesn't have built-in X509 cert generation without OpenSSL,
// we'll generate certs using a small inline DER/ASN1 builder

const forge = (() => {
  // Minimal ASN1/DER certificate builder
  // This creates valid X.509v3 certificates using only Node.js crypto

  function intToBytes(n, len) {
    const buf = Buffer.alloc(len);
    for (let i = len - 1; i >= 0; i--) {
      buf[i] = n & 0xff;
      n >>= 8;
    }
    return buf;
  }

  function derLength(len) {
    if (len < 0x80) return Buffer.from([len]);
    if (len < 0x100) return Buffer.from([0x81, len]);
    return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
  }

  function derSequence(...items) {
    const content = Buffer.concat(items);
    return Buffer.concat([Buffer.from([0x30]), derLength(content.length), content]);
  }

  function derSet(...items) {
    const content = Buffer.concat(items);
    return Buffer.concat([Buffer.from([0x31]), derLength(content.length), content]);
  }

  function derOid(oid) {
    const parts = oid.split('.').map(Number);
    const bytes = [40 * parts[0] + parts[1]];
    for (let i = 2; i < parts.length; i++) {
      let v = parts[i];
      if (v >= 128) {
        const enc = [];
        enc.push(v & 0x7f);
        v >>= 7;
        while (v > 0) {
          enc.push(0x80 | (v & 0x7f));
          v >>= 7;
        }
        enc.reverse();
        bytes.push(...enc);
      } else {
        bytes.push(v);
      }
    }
    const buf = Buffer.from(bytes);
    return Buffer.concat([Buffer.from([0x06]), derLength(buf.length), buf]);
  }

  function derUtf8String(str) {
    const buf = Buffer.from(str, 'utf8');
    return Buffer.concat([Buffer.from([0x0c]), derLength(buf.length), buf]);
  }

  function derPrintableString(str) {
    const buf = Buffer.from(str, 'ascii');
    return Buffer.concat([Buffer.from([0x13]), derLength(buf.length), buf]);
  }

  function derInteger(n) {
    if (Buffer.isBuffer(n)) {
      // Ensure leading zero for positive numbers with high bit set
      const bytes = n[0] >= 0x80 ? Buffer.concat([Buffer.from([0x00]), n]) : n;
      return Buffer.concat([Buffer.from([0x02]), derLength(bytes.length), bytes]);
    }
    if (n < 0x80) return Buffer.from([0x02, 0x01, n]);
    if (n < 0x8000) return Buffer.from([0x02, 0x02, (n >> 8) & 0xff, n & 0xff]);
    const hex = n.toString(16);
    const padded = hex.length % 2 ? '0' + hex : hex;
    const buf = Buffer.from(padded, 'hex');
    const bytes = buf[0] >= 0x80 ? Buffer.concat([Buffer.from([0x00]), buf]) : buf;
    return Buffer.concat([Buffer.from([0x02]), derLength(bytes.length), bytes]);
  }

  function derBitString(buf) {
    const content = Buffer.concat([Buffer.from([0x00]), buf]); // 0 unused bits
    return Buffer.concat([Buffer.from([0x03]), derLength(content.length), content]);
  }

  function derOctetString(buf) {
    return Buffer.concat([Buffer.from([0x04]), derLength(buf.length), buf]);
  }

  function derBool(v) {
    return Buffer.from([0x01, 0x01, v ? 0xff : 0x00]);
  }

  function derGeneralizedTime(date) {
    const s = date.toISOString().replace(/[-:T]/g, '').replace(/\.\d+Z/, 'Z');
    const buf = Buffer.from(s, 'ascii');
    return Buffer.concat([Buffer.from([0x18]), derLength(buf.length), buf]);
  }

  function derContextTag(tag, content, constructed = true) {
    const tagByte = 0x80 | (constructed ? 0x20 : 0) | tag;
    return Buffer.concat([Buffer.from([tagByte]), derLength(content.length), content]);
  }

  function buildRDN(attrs) {
    const rdnEntries = attrs.map(({ oid, value, printable }) => {
      const valEnc = printable ? derPrintableString(value) : derUtf8String(value);
      return derSet(derSequence(derOid(oid), valEnc));
    });
    return derSequence(...rdnEntries);
  }

  // OIDs
  const OID = {
    CN: '2.5.4.3',
    OU: '2.5.4.11',
    O: '2.5.4.10',
    C: '2.5.4.6',
    sha256WithRSA: '1.2.840.113549.1.1.11',
    rsaEncryption: '1.2.840.113549.1.1.1',
    basicConstraints: '2.5.29.19',
    keyUsage: '2.5.29.15',
    subjectAltName: '2.5.29.17',
    authorityKeyIdentifier: '2.5.29.35',
    subjectKeyIdentifier: '2.5.29.14',
  };

  function getPublicKeyDer(publicKeyPem) {
    const b64 = publicKeyPem
      .replace(/-----BEGIN PUBLIC KEY-----/, '')
      .replace(/-----END PUBLIC KEY-----/, '')
      .replace(/\s/g, '');
    return Buffer.from(b64, 'base64');
  }

  function createCertificate(options) {
    const {
      subject, issuerSubject, serialNumber,
      notBefore, notAfter,
      publicKeyPem, signingKeyPem,
      isCA, sans
    } = options;

    const subjectRdn = buildRDN(subject);
    const issuerRdn = buildRDN(issuerSubject || subject);
    const serial = derInteger(Buffer.from(serialNumber || crypto.randomBytes(16).toString('hex'), 'hex'));

    const sigAlgId = derSequence(derOid(OID.sha256WithRSA), Buffer.from([0x05, 0x00]));
    const validity = derSequence(
      derGeneralizedTime(notBefore),
      derGeneralizedTime(notAfter)
    );

    const pubKeyDer = getPublicKeyDer(publicKeyPem);

    // Extensions
    const exts = [];

    // Basic Constraints
    if (isCA) {
      exts.push(derSequence(
        derOid(OID.basicConstraints),
        derBool(true), // critical
        derOctetString(derSequence(derBool(true)))
      ));
    }

    // Subject Alternative Name
    if (sans && sans.length > 0) {
      const sanEntries = sans.map(san => {
        if (san.type === 'dns') {
          const buf = Buffer.from(san.value, 'ascii');
          return Buffer.concat([Buffer.from([0x82]), derLength(buf.length), buf]);
        } else if (san.type === 'ip') {
          const parts = san.value.split('.').map(Number);
          const buf = Buffer.from(parts);
          return Buffer.concat([Buffer.from([0x87]), derLength(buf.length), buf]);
        }
        return Buffer.alloc(0);
      });
      exts.push(derSequence(
        derOid(OID.subjectAltName),
        derOctetString(derSequence(...sanEntries))
      ));
    }

    const extensionsCtx = exts.length > 0
      ? derContextTag(3, derSequence(...exts))
      : Buffer.alloc(0);

    // TBSCertificate
    const tbs = derSequence(
      derContextTag(0, derInteger(2)), // version v3
      serial,
      sigAlgId,
      issuerRdn,
      validity,
      subjectRdn,
      pubKeyDer,
      extensionsCtx
    );

    // Sign
    const signer = crypto.createSign('SHA256');
    signer.update(tbs);
    const signature = signer.sign(signingKeyPem);

    // Certificate
    const cert = derSequence(
      tbs,
      sigAlgId,
      derBitString(signature)
    );

    // Convert to PEM
    const b64 = cert.toString('base64');
    const lines = b64.match(/.{1,64}/g) || [];
    return '-----BEGIN CERTIFICATE-----\n' + lines.join('\n') + '\n-----END CERTIFICATE-----\n';
  }

  return { createCertificate, OID };
})();

// Generate all certificates
console.log('Generating test certificates in:', CERTS_DIR);

// 1. CA key pair
const caKeys = generateKeyPair();
fs.writeFileSync(path.join(CERTS_DIR, 'ca-key.pem'), caKeys.privateKey);
console.log('  ca-key.pem');

// 2. CA certificate (self-signed, 10 years)
const now = new Date();
const caCert = forge.createCertificate({
  subject: [
    { oid: forge.OID.CN, value: 'TestCA', printable: true },
    { oid: forge.OID.O, value: 'TestOrg', printable: true },
    { oid: forge.OID.C, value: 'DE', printable: true }
  ],
  notBefore: new Date(now.getTime() - 86400000),
  notAfter: new Date(now.getTime() + 10 * 365.25 * 86400000),
  publicKeyPem: caKeys.publicKey,
  signingKeyPem: caKeys.privateKey,
  isCA: true
});
fs.writeFileSync(path.join(CERTS_DIR, 'ca-cert.pem'), caCert);
console.log('  ca-cert.pem');

// 3. Server key pair
const serverKeys = generateKeyPair();
fs.writeFileSync(path.join(CERTS_DIR, 'server-key.pem'), serverKeys.privateKey);
console.log('  server-key.pem');

// 4. Server certificate (signed by CA, CN=localhost, SAN=localhost,127.0.0.1)
const serverCert = forge.createCertificate({
  subject: [
    { oid: forge.OID.CN, value: 'localhost', printable: true }
  ],
  issuerSubject: [
    { oid: forge.OID.CN, value: 'TestCA', printable: true },
    { oid: forge.OID.O, value: 'TestOrg', printable: true },
    { oid: forge.OID.C, value: 'DE', printable: true }
  ],
  notBefore: new Date(now.getTime() - 86400000),
  notAfter: new Date(now.getTime() + 5 * 365.25 * 86400000),
  publicKeyPem: serverKeys.publicKey,
  signingKeyPem: caKeys.privateKey,
  sans: [
    { type: 'dns', value: 'localhost' },
    { type: 'ip', value: '127.0.0.1' }
  ]
});
fs.writeFileSync(path.join(CERTS_DIR, 'server-cert.pem'), serverCert);
console.log('  server-cert.pem');

// 5. Client key pair
const clientKeys = generateKeyPair();
fs.writeFileSync(path.join(CERTS_DIR, 'client-key.pem'), clientKeys.privateKey);
console.log('  client-key.pem');

// 6. Client certificate (signed by CA, CN=TestClient, OU=ModbusOperator)
const clientCert = forge.createCertificate({
  subject: [
    { oid: forge.OID.CN, value: 'TestClient', printable: true },
    { oid: forge.OID.OU, value: 'ModbusOperator', printable: true }
  ],
  issuerSubject: [
    { oid: forge.OID.CN, value: 'TestCA', printable: true },
    { oid: forge.OID.O, value: 'TestOrg', printable: true },
    { oid: forge.OID.C, value: 'DE', printable: true }
  ],
  notBefore: new Date(now.getTime() - 86400000),
  notAfter: new Date(now.getTime() + 5 * 365.25 * 86400000),
  publicKeyPem: clientKeys.publicKey,
  signingKeyPem: caKeys.privateKey
});
fs.writeFileSync(path.join(CERTS_DIR, 'client-cert.pem'), clientCert);
console.log('  client-cert.pem');

// 7. Encrypted client key (AES-256, passphrase: testpass123)
// Re-encrypt the client's actual private key so it matches client-cert.pem
const clientPrivateKeyObj = crypto.createPrivateKey(clientKeys.privateKey);
const encryptedClientKey = clientPrivateKeyObj.export({
  type: 'pkcs8',
  format: 'pem',
  cipher: 'aes-256-cbc',
  passphrase: 'testpass123'
});
fs.writeFileSync(path.join(CERTS_DIR, 'client-key-encrypted.pem'), encryptedClientKey);
console.log('  client-key-encrypted.pem');

// 8. Untrusted key pair (self-signed, NOT signed by CA)
const untrustedKeys = generateKeyPair();
fs.writeFileSync(path.join(CERTS_DIR, 'untrusted-key.pem'), untrustedKeys.privateKey);
const untrustedCert = forge.createCertificate({
  subject: [
    { oid: forge.OID.CN, value: 'untrusted', printable: true }
  ],
  notBefore: new Date(now.getTime() - 86400000),
  notAfter: new Date(now.getTime() + 5 * 365.25 * 86400000),
  publicKeyPem: untrustedKeys.publicKey,
  signingKeyPem: untrustedKeys.privateKey
});
fs.writeFileSync(path.join(CERTS_DIR, 'untrusted-cert.pem'), untrustedCert);
fs.writeFileSync(path.join(CERTS_DIR, 'untrusted-key.pem'), untrustedKeys.privateKey);
console.log('  untrusted-cert.pem');
console.log('  untrusted-key.pem');

// 9. Expired certificate (1 day validity, already expired)
const expiredKeys = generateKeyPair();
fs.writeFileSync(path.join(CERTS_DIR, 'expired-key.pem'), expiredKeys.privateKey);
const expiredCert = forge.createCertificate({
  subject: [
    { oid: forge.OID.CN, value: 'expired', printable: true }
  ],
  notBefore: new Date(now.getTime() - 2 * 86400000),
  notAfter: new Date(now.getTime() - 86400000),
  publicKeyPem: expiredKeys.publicKey,
  signingKeyPem: expiredKeys.privateKey
});
fs.writeFileSync(path.join(CERTS_DIR, 'expired-cert.pem'), expiredCert);
console.log('  expired-cert.pem');
console.log('  expired-key.pem');

console.log('\nAll test certificates generated successfully!');
