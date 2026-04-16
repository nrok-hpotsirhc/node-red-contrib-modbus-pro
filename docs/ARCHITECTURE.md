# Architecture Documentation

> Target architecture for node-red-contrib-modbus-forge.
> References: [Theoretical Foundations](THEORETICAL_FOUNDATIONS.md) | [Work Packages](WORK_PACKAGES.md) | [Agents](../agents.md)

---

## Architecture Overview

The project is based on three fundamental design principles that eliminate the anti-patterns of existing implementations:

1. **Centralized Connection Pooling** – Singleton config nodes manage connections
2. **Deterministic State Management** – XState v5 for all state transitions
3. **Dynamic Server Proxying** – Event-based slave architecture

## Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Node-RED Runtime                         │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    src/nodes/                             │   │
│  │                                                          │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌────────────────┐   │   │
│  │  │ modbus-read │  │ modbus-write│  │ modbus-in/out  │   │   │
│  │  │ (Client)    │  │ (Client)    │  │ (Server Proxy) │   │   │
│  │  └──────┬──────┘  └──────┬──────┘  └───────┬────────┘   │   │
│  │         │                │                  │            │   │
│  │  ┌──────┴────────────────┴──────────────────┴────────┐   │   │
│  │  │            Config Nodes (Singleton)                │   │   │
│  │  │  ┌──────────────────┐  ┌────────────────────┐     │   │   │
│  │  │  │ Client Config    │  │ Server Config      │     │   │   │
│  │  │  │ (TCP/RTU/TLS)    │  │ (TCP Listener)     │     │   │   │
│  │  │  └────────┬─────────┘  └─────────┬──────────┘     │   │   │
│  │  └───────────┼──────────────────────┼────────────────┘   │   │
│  └──────────────┼──────────────────────┼────────────────────┘   │
│                 │                      │                         │
│  ┌──────────────┼──────────────────────┼────────────────────┐   │
│  │              │     src/lib/         │                     │   │
│  │              ▼                      ▼                     │   │
│  │  ┌────────────────┐    ┌────────────────────┐            │   │
│  │  │ State Machine  │    │  Register Cache    │            │   │
│  │  │ (XState v5)    │    │  (Hashmap)         │            │   │
│  │  └───────┬────────┘    └────────────────────┘            │   │
│  │          │                                               │   │
│  │  ┌───────┴────────┐    ┌────────────────────┐            │   │
│  │  │ Queue/Pool     │    │  Security          │            │   │
│  │  │ - TCP Pool     │    │  - TLS Wrapper     │            │   │
│  │  │ - RTU Semaphore│    │  - Cert Validator  │            │   │
│  │  │ - Backpressure │    │  - RBAC            │            │   │
│  │  └───────┬────────┘    └─────────┬──────────┘            │   │
│  │          │                       │                       │   │
│  │  ┌───────┴───────────────────────┴──────────┐            │   │
│  │  │          Transport Layer                  │            │   │
│  │  │  ┌──────────┐  ┌──────────┐  ┌────────┐  │            │   │
│  │  │  │ TCP      │  │ RTU      │  │ TLS    │  │            │   │
│  │  │  │ Transport│  │ Transport│  │ Socket │  │            │   │
│  │  │  └────┬─────┘  └────┬─────┘  └───┬────┘  │            │   │
│  │  └───────┼──────────────┼────────────┼───────┘            │   │
│  └──────────┼──────────────┼────────────┼────────────────────┘   │
└─────────────┼──────────────┼────────────┼────────────────────────┘
              │              │            │
              ▼              ▼            ▼
       ┌──────────┐  ┌──────────┐  ┌──────────┐
       │ modbus-  │  │ serial-  │  │ node:tls │
       │ serial   │  │ port     │  │ (Node.js)│
       │ (ISC)    │  │ (MIT)    │  │          │
       └──────────┘  └──────────┘  └──────────┘
              │              │            │
              ▼              ▼            ▼
       ┌──────────────────────────────────────┐
       │     Physical Modbus Devices          │
       │  (PLCs, Sensors, Actuators, Gateways)│
       └──────────────────────────────────────┘
```

## Data Flow: Client Read Operation

```
1. Inject/Trigger → modbus-read node
2. modbus-read → Config Node: "READ_REQUEST" event
3. Config Node → XState: Transition CONNECTED → READING
4. XState Guard: isConnected? Queue not full?
5. Queue: Enqueue request (check backpressure)
6. Transport: modbus-serial.readHoldingRegisters(addr, len)
7. Response: Buffer received
8. Parser: Endianness conversion (big-endian → configured)
9. Payload Builder: Enrich msg.payload with metadata
10. XState: Transition READING → CONNECTED (SUCCESS)
11. modbus-read → Output: msg with data
```

## Data Flow: Server Proxy Operation

```
1. External Client → TCP:502 → Server Config Node
2. Server Config → Event: { fc, address, quantity, requestId }
3. Modbus-In Node: Filter event and inject as msg into flow
4. Flow: Fetch data (DB, API, context, ...)
5. Modbus-Out Node: msg.payload = { requestId, data: [...] }
6. Server Config → TCP response to external client
```

## Security Architecture

```
┌─────────────────────────────────────────┐
│           Node-RED Credential Store      │
│  ┌───────────────────────────────────┐  │
│  │ flows_cred.json (encrypted)      │  │
│  │  - CA certificate path           │  │
│  │  - Client certificate path       │  │
│  │  - Private key path              │  │
│  │  - Key passphrase                │  │
│  └───────────────────────────────────┘  │
│           NEVER in flow.json             │
│           NEVER in Git                   │
└──────────────────┬──────────────────────┘
                   │
                   ▼
         ┌─────────────────┐
         │  TLS Wrapper     │
         │  - node:tls      │
         │  - Port 802      │
         │  - TLS 1.2/1.3   │
         │  - mTLS           │
         └────────┬──────────┘
                  │
                  ▼
         ┌─────────────────┐
         │ Cert Validator   │
         │ - X.509v3 Check  │
         │ - RBAC Extract   │
         │ - Expiry Check   │
         └─────────────────┘
```

## Lifecycle Management

### Node-RED Deploy Cycle

```javascript
// Conceptual pattern (original development)
module.exports = function(RED) {
  function ModbusClientConfig(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Start XState actor
    node.actor = createActor(connectionMachine, { ... });
    node.actor.start();

    // Cleanup on deploy/undeploy
    node.on('close', function(done) {
      // 1. Stop XState actor
      node.actor.stop();
      // 2. Deregister all socket listeners
      node.transport.removeAllListeners();
      // 3. Close connection pool
      node.pool.drain().then(() => {
        done();
      });
    });
  }
};
```

> **Note:** The above code pattern is independently developed and based on the official Node-RED documentation for node creation [REF-11]. No code lines are taken from existing packages.

## Requirements Matrix

### Functional Requirements

| ID | Component | Description | WP | MS |
|----|-----------|-------------|----|----|
| FR-01 | Config Node | TCP and RTU parameter management | WP 1.2 | MS-1 |
| FR-02 | Config Node | Connection pool (TCP) and semaphore (RTU) | WP 1.4 | MS-2 |
| FR-03 | Config Node | TLS 1.3, X.509v3, mTLS | WP 4.1 | MS-7 |
| FR-04 | Client | FC 01, 02, 03, 04, 05, 06, 15, 16 | WP 2.1/2.2 | MS-3/4 |
| FR-05 | Client | Backpressure: max queue size, drop strategy | WP 2.3 | MS-4 |
| FR-06 | Client | Buffer parsing: endianness configuration | WP 2.4 | MS-3 |
| FR-07 | Server | Dynamic address proxying via In/Out nodes | WP 3.1-3.3 | MS-5 |
| FR-08 | Server | Optional in-memory cache | WP 3.4 | MS-6 |
| FR-09 | UI/UX | FSM status via this.status() | WP 1.3 | MS-2 |

### Non-Functional Requirements

| ID | Category | Description |
|----|----------|-------------|
| NFR-01 | Performance | All I/O asynchronous (async/await), no setTimeout cascades |
| NFR-02 | Security | Credentials only in Node-RED Credential Store |
| NFR-03 | Reliability | XState eliminates race conditions |
| NFR-04 | Compatibility | Node-RED v3/v4, Node.js 18/20/22 LTS |
| NFR-05 | Licensing | BSD-3-Clause |
