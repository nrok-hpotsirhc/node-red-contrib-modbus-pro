# Work Packages (Work Breakdown Structure)

> Detailed description of all work packages for node-red-contrib-modbus-pro.
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

---

## WP 6: Extended Modbus Function Codes

> **Background:** The Modbus Application Protocol Specification V1.1b3 defines 21 function codes
> beyond FC 43/13 (CANopen, out of scope). The first eight milestones (MS-1 – MS-8) implement the
> eight most common FCs (01–06, 15, 16). The remaining function codes are planned here in order of
> industrial relevance. See the complete FC status table in
> [THEORETICAL_FOUNDATIONS.md §3](THEORETICAL_FOUNDATIONS.md#3-the-modbus-data-model).

---

### WP 6.1: FC 22 (Mask Write Register) and FC 23 (Read/Write Multiple Registers)

**Milestone:** MS-9  
**Dependencies:** WP 2.1, WP 2.2 (client nodes)  
**Theoretical Foundation:** [§3 Complete FC table](THEORETICAL_FOUNDATIONS.md#3-the-modbus-data-model)  
**Priority:** HIGH – used in ~30% of PLC deployments

**Description:**  
Both function codes extend the write node (`modbus-write`) with two atomic operations that cannot
be replicated by composing existing FCs without introducing race conditions.

**FC 22 – Mask Write Register (0x16):**  
Applies AND and OR bitmasks to a single holding register in one atomic PDU.
Formula: `result = (current AND andMask) OR (orMask AND NOT andMask)`.
The modbus-serial library exposes this as `maskWriteRegister(address, andMask, orMask, unitId)`.
This avoids the classic read-modify-write race condition when multiple masters share a bus.

**FC 23 – Read/Write Multiple Registers (0x17):**  
Combines a multi-register write with a subsequent multi-register read in a single Modbus
transaction. Reduces round-trip latency in setpoint-feedback loops (write new setpoint,
read back the acknowledged process value in one PDU). The modbus-serial library exposes this
as `writeAndReadRegisters(writeAddress, writeValues, readAddress, readLength, unitId)`.

**UI additions to `modbus-write` node:**
- Two new FC options: `22 – Mask Write Register`, `23 – Read/Write Multiple Registers`
- FC 22 input: `{ andMask: 0xFFFF, orMask: 0x0000 }` (or separate fields in the node UI)
- FC 23 input: `{ writeAddress, writeValues[], readAddress, readLength }`

**Output Files:**
- `src/nodes/client/modbus-write.js` – extended with FC 22/23
- `src/nodes/client/modbus-write.html` – UI additions
- `test/integration/modbus-write-extended.test.js` – FC 22/23 scenarios

---

### WP 6.2: FC 43/14 – Read Device Identification

**Milestone:** MS-9  
**Dependencies:** WP 2.1 (client infrastructure)  
**Theoretical Foundation:** [§3 Complete FC table](THEORETICAL_FOUNDATIONS.md#3-the-modbus-data-model)  
**Priority:** HIGH – mandatory for IIoT asset management and SCADA inventory

**Description:**  
Implements the MEI Transport function code 43 with object type 14 (Read Device Identification),
which returns standardized device metadata: VendorName (0x00), ProductCode (0x01), MajorMinorRevision
(0x02), VendorURL (0x03), ProductName (0x04), ModelName (0x05), UserApplicationName (0x06), plus
optional vendor-specific objects (0x80–0xFF).

Three read modes are defined in the specification:
- **Basic** (01): Objects 0x00–0x02 in a single response
- **Regular** (02): Objects 0x00–0x06 in a single response
- **Extended** (03): All objects including vendor-specific, with streaming if needed
- **Individual** (04): One specific object by ID

A dedicated **Modbus-Discover** node is the preferred UI surface, since device identification
is a one-shot operation and not a cyclic poll. It receives a trigger message and outputs the
device identification object map as `msg.payload.deviceInfo`.

**Output Files:**
- `src/nodes/client/modbus-discover.js` – new node
- `src/nodes/client/modbus-discover.html`
- `test/integration/modbus-discover.test.js`

---

### WP 6.3: FC 08 (Diagnostics) and FC 07 (Read Exception Status) – Serial Only

**Milestone:** MS-10  
**Dependencies:** WP 1.1 (RTU transport)  
**Theoretical Foundation:** [§3 Complete FC table](THEORETICAL_FOUNDATIONS.md#3-the-modbus-data-model)  
**Priority:** MEDIUM – required for RTU commissioning and preventive maintenance

**Description:**  
Both function codes are defined for Modbus serial line only (not TCP).

**FC 07 – Read Exception Status (0x07):**  
Returns 8 bits from a device-specific exception status register. Common use: PLC alarm summary
word. Simple one-shot operation with no address argument. Should be available as a trigger
mode in the existing `modbus-read` node (or as a separate `modbus-diagnostic` node – see WP 6.3).

**FC 08 – Diagnostics (0x08):**  
Multiplexed via 13 sub-function codes (0x00–0x12):

| Sub-FC | Name |
|--------|------|
| 0x00 | Return Query Data (loopback) |
| 0x01 | Restart Communications Option |
| 0x02 | Return Diagnostic Register |
| 0x03 | Change ASCII Input Delimiter |
| 0x04 | Force Listen Only Mode |
| 0x0A | Clear Counters and Diagnostic Register |
| 0x0B | Return Bus Message Count |
| 0x0C | Return Bus Communication Error Count |
| 0x0D | Return Bus Exception Error Count |
| 0x0E | Return Slave Message Count |
| 0x0F | Return Slave No Response Count |
| 0x10 | Return Slave NAK Count |
| 0x11 | Return Slave Busy Count |
| 0x12 | Return Bus Character Overrun Count |

A dedicated **Modbus-Diagnostic** node with a sub-function dropdown is the recommended UI.
Results are emitted as `msg.payload.diagnostics`.

**Output Files:**
- `src/nodes/client/modbus-diagnostic.js` – new node (FC 07 + FC 08)
- `src/nodes/client/modbus-diagnostic.html`
- `test/integration/modbus-diagnostic.test.js`

---

### WP 6.4: Serial-Line Legacy Function Codes (FC 11, 12, 17, 20, 21, 24)

**Milestone:** MS-10  
**Dependencies:** WP 6.3  
**Theoretical Foundation:** [§3 Complete FC table](THEORETICAL_FOUNDATIONS.md#3-the-modbus-data-model)  
**Priority:** LOW – niche serial/legacy environments; rarely used in modern IIoT

**Description:**  
The remaining specified function codes are either serial-line-only diagnostics or file/FIFO
access mechanisms. All can be surfaced through the `modbus-diagnostic` node (FC 11/12/17)
or a new `modbus-file` node (FC 20/21/24):

| FC | Name | Notes |
|----|------|-------|
| 11 (0x0B) | Get Comm Event Counter | Serial only. Returns status word + event counter. |
| 12 (0x0C) | Get Comm Event Log | Serial only. Returns status, event count, message count, 64-event ring buffer. |
| 17 (0x11) | Report Server ID | Returns device type byte and run-indicator. Device-specific data. |
| 20 (0x14) | Read File Record | Reads records from a 16-bit addressed file in extended memory. |
| 21 (0x15) | Write File Record | Writes records to a file in extended memory. |
| 24 (0x18) | Read FIFO Queue | Returns up to 31 registers from a FIFO queue object. |

**Output Files:**
- `src/nodes/client/modbus-diagnostic.js` – FC 11, 12, 17 added as modes
- `src/nodes/client/modbus-file.js` – new node for FC 20, 21, 24
- `src/nodes/client/modbus-file.html`
- `test/integration/modbus-file.test.js`

---

## WP 7: Fieldbus Specialist Extensions

> **Background:** Beyond the raw function codes, a production-grade Modbus integration
> requires a set of cross-cutting architectural features that are invisible at the FC level
> but are critical for reliable, maintainable, and standards-compliant industrial deployments.
> The following work packages were identified from the perspective of a fieldbus specialist
> and IEC 62443 / IIoT architect.

---

### WP 7.1: Automatic Request Chunking and Broadcast Support

**Milestone:** MS-11  
**Dependencies:** WP 2.1, WP 2.2  
**Priority:** HIGH – affects correctness for large register blocks

**Description:**  
The Modbus PDU payload is limited to 253 bytes. This translates to hard limits per FC:

| FC | Max per request |
|----|-----------------|
| 01, 02 | 2000 coils / discrete inputs |
| 03, 04 | 125 holding / input registers |
| 15 | 1968 coils |
| 16 | 123 registers |

When a user configures a read of, e.g., 500 registers, the current implementation silently
fails or generates a Modbus exception 0x03 (Illegal Data Value). Automatic chunking splits
oversized requests into the minimum number of sequential sub-requests and re-assembles
the results transparently before passing `msg.payload` to the flow.

**Broadcast support (Unit ID 0 for RTU):**  
The Modbus RTU specification reserves Unit ID 0 as a broadcast address. Write operations
(FC 05, 06, 15, 16) are sent to all slaves simultaneously. Servers must not reply.
The current implementation should detect `unitId === 0` and skip response waiting,
to avoid false timeout errors.

**Output Files:**
- `src/lib/transport/request-chunker.js` – splitting and re-assembly logic
- `test/unit/transport/request-chunker.test.js`

---

### WP 7.2: Extended Data Type Abstraction

**Milestone:** MS-11  
**Dependencies:** WP 2.4 (buffer-parser)  
**Priority:** HIGH – required for sensors/drives with 32-bit and 64-bit process values

**Description:**  
The current `buffer-parser.js` handles Float32, UInt16, Int16, UInt32, and Int32.
Real-world devices use additional data types that span 2 or 4 consecutive registers:

| Type | Registers | Notes |
|------|-----------|-------|
| Float64 (Double) | 4 | IEEE 754 double-precision |
| Int64 / UInt64 | 4 | 64-bit signed / unsigned |
| String (ASCII) | N | N register = 2N chars, null-terminated |
| BCD (packed decimal) | 1–2 | Common in older PLCs and meters |
| Unix Timestamp (32-bit) | 2 | Seconds since epoch |
| Date/Time (IEC 61131) | 2–3 | Year/month/day/hour/min/sec encoding |

All types require byte-order configuration (BE, LE, byte-swap). Adding them to `buffer-parser.js`
and exposing them in the `modbus-read` UI dropdown ("Data Type") is the cleanest approach.

**Output Files:**
- `src/lib/parser/buffer-parser.js` – extended with new types
- `test/unit/parser/buffer-parser.test.js` – extended test vectors

---

### WP 7.3: Modbus Exception Code Structured Error Handling

**Milestone:** MS-11  
**Dependencies:** WP 2.1, WP 2.2  
**Priority:** HIGH – essential for SCADA error classification and alarm management

**Description:**  
When a Modbus server returns an exception response (function code OR-ed with 0x80), the
modbus-serial library throws a JavaScript Error. The current implementation forwards these
as generic `node.error()` calls. For SCADA systems, the exact exception code is operationally
critical:

| Exception Code | Name | Meaning |
|---------------|------|---------|
| 0x01 | Illegal Function | FC not supported by device |
| 0x02 | Illegal Data Address | Register address does not exist |
| 0x03 | Illegal Data Value | Value out of range for this register |
| 0x04 | Server Device Failure | Unrecoverable error in the device |
| 0x05 | Acknowledge | Long operation in progress; retry later |
| 0x06 | Server Device Busy | Device cannot process now |
| 0x08 | Memory Parity Error | Extended memory failure |
| 0x0A | Gateway Path Unavailable | Gateway misconfiguration |
| 0x0B | Gateway Target Device Failed | Target device not responding |

The exception code must be parsed from the error object and added to `msg.payload.exception`
so downstream nodes (e.g., alarm managers, dashboards) can react without string parsing.

**Output Files:**
- `src/lib/parser/exception-parser.js` – maps error codes to structured objects
- `test/unit/parser/exception-parser.test.js`

---

### WP 7.4: Modbus RTU over TCP (Raw RTU Encapsulation)

**Milestone:** MS-11  
**Dependencies:** WP 1.1 (transport layer)  
**Priority:** MEDIUM – required for many industrial TCP→RTU gateway products

**Description:**  
A significant portion of industrial gateway devices (e.g., Moxa NPort, Lantronix, Wago
750-352) operate in "raw RTU over TCP" mode: the TCP socket carries a binary-identical
Modbus RTU frame (including the 2-byte CRC) instead of the standard Modbus TCP MBAP
header. The modbus-serial library supports this mode via `connectTCP()` with the
`options.type = 'RTU'` flag.

This transport variant must be configurable in the `modbus-client-config` UI alongside
TCP and RTU as a third transport type: **"RTU over TCP"**.

**Configuration parameters (additional):**
- Host / IP
- Port (typically 4001 or 23)
- Unit ID / Slave ID
- Inter-frame delay (ms) – required by some gateways

**Output Files:**
- `src/lib/transport/rtu-over-tcp-transport.js` – new transport type
- `src/nodes/config/modbus-client-config.js` – extended with RTU-over-TCP option
- `src/nodes/config/modbus-client-config.html` – UI update
- `test/unit/transport/rtu-over-tcp-transport.test.js`

---

### WP 7.5: Report-by-Exception (RBE) Dedicated Node

**Milestone:** MS-12  
**Dependencies:** WP 2.1  
**Priority:** MEDIUM – reduces unnecessary downstream processing and network traffic

**Description:**  
Currently, the example flows contain an RBE implementation using standard Node-RED nodes.
A dedicated `modbus-rbe` node provides:
- Per-register dead-band filtering (absolute or percentage threshold)
- Per-address change detection for coils (boolean flip)
- A configurable inhibit time to prevent alarm storms
- A `msg.changed` array indicating which addresses changed

This pattern is called "Report by Exception" (RBE) or "Dead-Band" in IEC 61131-3 and is
a recommended best practice to reduce event bus load in large SCADA systems.

**Output Files:**
- `src/nodes/client/modbus-rbe.js` – new node
- `src/nodes/client/modbus-rbe.html`
- `test/unit/client/modbus-rbe.test.js`

---

### WP 7.6: Scan-List / Polling-Scheduler Node

**Milestone:** MS-12  
**Dependencies:** WP 2.1, WP 7.1  
**Priority:** MEDIUM – standard feature in any mature SCADA driver

**Description:**  
Rather than placing many individual `modbus-read` nodes, a single `modbus-scanner` node
manages a configurable table of read requests with independent polling intervals (scan groups).
This allows:
- Fast scan group: 100 ms for safety-critical values
- Slow scan group: 10 s for configuration registers
- On-demand group: triggered externally

The node emits one message per address/register group, preserving the existing `msg.payload`
structure. A single connection is shared via the existing connection pool, and requests are
serialized via the backpressure queue.

**Output Files:**
- `src/nodes/client/modbus-scanner.js` – new node
- `src/nodes/client/modbus-scanner.html`
- `test/integration/modbus-scanner.test.js`

---

### WP 7.7: Watchdog / Safe-State Heartbeat Node

**Milestone:** MS-12  
**Dependencies:** WP 2.2, WP 1.3 (state machine)  
**Priority:** MEDIUM – required for functional-safety use cases

**Description:**  
A `modbus-watchdog` node monitors the connection state of a client config node and
automatically sends a configurable "safe state" write (FC 05/06/15/16) when the connection
drops or a heartbeat timeout expires. Conversely, a "restore" write is sent when the
connection is re-established.

Use case: A PLC input that should be forced to 0 (safe) when the Node-RED controller loses
connectivity, preventing a runaway process. This is a common requirement in functional safety
(IEC 61508 SIL 1/2) and machine safety (ISO 13849 PLd) deployments.

**Configuration:**
- Client config node reference
- Safe-state FC, address, value
- Restore-state FC, address, value (optional)
- Heartbeat interval (ms)
- Timeout multiplier

**Output Files:**
- `src/nodes/client/modbus-watchdog.js` – new node
- `src/nodes/client/modbus-watchdog.html`
- `test/unit/client/modbus-watchdog.test.js`

---

### WP 7.8: Statistics and Diagnostics Runtime Node

**Milestone:** MS-12  
**Dependencies:** WP 1.3, WP 1.4, WP 2.3  
**Priority:** LOW – operational excellence, OEE / availability dashboards

**Description:**  
A `modbus-stats` node subscribes to internal events from the connection pool, RTU semaphore,
backpressure queue, and XState machine, and periodically emits a metrics payload:

```json
{
  "connection": "tcp://192.168.1.100:502",
  "state": "connected",
  "requestsTotal": 15482,
  "requestsSuccess": 15460,
  "requestsError": 22,
  "queueDepth": 3,
  "queueDropped": 0,
  "avgResponseTimeMs": 8.4,
  "lastErrorCode": "0x06",
  "reconnectCount": 1
}
```

This enables live OEE / availability dashboards in Node-RED without additional monitoring
infrastructure. The metrics interval is configurable (default: 5 s).

**Output Files:**
- `src/nodes/client/modbus-stats.js` – new node
- `src/nodes/client/modbus-stats.html`
- `test/unit/client/modbus-stats.test.js`
