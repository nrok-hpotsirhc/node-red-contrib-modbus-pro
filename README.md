# node-red-contrib-modbus-pro

> Next-Generation Modbus TCP/RTU Integration for Node-RED

[![License: BSD-3-Clause](https://img.shields.io/badge/License-BSD--3--Clause-blue.svg)](LICENSE)
[![Node-RED](https://img.shields.io/badge/Platform-Node--RED-red.svg)](https://nodered.org)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org)
[![Status](https://img.shields.io/badge/Status-In%20Development-orange.svg)](#development-progress)

---

## Development Progress

> **Current State:** Project foundation & documentation complete – implementation upcoming.

| # | Milestone | Status | Progress |
|---|-----------|--------|----------|
| MS-1 | Project Foundation & Transport Layer | 🔲 Open | `░░░░░░░░░░` 0 % |
| MS-2 | State Machine & Connection Management | 🔲 Open | `░░░░░░░░░░` 0 % |
| MS-3 | Client/Master – Read Nodes | 🔲 Open | `░░░░░░░░░░` 0 % |
| MS-4 | Client/Master – Write Nodes & Queue | 🔲 Open | `░░░░░░░░░░` 0 % |
| MS-5 | Server/Slave – Proxy Architecture | 🔲 Open | `░░░░░░░░░░` 0 % |
| MS-6 | Server Caching & Optimization | 🔲 Open | `░░░░░░░░░░` 0 % |
| MS-7 | Modbus/TCP Security | 🔲 Open | `░░░░░░░░░░` 0 % |
| MS-8 | Quality Assurance & Release | 🔲 Open | `░░░░░░░░░░` 0 % |

**Overall Progress: 0 / 8 milestones completed**

> Milestone details: [MILESTONES.md](MILESTONES.md) · Work packages: [docs/WORK_PACKAGES.md](docs/WORK_PACKAGES.md)

---

## Overview

**node-red-contrib-modbus-pro** is a ground-up Modbus integration package for Node-RED that systematically addresses the architectural weaknesses of existing legacy implementations. It provides:

- **Deterministic State Management** via [XState](https://xstate.js.org/) – eliminates race conditions and undefined states
- **Centralized Connection Pooling** – TCP multiplexing and RTU semaphore serialization
- **Backpressure Management** – configurable queue limits with FIFO/LIFO drop strategies
- **Dynamic Server Proxying** – event-based processing without monolithic memory arrays
- **Modbus/TCP Security (MBTPS)** – TLS 1.3, mTLS via X.509v3, port 802
- **Full Function Code Support** – FC 01-06, 15, 16 and diagnostics

## Architecture Principles

This project is based on a comprehensive requirements analysis, documented in:

| Document | Description |
|----------|-------------|
| [agents.md](agents.md) | AI agent guide for development |
| [docs/THEORETICAL_FOUNDATIONS.md](docs/THEORETICAL_FOUNDATIONS.md) | Complete theoretical foundation |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture documentation |
| [docs/WORK_PACKAGES.md](docs/WORK_PACKAGES.md) | Detailed work packages |
| [MILESTONES.md](MILESTONES.md) | Milestone planning |
| [docs/TEST_MANUAL.md](docs/TEST_MANUAL.md) | Test documentation & strategy |
| [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md) | Developer guide |
| [docs/LEGAL_ANALYSIS.md](docs/LEGAL_ANALYSIS.md) | License & legal analysis |
| [docs/REFERENCES.md](docs/REFERENCES.md) | Bibliography |

## Installation

```bash
npm install node-red-contrib-modbus-pro
```

For serial RTU support:

```bash
npm install node-red-contrib-modbus-pro serialport
```

## Quick Start

### Modbus TCP Client (Reading Holding Registers)

1. Drag a **Modbus Client Config** node into the flow
2. Configure IP address and port (default: 502)
3. Add a **Modbus Read** node and select FC 03 (Read Holding Registers)
4. Connect to a Debug node for output

### Modbus Server (Slave Simulation)

1. Drag a **Modbus Server Config** node into the flow
2. Connect **Modbus-In** and **Modbus-Out** nodes for dynamic address proxying
3. Process incoming requests in the flow and send responses back

## Supported Function Codes

| FC | Function | Data Type |
|----|----------|-----------|
| 01 | Read Coils | Bit (R) |
| 02 | Read Discrete Inputs | Bit (R) |
| 03 | Read Holding Registers | 16-Bit (R) |
| 04 | Read Input Registers | 16-Bit (R) |
| 05 | Write Single Coil | Bit (W) |
| 06 | Write Single Register | 16-Bit (W) |
| 15 | Write Multiple Coils | Bit[] (W) |
| 16 | Write Multiple Registers | 16-Bit[] (W) |

## Project Structure

```
node-red-contrib-modbus-pro/
├── src/
│   ├── nodes/          # Node-RED nodes (HTML + JS)
│   │   ├── config/     # Configuration nodes (TCP/RTU/Security)
│   │   ├── client/     # Client/Master nodes (Read/Write)
│   │   └── server/     # Server/Slave nodes (In/Out)
│   ├── lib/            # Internal libraries
│   │   ├── transport/  # TCP & RTU abstraction
│   │   ├── state-machine/ # XState state machine
│   │   ├── queue/      # Backpressure & queue management
│   │   ├── security/   # TLS/mTLS integration
│   │   └── parser/     # Endianness & buffer parsing
│   └── index.js        # Entry point
├── test/
│   ├── unit/           # Unit tests (Mocha/Chai)
│   ├── integration/    # Integration tests
│   ├── fixtures/       # Test fixtures (documented!)
│   ├── mocks/          # Mock objects (documented!)
│   └── helpers/        # Test helper functions
└── examples/
    └── flows/          # Example flows
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Unit tests only
npm run test:unit

# Code coverage
npm run test:coverage

# Linting
npm run lint
```

## License

This project is licensed under the **BSD-3-Clause License**. See [LICENSE](LICENSE) for details.

BSD-3-Clause was deliberately chosen to:
- Ensure maximum compatibility with industrial white-label applications
- Provide non-endorsement protection (clause 3) for the original authors
- Guarantee compatibility with all dependency licenses (ISC, MIT, Apache 2.0)

## Differentiation from Existing Packages

This project is a **complete rewrite** and contains no copied code from:
- `node-red-contrib-modbus` (BiancoRoyal, BSD-3-Clause)
- `modbus-serial` (yaacov, ISC) – used as a **dependency**, not copied
- `jsmodbus` (Cloud-Automation, MIT) – architectural concepts as inspiration

See [docs/LEGAL_ANALYSIS.md](docs/LEGAL_ANALYSIS.md) for the complete legal assessment.
