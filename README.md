# node-red-contrib-modbus-pro

> Next-Generation Modbus TCP/RTU Integration for Node-RED

[![License: BSD-3-Clause](https://img.shields.io/badge/License-BSD--3--Clause-blue.svg)](LICENSE)
[![Node-RED](https://img.shields.io/badge/Platform-Node--RED-red.svg)](https://nodered.org)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org)
[![Status](https://img.shields.io/badge/Status-MS--9%20Complete-brightgreen.svg)](#development-progress)
[![Tests](https://img.shields.io/badge/Tests-785%20passing-brightgreen.svg)](#development-progress)

---

## Development Progress

> **Current State (2026-05-05):** All 12 milestones complete. v0.2.0 release candidate – the package now ships **11 Node-RED nodes** and supports all spec function codes (FC 01–06, 07, 08, 11, 12, 15, 16, 17, 20, 21, 22, 23, 24, 43/14) plus advanced fieldbus operations (RBE, multi-rate scanner, safe-state watchdog, runtime metrics) and a new RTU-over-TCP transport. **785/785 tests passing**, lint clean.

| # | Milestone | Status | Progress |
|---|-----------|--------|----------|
| MS-1 | Project Foundation & Transport Layer | ✅ Complete | `██████████` 100 % |
| MS-2 | State Machine & Connection Management | ✅ Complete | `██████████` 100 % |
| MS-3 | Client/Master – Read Nodes | ✅ Complete | `██████████` 100 % |
| MS-4 | Client/Master – Write Nodes & Queue | ✅ Complete | `██████████` 100 % |
| MS-5 | Server/Slave – Proxy Architecture | ✅ Complete | `██████████` 100 % |
| MS-6 | Server Caching & Optimization | ✅ Complete | `██████████` 100 % |
| MS-7 | Modbus/TCP Security | ✅ Complete | `██████████` 100 % |
| MS-8 | Quality Assurance & Release | ✅ Complete | `██████████` 100 % |
| MS-9 | High-Priority Extended FCs | ✅ Complete | `██████████` 100 % |
| MS-10 | Serial Diagnostics & Legacy FCs | ✅ Complete | `██████████` 100 % |
| MS-11 | Fieldbus Architecture Extensions | ✅ Complete | `██████████` 100 % |
| MS-12 | Advanced Fieldbus Nodes | ✅ Complete | `██████████` 100 % |

**Overall Progress: 12 / 12 milestones completed – 785 / 785 tests passing**

> Milestone details: [MILESTONES.md](MILESTONES.md) · Work packages: [docs/WORK_PACKAGES.md](docs/WORK_PACKAGES.md)

---

## Overview

**node-red-contrib-modbus-pro** is a ground-up Modbus integration package for Node-RED that systematically addresses the architectural weaknesses of existing legacy implementations. It provides:

- **Deterministic State Management** via [XState](https://xstate.js.org/) – eliminates race conditions and undefined states
- **Centralized Connection Pooling** – TCP multiplexing and RTU semaphore serialization
- **Backpressure Management** – configurable queue limits with FIFO/LIFO drop strategies
- **Dynamic Server Proxying** – event-based processing without monolithic memory arrays
- **Modbus/TCP Security (MBTPS)** – TLS 1.3, mTLS via X.509v3, port 802
- **Implemented Function Codes** – FC 01–08, 11, 12, 15–17, 20, 21, 22, 23, 24, and 43/14 (full Modbus Application Protocol coverage)

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
2. Configure IP address (`192.168.1.10`) and port (default: `502`)
3. Add a **Modbus Read** node, select the config node, and set:
   - FC: `3 – Read Holding Registers`
   - Address: `0`, Quantity: `10`
   - Poll Interval: `1000` ms (or `0` for trigger-only mode)
4. Connect to a **Debug** node and deploy

The output message contains:
```json
{
  "payload": {
    "data": [100, 200, 300, ...],
    "buffer": "<Buffer 00 64 00 c8 01 2c ...>",
    "address": 0,
    "quantity": 10,
    "fc": 3,
    "unitId": 1
  },
  "topic": "modbus-read/3/0/10"
}
```

### Modbus Server (Slave Simulation)

1. Drag a **Modbus Server Config** node into the flow (default port: `8502`)
2. Add a **Modbus-In** node to receive incoming Modbus requests
3. Process the request in a **Function** node
4. Send the response back via a **Modbus-Out** node

```
[Modbus-In] → [Function: process request] → [Modbus-Out]
```

### Example Flows

Pre-built example flows are available in the `examples/flows/` directory:

| Flow | Description |
|------|-------------|
| [watchdog-heartbeat.json](examples/flows/watchdog-heartbeat.json) | Watchdog pattern with toggling heartbeat register and timeout detection |
| [rbe-filter.json](examples/flows/rbe-filter.json) | Report-By-Exception filter with deadband for efficient data logging |
| [bitwise-coil-packing.json](examples/flows/bitwise-coil-packing.json) | Pack 16 coils into a register and unpack status registers into bit flags |

Import via Node-RED menu: **☰ → Import → select file**.

## Node Reference

### Modbus Client Config

Configuration node that manages a Modbus TCP or RTU connection.

| Property | Default | Description |
|----------|---------|-------------|
| Connection Type | `tcp` | `tcp`, `rtu`, or `rtu-over-tcp` |
| Host | `127.0.0.1` | TCP server address |
| Port | `502` | TCP port |
| Serial Port | `/dev/ttyUSB0` | RTU serial device path |
| Baud Rate | `9600` | RTU baud rate |
| Unit ID | `1` | Modbus slave ID (1–247) |
| Timeout | `1000` ms | Response timeout |
| TLS Enabled | `false` | Enable Modbus/TCP Security (TLS 1.3) |

### Modbus Read

Reads coils, discrete inputs, holding registers, or input registers from a Modbus device.

| Property | Default | Description |
|----------|---------|-------------|
| Function Code | `3` | `1`=Coils, `2`=DI, `3`=HR, `4`=IR |
| Address | `0` | Start address |
| Quantity | `1` | Number of registers/coils to read |
| Address Offset | `zero-based` | `zero-based` or `one-based` |
| Poll Interval | `0` ms | Auto-polling interval (`0` = trigger via input only) |

**Input:** Any `msg` triggers a read (ignored in polling mode).
**Output:** `msg.payload` contains `{ data, buffer, address, quantity, fc, unitId }`.

### Modbus Write

Writes values to coils or holding registers on a Modbus device. Includes a backpressure queue.

| Property | Default | Description |
|----------|---------|-------------|
| Function Code | `6` | `5`=Single Coil, `6`=Single Reg, `15`=Multi Coil, `16`=Multi Reg, `22`=Mask Write, `23`=Read/Write |
| Address | `0` | Target address |
| Address Offset | `zero-based` | `zero-based` or `one-based` |
| Max Queue Size | `100` | Maximum queued write requests |
| Drop Strategy | `fifo` | `fifo` (drop oldest) or `lifo` (drop newest) when queue is full |

**Input:** `msg.payload` = value (`number` for FC 5/6, `array` for FC 15/16, `{ andMask, orMask }` for FC 22, `array` for FC 23).
**Output:** Write confirmation with address and value.

### Modbus Discover

Reads device identification from a Modbus device using FC 43/14 (MEI Transport).

| Property | Default | Description |
|----------|---------|-------------|
| Device ID Level | `1` | `1`=Basic, `2`=Regular, `3`=Extended, `4`=Individual |
| Object ID | `0` | Object ID for Individual mode (0x00–0xFF) |

**Input:** Any `msg` triggers a discovery request. Override with `msg.deviceIdCode` / `msg.objectId`.
**Output:** `msg.payload` contains `{ conformityLevel, deviceInfo, objects, raw }`.

### Modbus Diagnostic

Issues serial-line diagnostic and identification function codes (FC 07, 08, 11, 12, 17) that are not covered by the regular read/write nodes.

| Property | Default | Description |
|----------|---------|-------------|
| Mode | `exceptionStatus` | `exceptionStatus` (FC 07) / `diagnostics` (FC 08) / `eventCounter` (FC 11) / `eventLog` (FC 12) / `reportServerId` (FC 17) |
| Sub-function | `0` | FC 08 sub-function code (0=Loopback, 1=Restart, …) |
| Data field | `0` | FC 08 data payload |

**Input:** Any `msg` triggers the configured operation. FC 08 honors `msg.subFunction` / `msg.dataField` overrides.
**Output:** Function-code-specific structured object (e.g. `{ statusByte, bits[] }` for FC 07; `{ status, eventCount, messageCount, events[] }` for FC 12).

### Modbus File

Provides access to file/FIFO function codes for legacy PLC file systems.

| Property | Default | Description |
|----------|---------|-------------|
| Mode | `readFile` | `readFile` (FC 20) / `writeFile` (FC 21) / `readFifo` (FC 24) |
| File Number | `1` | Target file (1–65535) |
| Record Number | `0` | Record offset (0–9999) |
| Record Length | `1` | Read length in registers (1–125) |
| FIFO Pointer | `0` | FIFO pointer address (FC 24 only) |

**Input:** Any `msg` triggers the operation. FC 21 requires `msg.payload.values` (array of register values to write). All parameters can be overridden via `msg.payload`.
**Output:** `{ records[][] }` for read, `{ valuesWritten }` for write, `{ count, values[] }` for FIFO.

### Modbus RBE (Report-by-Exception)

Suppresses unchanged values from a cyclic Modbus read flow. Only forwards a downstream message when at least one register/coil exceeds the configured dead-band.

| Property | Default | Description |
|----------|---------|-------------|
| Mode | `absolute` | `absolute` / `percentage` / `boolean` |
| Dead-band | `0` | Threshold (raw value or percentage) |
| Inhibit (ms) | `0` | Min time between reports per address |
| Pass through first | `true` | Forward the very first message as a baseline |

**Input:** Standard `modbus-read` payload (`{ fc, address, data: [...] }`). Send `msg.reset = true` to clear the baseline.
**Output:** Original `msg.payload` plus `msg.changed` (array of addresses that crossed the threshold) and `msg.rbe` (mode/deadband/counts).

### Modbus Scanner

Single-instance polling scheduler that replaces a constellation of cyclic `modbus-read` nodes. Maintains a configurable list of read groups, each with its own interval, sharing one transport.

| Property | Default | Description |
|----------|---------|-------------|
| Scan groups (JSON) | `[{"id":"fast","intervalMs":1000,"fc":3,"address":0,"quantity":10}]` | Array of group definitions |
| Auto-start | `true` | Start polling on deploy |

Each group must specify `id`, `intervalMs` (≥ 50), `fc` (1–4), `address`, `quantity`, and optionally `unitId`. Overlapping cycles are dropped silently.

**Commands:** `start`, `stop`, `trigger` (with optional `msg.groupId`), `stats`.
**Output:** One message per group per cycle, with the same shape as `modbus-read`, plus `msg.modbusScanner = { groupId, intervalMs, cycle }`.

### Modbus Watchdog

Cyclically writes a heartbeat value to a Modbus device. On heartbeat failure or transport disconnect, performs a configurable safe-state write. Optional restore write returns the device to normal operation on reconnect.

| Property | Default | Description |
|----------|---------|-------------|
| Heartbeat interval | `1000` ms | Heartbeat period |
| Heartbeat / Safe-state / Restore FC | `6` | Write FC (5/6/15/16) |
| Heartbeat / Safe-state / Restore Address | `0` | Target address |
| Heartbeat / Safe-state / Restore Value | `1` / `0` / `1` | Value to write |
| Restore enabled | `false` | Issue a restore write on reconnect |

**Commands (`msg.payload`):** `start`, `stop`, `safeState` (manual trigger), `status`.
**Events:** `safeState` (with reason), `reconnect`.

> **Safety disclaimer:** Node-RED is not a safety-rated runtime. This node provides defense-in-depth only and must not replace a hardware safety system.

### Modbus Stats

Aggregates runtime metrics across the configured Modbus client transport by transparently wrapping its read/write methods.

| Property | Default | Description |
|----------|---------|-------------|
| Mode | `periodic` | `periodic` (emit on interval) or `onDemand` |
| Interval (ms) | `5000` | Snapshot period |
| Latency buffer | `1000` | Ring buffer size for percentile calculations |

**Commands:** `snapshot` / `get` (emit current metrics), `reset` (clear counters), `rehook` (re-attach to transport after manual reconnect).
**Output:** `{ requests: { total, byFc }, errors: { total, byFc }, exceptions: { code: count }, latencyMs: { count, last, min, max, avg, p50, p95, p99 }, uptimeMs }`.

### Modbus Server Config

Configuration node that creates a Modbus TCP server (slave simulator / proxy).

| Property | Default | Description |
|----------|---------|-------------|
| Host | `0.0.0.0` | Bind address |
| Port | `8502` | Listen port |
| Unit ID | `255` | Accepted unit ID (`255` = any) |
| Response Timeout | `5000` ms | Max time to wait for flow response |
| Cache Enabled | `false` | Enable register cache |
| Cache TTL | `60000` ms | Cache time-to-live |
| TLS Enabled | `false` | Enable TLS server mode |

### Modbus In

Receives incoming Modbus requests from connected clients and emits them into the flow.

| Property | Default | Description |
|----------|---------|-------------|
| Filter FC | `all` | Filter by function code (`all` or specific FC number) |
| Filter Unit ID | `all` | Filter by unit ID (`all` or specific ID) |

**Output:** `msg.payload` contains `{ requestId, fc, address, quantity, unitId }`.

### Modbus Out

Sends a response back to the Modbus client that sent the original request.

| Property | Default | Description |
|----------|---------|-------------|

**Input:** `msg.payload` must include `{ requestId, data }` from the Modbus-In node.

## Supported Function Codes

| FC | Function | Data Type | Status |
|----|----------|-----------|--------|
| 01 | Read Coils | Bit (R) | ✅ |
| 02 | Read Discrete Inputs | Bit (R) | ✅ |
| 03 | Read Holding Registers | 16-Bit (R) | ✅ |
| 04 | Read Input Registers | 16-Bit (R) | ✅ |
| 05 | Write Single Coil | Bit (W) | ✅ |
| 06 | Write Single Register | 16-Bit (W) | ✅ |
| 15 | Write Multiple Coils | Bit[] (W) | ✅ |
| 16 | Write Multiple Registers | 16-Bit[] (W) | ✅ |
| 22 | Mask Write Register | 16-Bit (W) | ✅ |
| 23 | Read/Write Multiple Registers | 16-Bit (R/W) | ✅ |
| 43/14 | Read Device Identification | String (R) | ✅ |
| 07 | Read Exception Status | Byte (R) | ✅ MS-10 |
| 08 | Diagnostics | Various | ✅ MS-10 |
| 11/12/17 | Serial Diagnostics | Various | ✅ MS-10 |
| 20/21 | File Record Access | File (R/W) | ✅ MS-10 |
| 24 | Read FIFO Queue | 16-Bit[] (R) | ✅ MS-10 |

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
