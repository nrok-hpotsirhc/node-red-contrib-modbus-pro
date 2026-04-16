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
| MS-3 | Client/Master – Read Nodes | [ ] Open | WP 2.1, WP 2.4 | FC 01-04, payload parsing, endianness |
| MS-4 | Client/Master – Write Nodes & Queue | [ ] Open | WP 2.2, WP 2.3 | FC 05/06/15/16, backpressure |
| MS-5 | Server/Slave – Proxy Architecture | [ ] Open | WP 3.1, WP 3.2, WP 3.3 | TCP/RTU listener, Modbus-In/Out nodes |
| MS-6 | Server Caching & Optimization | [ ] Open | WP 3.4 | In-memory hashmap, performance |
| MS-7 | Modbus/TCP Security | [ ] Open | WP 4.1, WP 4.2, WP 4.3 | TLS 1.3, mTLS, credential management |
| MS-8 | Quality Assurance & Release | [ ] Open | WP 5.1, WP 5.2, WP 5.3, WP 5.4 | Testing, docs, npm publish |

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
- [ ] `src/nodes/client/modbus-read.js` – Read node (all 4 FCs via dropdown)
- [ ] `src/nodes/client/modbus-read.html` – Read node UI (FC, address, length, address offset toggle)
- [ ] `src/lib/parser/buffer-parser.js` – Big-endian / little-endian / word-swap conversion
- [ ] `src/lib/parser/payload-builder.js` – msg.payload standardization with metadata
- [ ] `test/unit/parser/buffer-parser.test.js` – Endianness tests with known Float32 values
- [ ] `test/unit/parser/payload-builder.test.js`
- [ ] `test/fixtures/register-maps/` – Example register maps of various devices
- [ ] `test/integration/modbus-read.test.js` – Integration with node-red-node-test-helper

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
- [ ] `src/nodes/client/modbus-write.js` – Write node (single + multiple)
- [ ] `src/nodes/client/modbus-write.html` – Write node UI
- [ ] `src/lib/queue/backpressure-queue.js` – Queue with configurable limit
- [ ] `test/unit/queue/backpressure-queue.test.js` – Tests for FIFO/LIFO drop, overflow
- [ ] `test/integration/modbus-write.test.js`

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
- [ ] `src/nodes/config/modbus-server-config.js` – Server config node (TCP listener)
- [ ] `src/nodes/config/modbus-server-config.html` – Server config UI
- [ ] `src/nodes/server/modbus-in.js` – Event receiver (request → flow)
- [ ] `src/nodes/server/modbus-in.html`
- [ ] `src/nodes/server/modbus-out.js` – Response sender (flow → TCP response)
- [ ] `src/nodes/server/modbus-out.html`
- [ ] `test/integration/modbus-server-proxy.test.js` – End-to-end proxy test

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
- [ ] `src/lib/cache/register-cache.js` – Hashmap-based register cache
- [ ] `test/unit/cache/register-cache.test.js`
- [ ] Performance benchmarks documented

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
- [ ] `src/lib/security/tls-wrapper.js` – TLS socket creation
- [ ] `src/lib/security/certificate-validator.js` – X.509v3 validation, RBAC extraction
- [ ] Config node HTML extension for TLS fields (credential type)
- [ ] `test/unit/security/tls-wrapper.test.js`
- [ ] `test/unit/security/certificate-validator.test.js`
- [ ] `test/fixtures/certs/` – Test certificates (self-signed, documented)

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
- [ ] Complete test suite with >80% coverage
- [ ] Leak tests verified for partial deploys
- [ ] Node-RED help sidebar texts for all nodes
- [ ] `examples/flows/` with examples (watchdog, RBE filter, bitwise stuffing)
- [ ] npm publish configuration
- [ ] CHANGELOG.md finalized
- [ ] README.md finalized

**Acceptance Criteria:**
- `npm test` passes, coverage > 80%
- `npm pack` produces valid package
- All Node-RED help sidebars present
- License compliance verified (BSD-3-Clause, ISC, MIT compatible)
- No credential leaks in flow.json

---

## Progress Log

| Date | Milestone | Status | Notes |
|------|-----------|--------|-------|
| 2026-04-16 | MS-1 | Complete | Transport layer, config node, unit tests (82 passing) |
| 2026-04-16 | MS-2 | Complete | XState state machine, connection pool, RTU semaphore (170 passing) |
| _TBD_ | MS-3 | Open | — |
| _TBD_ | MS-4 | Open | — |
| _TBD_ | MS-5 | Open | — |
| _TBD_ | MS-6 | Open | — |
| _TBD_ | MS-7 | Open | — |
| _TBD_ | MS-8 | Open | — |
