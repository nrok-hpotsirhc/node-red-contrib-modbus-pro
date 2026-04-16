# Work Packages (Work Breakdown Structure)

> Detailed description of all work packages for node-red-contrib-modbus-forge.
> Milestone grouping: see [MILESTONES.md](../MILESTONES.md)
> Theoretical foundations: see [THEORETICAL_FOUNDATIONS.md](THEORETICAL_FOUNDATIONS.md)
> Agent guide: see [agents.md](../agents.md)

---

## WP 1: Core Framework, Transport Layer and Connection Pooling

### WP 1.1: Transport Layer Abstraction

**Milestone:** MS-1  
**Dependencies:** None (starting package)  
**Theoretical Foundation:** [§2 Transport Layers](THEORETICAL_FOUNDATIONS.md#2-transport-layers-modbus-rtu-vs-modbus-tcp)

**Description:**
Evaluation and abstraction of the `modbus-serial` library (ISC license) as the primary transport layer. The encapsulation of the `serialport` dependency must be designed so that the node can be installed error-free on systems without RS-485 hardware (e.g. cloud containers) and used purely over TCP.

**Tasks:**
1. Factory pattern for transport selection (TCP vs. RTU)
2. TCP transport: socket creation via `modbus-serial.connectTCP()`
3. RTU transport: serial creation via `modbus-serial.connectRTUBuffered()` with fallback
4. Graceful degradation: if `serialport` is not installed, disable RTU functions instead of crashing
5. Unified interface for both transport types (connect, disconnect, isOpen, getID, setID)

**Output Files:**
- `src/lib/transport/tcp-transport.js`
- `src/lib/transport/rtu-transport.js`
- `src/lib/transport/transport-factory.js`
- `test/unit/transport/tcp-transport.test.js`
- `test/unit/transport/rtu-transport.test.js`

---

### WP 1.2: Configuration Nodes (Config Nodes)

**Milestone:** MS-1  
**Dependencies:** WP 1.1  
**Theoretical Foundation:** [§2 Transport Layers](THEORETICAL_FOUNDATIONS.md#2-transport-layers-modbus-rtu-vs-modbus-tcp)

**Description:**
Development of the central Node-RED configuration nodes as singleton instances for managing physical connection parameters. The HTML/JS UI must cover the following parameters:

**TCP Parameters:**
- Host/IP address
- Port (default: 502, with TLS: 802)
- Timeout (ms)
- Unit ID / Slave ID

**RTU Parameters:**
- Serial port (e.g. COM3, /dev/ttyUSB0)
- Baud rate (9600, 19200, 38400, 57600, 115200)
- Parity (None, Even, Odd)
- Data bits (7, 8)
- Stop bits (1, 2)
- Unit ID / Slave ID

**Output Files:**
- `src/nodes/config/modbus-client-config.js`
- `src/nodes/config/modbus-client-config.html`

---

### WP 1.3: XState State Machine

**Milestone:** MS-2  
**Dependencies:** WP 1.1, WP 1.2  
**Theoretical Foundation:** [§6 Deterministic State Management](THEORETICAL_FOUNDATIONS.md#6-deterministic-state-management-via-xstate)

**Description:**
Implementation of a formalized state machine using XState v5, deterministically modeling the entire connection lifecycle. Replaces the hand-coded, error-prone FSM of the legacy package.

**States:**
```
DISCONNECTED → CONNECTING → CONNECTED → READING/WRITING → CONNECTED
                    ↓                         ↓
               ERROR → BACKOFF → RECONNECTING → CONNECTING
                                      ↓
                              DISCONNECTED (max retries)
```

**XState Elements:**
- **States:** DISCONNECTED, CONNECTING, CONNECTED, READING, WRITING, ERROR, BACKOFF, RECONNECTING
- **Events:** CONNECT, DISCONNECT, READ_REQUEST, WRITE_REQUEST, SUCCESS, FAILURE, TIMEOUT, RETRY
- **Guards:** isConnected, isQueueFull, hasRetriesLeft, isValidRequest
- **Actions:** openSocket, closeSocket, enqueueRequest, dequeueRequest, updateStatus, incrementRetry

**Integration with Node-RED:**
- `this.status()` API calls as XState actions
- Green: CONNECTED, Red: DISCONNECTED/ERROR, Yellow: BACKOFF/RECONNECTING

**Output Files:**
- `src/lib/state-machine/connection-machine.js`
- `src/lib/state-machine/guards.js`
- `src/lib/state-machine/actions.js`
- `test/unit/state-machine/connection-machine.test.js`

---

### WP 1.4: Connection Pool (TCP) and Semaphore (RTU)

**Milestone:** MS-2  
**Dependencies:** WP 1.3  
**Theoretical Foundation:** [§6.1 Connection Pooling](THEORETICAL_FOUNDATIONS.md#6-deterministic-state-management-via-xstate)

**Description:**
- **TCP:** Connection pool analogous to database drivers. Requests are distributed across parallel sockets via multiplexing. Pool size is configurable to respect SYN flood protection of target PLCs.
- **RTU:** Since RS-485 is half-duplex, the config node acts as an asynchronous arbitrator (semaphore). All read/write requests are converted to promises in a serial queue. Only after receiving a response (or timeout) is the next request sent.

**Output Files:**
- `src/lib/queue/connection-pool.js`
- `src/lib/queue/rtu-semaphore.js`
- `test/unit/queue/connection-pool.test.js`
- `test/unit/queue/rtu-semaphore.test.js`

---

## WP 2: Modbus Client / Master Nodes

### WP 2.1: Getter Nodes (Read Function Codes)

**Milestone:** MS-3  
**Dependencies:** WP 1.1–1.4  
**Theoretical Foundation:** [§3 Data Model and Function Codes](THEORETICAL_FOUNDATIONS.md#3-the-modbus-data-model)

**Description:**
Implementation of read nodes for FC 01 (Read Coils), FC 02 (Read Discrete Inputs), FC 03 (Read Holding Registers) and FC 04 (Read Input Registers).

**UI Elements:**
- Dropdown: Function code selection
- Input: Start address
- Input: Number of registers/coils
- Toggle: Zero-based vs. one-based addressing (with tooltip explanation)
- Dropdown: Polling mode (trigger-based or interval)

**Address Offset Logic:**
When one-based is enabled: UI shows 40001, internal offset = 0 (40001 - 40001). Register 40108 → offset 107.

**Output Files:**
- `src/nodes/client/modbus-read.js`
- `src/nodes/client/modbus-read.html`
- `test/integration/modbus-read.test.js`

---

### WP 2.2: Setter Nodes (Write Function Codes)

**Milestone:** MS-4  
**Dependencies:** WP 2.1  
**Theoretical Foundation:** [§3 Data Model and Function Codes](THEORETICAL_FOUNDATIONS.md#3-the-modbus-data-model)

**Description:**
Implementation of write nodes for FC 05 (Write Single Coil), FC 06 (Write Single Register), FC 15 (Write Multiple Coils) and FC 16 (Write Multiple Registers).

**Specifics:**
- FC 05: msg.payload as boolean or 0xFF00/0x0000
- FC 06: msg.payload as integer (0–65535)
- FC 15: msg.payload as boolean array → conversion to bit-packed buffer
- FC 16: msg.payload as integer array → validation for 16-bit range

**Output Files:**
- `src/nodes/client/modbus-write.js`
- `src/nodes/client/modbus-write.html`
- `test/integration/modbus-write.test.js`

---

### WP 2.3: Backpressure Management

**Milestone:** MS-4  
**Dependencies:** WP 1.4  
**Theoretical Foundation:** [§7 Backpressure Management](THEORETICAL_FOUNDATIONS.md#7-backpressure-management)

**Description:**
Implementation of a configurable queue with a hard limit to protect the Node.js event loop.

**Configuration Parameters:**
- **Max Queue Size:** Hard limit (default: 100)
- **Drop Strategy:**
  - FIFO (First-In-First-Out): Oldest message is discarded → ideal for continuous sensor monitoring
  - LIFO (Last-In-First-Out): Newest message is discarded → ideal for alarm events
- **Queue Full Status:** `this.status({ fill: "yellow", shape: "ring", text: "Queue full" })`

**Output Files:**
- `src/lib/queue/backpressure-queue.js`
- `test/unit/queue/backpressure-queue.test.js`

---

### WP 2.4: Payload Standardization and Buffer Parsing

**Milestone:** MS-3  
**Dependencies:** WP 2.1  
**Theoretical Foundation:** [§4 Endianness in JavaScript](THEORETICAL_FOUNDATIONS.md#4-endianness-in-javascript)

**Description:**
Standardization of the Node-RED payload with metadata and implementation of buffer parsing for the endianness challenge with 32-bit floats.

**msg.payload Structure:**
```json
{
  "data": [1234, 5678],
  "buffer": "<Buffer 04 d2 16 2e>",
  "fc": 3,
  "address": 107,
  "quantity": 2,
  "unitId": 1,
  "timestamp": "2026-04-16T10:00:00.000Z",
  "connection": "tcp://192.168.1.100:502"
}
```

**Buffer Parsing Options:**
- Big-Endian (standard Modbus)
- Little-Endian
- Big-Endian Byte Swap
- Little-Endian Byte Swap
- Float32 IEEE 754 (from 2 consecutive registers)
- UInt32 / Int32 (from 2 consecutive registers)

**Output Files:**
- `src/lib/parser/buffer-parser.js`
- `src/lib/parser/payload-builder.js`
- `test/unit/parser/buffer-parser.test.js`
- `test/unit/parser/payload-builder.test.js`
- `test/fixtures/register-maps/` (example data)

---

## WP 3: Modbus Server / Slave Proxy Nodes

### WP 3.1: TCP/RTU Listener Architecture

**Milestone:** MS-5  
**Dependencies:** WP 1.1–1.4  
**Theoretical Foundation:** [§8 Dynamic Address Space Mapping](THEORETICAL_FOUNDATIONS.md#8-dynamic-address-space-mapping)

**Description:**
Implementation of the TCP/RTU listener architecture, inspired by the event-based design of `jsmodbus` (MIT license). The server config node acts as a pure TCP listener that emits incoming Modbus requests as events.

**Architecture:**
```
External Client → TCP:502 → Server Config Node → Emit event
                                                      ↓
                                               Modbus-In Node (Flow)
                                                      ↓
                                               Flow Processing
                                                      ↓
                                               Modbus-Out Node
                                                      ↓
                                         TCP Response → Client
```

**Output Files:**
- `src/nodes/config/modbus-server-config.js`
- `src/nodes/config/modbus-server-config.html`

---

### WP 3.2: Modbus-In Node

**Milestone:** MS-5  
**Dependencies:** WP 3.1

**Description:**
Development of the Modbus-In node that subscribes to events from the server config node and forwards them as structured JSON messages into the Node-RED flow.

**msg.payload for incoming request:**
```json
{
  "type": "readHoldingRegisters",
  "fc": 3,
  "address": 107,
  "quantity": 2,
  "unitId": 1,
  "requestId": "uuid-v4",
  "remoteAddress": "192.168.1.50"
}
```

**Output Files:**
- `src/nodes/server/modbus-in.js`
- `src/nodes/server/modbus-in.html`

---

### WP 3.3: Modbus-Out Node

**Milestone:** MS-5  
**Dependencies:** WP 3.2

**Description:**
Development of the Modbus-Out node that collects the values asynchronously computed by the flow, generates the correct Modbus response frame, and sends it to the waiting client.

**msg.payload for response:**
```json
{
  "requestId": "uuid-v4",
  "data": [1234, 5678]
}
```

**Output Files:**
- `src/nodes/server/modbus-out.js`
- `src/nodes/server/modbus-out.html`
- `test/integration/modbus-server-proxy.test.js`

---

### WP 3.4: In-Memory Caching (Optional)

**Milestone:** MS-6  
**Dependencies:** WP 3.1–3.3

**Description:**
Optional, memory-efficient caching engine in the server config node. Implemented as a hashmap (Map<number, { value, ttl, timestamp }>), which maps fragmented, non-linear address spaces without waste.

**Configuration:**
- Enable/disable cache
- TTL (Time-to-Live) per entry
- Max cache size
- Automatic invalidation on write operations

**Output Files:**
- `src/lib/cache/register-cache.js`
- `test/unit/cache/register-cache.test.js`

---

## WP 4: Modbus/TCP Security and Credential Management

### WP 4.1: TLS Integration

**Milestone:** MS-7  
**Dependencies:** WP 1.1–1.4  
**Theoretical Foundation:** [§5 Modbus/TCP Security](THEORETICAL_FOUNDATIONS.md#5-modbustcp-security-protocol)

**Description:**
Integration of `node:tls` into the socket generation of the config node. When TLS is enabled, the TCP socket is replaced by a TLS socket that enforces TLS 1.3 over port 802.

**Implementation:**
```javascript
const tls = require('node:tls');
const options = {
  host: config.host,
  port: config.tlsPort || 802,
  ca: fs.readFileSync(credentials.caPath),
  cert: fs.readFileSync(credentials.certPath),
  key: fs.readFileSync(credentials.keyPath),
  minVersion: 'TLSv1.2',
  rejectUnauthorized: true
};
const socket = tls.connect(options);
```

**Output Files:**
- `src/lib/security/tls-wrapper.js`
- `test/unit/security/tls-wrapper.test.js`

---

### WP 4.2: Credential UI

**Milestone:** MS-7  
**Dependencies:** WP 4.1

**Description:**
Extension of the config node HTML UI with input fields for certificates. Uses the Node-RED Credential API (`credentials` field in the node definition).

**Fields:**
- CA certificate (file path, type: password)
- Client certificate (file path, type: password)
- Private key (file path, type: password)
- Private key passphrase (optional, type: password)
- Enable TLS (checkbox)
- Automatically set port to 802 (when TLS is enabled)

---

### WP 4.3: Credential Separation in Build Process

**Milestone:** MS-7  
**Dependencies:** WP 4.2

**Description:**
Ensuring certificate data never ends up in `flow.json`. Uses the Node-RED credential mechanism:
- Define `credentials` in the node registration
- Data is persisted in a separate `*_cred.json` file
- `*_cred.json` is listed in `.gitignore`
- Validation on deploy: warning if credential fields are empty

**Output Files:**
- `src/lib/security/certificate-validator.js`
- `test/unit/security/certificate-validator.test.js`
- `test/fixtures/certs/` (self-signed test certificates)

---

## WP 5: Quality Assurance, Documentation and Deployment

### WP 5.1: Test Framework

**Milestone:** MS-8  
**Dependencies:** WP 1–4

**Description:**
Finalization of the automated test framework. Key areas:
- Deterministic XState behavior (all state transitions)
- Correctness of endianness parsing (Float32, UInt32, Int16)
- CRC calculation for RTU
- Queue overflow behavior
- TLS handshake scenarios

---

### WP 5.2: UI Tests and Leak Validation

**Milestone:** MS-8  
**Dependencies:** WP 5.1

**Description:**
Node-RED UI tests with `node-red-node-test-helper` and simulation of connection drops. Validation that no socket listener leaks occur during partial deployments (cf. legacy issue #187).

**Test Scenarios:**
1. Partial deploy: remove node → verify listeners are deregistered
2. Full deploy: all sockets properly closed
3. Rapid re-deploy: deploy 10x in succession → no memory leak
4. Connection drop: TCP server disconnects → verify reconnect behavior

---

### WP 5.3: Documentation and Example Flows

**Milestone:** MS-8  
**Dependencies:** WP 5.2

**Description:**
- Node-RED help sidebar texts for all nodes
- Example flows in `examples/flows/`:
  - Watchdog implementation
  - Bitwise stuffing (16 coils → 1 register)
  - RBE filtering (Report By Exception)
  - Float32 parsing
  - Server proxy with dynamic addresses

---

### WP 5.4: License Compliance and Publication

**Milestone:** MS-8  
**Dependencies:** WP 5.3

**Description:**
- License compliance check (BSD-3-Clause, ISC, MIT)
- Publication to npm registry
- Registration in the Node-RED Flow Library
- Finalize CHANGELOG.md
- Create GitHub release

**Reference:** [LEGAL_ANALYSIS.md](LEGAL_ANALYSIS.md)
