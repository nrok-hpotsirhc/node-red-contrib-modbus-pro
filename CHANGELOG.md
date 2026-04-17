# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Fixed (Code Review Pass)
- **modbus-server-config:** Added `setCoilArray` (FC 15) and `setRegisterArray` (FC 16) to the modbus-serial vector so multi-write requests are proxied as a single `modbusRequest` event with the full array payload, and cache invalidation receives the correct `count`. Previously FC 15/16 fell back to per-address loops.
- **state-machine/guards:** `isValidRequest` now enforces `address ≤ 0xFFFF` (upper bound) and requires an integer `length` between 1 and 2000; it also rejects empty `operation` strings. Prevents malformed requests from reaching the transport.
- **state-machine/connection-machine:** `createConnectionActor` now normalizes `baseDelay`, `maxDelay`, `maxRetries`, and `maxQueueSize`. If `baseDelay > maxDelay`, the values are swapped to preserve meaningful exponential backoff.
- **tcp-transport:** `connect()` now destroys the TLS wrapper when `connectTCP` fails, preventing a leaked `TlsWrapper` instance on reconnect attempts.
- **rtu-semaphore:** The inter-frame timer is now tracked as `_scheduleTimer` and cleared in `drain()`, allowing clean shutdown without a dangling pending timer.
- **modbus-read:** `pollInterval` is now clamped to `(0, 86400000]`. Negative or non-finite values (previously accepted by `parseInt`) are rejected with a warning and polling is disabled. Switched to `parseIntSafe` for all numeric config parsing to correctly handle `0`.

### Documentation
- **Theoretical Foundations Expansion (§12–§17) for MS-9–MS-12**
  - Added §12: Extended Function Codes – PDU Structure and Protocol Behavior
    - Detailed PDU request/response structures for FC 22, 23, 43/14, 07, 08, 11, 12, 17, 20, 21, 24
    - modbus-serial API mapping and library support summary table
    - FC 08 full sub-function reference (13 diagnostic sub-functions)
    - FC 43/14 MEI conformity levels, object ID map, and streaming protocol
  - Added §13: Modbus Exception Responses – error response format, all exception codes (0x01–0x0B), gateway-specific behavior, structured error object design with retryable flag
  - Added §14: PDU Payload Limits and Automatic Request Chunking – per-FC maximum quantities, chunking algorithm, reassembly considerations, broadcast (Unit ID 0) semantics
  - Added §15: Extended Data Types Across Modbus Registers – Float64, Int64/UInt64 (BigInt), ASCII String, BCD, Unix Timestamp, IEC 61131-3 DateTime with byte-order variants
  - Added §16: Modbus RTU over TCP Encapsulation – MBAP vs raw RTU framing, gateway product landscape (Moxa, Lantronix, Wago, Digi, ADAM), inter-frame delay formula, modbus-serial `connectTcpRTUBuffered` API
  - Added §17: Industrial Operational Patterns – RBE/dead-band filtering (IEC 61131-3), multi-rate scan scheduling, watchdog/safe-state heartbeat (IEC 61508, ISO 13849), runtime metrics with EMA
  - Extended Glossary with 6 new terms (BCD, EMA, MBAP, MEI, OEE, SIL)
  - Updated Table of Contents to include §12–§17
- Updated all WP (6.1–7.8) theory references to point to new dedicated sections
- Updated all milestone (MS-9–MS-12) theory references in MILESTONES.md

- **FC Gap Analysis & Roadmap Planning (MS-9–MS-12)**
  - Conducted complete gap analysis against the Modbus Application Protocol Specification V1.1b3: 8 of 21 function codes were already implemented (FC 01–06, 15, 16); 13 function codes are now planned in 4 new milestones
  - Updated `docs/THEORETICAL_FOUNDATIONS.md` §3 with a complete FC status table (✅ Implemented / 🔲 Planned / ⬜ Out of scope) and detailed descriptions of all planned FCs
  - Added **WP 6** (Extended Function Codes) with 4 sub-packages:
    - WP 6.1: FC 22 (Mask Write Register) + FC 23 (Read/Write Multiple Registers) → MS-9
    - WP 6.2: FC 43/14 (Read Device Identification) → MS-9
    - WP 6.3: FC 08 (Diagnostics) + FC 07 (Read Exception Status) → MS-10
    - WP 6.4: FC 11, 12, 17 (serial diagnostics) + FC 20, 21, 24 (file/FIFO) → MS-10
  - Added **WP 7** (Fieldbus Specialist Extensions) with 4 sub-packages:
    - WP 7.1: Automatic request chunking + broadcast (Unit ID 0) → MS-11
    - WP 7.2: Extended data types (Float64, Int64, String, BCD, DateTime) → MS-11
    - WP 7.3: Structured Modbus exception code handling (0x01–0x0B) → MS-11
    - WP 7.4: RTU-over-TCP transport for industrial gateways → MS-11
    - WP 7.5: Report-by-Exception (RBE) dedicated node → MS-12
    - WP 7.6: Scan-list / Polling-Scheduler node → MS-12
    - WP 7.7: Watchdog / Safe-State Heartbeat node → MS-12
    - WP 7.8: Statistics and Diagnostics Runtime node → MS-12
  - Added 4 new milestones (MS-9–MS-12) to `MILESTONES.md`
  - Updated `agents.md` §6 milestone table and §9 status snapshot

### Changed
- **Code Review #5: State Machine, Cache & Transport Hardening**
  - Fix `connection-machine.js` reconnect retry reset: `reconnecting → connected` transition now calls `resetRetry` so subsequent failures get a fresh retry budget instead of continuing from where the last reconnect left off
  - Fix `guards.js` NaN address rejection: `isValidRequest` now uses `Number.isFinite()` to reject NaN addresses (previously `NaN` passed `typeof === 'number'` and `NaN < 0 === false`)
  - Fix `register-cache.js` range invalidation: `invalidateOnWrite()` now scans for cached range reads that overlap the written address range, preventing stale data when a write hits the middle of a previously cached batch read
  - Add disconnect timeout in `base-transport.js`: `disconnect()` now has a 10s safety timeout preventing hung promises if `_client.close()` callback never fires
  - Add `timer.unref()` to `modbus-read.js` poll interval timer and `modbus-server-config.js` deferred start timer
  - Fix `certificate-validator.js` CRLF handling: `_parseOURoles()` now splits on `/\r?\n/` to handle Windows-style line endings in X.509 subjects

### Changed
- **Code Review #4: Security, Robustness & Code Quality**
  - Fix double `done()` call in `modbus-write.js` LIFO drop: drop event handler now only calls `done()` for FIFO drops (old items). LIFO drops are handled by the current input handler, preventing Node-RED message tracking corruption
  - Fix `tls-wrapper.js` `disconnect()` double-resolve: added `settled` guard and `clearTimeout` to prevent timeout from firing after socket close event, eliminating redundant `socket.destroy()` on already-closed sockets
  - Fix `base-transport.js` `destroy()` resource leak: wrap `disconnect()` call in try/catch so `removeAllListeners()` always runs even if disconnect throws, preventing listener accumulation
  - Fix `modbus-in.js` and `modbus-out.js` timer leak: track `setTimeout` handles for status-reset and clear them on node close, preventing "not a function" errors after node removal
  - Add timeout protection to `modbus-server-config.js` `stopServer()`: 10s safety timer ensures the promise resolves even if `server.close()` callback never fires; try/catch around close calls prevents unhandled exceptions during shutdown
  - Extract shared `parseIntSafe()` utility to `src/lib/utils.js` (DRY): remove duplicate implementations from `modbus-client-config.js` and `modbus-server-config.js`
  - Add polling error throttle in `modbus-read.js`: repeated identical errors during interval polling are logged only once, preventing log flooding when transport is down
  - Add `timer.unref()` to `rtu-semaphore.js` inter-frame delay timer: prevents the timer from keeping the Node.js process alive during shutdown
  - Generate missing test certificate fixtures (`test/fixtures/certs/`): CA, server (with SAN), client (with OU=ModbusOperator), encrypted key (AES-256), untrusted cert, expired cert – via `generate-certs.js` script. Fixes 35 previously failing security tests (532/532 now passing)

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
