# Test Fixtures Catalog
> MANDATORY DOCUMENT: Every fixture file in this directory MUST be cataloged here.
> See also: [Test Manual](../../docs/TEST_MANUAL.md) | [agents.md](../../agents.md) §5
---
## Directory Structure
```
test/fixtures/
├── README.md              ← This document (catalog)
├── register-maps/         # Example register maps of various devices
└── certs/                 # Self-signed test certificates
```
## Catalog
### register-maps/
| File | Description | Used In | Last Updated | Removable? |
|------|-------------|---------|-------------|------------|
| `energy-meter.json` | Generic energy meter register map with Float32, UInt32, UInt16 values | `test/unit/parser/*.test.js`, `test/integration/modbus-read.test.js` | 2026-04-16 | no – used for parser and integration tests |
| `temperature-sensor.json` | Temperature sensor with Float32 values in all 4 byte order variants | `test/unit/parser/buffer-parser.test.js` | 2026-04-16 | no – used for endianness tests |
| `digital-io.json` | Digital I/O module with coils and discrete inputs | `test/integration/modbus-read.test.js` | 2026-04-16 | no – used for boolean data tests |
### certs/
| File | Description | Used In | Last Updated | Removable? |
|------|-------------|---------|-------------|------------|
| `ca-cert.pem` | Self-signed CA certificate (RSA 2048, 10 years, CN=TestCA) | `test/unit/security/*.test.js` | 2026-04-16 | no – CA root for all test certs |
| `ca-key.pem` | CA private key (RSA 2048) | `test/unit/security/*.test.js` | 2026-04-16 | no – signs server/client certs |
| `server-cert.pem` | Server certificate signed by CA (CN=localhost, SAN=localhost,127.0.0.1) | `test/unit/security/tls-wrapper.test.js` | 2026-04-16 | no – TLS server identity in integration tests |
| `server-key.pem` | Server private key (RSA 2048) | `test/unit/security/tls-wrapper.test.js` | 2026-04-16 | no – TLS server key |
| `client-cert.pem` | Client certificate signed by CA (CN=TestClient, OU=ModbusOperator) | `test/unit/security/*.test.js` | 2026-04-16 | no – mTLS client auth and RBAC tests |
| `client-key.pem` | Client private key (RSA 2048) | `test/unit/security/*.test.js` | 2026-04-16 | no – mTLS client key |
| `client-key-encrypted.pem` | Client private key encrypted with AES-256 (passphrase: testpass123) | `test/unit/security/certificate-validator.test.js` | 2026-04-16 | no – passphrase validation tests |
| `untrusted-cert.pem` | Self-signed certificate NOT signed by CA (CN=untrusted) | `test/unit/security/tls-wrapper.test.js` | 2026-04-16 | no – negative test for untrusted certs |
| `untrusted-key.pem` | Private key for untrusted certificate | `test/unit/security/tls-wrapper.test.js` | 2026-04-16 | no – pairs with untrusted-cert |
| `expired-cert.pem` | Short-lived certificate for expiry tests (1 day validity) | `test/unit/security/certificate-validator.test.js` | 2026-04-16 | no – expiry detection tests |
| `expired-key.pem` | Private key for expired certificate | `test/unit/security/certificate-validator.test.js` | 2026-04-16 | no – pairs with expired-cert |
---
## Guidelines
1. **Every new fixture file** must be registered in the table above
2. **No production data** – only synthetic, generated test data
3. **No real certificates** – only self-signed for tests
4. **Description** must clearly state what the fixture simulates
5. **Used In** must list the test files that use this fixture
