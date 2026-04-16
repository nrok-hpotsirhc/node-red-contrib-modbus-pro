# Test Fixtures Catalog
> MANDATORY DOCUMENT: Every fixture file in this directory MUST be cataloged here.
> See also: [Test Manual](../../docs/TEST_MANUAL.md) | [agents.md](../../agents.md) §5
---
## Directory Structure
```
test/fixtures/
├── README.md              ← This document (catalog)
├── register-maps/         # Example register maps of various devices
└── certs/                 # Self-signed test certificates
```
## Catalog
### register-maps/
| File | Description | Used In | Last Updated | Removable? |
|------|-------------|---------|-------------|------------|
| _empty_ | Will be populated in MS-3 (WP 2.1/2.4) | — | — | — |
### certs/
| File | Description | Used In | Last Updated | Removable? |
|------|-------------|---------|-------------|------------|
| _empty_ | Will be populated in MS-7 (WP 4.1–4.3) | — | — | — |
---
## Guidelines
1. **Every new fixture file** must be registered in the table above
2. **No production data** – only synthetic, generated test data
3. **No real certificates** – only self-signed for tests
4. **Description** must clearly state what the fixture simulates
5. **Used In** must list the test files that use this fixture
