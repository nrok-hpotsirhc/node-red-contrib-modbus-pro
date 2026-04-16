# Agent Guide – node-red-contrib-modbus-pro

> This document serves as the primary guide for AI agents (e.g. GitHub Copilot, Cursor)
> working on this project. It defines context, rules, references, and session planning.

---

## 0. Language Policy

> **All documentation, code comments, commit messages, and inline markers in this project
> MUST be written in English.** This applies to all files in `docs/`, `test/`, `src/`,
> as well as root-level markdown files (README.md, MILESTONES.md, CHANGELOG.md, agents.md).

---

## 1. Project Overview

**Name:** `node-red-contrib-modbus-pro`  
**License:** BSD-3-Clause  
**Goal:** Development of an industrial-grade Modbus TCP/RTU integration package for Node-RED that eliminates the architectural weaknesses of the dominant legacy package `node-red-contrib-modbus` (BiancoRoyal) through modern software engineering principles.

### Core Principles
1. **Deterministic State Management** via XState (no hand-coded FSM)
2. **Centralized Connection Pooling** (TCP) and **Semaphore Arbitration** (RTU)
3. **Backpressure Management** with configurable queue limits and drop strategies
4. **Dynamic Server Proxying** – event-based slave architecture without monolithic arrays
5. **Modbus/TCP Security** – TLS 1.3, mTLS, X.509v3, port 802

### Technology Stack
- **Runtime:** Node.js >= 18 LTS
- **Platform:** Node-RED >= 3.0.0
- **State Machine:** XState v5
- **Transport:** modbus-serial (ISC license) as dependency
- **Serial (optional):** serialport v13 (as optional dependency)
- **Testing:** Mocha, Chai, Sinon, node-red-node-test-helper
- **Coverage:** nyc / Istanbul

---

## 2. Documentation References

| Document | Path | Description |
|----------|------|-------------|
| Theoretical Foundations | [docs/THEORETICAL_FOUNDATIONS.md](docs/THEORETICAL_FOUNDATIONS.md) | Modbus protocol, data model, endianness, security – complete theory |
| Architecture | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Target architecture, design patterns, component diagrams |
| Work Packages | [docs/WORK_PACKAGES.md](docs/WORK_PACKAGES.md) | All WP 1.1–5.4 with detailed descriptions |
| Milestones | [MILESTONES.md](MILESTONES.md) | Grouping of WPs into agent sessions, step-by-step |
| Test Manual | [docs/TEST_MANUAL.md](docs/TEST_MANUAL.md) | Test strategy, test catalog, mock data policy |
| Developer Guide | [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md) | Setup, coding standards, contributing |
| Legal Analysis | [docs/LEGAL_ANALYSIS.md](docs/LEGAL_ANALYSIS.md) | License compatibility, plagiarism check, differentiation |
| References | [docs/REFERENCES.md](docs/REFERENCES.md) | All sources, specifications, links |

---

## 3. Project Structure

```
node-red-contrib-modbus-pro/
├── src/
│   ├── nodes/
│   │   ├── config/          # Modbus-Client-Config, Modbus-Server-Config
│   │   ├── client/          # Modbus-Read, Modbus-Write
│   │   └── server/          # Modbus-In, Modbus-Out
│   ├── lib/
│   │   ├── transport/       # TCP/RTU abstraction, socket management
│   │   ├── state-machine/   # XState definitions for connection lifecycle
│   │   ├── queue/           # Backpressure queue with FIFO/LIFO drop
│   │   ├── security/        # TLS wrapper, certificate validation, RBAC
│   │   └── parser/          # Endianness conversion, Float32 parsing
│   └── index.js
├── test/
│   ├── unit/                # Granular unit tests per module
│   │   ├── transport/
│   │   ├── state-machine/
│   │   ├── queue/
│   │   ├── security/
│   │   └── parser/
│   ├── integration/         # End-to-end with node-red-node-test-helper
│   ├── fixtures/            # Static test data (DOCUMENTED in fixtures/README.md)
│   ├── mocks/               # Mock objects (DOCUMENTED in mocks/README.md)
│   └── helpers/             # Shared test utilities
├── examples/flows/          # Importable example flows
├── docs/                    # Full project documentation
├── agents.md                # ← This document
├── MILESTONES.md            # Milestone planning
├── CHANGELOG.md             # Updated with every release
└── package.json
```

---

## 4. Rules for Agent Sessions

### 4.1 Workflow
1. **Read MILESTONES.md** before every session to know the current state.
2. **Work on one milestone per session.** Each milestone is sized to be completable within a single agent session.
3. **Mark completed milestones** in MILESTONES.md with `[x]` and the date.
4. **Write tests alongside code** – every module needs unit tests BEFORE it is considered complete.
5. **Update CHANGELOG.md** with every feature or bugfix.

### 4.2 Coding Standards
- **Async code:** Exclusively async/await and Promises – NO callback hell, NO setTimeout cascades.
- **State management:** All connection states via XState – NO hand-coded if/else FSMs.
- **Error handling:** Errors propagate via XState transitions and Node-RED `node.error()`. Never silently swallow.
- **Logging:** `node.warn()` and `node.log()` with context (connection ID, unit ID).
- **Node-RED status:** Consistently use `this.status()` API – Connected (green), Disconnected (red), Error (red/ring), Queue Full (yellow).

### 4.3 Security Rules
- **Credentials:** NEVER store in `flow.json` – exclusively use the Node-RED Credential Store.
- **Private keys:** PEM paths only via credential fields (`type: "password"` in HTML).
- **No REST→Modbus-Write bridges** without authentication.
- **TLS validation:** Certificates MUST be validated (`rejectUnauthorized: true` as default).

---

## 5. Mock and Test Data Policy

> **CRITICAL:** All mock and test data MUST be visibly documented so they can be
> quickly found and removed or updated when necessary.

### Rules:
1. **Mock files** reside exclusively in `test/mocks/` and are cataloged in `test/mocks/README.md`.
2. **Test fixtures** (static data like register maps, certificates) reside in `test/fixtures/` and are cataloged in `test/fixtures/README.md`.
3. **Every mock file** contains a header comment:
   ```javascript
   /**
    * MOCK: [Description]
    * USED IN: [Test files that use this mock]
    * LAST UPDATED: [Date]
    * REMOVABLE: [yes/no + rationale]
    */
   ```
4. **No mock data in production code** (`src/`). Check on every PR/commit.
5. **Inline test data** in test files must be marked with `// TEST-DATA:`.
6. **Update obligation:** When the API changes, affected mocks and fixtures must be updated. The test manual ([docs/TEST_MANUAL.md](docs/TEST_MANUAL.md)) describes the process.

---

## 6. Work Package and Milestone References

The implementation follows the **Work Breakdown Structure** from [docs/WORK_PACKAGES.md](docs/WORK_PACKAGES.md), grouped into 8 milestones (see [MILESTONES.md](MILESTONES.md)):

| Milestone | Focus | Work Packages |
|-----------|-------|---------------|
| MS-1 | Project Foundation & Transport | WP 1.1, WP 1.2 |
| MS-2 | State Machine & Connection | WP 1.3, WP 1.4 |
| MS-3 | Client Read Nodes | WP 2.1, WP 2.4 |
| MS-4 | Client Write Nodes & Queue | WP 2.2, WP 2.3 |
| MS-5 | Server Proxy Architecture | WP 3.1, WP 3.2, WP 3.3 |
| MS-6 | Server Caching & Optimization | WP 3.4 |
| MS-7 | Modbus/TCP Security | WP 4.1, WP 4.2, WP 4.3 |
| MS-8 | QA, Documentation & Release | WP 5.1, WP 5.2, WP 5.3, WP 5.4 |

### Session Workflow per Milestone:
1. Read MILESTONES.md → check current status
2. Read related WPs in WORK_PACKAGES.md
3. Consult relevant theory in THEORETICAL_FOUNDATIONS.md
4. Implement code in `src/`
5. Write and run unit tests in `test/unit/`
6. Update mock/fixture documentation
7. Mark milestone as completed in MILESTONES.md
8. Update CHANGELOG.md

---

## 7. Theoretical Foundations (Quick Reference)

The complete document is at [docs/THEORETICAL_FOUNDATIONS.md](docs/THEORETICAL_FOUNDATIONS.md). Key points for agent sessions:

- **Modbus addressing:** Zero-based on the bus, one-based in datasheets. Register 40108 → offset 107, FC 03.
- **Endianness:** Modbus transmits big-endian. Float32 across 2 registers → word order is device-dependent.
- **Function codes:** FC 01-04 (Read), FC 05/06 (Write Single), FC 15/16 (Write Multiple). Max payload 240 bytes.
- **RTU vs. TCP:** RTU is half-duplex (semaphore required), TCP is full-duplex (connection pool possible).
- **Security:** TLS 1.3 over port 802, mTLS with X.509v3, credentials in the Node-RED Credential Store.

---

## 8. References (Short List)

Complete bibliography: [docs/REFERENCES.md](docs/REFERENCES.md)

- Modbus Application Protocol Specification V1.1b3 – modbus.org
- Modbus/TCP Security Protocol Specification – modbus.org
- modbus-serial (npm, ISC) – github.com/yaacov/node-modbus-serial
- jsmodbus (npm, MIT) – github.com/Cloud-Automation/node-modbus
- XState v5 Documentation – stately.ai/docs/xstate-v5
- Node-RED Node Creation Guide – nodered.org/docs/creating-nodes
- node-red-contrib-modbus (BSD-3-Clause) – github.com/BiancoRoyal/node-red-contrib-modbus
- FlowFuse Modbus Best Practices – flowfuse.com/blog
