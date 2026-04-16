# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
- **MS-7: Modbus/TCP Security**
  - `src/lib/security/certificate-validator.js` – X.509v3 certificate validator for Modbus/TCP Security. Validates PEM-encoded certificates and private keys, checks expiry with configurable warning threshold, verifies cert/key pair matching, extracts RBAC roles from X.509v3 OU fields. Supports encrypted private keys with passphrase. Used by both client and server config nodes.
  - `src/lib/security/tls-wrapper.js` – TLS socket factory for Modbus/TCP Security connections. Creates and manages TLS sockets compliant with the Modbus/TCP Security specification (port 802, TLS 1.2/1.3, mTLS with X.509v3). Pre-validates certificates, supports handshake timeout, emits connect/error/close events. Peer certificate inspection and RBAC role extraction from connected peers.
  - Extended `src/lib/transport/tcp-transport.js` – TLS support via `tls: true` config option. When TLS enabled: creates TlsWrapper, establishes TLS connection, passes secure socket to modbus-serial's connectTCP. Auto-sets port to 802 when TLS enabled and port not explicitly set. Reports transport type as `tcp+tls`. TLS resource cleanup on destroy.
  - Extended `src/nodes/config/modbus-client-config.js` – TLS configuration for client connections: tlsEnabled flag, rejectUnauthorized toggle, credential fields for CA/cert/key paths and passphrase via Node-RED Credential Store. Validates TLS credentials on startup with warnings and errors. TLS config merged into transport config.
  - Extended `src/nodes/config/modbus-client-config.html` – TLS UI section: Enable TLS checkbox (auto-switches port 502↔802), CA Certificate path, Client Certificate path, Private Key path, Key Passphrase, Verify Server checkbox. Dynamic show/hide based on connection type and TLS toggle. Help sidebar with Modbus/TCP Security documentation.
  - Extended `src/nodes/config/modbus-server-config.js` – TLS listener support: creates `tls.createServer()` when TLS enabled, passes to ServerTCP via server option. Supports mTLS with requestCert/rejectUnauthorized. Credential fields for server CA/cert/key/passphrase. Validates certificates on startup.
  - Extended `src/nodes/config/modbus-server-config.html` – TLS UI section: Enable TLS checkbox, Server CA/Certificate/Key/Passphrase fields, Verify Clients checkbox. Help sidebar with TLS documentation and security notes.
  - `test/unit/security/certificate-validator.test.js` – 55 unit tests covering constructor, certificate validation (valid/invalid/expired/non-PEM), key validation (valid/encrypted/wrong passphrase), key pair verification (matching/mismatched), config validation (full/partial/error propagation), RBAC role extraction, certificate info extraction, internal OU parsing.
  - `test/unit/security/tls-wrapper.test.js` – 40 unit tests covering constructor (host validation, defaults, options), TLS options building, connection state, disconnect/destroy lifecycle, integration tests with real TLS server (mTLS handshake, peer certificate inspection, untrusted cert rejection), error scenarios (connection refused, handshake timeout).
  - `test/fixtures/certs/` – Self-signed test certificates: CA (root), server (with SAN), client (with OU=ModbusOperator for RBAC), encrypted key (AES-256), untrusted cert (not signed by CA), expired cert (1-day validity). All documented in fixtures/README.md.

### Added
- **MS-6: Server Caching & Optimization**
  - `src/lib/cache/register-cache.js` – In-memory hashmap-based register cache for the Modbus server proxy. Stores read responses keyed by function code, unit ID, and address. Features configurable TTL per entry (default 60s), max cache size with LRU-like eviction of oldest entries, automatic invalidation on write operations (FC 05/06/15/16 invalidate corresponding FC 01/03 entries), periodic expired-entry cleanup, runtime enable/disable, unit-level invalidation, and performance statistics (hit rate, size). Extends EventEmitter with hit/miss/evict events.
  - `test/unit/cache/register-cache.test.js` – 71 unit tests covering constructor validation, get/set operations, TTL expiration, max size eviction, write invalidation (FC 05→FC 01, FC 06→FC 03, FC 15→FC 01, FC 16→FC 03), unit invalidation, clear, enable/disable toggling, events, statistics, destroy lifecycle, and edge cases (address 0, unit 255, large arrays, constant memory under flooding)
  - Integrated cache into `modbus-server-config.js` – Read requests check cache first (cache hit returns immediately without flow traversal), write requests auto-invalidate affected cache entries, successful flow responses are cached for subsequent reads
  - Extended `modbus-server-config.html` – Added cache configuration UI: Enable Cache checkbox, Cache TTL (ms), Max Cache Size, with dynamic show/hide of cache fields and help sidebar documentation

### Added
- **MS-5: Server/Slave – Proxy Architecture**
  - `src/nodes/config/modbus-server-config.js` – Modbus TCP server config node using modbus-serial's ServerTCP with event-based vector callbacks implementing the Dynamic Server Proxy pattern (no monolithic memory arrays)
  - `src/nodes/config/modbus-server-config.html` – Server config UI with host, port, unit ID, response timeout settings and help sidebar
  - `src/nodes/server/modbus-in.js` – Modbus-In node subscribing to server config events, injecting structured JSON requests (fc, address, quantity/value, requestId, unitId) into the Node-RED flow with function code and unit ID filtering
  - `src/nodes/server/modbus-in.html` – Modbus-In editor UI with server selection, function code filter, unit ID filter, and help sidebar
  - `src/nodes/server/modbus-out.js` – Modbus-Out node collecting flow responses and routing them back to the waiting external Modbus client via resolveRequest()/rejectRequest(), with error response support and message forwarding
  - `src/nodes/server/modbus-out.html` – Modbus-Out editor UI with help sidebar including Modbus error codes reference and example flow
  - `test/unit/server/modbus-server-config.test.js` – 14 unit tests for server config (loading, config parsing, request emitter, resolve/reject, server lifecycle, TCP integration, full proxy round-trip)
  - `test/integration/modbus-server-proxy.test.js` – 18 integration tests with real TCP connections (modbus-in/out loading, validation, filtering, FC 03/04 register reads, FC 05/06 writes, concurrent requests, cleanup)
  - Registered `modbus-server-config`, `modbus-in`, `modbus-out` nodes in package.json `node-red.nodes`

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
- docs/LEGAL_ANALYSIS.md – License compliance and source attribution
- docs/REFERENCES.md – Bibliography
- .gitignore, LICENSE (BSD-3-Clause), .mocharc.yml
- Project folder structure (src/, test/, examples/, docs/)

### Changed
- All documentation translated from German to English
- Documentation files renamed to English (e.g. ARBEITSPAKETE.md → WORK_PACKAGES.md)
