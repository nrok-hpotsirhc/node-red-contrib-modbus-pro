# Milestones – node-red-contrib-modbus-pro

> Each milestone is designed as a self-contained agent session.
> This document serves as a running guide: completed milestones are marked accordingly.
> References: [Work Packages](docs/WORK_PACKAGES.md) | [Architecture](docs/ARCHITECTURE.md) | [Agents](agents.md)

---

## Overview

| # | Milestone | Status | Work Packages | Focus |
|---|-----------|--------|---------------|-------|
| MS-1 | Project Foundation & Transport Layer | [x] Complete | WP 1.1, WP 1.2 | Library abstraction, config node UI |
| MS-2 | State Machine & Connection Management | [x] Complete | WP 1.3, WP 1.4 | XState FSM, connection pool, semaphore |
| MS-3 | Client/Master – Read Nodes | [x] Complete | WP 2.1, WP 2.4 | FC 01-04, payload parsing, endianness |
| MS-4 | Client/Master – Write Nodes & Queue | [x] Complete | WP 2.2, WP 2.3 | FC 05/06/15/16, backpressure |
| MS-5 | Server/Slave – Proxy Architecture | [x] Complete | WP 3.1, WP 3.2, WP 3.3 | TCP/RTU listener, Modbus-In/Out nodes |
| MS-6 | Server Caching & Optimization | [x] Complete | WP 3.4 | In-memory hashmap, performance |
| MS-7 | Modbus/TCP Security | [x] Complete | WP 4.1, WP 4.2, WP 4.3 | TLS 1.3, mTLS, credential management |
| MS-8 | Quality Assurance & Release | [x] Complete | WP 5.1, WP 5.2, WP 5.3, WP 5.4 | Testing, docs, npm publish – v0.1.0 released |
| MS-9 | High-Priority Extended FCs | [x] Complete | WP 6.1, WP 6.2 | FC 22/23, FC 43/14 Device Identification |
| MS-10 | Serial Diagnostics & Legacy FCs | [ ] Open | WP 6.3, WP 6.4 | FC 07/08 diagnostics, FC 11/12/17/20/21/24 |
| MS-11 | Fieldbus Architecture Extensions | [ ] Open | WP 7.1, WP 7.2, WP 7.3, WP 7.4 | Chunking, data types, exceptions, RTU-TCP |
| MS-12 | Advanced Fieldbus Nodes | [ ] Open | WP 7.5, WP 7.6, WP 7.7, WP 7.8 | RBE, scanner, watchdog, stats |

---

## MS-1: Project Foundation & Transport Layer

**Goal:** Stable foundation for managing physical and logical interfaces.

**Work Packages:**
- **WP 1.1** – Evaluation and abstraction of `modbus-serial` as transport layer
- **WP 1.2** – Development of config nodes (HTML/JS UI for TCP and RTU parameters)

**Deliverables:**
- [x] `src/lib/transport/tcp-transport.js` – TCP socket abstraction over modbus-serial
- [x] `src/lib/transport/rtu-transport.js` – RTU serial abstraction (graceful fallback without serialport)
- [x] `src/lib/transport/transport-factory.js` – Factory pattern for transport selection
- [x] `src/nodes/config/modbus-client-config.js` – Config node logic
- [x] `src/nodes/config/modbus-client-config.html` – Config node UI (IP, port, baud rate, parity, etc.)
- [x] `test/unit/transport/tcp-transport.test.js` – Unit tests TCP
- [x] `test/unit/transport/rtu-transport.test.js` – Unit tests RTU
- [x] `test/mocks/mock-serial-port.js` – Mock for serialport (documented in mocks/README.md)
- [x] `test/mocks/mock-tcp-socket.js` – Mock for net.Socket (documented in mocks/README.md)

**Theoretical Foundations:** See [THEORETICAL_FOUNDATIONS.md §2 Transport Layers](docs/THEORETICAL_FOUNDATIONS.md#2-transport-layers-modbus-rtu-vs-modbus-tcp)

**Acceptance Criteria:**
- Config node can be deployed in Node-RED (without connection)
- `npm install --no-optional` works (TCP-only, no serialport)
- All unit tests pass

---

## MS-2: State Machine & Connection Management

**Goal:** Elimination of race conditions through formalized state management.

**Work Packages:**
- **WP 1.3** – XState state machine (connect, error, reconnect, backoff)
- **WP 1.4** – Connection pool (TCP) and semaphore (RTU)

**Deliverables:**
- [x] `src/lib/state-machine/connection-machine.js` – XState v5 state machine
- [x] `src/lib/state-machine/guards.js` – XState guards (isConnected, isQueueFull, etc.)
- [x] `src/lib/state-machine/actions.js` – XState actions (connect, disconnect, enqueue, etc.)
- [x] `src/lib/queue/connection-pool.js` – TCP connection pool
- [x] `src/lib/queue/rtu-semaphore.js` – RTU semaphore/mutex for serial serialization
- [x] `test/unit/state-machine/connection-machine.test.js` – Deterministic FSM testing
- [x] `test/unit/queue/connection-pool.test.js`
- [x] `test/unit/queue/rtu-semaphore.test.js`

**Theoretical Foundations:** See [THEORETICAL_FOUNDATIONS.md §6 State Machine](docs/THEORETICAL_FOUNDATIONS.md#6-deterministic-state-management-via-xstate)

**Acceptance Criteria:**
- XState machine traverses all defined state transitions
- Parallel TCP requests are multiplexed via pool
- RTU requests are strictly serialized (no concurrent bus access)
- Status visualization in Node-RED UI (green/red/yellow)
- All unit tests pass

---

## MS-3: Client/Master – Read Nodes

**Goal:** Complete implementation of read function codes with intelligent payload parsing.

**Work Packages:**
- **WP 2.1** – Getter nodes for FC 01, 02, 03, 04
- **WP 2.4** – Payload standardization, buffer parsing, endianness handling

**Deliverables:**
- [x] `src/nodes/client/modbus-read.js` – Read node (all 4 FCs via dropdown)
- [x] `src/nodes/client/modbus-read.html` – Read node UI (FC, address, length, address offset toggle)
- [x] `src/lib/parser/buffer-parser.js` – Big-endian / little-endian / word-swap conversion
- [x] `src/lib/parser/payload-builder.js` – msg.payload standardization with metadata
- [x] `test/unit/parser/buffer-parser.test.js` – Endianness tests with known Float32 values
- [x] `test/unit/parser/payload-builder.test.js`
- [x] `test/fixtures/register-maps/` – Example register maps of various devices
- [x] `test/integration/modbus-read.test.js` – Integration with node-red-node-test-helper

**Theoretical Foundations:** See [THEORETICAL_FOUNDATIONS.md §3 Data Model](docs/THEORETICAL_FOUNDATIONS.md#3-the-modbus-data-model) and [§4 Endianness](docs/THEORETICAL_FOUNDATIONS.md#4-endianness-in-javascript)

**Acceptance Criteria:**
- FC 01-04 return correct values from mock server
- Zero-based/one-based address offset configurable
- Float32 (IEEE 754) correctly reconstructed from 2 registers
- msg.payload contains metadata (FC, address, timestamp, unit ID)

---

## MS-4: Client/Master – Write Nodes & Queue

**Goal:** Safe write operations with queue overflow protection.

**Work Packages:**
- **WP 2.2** – Setter nodes for FC 05, 06, 15, 16
- **WP 2.3** – Backpressure logic with max queue size and FIFO/LIFO drop

**Deliverables:**
- [x] `src/nodes/client/modbus-write.js` – Write node (single + multiple)
- [x] `src/nodes/client/modbus-write.html` – Write node UI
- [x] `src/lib/queue/backpressure-queue.js` – Queue with configurable limit
- [x] `test/unit/queue/backpressure-queue.test.js` – Tests for FIFO/LIFO drop, overflow
- [x] `test/integration/modbus-write.test.js`

**Theoretical Foundations:** See [THEORETICAL_FOUNDATIONS.md §7 Backpressure](docs/THEORETICAL_FOUNDATIONS.md#7-backpressure-management)

**Acceptance Criteria:**
- FC 05/06 write single values correctly
- FC 15/16 write arrays correctly
- Boolean arrays are converted to multi-coil requests
- Queue drops oldest/newest message on overflow (configurable)
- Memory consumption remains constant under flooding

---

## MS-5: Server/Slave – Proxy Architecture

**Goal:** Reactive, dynamic slave architecture without monolithic memory matrix.

**Work Packages:**
- **WP 3.1** – TCP/RTU listener architecture
- **WP 3.2** – Modbus-In node
- **WP 3.3** – Modbus-Out node

**Deliverables:**
- [x] `src/nodes/config/modbus-server-config.js` – Server config node (TCP listener)
- [x] `src/nodes/config/modbus-server-config.html` – Server config UI
- [x] `src/nodes/server/modbus-in.js` – Event receiver (request → flow)
- [x] `src/nodes/server/modbus-in.html`
- [x] `src/nodes/server/modbus-out.js` – Response sender (flow → TCP response)
- [x] `src/nodes/server/modbus-out.html`
- [x] `test/integration/modbus-server-proxy.test.js` – End-to-end proxy test

**Theoretical Foundations:** See [THEORETICAL_FOUNDATIONS.md §8 Dynamic Server Proxying](docs/THEORETICAL_FOUNDATIONS.md#8-dynamic-address-space-mapping)

**Acceptance Criteria:**
- External Modbus client can read registers from Node-RED server
- Requests are injected as JSON into the flow
- Responses can be sent back asynchronously from the flow
- Non-linear address spaces work without memory waste

---

## MS-6: Server Caching & Optimization

**Goal:** Performance optimization for latency-critical scenarios.

**Work Packages:**
- **WP 3.4** – In-memory hashmap for auto-replying

**Deliverables:**
- [x] `src/lib/cache/register-cache.js` – Hashmap-based register cache
- [x] `test/unit/cache/register-cache.test.js`
- [x] Performance benchmarks documented

**Acceptance Criteria:**
- Cache answers recurring requests without flow traversal
- Cache TTL configurable
- Cache invalidation on write operations

---

## MS-7: Modbus/TCP Security

**Goal:** Certificate-based encryption and OT security standards compliance.

**Work Packages:**
- **WP 4.1** – TLS 1.3 integration via node:tls, port 802
- **WP 4.2** – Credential UI for certificates (CA, client, key)
- **WP 4.3** – Build process for credential separation

**Deliverables:**
- [x] `src/lib/security/tls-wrapper.js` – TLS socket creation
- [x] `src/lib/security/certificate-validator.js` – X.509v3 validation, RBAC extraction
- [x] Config node HTML extension for TLS fields (credential type)
- [x] `test/unit/security/tls-wrapper.test.js`
- [x] `test/unit/security/certificate-validator.test.js`
- [x] `test/fixtures/certs/` – Test certificates (self-signed, documented)

**Theoretical Foundations:** See [THEORETICAL_FOUNDATIONS.md §5 Modbus/TCP Security](docs/THEORETICAL_FOUNDATIONS.md#5-modbustcp-security-protocol)

**Acceptance Criteria:**
- TLS connection over port 802 works
- mTLS handshake with client and server certificate succeeds
- Private keys are stored in the Node-RED Credential Store
- Invalid certificates are rejected
- RBAC roles extractable from X.509v3 extensions

---

## MS-8: Quality Assurance & Release

**Goal:** Enterprise-ready publication.

**Work Packages:**
- **WP 5.1** – Finalize automated test framework
- **WP 5.2** – UI tests, partial-deploy leak tests
- **WP 5.3** – Documentation, example flows, help sidebar
- **WP 5.4** – License compliance, npm registry, Node-RED Flow Library

**Deliverables:**
- [x] Complete test suite with >80% coverage – 565/565 tests passing, all security tests fixed
- [x] Code Review #4: 9 bug fixes and improvements (see CHANGELOG.md)
- [x] Code Review #5: 7 fixes + 4 new tests (reconnect retry reset, NaN guard, cache range invalidation, disconnect timeout, poll/deferred unref, CRLF cert parse)
- [x] Test certificate fixtures generated (`test/fixtures/certs/generate-certs.js`)
- [x] Shared utility extracted (`src/lib/utils.js`) – DRY improvement
- [x] Leak tests verified for partial deploys – 29 tests in `test/integration/lifecycle.test.js`
- [x] Node-RED help sidebar texts for all nodes
- [x] `examples/flows/` – 3 example flows (watchdog-heartbeat, rbe-filter, bitwise-coil-packing)
- [x] npm publish configuration – `"files"` array in package.json (42 files, 63 kB)
- [x] CHANGELOG.md finalized – `[Unreleased]` → `[0.1.0]` – 2026-04-17
- [x] README.md finalized – Node Reference, Quick Start, Example Flows sections

**Acceptance Criteria:**
- `npm test` passes, coverage > 80%
- `npm pack` produces valid package
- All Node-RED help sidebars present
- License compliance verified (BSD-3-Clause, ISC, MIT compatible)
- No credential leaks in flow.json

---

## MS-9: High-Priority Extended Function Codes

**Goal:** Close the gap between the 8 implemented FCs and the most industrially relevant
missing FCs before the v1.0 release. FC 22 and FC 23 eliminate race conditions; FC 43/14
enables automated device discovery.

**Work Packages:**
- **WP 6.1** – FC 22 (Mask Write Register) + FC 23 (Read/Write Multiple Registers)
- **WP 6.2** – FC 43/14 (Read Device Identification)

**Deliverables:**
- [x] `src/nodes/client/modbus-write.js` – FC 22 / FC 23 added
- [x] `src/nodes/client/modbus-write.html` – UI additions for FC 22/23
- [x] `test/integration/modbus-write-extended.test.js` – FC 22/23 test scenarios
- [x] `src/nodes/client/modbus-discover.js` – new Modbus-Discover node
- [x] `src/nodes/client/modbus-discover.html`
- [x] `test/integration/modbus-discover.test.js`

**Theoretical Foundations:**
- [THEORETICAL_FOUNDATIONS.md §12.1 FC 22 – Mask Write Register](docs/THEORETICAL_FOUNDATIONS.md#121-fc-22--mask-write-register-0x16)
- [THEORETICAL_FOUNDATIONS.md §12.2 FC 23 – Read/Write Multiple Registers](docs/THEORETICAL_FOUNDATIONS.md#122-fc-23--readwrite-multiple-registers-0x17)
- [THEORETICAL_FOUNDATIONS.md §12.3 FC 43/14 – Read Device Identification](docs/THEORETICAL_FOUNDATIONS.md#123-fc-4314--read-device-identification-mei-transport-0x2b0x0e)
- [THEORETICAL_FOUNDATIONS.md §12.10 Library Support Summary](docs/THEORETICAL_FOUNDATIONS.md#1210-library-support-summary)

**Acceptance Criteria:**
- FC 22 performs atomic AND/OR mask write on a holding register
- FC 23 combines write + read in a single PDU with correct round-trip latency
- `modbus-discover` returns device identification object map from compliant devices
- Streaming mode supported for extended object lists (FC 43/14)

---

## MS-10: Serial Diagnostics and Legacy Function Codes

**Goal:** Complete serial-line diagnostic coverage for RTU environments; add file/FIFO
access for legacy PLC file systems. Primarily relevant for brownfield RTU deployments.

**Work Packages:**
- **WP 6.3** – FC 08 (Diagnostics) + FC 07 (Read Exception Status)
- **WP 6.4** – FC 11, 12, 17, 20, 21, 24

**Deliverables:**
- [ ] `src/nodes/client/modbus-diagnostic.js` – new node (FC 07, FC 08, FC 11, FC 12, FC 17)
- [ ] `src/nodes/client/modbus-diagnostic.html`
- [ ] `test/integration/modbus-diagnostic.test.js`
- [ ] `src/nodes/client/modbus-file.js` – new node (FC 20, FC 21, FC 24)
- [ ] `src/nodes/client/modbus-file.html`
- [ ] `test/integration/modbus-file.test.js`

**Theoretical Foundations:**
- [THEORETICAL_FOUNDATIONS.md §12.4 FC 07 – Read Exception Status](docs/THEORETICAL_FOUNDATIONS.md#124-fc-07--read-exception-status-0x07)
- [THEORETICAL_FOUNDATIONS.md §12.5 FC 08 – Diagnostics](docs/THEORETICAL_FOUNDATIONS.md#125-fc-08--diagnostics-0x08)
- [THEORETICAL_FOUNDATIONS.md §12.6 FC 11/12 – Event Counter/Log](docs/THEORETICAL_FOUNDATIONS.md#126-fc-1112--communication-event-counter-and-event-log-0x0b0x0c)
- [THEORETICAL_FOUNDATIONS.md §12.7 FC 17 – Report Server ID](docs/THEORETICAL_FOUNDATIONS.md#127-fc-17--report-server-id-0x11)
- [THEORETICAL_FOUNDATIONS.md §12.8 FC 20/21 – File Record Access](docs/THEORETICAL_FOUNDATIONS.md#128-fc-2021--file-record-access-0x140x15)
- [THEORETICAL_FOUNDATIONS.md §12.9 FC 24 – Read FIFO Queue](docs/THEORETICAL_FOUNDATIONS.md#129-fc-24--read-fifo-queue-0x18)
- [THEORETICAL_FOUNDATIONS.md §12.10 Library Support Summary](docs/THEORETICAL_FOUNDATIONS.md#1210-library-support-summary)

**Acceptance Criteria:**
- FC 08/0x00 loopback echo test works on RTU bus
- FC 08 sub-function counter reads return numeric values
- FC 07 returns 8-bit exception status word
- FC 11/12/17 return structured diagnostic data
- FC 20/21 read/write file records on a compliant device
- FC 24 reads FIFO queue contents

---

## MS-11: Fieldbus Architecture Extensions

**Goal:** Harden the core architecture for production-grade industrial deployments:
automatic request splitting, extended data types, structured exception codes, and
RTU-over-TCP gateway support.

**Work Packages:**
- **WP 7.1** – Automatic request chunking + broadcast (Unit ID 0)
- **WP 7.2** – Extended data type abstraction (Double, Int64, String, BCD, DateTime)
- **WP 7.3** – Modbus exception code structured error handling
- **WP 7.4** – Modbus RTU over TCP transport

**Deliverables:**
- [ ] `src/lib/transport/request-chunker.js` – auto-split and reassemble large requests
- [ ] `test/unit/transport/request-chunker.test.js`
- [ ] `src/lib/parser/buffer-parser.js` – Float64, Int64/UInt64, String, BCD, DateTime
- [ ] `src/lib/parser/exception-parser.js` – structured exception code mapping
- [ ] `test/unit/parser/exception-parser.test.js`
- [ ] `src/lib/transport/rtu-over-tcp-transport.js` – RTU-over-TCP transport type
- [ ] `src/nodes/config/modbus-client-config.js` – RTU-over-TCP config option
- [ ] `test/unit/transport/rtu-over-tcp-transport.test.js`

**Theoretical Foundations:**
- [THEORETICAL_FOUNDATIONS.md §13 Modbus Exception Responses](docs/THEORETICAL_FOUNDATIONS.md#13-modbus-exception-responses)
- [THEORETICAL_FOUNDATIONS.md §14 PDU Limits and Request Chunking](docs/THEORETICAL_FOUNDATIONS.md#14-pdu-payload-limits-and-automatic-request-chunking)
- [THEORETICAL_FOUNDATIONS.md §15 Extended Data Types](docs/THEORETICAL_FOUNDATIONS.md#15-extended-data-types-across-modbus-registers)
- [THEORETICAL_FOUNDATIONS.md §16 RTU over TCP Encapsulation](docs/THEORETICAL_FOUNDATIONS.md#16-modbus-rtu-over-tcp-encapsulation)

**Acceptance Criteria:**
- A read request for 300 registers is automatically split into 3 sequential requests
- Broadcast (Unit ID 0) write completes without timeout error
- Float64 and Int64 values correctly reconstructed from 4 consecutive registers
- Modbus exception response surfaces as `msg.payload.exception.code` and `msg.payload.exception.name`
- RTU-over-TCP transport connects to gateway devices using raw RTU framing

---

## MS-12: Advanced Fieldbus Nodes

**Goal:** Provide the higher-level operational nodes that distinguish an enterprise-grade
SCADA driver from a basic protocol adapter: change detection, scan scheduling, safe-state
watchdog, and runtime metrics.

**Work Packages:**
- **WP 7.5** – Report-by-Exception (RBE) node
- **WP 7.6** – Scan-list / Polling-Scheduler node
- **WP 7.7** – Watchdog / Safe-State Heartbeat node
- **WP 7.8** – Statistics and Diagnostics Runtime node

**Deliverables:**
- [ ] `src/nodes/client/modbus-rbe.js` – dead-band and change-detection node
- [ ] `src/nodes/client/modbus-rbe.html`
- [ ] `test/unit/client/modbus-rbe.test.js`
- [ ] `src/nodes/client/modbus-scanner.js` – multi-rate polling scan-list node
- [ ] `src/nodes/client/modbus-scanner.html`
- [ ] `test/integration/modbus-scanner.test.js`
- [ ] `src/nodes/client/modbus-watchdog.js` – safe-state heartbeat node
- [ ] `src/nodes/client/modbus-watchdog.html`
- [ ] `test/unit/client/modbus-watchdog.test.js`
- [ ] `src/nodes/client/modbus-stats.js` – runtime metrics node
- [ ] `src/nodes/client/modbus-stats.html`
- [ ] `test/unit/client/modbus-stats.test.js`
- [ ] `package.json` – register all 4 new nodes

**Theoretical Foundations:**
- [THEORETICAL_FOUNDATIONS.md §17.1 Report-by-Exception (RBE)](docs/THEORETICAL_FOUNDATIONS.md#171-report-by-exception-rbe-and-dead-band-filtering)
- [THEORETICAL_FOUNDATIONS.md §17.2 Multi-Rate Scan Scheduling](docs/THEORETICAL_FOUNDATIONS.md#172-multi-rate-scan-scheduling)
- [THEORETICAL_FOUNDATIONS.md §17.3 Watchdog and Safe-State Heartbeat](docs/THEORETICAL_FOUNDATIONS.md#173-watchdog-and-safe-state-heartbeat)
- [THEORETICAL_FOUNDATIONS.md §17.4 Runtime Metrics](docs/THEORETICAL_FOUNDATIONS.md#174-runtime-metrics-and-operational-monitoring)

**Acceptance Criteria:**
- `modbus-rbe` passes only changed values downstream with configurable dead-band
- `modbus-scanner` supports at least 3 independent scan groups with different intervals
- `modbus-watchdog` sends safe-state write within 2× heartbeat interval after connection loss
- `modbus-stats` emits `requestsTotal`, `avgResponseTimeMs`, `queueDepth`, `reconnectCount`

---

## Progress Log

| Date | Milestone | Status | Notes |
|------|-----------|--------|-------|
| 2026-04-16 | MS-1 | Complete | Transport layer, config node, unit tests (82 passing) |
| 2026-04-16 | MS-2 | Complete | XState state machine, connection pool, RTU semaphore (170 passing) |
| 2026-04-16 | MS-3 | Complete | Read nodes, buffer parser, payload builder (264 passing) |
| 2026-04-16 | MS-4 | Complete | Write nodes, backpressure queue (334 passing) |
| 2026-04-16 | MS-5 | Complete | Server proxy architecture, Modbus-In/Out nodes (366 passing) |
| 2026-04-16 | MS-6 | Complete | Register cache with TTL, write invalidation (437 passing) |
| 2026-04-16 | MS-7 | Complete | TLS wrapper, certificate validator, mTLS, credential UI (532 passing) |
| 2026-04-17 | MS-8 | In Progress | Code Review #4: 9 fixes (LIFO double-done, TLS disconnect, destroy leak, timer cleanup, stopServer timeout, DRY parseIntSafe, poll throttle, unref timer, test cert generation). 532/532 tests passing |
| 2026-04-17 | MS-8 | In Progress | Code Review #5: 7 fixes (reconnect retry reset, NaN guard, cache range invalidation, disconnect timeout, poll unref, deferred unref, CRLF cert parse). 4 new tests. 536/536 passing |
| 2026-04-17 | MS-9 – MS-12 | Planned | FC gap analysis: 13 missing FCs identified; 8 new WPs (6.1–7.8) and 4 new milestones (MS-9–MS-12) added to planning documents |
| 2026-04-17 | MS-9 – MS-12 | Planned | Theoretical Foundations §12–§17 elaborated: extended FC PDU structures, exception responses, request chunking, extended data types (Float64/Int64/BCD/String/DateTime), RTU-over-TCP, industrial patterns (RBE, scan scheduling, watchdog, metrics). All WP and milestone theory references updated |
| 2026-04-18 | MS-8 | In Progress | Node-RED help sidebar texts enhanced for all 6 nodes (modbus-client-config, modbus-server-config, modbus-read, modbus-write, modbus-in, modbus-out). Added status indicators, error behavior, references, default values. 536/536 tests passing |
| 2026-04-18 | MS-8 | In Progress | 29 lifecycle/leak tests (WP 5.2), 3 example flows (WP 5.3), README Node Reference (WP 5.4), npm pack config (files array). 565/565 tests passing |
| 2026-04-18 | MS-9 | Complete | FC 22 (Mask Write Register), FC 23 (Read/Write Multiple Registers), FC 43/14 (Read Device Identification). New modbus-discover node. Extended base-transport, payload-builder, modbus-write. 81 new tests (unit + integration). 646/646 tests passing |
| 2026-04-18 | MS-8 | In Progress | Code Review #6: 4 fixes (parseIntSafe consistency in modbus-write + modbus-discover, FC 23 response null guard, 16-bit range validation in buffer-parser `_validateRegisterPair`). 646/646 tests passing |
| 2026-04-17 | MS-8 | Complete | CHANGELOG.md finalized: [Unreleased] → [0.1.0] – 2026-04-17. All WP 5.1–5.4 deliverables complete. v0.1.0 ready for npm publish. 646/646 tests passing |
| 2026-05-05 | MS-9 | Complete | Finalization audit: lint config, deterministic generated TLS cert fixtures, client transport auto-connect, status transition hardening, UI parsing cleanup. 646/646 tests passing; lint passing; npm pack dry run passing |
| 2026-05-05 | Post-audit | Complete | Code review follow-up: removed BOM from `src/index.js`; added `.unref()` to status timers (modbus-in, modbus-out), `stopServer` safety timer, and `RtuSemaphore.drain` wait timer for clean Node.js shutdown. 646/646 tests passing; lint passing |
