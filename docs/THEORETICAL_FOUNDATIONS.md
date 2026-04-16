# Theoretical Foundations

> Complete theoretical foundation for the node-red-contrib-modbus-pro project.
> Serves as a reference for developers and AI agents.
> References: [Agents](../agents.md) | [Architecture](ARCHITECTURE.md) | [Work Packages](WORK_PACKAGES.md) | [References](REFERENCES.md)

---

## Table of Contents

1. [Historical Context of the Modbus Protocol](#1-historical-context-of-the-modbus-protocol)
2. [Transport Layers: Modbus RTU vs. Modbus TCP](#2-transport-layers-modbus-rtu-vs-modbus-tcp)
3. [The Modbus Data Model](#3-the-modbus-data-model)
4. [Endianness in JavaScript](#4-endianness-in-javascript)
5. [Modbus/TCP Security Protocol (MBTPS)](#5-modbustcp-security-protocol)
6. [Deterministic State Management via XState](#6-deterministic-state-management-via-xstate)
7. [Backpressure Management](#7-backpressure-management)
8. [Dynamic Address Space Mapping](#8-dynamic-address-space-mapping)
9. [Analysis of Existing Implementations](#9-analysis-of-existing-implementations)
10. [Node.js Libraries Comparison](#10-nodejs-libraries-comparison)
11. [Best Practices for Industrial Deployment](#11-best-practices-for-industrial-deployment)

---

## 1. Historical Context of the Modbus Protocol

### Origin and Standardization

The Modbus protocol was developed in 1979 by Modicon (now part of Schneider Electric) for communication between programmable logic controllers (PLCs). Due to its open specification, simplicity, and royalty-free usage, it has become the de facto standard of industrial automation.

In April 2004, the protocol rights were transferred to the independent **Modbus Organization, Inc.**, cementing the commitment to open interoperability and the avoidance of vendor lock-in.

> **Source:** Modbus Organization – "Modbus Application Protocol Specification V1.1b3" [REF-01]

### Client-Server Architecture (formerly Master-Slave)

The architecture is based on a strict **request-response paradigm**:

- **Client (formerly Master):** Initiates data exchange, sends requests
- **Server (formerly Slave):** Acts purely reactively, only responds to requests

This asymmetry has fundamental implications for the Node-RED implementation:
- A **client node** triggers asynchronous events in the Node.js event loop
- A **server node** continuously listens on a port and manages an address space

### Device Addressing

- Slave IDs 1–247 on a bus
- Address 0: Broadcast (all slaves)
- Addresses 248–255: Reserved
- For TCP: Unit ID typically 255 or 1 (except when using gateways)

> **Source:** Modbus Organization – "MODBUS over Serial Line Specification V1.02" [REF-02]

---

## 2. Transport Layers: Modbus RTU vs. Modbus TCP

### Modbus RTU (Remote Terminal Unit)

- **Physical Medium:** RS-485 (differential signaling, >1000m), RS-232
- **Data Format:** Compact binary format, continuous data sequence
- **Error Checking:** CRC (Cyclic Redundancy Check, 2 bytes)
- **Node Limit:** 32 physical devices (hardware), 247 logical addresses
- **Communication:** Half-duplex (sequential)
- **Speed:** Typically 9,600–115,200 bit/s

**Implication for Node-RED:**
Since serial lines operate sequentially, an RTU client MUST implement a locking mechanism (semaphore). Parallel read requests from multiple flows must be queued.

### Modbus TCP/IP

- **Physical Medium:** Ethernet, Wi-Fi
- **Adaptation:** 1999, encapsulation in TCP/IP packets
- **Error Checking:** TCP checksum + Ethernet FCS (no separate CRC)
- **Port:** 502 (standard), 802 (TLS)
- **Communication:** Full-duplex, multiplexing possible
- **Speed:** 10/100/1000 Mbit/s

**Implication for Node-RED:**
TCP allows parallel socket connections. A connection pool can distribute requests across multiple sockets.

### Comparison Table

| Feature | Modbus RTU | Modbus TCP |
|---------|-----------|-----------|
| Medium | RS-485, RS-232 | Ethernet, Wi-Fi |
| Error Checking | CRC (2 bytes) | TCP Checksum |
| Addressing | Slave ID (1–247) | IP + Unit ID |
| Nodes/Network | 32 (HW), 247 (SW) | Unlimited (IP) |
| Communication | Half-Duplex | Full-Duplex |
| Speed | ≤ 115,200 bit/s | ≤ 1 Gbit/s |
| Use Case | Legacy, long cables, interference | IIoT, cloud, SCADA |

> **Sources:** Modbus Application Protocol Specification V1.1b3 [REF-01], MODBUS Messaging on TCP/IP Implementation Guide V1.0b [REF-03]

---

## 3. The Modbus Data Model

### Four-Table Architecture

The Modbus protocol abstracts machine data through a four-part table system derived from relay logic (ladder logic):

| Table | Type | Access | Size | Function Codes |
|-------|------|--------|------|----------------|
| **Discrete Inputs** (Contacts) | Boolean | Read-only | 1 bit | FC 02 |
| **Coils** (Discrete Outputs) | Boolean | Read/Write | 1 bit | FC 01, 05, 15 |
| **Input Registers** | Numeric | Read-only | 16 bit | FC 04 |
| **Holding Registers** | Numeric | Read/Write | 16 bit | FC 03, 06, 16 |

### Addressing Paradox: Zero-Based vs. One-Based

One of the most common error sources in Modbus integration:

- **Protocol level (bus):** Strictly zero-based. The first holding register has address 0x0000.
- **Datasheet convention:** One-based with type prefix:
  - Discrete Inputs: 10001–19999
  - Coils: 00001–09999
  - Input Registers: 30001–39999
  - Holding Registers: 40001–49999

**Example:** Datasheet shows register **40108**
- Leading "4" → Holding Register → FC 03
- Offset on bus: 108 - 1 = **107** (0x006B)

> An architecturally mature Node-RED node must make this offset mapping transparent or support the user through clear UI validation.

### Standardized Function Codes (FC)

| FC (Dec) | FC (Hex) | Function | Target Table | Action |
|----------|----------|----------|--------------|--------|
| 01 | 0x01 | Read Coils | Coils | Reads up to 2000 outputs |
| 02 | 0x02 | Read Discrete Inputs | Discrete Inputs | Reads inputs for HMI/SCADA |
| 03 | 0x03 | Read Holding Registers | Holding Registers | Reads parameters/setpoints |
| 04 | 0x04 | Read Input Registers | Input Registers | Reads analog measurements |
| 05 | 0x05 | Write Single Coil | Coils | Sets a single output |
| 06 | 0x06 | Write Single Register | Holding Registers | Writes a 16-bit value |
| 15 | 0x0F | Write Multiple Coils | Coils | Writes bit sequences |
| 16 | 0x10 | Write Multiple Registers | Holding Registers | Writes register blocks |

**Extended Function Codes (optional):**
- FC 08 (0x08): Diagnostics – serial line testing
- FC 43 (0x2B): Read Device Identification – automated device discovery

**Payload Limitation:** The Modbus specification limits the payload to 240 bytes, meaning a maximum of ~120 registers (16 bits each) per read request. Larger data sets require chunking across multiple sequential requests.

> **Source:** Modbus Application Protocol Specification V1.1b3, Chapter 6 [REF-01]

---

## 4. Endianness in JavaScript

### The Problem

Modbus transmits data packets strictly in **big-endian format** (MSB first). The hex value `0x1234` is sent as `0x12` followed by `0x34`.

Many industrial sensors generate **32-bit values** (Float32 IEEE 754, UInt32) that are split across **two consecutive 16-bit registers**. However, the Modbus protocol does not define the order of these two registers:

| Variant | Register Order | Example for 123456.0 (Float32) |
|---------|---------------|-------------------------------|
| Big-Endian (AB CD) | High word first | [0x47F1, 0x2000] |
| Little-Endian (CD AB) | Low word first | [0x2000, 0x47F1] |
| Big-Endian Byte Swap (BA DC) | Bytes swapped | [0xF147, 0x0020] |
| Little-Endian Byte Swap (DC BA) | Bytes + words swapped | [0x0020, 0xF147] |

### Solution in Node.js

JavaScript processes numbers natively as 64-bit floating point. For correct conversion, incoming buffer arrays must be decomposed into 8-bit octets and reassembled according to the device configuration:

```javascript
// Conceptual example (no copied code)
function parseFloat32(buffer, byteOrder) {
  const view = new DataView(new ArrayBuffer(4));
  switch (byteOrder) {
    case 'BE':    // Big-Endian (AB CD)
      view.setUint8(0, buffer[0]);
      view.setUint8(1, buffer[1]);
      view.setUint8(2, buffer[2]);
      view.setUint8(3, buffer[3]);
      break;
    case 'LE':    // Little-Endian (CD AB)
      view.setUint8(0, buffer[2]);
      view.setUint8(1, buffer[3]);
      view.setUint8(2, buffer[0]);
      view.setUint8(3, buffer[1]);
      break;
    // ... additional variants
  }
  return view.getFloat32(0, false);
}
```

> **Note:** The above code is an independently developed conceptual example illustrating the byte-order problem. It is not based on any external source.

> **Relevant Work Package:** [WP 2.4 – Payload Standardization](WORK_PACKAGES.md#wp-24-payload-standardization-and-buffer-parsing)

---

## 5. Modbus/TCP Security Protocol

### Motivation

Modbus TCP transmits all data in **plaintext** and has **no authentication**. This enables:
- Eavesdropping on traffic (packet sniffers)
- Man-in-the-Middle (MITM) attacks
- Unauthorized write commands (FC 05, 06) to PLC systems

### Modbus/TCP Security (MBTPS)

The Modbus Organization has ratified the "Modbus/TCP Security" specification, which encapsulates the traditional Modbus PDU in a **TLS tunnel**:

| Element | Description |
|---------|-------------|
| **Port 802** | IANA-registered TCP port for secured connections |
| **TLS 1.2/1.3** | Encryption standard, natively available in Node.js `node:tls` |
| **mTLS (Mutual TLS)** | Mutual authentication via X.509v3 certificates |
| **RBAC** | Role-Based Access Control via X.509v3 extensions |

### Certificate Management in Node-RED

**Critical architecture decision:** Certificates and private keys must **never** be stored in `flow.json`, as this file is often unencrypted in Git repositories.

Instead, the architecture uses the **Node-RED Credential API**:
- Credentials are persisted in a separate `*_cred.json` file
- The file is cryptographically protected with the Node-RED `credentialSecret`
- `*_cred.json` is listed in `.gitignore`

### IEC 62443 Compliance

The integration of TLS and mTLS enables compliance with the **IEC 62443** standard series (Industrial Automation and Control Systems Security), which requires:
- Authentication of all network participants
- Encryption of communications
- Role-based access control
- Audit capability

> **Sources:** Modbus/TCP Security Protocol Specification [REF-04], IEC 62443 [REF-10]
> **Relevant Work Package:** [WP 4 – Modbus/TCP Security](WORK_PACKAGES.md#wp-4-modbustcp-security-and-credential-management)

---

## 6. Deterministic State Management via XState

### Problem: Hand-Coded FSM in Legacy Package

The legacy package `node-red-contrib-modbus` implements a proprietary, hand-written Finite State Machine (FSM) with states like INIT, ACTIVATED, QUEUEING, READING, EMPTY, RECONNECTING. This leads to:

- **"FSM Not Ready To Read" errors:** When a trigger reaches the node while the FSM is stuck in READING state
- **Race conditions:** Asynchronous events can push the FSM into undefined states
- **Log floods:** Minimal network latencies result in massive error messages

> **Source:** GitHub issues of the legacy package, documented in the community [REF-05]

### Solution: XState v5

[XState](https://stately.ai/docs/xstate-v5) enables graphical and mathematically correct state modeling. Benefits:

1. **Determinism:** Every transition is explicitly defined. Undefined states are mathematically impossible.
2. **Guards:** Conditions checked before a transition (e.g. `isConnected`, `hasRetriesLeft`).
3. **Actions:** Side effects during state transitions (e.g. open socket, update status).
4. **Visualization:** XState definitions can be graphically displayed (stately.ai/viz).

### State Diagram

```
                    ┌──────────────┐
                    │ DISCONNECTED │ ◄──── max retries reached
                    └──────┬───────┘
                           │ CONNECT
                           ▼
                    ┌──────────────┐
              ┌────►│  CONNECTING  │
              │     └──────┬───────┘
              │            │ SUCCESS
              │            ▼
              │     ┌──────────────┐
              │     │  CONNECTED   │ ◄──── READ/WRITE SUCCESS
              │     └──────┬───────┘
              │            │ READ_REQUEST / WRITE_REQUEST
              │            ▼
              │     ┌──────────────┐
              │     │ READING /    │
              │     │ WRITING      │
              │     └──────┬───────┘
              │            │ FAILURE / TIMEOUT
              │            ▼
              │     ┌──────────────┐
              │     │    ERROR     │
              │     └──────┬───────┘
              │            │ RETRY
              │            ▼
              │     ┌──────────────┐
              └─────┤   BACKOFF    │ (exponential: 1s, 2s, 4s, 8s, ...)
                    └──────────────┘
```

> **Source:** XState v5 Documentation [REF-08]
> **Relevant Work Package:** [WP 1.3 – XState State Machine](WORK_PACKAGES.md#wp-13-xstate-state-machine)

---

## 7. Backpressure Management

### Problem: Queue Overflow in Legacy Package

When the polling rate exceeds the physical processing rate (e.g. 10ms interval at 9600 baud), the internal queue grows uncontrollably. Consequences:
- Massive memory leak
- System becomes extremely sluggish
- Eventually: crash

> **Source:** Community reports in the legacy repository [REF-05]

### Solution: Configurable Queue with Drop Strategy

| Parameter | Description | Default |
|-----------|-------------|---------|
| **Max Queue Size** | Hard limit for queue size | 100 |
| **Drop Strategy: FIFO** | Oldest message is discarded | Sensor monitoring |
| **Drop Strategy: LIFO** | Newest message is discarded | Alarm events |
| **Status Indicator** | `this.status()` shows queue fill level | Yellow at >80% |

**Algorithm:**
```
IF queue.length >= maxQueueSize:
  IF dropStrategy == FIFO:
    queue.shift()     // Remove oldest
  ELSE IF dropStrategy == LIFO:
    // New message is discarded (not enqueued)
    RETURN "dropped"
queue.push(newMessage)
```

The memory footprint remains constant, regardless of the flow's polling rate.

> **Relevant Work Package:** [WP 2.3 – Backpressure Management](WORK_PACKAGES.md#wp-23-backpressure-management)

---

## 8. Dynamic Address Space Mapping

### Problem: Monolithic Memory Arrays

Traditional Modbus server implementations allocate a static array for the entire address space. With non-linear address structures (e.g. data at addresses 6000, 6001, 6005), memory is massively wasted.

### Solution: Event-Based Proxy Pattern

The server config node acts as a pure TCP listener. When requests arrive, an event is published into the Node-RED flow:

```
External Modbus Client
        │
        ▼ FC 03, Register 40108
┌───────────────────┐
│ Server Config Node │  ← TCP listener on port 502
└────────┬──────────┘
         │ Event: { fc: 3, address: 107, quantity: 2 }
         ▼
┌───────────────────┐
│  Modbus-In Node   │  ← Filters by address
└────────┬──────────┘
         │ msg.payload into the flow
         ▼
┌───────────────────┐
│  Flow Processing  │  ← HTTP API, database, sensor, ...
└────────┬──────────┘
         │ Result
         ▼
┌───────────────────┐
│  Modbus-Out Node  │  ← Generates response frame
└────────┬──────────┘
         │ TCP Response
         ▼
External Modbus Client
```

**Benefits:**
- No wasted memory for empty address ranges
- Dynamic data sources (APIs, databases) exposable as Modbus registers
- Full control over response logic in the flow

**Optional: In-Memory Cache** for latency-critical requests (hashmap instead of array).

> **Relevant Work Package:** [WP 3 – Server/Slave Proxy Nodes](WORK_PACKAGES.md#wp-3-modbus-server--slave-proxy-nodes)

---

## 9. Analysis of Existing Implementations

### node-red-contrib-modbus (BiancoRoyal)

**License:** BSD-3-Clause  
**Maintainer:** Klaus Landsdorf / P4NR B2B Community  
**History:** Originally by Mika Karaila (2015), taken over by BiancoRoyal (2016)

**Identified Architectural Weaknesses:**

1. **FSM Bottleneck:** Proprietary, hand-coded finite state machine with states INIT, ACTIVATED, QUEUEING, READING, EMPTY. Error messages like "FSM Not Ready To Read" during asynchronous latencies.

2. **Queue Overflow:** Missing backpressure mechanisms. When polling rate is too high, the queue grows uncontrollably in memory.

3. **Deployment Leaks:** Socket listeners are not correctly deregistered during partial deployments (`removeListener`), leading to event listener multiplication.

> **Note:** This analysis is based on publicly available GitHub issues and community reports. No code snippets are copied or reproduced. The analysis serves exclusively for architectural differentiation of the new development.
> **Source:** GitHub BiancoRoyal/node-red-contrib-modbus [REF-05]

### Differentiation of Our Implementation

| Aspect | Legacy (BiancoRoyal) | Forge (Our Approach) |
|--------|---------------------|---------------------|
| State Management | Hand-coded FSM | XState v5 (formally verifiable) |
| Queue | Unlimited, no backpressure | Configurable, FIFO/LIFO drop |
| Server Memory | Static array | Event-based proxy pattern |
| Security | No TLS | TLS 1.3, mTLS, port 802 |
| Lifecycle | Leak-prone on deploy | Strict deregistration in `node.on('close')` |

---

## 10. Node.js Libraries Comparison

### modbus-serial (ISC License)

- **Repository:** github.com/yaacov/node-modbus-serial
- **Focus:** Client/master with excellent RTU and TCP support
- **API:** Promise-based (async/await compatible)
- **Serialport:** Optional dependency (v13, Node.js 20+)
- **Server:** Simple ServerTCP with vector callbacks
- **Usage in project:** As **npm dependency** for the transport layer

### jsmodbus (MIT License)

- **Repository:** github.com/Cloud-Automation/node-modbus
- **Focus:** Event-based server architecture
- **API:** Event emitter pattern
- **Usage in project:** As **architectural inspiration** for event-based server proxying. No code is copied.

### Comparison Table

| Criterion | modbus-serial | jsmodbus |
|-----------|--------------|---------|
| Primary Focus | Client robustness | Flexible eventing |
| RTU Support | Excellent | Good |
| TCP Support | Very good | Very good |
| Server Architecture | Callback-based | Event-based |
| Promise API | Native | Partial |
| License | ISC | MIT |
| Maintenance | Active | Relatively slow |

### Recommended Hybrid Strategy

- **Client/Master:** `modbus-serial` as dependency (promise API guarantees stability in RTU environments)
- **Server/Slave:** Independent, event-based implementation, inspired by the concept of `jsmodbus`, but without code adoption

> **Sources:** npm package pages [REF-06, REF-07]

---

## 11. Best Practices for Industrial Deployment

### Strict Logic Separation (Separation of Concerns)

Node-RED is an event-driven IT software and must **never** take over hard real-time control logic:
- **Not with Node-RED:** Emergency stop circuits, PID controllers, safety-critical PLC logic
- **Node-RED's role:** Read data, contextualize (JSON), publish to IT systems (MQTT, UNS)

> **Source:** FlowFuse Best Practices [REF-09]

### Efficient Polling

- **Grouping:** Query contiguous registers in a single request (e.g. FC 03, length 50)
- **Interval Adjustment:** HMI: ~1s, cloud dashboard: ~60s
- **Bitwise Stuffing:** Encode 16 coils into a single holding register → reduce network load

### System Resilience

- **RBE (Report By Exception):** Filter node after Modbus-Read → only forward changed values
- **Watchdog:** Status monitoring via `this.status()`, trigger node for connection restart
- **DMZ Placement:** Node-RED between IT and OT (Demilitarized Zone)

> **Source:** FlowFuse – "Working with Modbus in Node-RED" [REF-09]

---

## Glossary

| Term | Definition |
|------|-----------|
| **ADU** | Application Data Unit – complete Modbus data packet including header |
| **PDU** | Protocol Data Unit – payload without transport header |
| **CRC** | Cyclic Redundancy Check – error checksum for RTU |
| **FSM** | Finite State Machine |
| **mTLS** | Mutual TLS – mutual certificate authentication |
| **RBAC** | Role-Based Access Control |
| **SCADA** | Supervisory Control and Data Acquisition |
| **PLC** | Programmable Logic Controller |
| **UNS** | Unified Namespace – central data hub in IIoT architectures |
| **OT** | Operational Technology |
| **IIoT** | Industrial Internet of Things |
| **HMI** | Human Machine Interface |
| **RBE** | Report By Exception – report only on value change |
