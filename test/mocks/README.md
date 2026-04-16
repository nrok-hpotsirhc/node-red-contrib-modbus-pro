# Mock Objects Catalog
> MANDATORY DOCUMENT: Every mock file in this directory MUST be cataloged here.
> See also: [Test Manual](../../docs/TEST_MANUAL.md) | [agents.md](../../agents.md) §5
---
## Directory Structure
```
test/mocks/
├── README.md                 ← This document (catalog)
├── mock-serial-port.js       # Mock for serialport (planned: MS-1)
├── mock-tcp-socket.js        # Mock for net.Socket (planned: MS-1)
└── mock-modbus-server.js     # Mock Modbus TCP Server (planned: MS-3)
```
## Catalog
| File | Simulates | Used In | Last Updated | Removable? | Dependencies |
|------|----------|---------|-------------|------------|-------------|
| `mock-tcp-socket.js` | `net.Socket` for TCP transport | `test/unit/transport/tcp-transport.test.js` | 2026-04-16 | no – required for TCP transport unit tests | none |
| `mock-serial-port.js` | `serialport` module for RTU transport | `test/unit/transport/rtu-transport.test.js` | 2026-04-16 | no – required for RTU transport unit tests | none |
---
## Guidelines
### Mandatory Header
Every mock file MUST contain the following header comment:
```javascript
/**
 * MOCK: [Short description]
 * SIMULATES: [What is being simulated?]
 * USED IN: [List of test files]
 * LAST UPDATED: [Date]
 * REMOVABLE: [yes/no – rationale]
 * DEPENDENCIES: [Which modules are being mocked?]
 */
```
### General Rules
1. **Every new mock file** must be registered in the table above
2. **Mocks may only be used in `test/`** – NEVER in `src/`
3. **Naming convention:** `mock-<what-is-mocked>.js`
4. **Mocks must be deterministic** – no random values without seed
5. **Mocks must replicate the real API as closely as possible** – same method names and signatures
6. **Cleanup:** Remove mocks that are no longer needed and delete them from this catalog
