# Test Manual

> Test strategy, test catalog, and mock data policy for node-red-contrib-modbus-pro.
> References: [Agents](../agents.md) | [Work Packages](WORK_PACKAGES.md) | [Architecture](ARCHITECTURE.md)

---

## 1. Test Strategy

### Test Pyramid

```
        ┌─────────────────┐
        │  Integration     │  ← node-red-node-test-helper
        │  (few, expensive)│     End-to-end flows
        ├─────────────────┤
        │   Unit Tests     │  ← Mocha + Chai + Sinon
        │   (many, fast)   │     Per module, isolated
        └─────────────────┘
```

### Tools

| Tool | Version | Purpose |
|------|---------|---------|
| Mocha | ^10.0.0 | Test runner |
| Chai | ^4.0.0 | Assertion library (expect/should) |
| Sinon | ^17.0.0 | Mocking, stubbing, spying |
| nyc | ^15.0.0 | Code coverage (Istanbul) |
| node-red-node-test-helper | ^0.3.0 | Node-RED integration tests |

### Coverage Target

- **Minimum:** 80% line coverage
- **Target:** 90%+ for critical modules (state machine, parser, security)

---

## 2. Mock and Test Data Policy

> **CRITICAL RULE:** All mock and test data MUST be visibly documented
> so they can be quickly found and removed or updated when necessary.

### Directory Structure

```
test/
├── fixtures/              # Static test data
│   ├── README.md          # ← CATALOG of all fixtures (MANDATORY)
│   ├── register-maps/     # Example register maps
│   └── certs/             # Self-signed test certificates
├── mocks/                 # Mock implementations
│   ├── README.md          # ← CATALOG of all mocks (MANDATORY)
│   ├── mock-serial-port.js
│   ├── mock-tcp-socket.js
│   └── mock-modbus-server.js
└── helpers/               # Shared test utilities
    └── test-utils.js
```

### Mandatory Header for Mock Files

Every mock file MUST contain the following header:

```javascript
/**
 * MOCK: [Short description of the mock]
 * SIMULATES: [What is being simulated? e.g. "TCP socket with configurable responses"]
 * USED IN: [List of test files that import this mock]
 * LAST UPDATED: [Date of last change]
 * REMOVABLE: [yes/no – rationale]
 * DEPENDENCIES: [Which modules/APIs are being mocked?]
 */
```

### Inline Test Data in Test Files

Test data defined directly in test files must be prefixed with `// TEST-DATA:`:

```javascript
// TEST-DATA: Example Holding Register Response (FC 03, 2 registers)
const mockResponse = {
  data: [0x1234, 0x5678],
  buffer: Buffer.from([0x12, 0x34, 0x56, 0x78])
};
```

### Update Process

1. On API changes: identify affected mocks in `test/mocks/README.md`
2. Update mocks and set header date
3. Run affected tests and verify
4. Update `test/mocks/README.md` and `test/fixtures/README.md`

---

## 3. Test Catalog

### 3.1 Transport Layer Tests

**File:** `test/unit/transport/tcp-transport.test.js`  
**Work Package:** WP 1.1

| Test | Description | Expected Result |
|------|-------------|-----------------|
| TCP-Connect | Establish connection to mock server | Socket opened, status: connected |
| TCP-Disconnect | Disconnect | Socket closed, no leak |
| TCP-Timeout | Server does not respond | Timeout error after configured time |
| TCP-Reconnect | Connection lost → automatic reconnect | Reconnect after backoff |
| TCP-Invalid-Host | Invalid IP address | Error propagated cleanly |
| TCP-Port-Conflict | Port already in use | Descriptive error message |

**File:** `test/unit/transport/rtu-transport.test.js`  
**Work Package:** WP 1.1

| Test | Description | Expected Result |
|------|-------------|-----------------|
| RTU-Connect | Serial connection via mock | Port opened |
| RTU-No-Serialport | serialport not installed | Graceful degradation, no exception |
| RTU-Baudrate | Various baud rates (9600, 19200, etc.) | Correctly configured |
| RTU-Parity | None, Even, Odd | Correctly passed through |

### 3.2 State Machine Tests

**File:** `test/unit/state-machine/connection-machine.test.js`  
**Work Package:** WP 1.3

| Test | Description | Expected Result |
|------|-------------|-----------------|
| Initial-State | Machine starts | State: DISCONNECTED |
| Connect-Success | DISCONNECTED → CONNECT | Transition to CONNECTED |
| Connect-Failure | CONNECTING → FAILURE | Transition to ERROR |
| Error-to-Backoff | ERROR → RETRY | Transition to BACKOFF |
| Backoff-Exponential | Multiple retries | Wait time doubles (1s, 2s, 4s, ...) |
| Max-Retries | Retries exceeded | Transition to DISCONNECTED (final) |
| Guard-isConnected | READ_REQUEST in DISCONNECTED state | Request rejected |
| Guard-isQueueFull | Request when queue is full | Request rejected/dropped |
| Read-While-Reading | Second READ during active READ | Queue or rejection |
| Disconnect-While-Reading | DISCONNECT during READ | Socket closed, READ aborted |
| Rapid-Transitions | Fast event sequence | No undefined state |

### 3.3 Queue/Backpressure Tests

**File:** `test/unit/queue/backpressure-queue.test.js`  
**Work Package:** WP 2.3

| Test | Description | Expected Result |
|------|-------------|-----------------|
| Enqueue | Enqueue message | Queue size +1 |
| Dequeue | Dequeue message | FIFO order |
| Max-Size | Queue full (e.g. 100) | Next message is dropped |
| Drop-FIFO | Overflow with FIFO strategy | Oldest message removed |
| Drop-LIFO | Overflow with LIFO strategy | Newest message not enqueued |
| Memory-Constant | 10,000 messages with max=100 | Memory remains constant |
| Empty-Dequeue | Dequeue from empty queue | undefined/null, no error |
| Concurrent | Parallel enqueue/dequeue | Thread-safe (event loop) |

**File:** `test/unit/queue/connection-pool.test.js`  
**Work Package:** WP 1.4

| Test | Description | Expected Result |
|------|-------------|-----------------|
| Pool-Create | Create pool with size=3 | 3 sockets available |
| Acquire-Release | Check out and return socket | Reusable |
| Pool-Exhausted | All sockets checked out | Wait or error |
| Pool-Drain | Close pool | All sockets closed, no leak |

**File:** `test/unit/queue/rtu-semaphore.test.js`  
**Work Package:** WP 1.4

| Test | Description | Expected Result |
|------|-------------|-----------------|
| Serial-Access | 2 parallel requests | Strictly sequential execution |
| Release-After-Response | Request completed | Semaphore released |
| Release-After-Timeout | Timeout without response | Semaphore released after timeout |

### 3.4 Parser/Endianness Tests

**File:** `test/unit/parser/buffer-parser.test.js`  
**Work Package:** WP 2.4

| Test | Description | Expected Result |
|------|-------------|-----------------|
| UInt16-BE | Buffer [0x12, 0x34] | 4660 (0x1234) |
| UInt16-LE | Buffer [0x34, 0x12] | 4660 (0x1234) |
| Float32-BE | 2 registers → Float32 big-endian | IEEE 754 correct |
| Float32-LE | 2 registers → Float32 little-endian | Word swap correct |
| Float32-BE-Swap | Byte swap big-endian | Correct byte order |
| Float32-LE-Swap | Byte swap little-endian | Correct order |
| Int32-Signed | Negative values across 2 registers | Correctly interpreted as signed |
| UInt32 | Large positive values | Correctly interpreted as unsigned |
| Zero-Value | All bytes 0x00 | 0 / 0.0 |
| Max-Value | All bytes 0xFF | Correct maximum values |
| NaN | Float32 NaN representation | NaN detected |
| Infinity | Float32 Infinity | Infinity detected |

**File:** `test/unit/parser/payload-builder.test.js`  
**Work Package:** WP 2.4

| Test | Description | Expected Result |
|------|-------------|-----------------|
| Build-FC03 | Holding register response | msg.payload with data, buffer, fc, address, timestamp |
| Build-FC01 | Coil response | Boolean array in data |
| Metadata | All metadata present | unitId, connection, timestamp correct |
| Timestamp-Format | ISO 8601 | Valid date |

### 3.5 Security Tests

**File:** `test/unit/security/tls-wrapper.test.js`  
**Work Package:** WP 4.1

| Test | Description | Expected Result |
|------|-------------|-----------------|
| TLS-Connect | Connection with valid certificates | TLS handshake successful |
| TLS-Invalid-Cert | Invalid client certificate | Connection rejected |
| TLS-Expired-Cert | Expired certificate | Connection rejected |
| TLS-No-CA | Missing CA certificate | Validation error |
| TLS-Min-Version | TLS < 1.2 | Connection rejected |
| TLS-Port-802 | Default port with TLS | Port 802 |

**File:** `test/unit/security/certificate-validator.test.js`  
**Work Package:** WP 4.3

| Test | Description | Expected Result |
|------|-------------|-----------------|
| Valid-Cert | Valid X.509v3 | Validation passed |
| RBAC-Extract | Role from extension | Correct role string |
| Credential-Store | Private key in credentials | Not in flow.json |

### 3.6 Integration Tests

**File:** `test/integration/modbus-read.test.js`  
**Work Package:** WP 2.1

| Test | Description | Expected Result |
|------|-------------|-----------------|
| Read-FC03 | Complete flow: Inject → Read → Debug | Correct register values |
| Read-FC01 | Read coils | Boolean array |
| Read-Polling | Interval-based reading | Regular messages |
| Read-Error | Server unreachable | Error output, status red |

**File:** `test/integration/modbus-write.test.js`  
**Work Package:** WP 2.2

| Test | Description | Expected Result |
|------|-------------|-----------------|
| Write-FC06 | Write single register | Confirmation |
| Write-FC16 | Write multiple registers | Confirmation |
| Write-FC05 | Write single coil (boolean) | Confirmation |

**File:** `test/integration/modbus-server-proxy.test.js`  
**Work Package:** WP 3.1–3.3

| Test | Description | Expected Result |
|------|-------------|-----------------|
| Proxy-Read | Client → Server → Flow → Response | Correct data returned |
| Proxy-Write | Client → Server → Flow → Confirmation | Write confirmation |
| Proxy-Timeout | Flow does not respond in time | Timeout to client |

### 3.7 Leak Tests (Partial Deploy)

**File:** `test/integration/lifecycle.test.js`  
**Work Package:** WP 5.2

| Test | Description | Expected Result |
|------|-------------|-----------------|
| Partial-Deploy | Remove node and deploy | No listener leaks |
| Full-Deploy | Re-deploy entire flow | All sockets closed |
| Rapid-Deploy | 10x fast consecutive deploys | No memory leak |
| Close-Cleanup | node.on('close') verification | removeAllListeners called |

---

## 4. Running Tests

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# With coverage
npm run test:coverage

# Single test
npx mocha test/unit/parser/buffer-parser.test.js
```

---

## 5. Adding New Tests

### Checklist for New Tests

- [ ] Test file follows the pattern `*.test.js`
- [ ] Located in the correct folder (`test/unit/<module>/` or `test/integration/`)
- [ ] Inline test data marked with `// TEST-DATA:`
- [ ] New mocks documented in `test/mocks/README.md`
- [ ] New fixtures documented in `test/fixtures/README.md`
- [ ] Mock header comment present (if new mock file)
- [ ] Coverage has not decreased

### Template for New Unit Tests

```javascript
'use strict';

const { expect } = require('chai');
const sinon = require('sinon');

// Module under test
// const { myFunction } = require('../../../src/lib/<module>/<file>');

describe('<ModuleName>', function () {
  // Setup/Teardown
  beforeEach(function () {
    // Set up mocks and stubs
  });

  afterEach(function () {
    sinon.restore();
  });

  describe('<FunctionName>', function () {
    it('should <expected behavior>', function () {
      // TEST-DATA: Description of test data
      const input = { /* ... */ };
      const expected = { /* ... */ };

      // const result = myFunction(input);
      // expect(result).to.deep.equal(expected);
    });
  });
});
```

---

## 6. Test Documentation Maintenance

> This documentation MUST be updated with every change to the test suite.

**Update required when:**
- New test files → update test catalog (§3)
- New mocks → update `test/mocks/README.md`
- New fixtures → update `test/fixtures/README.md`
