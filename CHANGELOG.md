# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Changed
- **Code Review #3: Robustness & Correctness Improvements**
  - Fix resource leak: FIFO drop handler in `modbus-write.js` now calls `done()` on dropped messages to release Node-RED message tracking resources
  - Fix double `processQueue()` call on write error: replace `.catch().then()` chain with `.then(onSuccess, onError)` pattern to prevent redundant queue processing
  - Remove dead code: unreachable `value === true` / `value === false` branches in FC 05 `validateValue()` (already handled by prior `typeof === 'boolean'` check)
  - Simplify `doWrite()`: remove redundant `if/else` branching for FC 5/6 vs FC 15/16 – all function codes use the same `transport[method](address, value)` call
  - Add clarifying comment in `connection-machine.js` explaining that `writing.SUCCESS` → `reading` transition is intentional (consumer-driven dispatch)

### Added
- **MS-4: Client/Master – Write Nodes & Queue**
  - `src/nodes/client/modbus-write.js` – Modbus Write node supporting FC 05 (Write Single Coil), FC 06 (Write Single Register), FC 15 (Write Multiple Coils), FC 16 (Write Multiple Registers) with input validation, value normalization, and standardized output payload
  - `src/nodes/client/modbus-write.html` – Write node editor UI with function code selection, address, address offset toggle, queue size, drop strategy, dynamic value hint, and help sidebar
  - `src/lib/queue/backpressure-queue.js` – Configurable backpressure queue with hard limit (1–10000), FIFO drop (oldest removed) and LIFO drop (newest rejected) strategies, high/low water mark events, queue statistics, constant memory footprint under flooding
  - `test/unit/queue/backpressure-queue.test.js` – 46 unit tests for backpressure queue (constructor validation, FIFO/LIFO drop, events, memory consistency, edge cases)
  - `test/integration/modbus-write.test.js` – 24 integration tests with node-red-node-test-helper (FC 05/06/15/16, address offset, topic handling, validation errors, queue behavior, cleanup)
  - Registered `modbus-write` node in package.json `node-red.nodes`

### Added
- **MS-3: Client/Master – Read Nodes**
  - `src/nodes/client/modbus-read.js` – Modbus Read node supporting FC 01–04 via dropdown selection
  - `src/nodes/client/modbus-read.html` – Read node editor UI with function code selection, address, quantity, zero-based/one-based address offset toggle, polling interval, address hint display, and help sidebar
  - `src/lib/parser/buffer-parser.js` – Buffer parser for Modbus register data with support for Big-Endian (AB CD), Little-Endian (CD AB), Big-Endian Byte Swap (BA DC), Little-Endian Byte Swap (DC BA) byte orders. Parses Float32, UInt32, Int32, Int16, UInt16 and batch arrays
  - `src/lib/parser/payload-builder.js` – Payload standardization with metadata (fc, fcName, address, quantity, unitId, timestamp, connection string, buffer)
  - `test/unit/parser/buffer-parser.test.js` – 49 unit tests for endianness parsing with known Float32/UInt32/Int32 values
  - `test/unit/parser/payload-builder.test.js` – 31 unit tests for payload building and connection string generation
  - `test/integration/modbus-read.test.js` – 13 integration tests with node-red-node-test-helper (FC 01–04, address offset, topic handling, error handling, cleanup)
  - `test/fixtures/register-maps/energy-meter.json` – Example energy meter register map (Float32, UInt32, UInt16)
  - `test/fixtures/register-maps/temperature-sensor.json` – Temperature sensor with all 4 byte order variants
  - `test/fixtures/register-maps/digital-io.json` – Digital I/O module with coils and discrete inputs
  - Registered `modbus-read` node in package.json `node-red.nodes`

### Changed
- **Code Review #2: Quality & Correctness Improvements**
  - Fix `package.json`: remove ghost `modbus-read` node entry pointing to non-existent file – would crash Node-RED on load
  - Fix `package.json`: replace German placeholders `[HIER AUTOR EINTRAGEN]` and `[HIER-OWNER]` with actual values
  - Fix `.mocharc.yml`: remove invalid `spec-version` key (not a valid mocha config property)
  - Fix HTML help text: correct "Unit ID (1-247)" to "Unit ID (0-255)" to match `BaseTransport.setID()` validation
  - Refactor `connection-machine.js`: replace inline anonymous functions in `error` and `backoff` state entries with XState v5 parameterized `notifyStatus` action using resolver functions
  - Add missing status notifications: `connecting` and `reconnecting` states now emit yellow status via `notifyStatus`
  - Remove unused `startIndex` variable in `ConnectionPool.acquire()`

- **Code Review #1: Quality, Security & Robustness Improvements**
  - Extract `BaseTransport` base class from TCP/RTU transports – eliminates ~150 lines of code duplication (DRY)
  - Add Modbus-compliant input validation to all transport read/write methods (address 0-65535, register read length 1-125, coil read length 1-2000, write array bounds)
  - Add `setID()` range validation (unit ID 0-255) per Modbus specification
  - Fix `disconnect()` – properly await `close()` callback via Promise instead of fire-and-forget pattern
  - Fix `storeError` action – remove XState v4 `event.data` fallback, use v5-correct `event.error`
  - Add ±25% jitter to exponential backoff to prevent thundering-herd reconnection storms
  - Add `canEnqueue` guard combining `isValidRequest` + `isQueueNotFull` – prevents unbounded queue growth in reading/writing states
  - Replace dead `self.system.emit()` notification actions with functional `onStatusChange` callback pattern
  - Fix `RtuSemaphore.drain()` – replace `setTimeout` polling loop with event-based waiting (complete/timeout/error)
  - Fix `modbus-client-config.js` – replace `parseInt(x) || default` with `parseIntSafe()` to correctly handle value 0 (e.g. unitId 0 for TCP broadcast)
  - Remove duplicate TCP_DEFAULTS/RTU_DEFAULTS objects from config node (inline defaults)
  - Simplify `enqueueRequest` action (remove unnecessary temp variable)

### Added
- **MS-2: State Machine & Connection Management**
  - `src/lib/state-machine/connection-machine.js` – XState v5 state machine with 8 states (DISCONNECTED, CONNECTING, CONNECTED, READING, WRITING, ERROR, BACKOFF, RECONNECTING)
  - `src/lib/state-machine/guards.js` – XState guards (isConnected, hasRetriesLeft, isQueueNotFull, isValidRequest)
  - `src/lib/state-machine/actions.js` – XState actions (incrementRetry, resetRetry, storeError, enqueueRequest, dequeueRequest, calculateBackoff, storeTransport)
  - `src/lib/queue/connection-pool.js` – TCP connection pool with round-robin multiplexing, configurable pool size, replace/drain lifecycle
  - `src/lib/queue/rtu-semaphore.js` – RTU semaphore for half-duplex serial bus arbitration with inter-frame delay and timeout handling
  - `test/unit/state-machine/connection-machine.test.js` – 40 deterministic FSM tests covering all state transitions
  - `test/unit/queue/connection-pool.test.js` – 26 unit tests for TCP connection pool
  - `test/unit/queue/rtu-semaphore.test.js` – 22 unit tests for RTU semaphore

- **MS-1: Project Foundation & Transport Layer**
  - `src/lib/transport/tcp-transport.js` – TCP socket abstraction over modbus-serial (EventEmitter, FC 01-06/15/16)
  - `src/lib/transport/rtu-transport.js` – RTU serial abstraction with graceful fallback when serialport is not installed
  - `src/lib/transport/transport-factory.js` – Factory pattern for transport selection with config validation
  - `src/nodes/config/modbus-client-config.js` – Node-RED config node for TCP/RTU connection parameters
  - `src/nodes/config/modbus-client-config.html` – Config node editor UI with dynamic TCP/RTU field toggle and help sidebar
  - `test/unit/transport/tcp-transport.test.js` – 30 unit tests for TCP transport
  - `test/unit/transport/rtu-transport.test.js` – 32 unit tests for RTU transport
  - `test/unit/transport/transport-factory.test.js` – 20 unit tests for transport factory
  - `test/mocks/mock-tcp-socket.js` – Mock for net.Socket (cataloged in mocks/README.md)
  - `test/mocks/mock-serial-port.js` – Mock for serialport (cataloged in mocks/README.md)
  - Registered `modbus-client-config` node in package.json `node-red.nodes`
- Project structure and documentation initialized
- agents.md – AI agent guide
- MILESTONES.md – Milestone planning (8 milestones)
- docs/WORK_PACKAGES.md – Work Breakdown Structure (WP 1.1–5.4)
- docs/THEORETICAL_FOUNDATIONS.md – Complete theoretical foundation
- docs/ARCHITECTURE.md – Target architecture documentation
- docs/TEST_MANUAL.md – Test strategy and mock data policy
- docs/DEVELOPER_GUIDE.md – Developer guide
- docs/LEGAL_ANALYSIS.md – License compliance and plagiarism check
- docs/REFERENCES.md – Bibliography
- .gitignore, LICENSE (BSD-3-Clause), .mocharc.yml
- Project folder structure (src/, test/, examples/, docs/)

### Changed
- All documentation translated from German to English
- Documentation files renamed to English (e.g. ARBEITSPAKETE.md → WORK_PACKAGES.md)
