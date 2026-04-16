# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Changed
- **Code Review: Quality, Security & Robustness Improvements**
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
