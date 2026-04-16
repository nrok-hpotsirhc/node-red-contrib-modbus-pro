# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
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
