# Developer Guide

> Guide for developers working on, testing, or using node-red-contrib-modbus-pro.
> References: [Agents](../agents.md) | [Architecture](ARCHITECTURE.md) | [Test Manual](TEST_MANUAL.md)

---

## 1. Project Setup

### Prerequisites

- **Node.js:** >= 18 LTS (recommended: 20 LTS)
- **npm:** >= 9
- **Git:** >= 2.30
- **Node-RED:** >= 3.0.0 (for local development/testing)

### Installation

```bash
# Clone repository
git clone https://github.com/[OWNER]/node-red-contrib-modbus-pro.git
cd node-red-contrib-modbus-pro

# Install dependencies
npm install

# Optional: serialport for RTU development
npm install serialport

# Run tests to ensure everything works
npm test
```

### Local Development with Node-RED

```bash
# In the project directory: link to global npm
npm link

# In the Node-RED user directory (~/.node-red):
cd ~/.node-red
npm link node-red-contrib-modbus-pro

# Start Node-RED
node-red

# After code changes: restart Node-RED (Ctrl+C, then start again)
```

---

## 2. Project Structure

```
node-red-contrib-modbus-pro/
├── src/                    # Source code
│   ├── nodes/              # Node-RED nodes (pairs: .js + .html)
│   │   ├── config/         # Configuration nodes (singleton)
│   │   ├── client/         # Client nodes (Read, Write)
│   │   └── server/         # Server nodes (In, Out)
│   ├── lib/                # Internal libraries (not Node-RED-specific)
│   │   ├── transport/      # TCP/RTU abstraction
│   │   ├── state-machine/  # XState state machines
│   │   ├── queue/          # Backpressure, connection pool, semaphore
│   │   ├── security/       # TLS, certificates, RBAC
│   │   ├── parser/         # Buffer parsing, endianness
│   │   └── cache/          # In-memory register cache
│   └── index.js            # Node-RED registration entry point
├── test/                   # Tests (see TEST_MANUAL.md)
├── examples/flows/         # Importable example flows (.json)
├── docs/                   # Documentation
├── agents.md               # AI agent guide
├── MILESTONES.md           # Milestone planning
├── CHANGELOG.md            # Change log
├── package.json            # npm configuration
├── .mocharc.yml            # Mocha configuration
└── .gitignore              # Git ignore rules
```

---

## 3. Coding Standards

### General

- **Language:** JavaScript (ES2022+, Node.js >= 18)
- **Modules:** CommonJS (`require`/`module.exports`) – Node-RED standard
- **Strict Mode:** `'use strict';` in every file
- **Semicolons:** Yes
- **Indentation:** 2 spaces
- **Maximum Line Length:** 120 characters

### Async Code

```javascript
// ✅ CORRECT: async/await
async function readRegisters(client, address, length) {
  const result = await client.readHoldingRegisters(address, length);
  return result;
}

// ❌ WRONG: Callback hell
function readRegisters(client, address, length, callback) {
  client.readHoldingRegisters(address, length, function(err, data) {
    if (err) callback(err);
    else callback(null, data);
  });
}

// ❌ WRONG: setTimeout cascades for retry logic
setTimeout(() => { retry(); }, 1000);
// Instead: use XState backoff state
```

### State Management

```javascript
// ✅ CORRECT: XState for state transitions
const { createMachine, createActor } = require('xstate');
const machine = createMachine({ /* ... */ });
const actor = createActor(machine);

// ❌ WRONG: Hand-coded FSM
let state = 'INIT';
if (state === 'INIT') { state = 'CONNECTING'; }
if (state === 'CONNECTING' && success) { state = 'CONNECTED'; }
```

### Node-RED Status API

```javascript
// Always use this.status() for visual feedback
node.status({ fill: 'green', shape: 'dot', text: 'connected' });
node.status({ fill: 'red', shape: 'ring', text: 'disconnected' });
node.status({ fill: 'yellow', shape: 'ring', text: 'queue: 85/100' });
node.status({ fill: 'red', shape: 'dot', text: 'error: timeout' });
```

### Error Handling

```javascript
// ✅ CORRECT: Propagate errors via Node-RED API
try {
  const result = await transport.read(address, length);
  node.send({ payload: result });
} catch (err) {
  node.error(`Read failed: ${err.message}`, msg);
  // Trigger XState transition
  actor.send({ type: 'FAILURE', error: err });
}

// ❌ WRONG: Silently swallow errors
try { await transport.read(); } catch (e) { /* nothing */ }
```

---

## 4. Creating Node-RED Nodes

### File Structure of a Node

Every Node-RED node consists of two files:

1. **`<name>.js`** – Server-side logic (Node.js)
2. **`<name>.html`** – Client-side UI (browser)

### Registration in package.json

```json
{
  "node-red": {
    "nodes": {
      "modbus-client-config": "src/nodes/config/modbus-client-config.js",
      "modbus-read": "src/nodes/client/modbus-read.js",
      "modbus-write": "src/nodes/client/modbus-write.js"
    }
  }
}
```

### Lifecycle Management (CRITICAL)

```javascript
module.exports = function(RED) {
  function MyNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Initialization...

    // MANDATORY: Cleanup on deploy/undeploy
    node.on('close', function(removed, done) {
      // 1. Stop timers
      clearInterval(node.pollInterval);
      // 2. Remove event listeners
      node.transport.removeAllListeners();
      // 3. Close sockets
      node.transport.close().then(() => {
        done(); // Signal Node-RED: cleanup complete
      }).catch((err) => {
        node.warn(`Cleanup error: ${err.message}`);
        done();
      });
    });
  }

  RED.nodes.registerType('my-node', MyNode);
};
```

> **WARNING:** Missing cleanup logic in `node.on('close')` leads to socket leaks during partial deployments. This was a critical bug in the legacy package (Issue #187).

---

## 5. Contributing

### Workflow

1. **Fork** the repository
2. Create a **feature branch**: `git checkout -b feature/my-feature`
3. **Implement** code + write tests
4. **Run tests**: `npm test`
5. **Check lint**: `npm run lint`
6. **Check coverage**: `npm run test:coverage` (>= 80%)
7. **Commit**: Conventional commit messages
8. **Pull request** against `main`

### Commit Message Format

```
<type>(<scope>): <description>

Types:
  feat     - New feature
  fix      - Bug fix
  docs     - Documentation only
  test     - Add/change tests
  refactor - Code refactoring without functional change
  chore    - Build process, dependencies

Examples:
  feat(client): implement FC03 Read Holding Registers
  fix(state-machine): resolve race condition in BACKOFF state
  test(parser): add Float32 endianness edge cases
  docs(readme): update installation instructions
```

### Pull Request Checklist

- [ ] Tests written and passing
- [ ] Coverage has not decreased
- [ ] Lint errors resolved
- [ ] New mocks documented in `test/mocks/README.md`
- [ ] New fixtures documented in `test/fixtures/README.md`
- [ ] CHANGELOG.md updated
- [ ] No code copied from external repositories
- [ ] No credentials in code

---

## 6. Debugging

### Node-RED Debug Mode

```bash
# All Modbus debug output
DEBUG=modbusPro* node-red -v

# Transport layer only
DEBUG=modbusPro:transport* node-red -v

# State machine only
DEBUG=modbusPro:state* node-red -v

# Also modbus-serial debug
DEBUG=modbusPro*,modbus-serial node-red -v
```

### Common Issues

| Problem | Cause | Solution |
|---------|-------|---------|
| "Cannot find module 'serialport'" | serialport not installed | `npm install serialport` or use TCP only |
| "FSM Error" | Invalid state transition | Use XState visualizer (stately.ai/viz) |
| "Queue Full" | Polling rate too high | Increase interval or adjust max queue size |
| "TLS Handshake Failed" | Certificate issue | Check certificates, CA correct? |
| "ECONNREFUSED" | Target PLC unreachable | Check IP/port, firewall? |

---

## 7. Release Process

```bash
# Bump version
npm version patch|minor|major

# Update CHANGELOG.md

# Create tag
git tag v1.0.0

# Publish
npm publish

# Node-RED Flow Library
# → Automatic after npm publish (if package.json is correct)
```
