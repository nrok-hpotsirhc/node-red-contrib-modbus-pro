# Legal Analysis

> License compatibility, source attribution, and risk assessment for node-red-contrib-modbus-pro.
> References: [Agents](../agents.md) | [References](REFERENCES.md)

---

## 1. Executive Summary

This project uses the **BSD-3-Clause** license and is developed **from scratch**. No source code is copied from existing Modbus implementations. All dependencies are license-compatible.

| Aspect | Assessment | Risk |
|--------|-----------|------|
| License compatibility | All dependencies compatible | ✅ Low |
| Source attribution | All references verified | ✅ Low |
| Patent risk | No known patent claims | ✅ Low |
| Trademark risk | Own name, no name collision | ✅ Low |

---

## 2. License Compatibility Matrix

### Direct Dependencies

| Package | License | Compatible with BSD-3? | Notes |
|---------|---------|----------------------|-------|
| modbus-serial | ISC | ✅ Yes | Permissive, minimal restriction |
| xstate | MIT | ✅ Yes | Permissive |
| serialport | MIT | ✅ Yes | Optional dependency |

### Dev Dependencies

| Package | License | Relevant? | Notes |
|---------|---------|-----------|-------|
| mocha | MIT | Dev-only | Not shipped |
| chai | MIT | Dev-only | Not shipped |
| sinon | BSD-3-Clause | Dev-only | Not shipped |
| nyc | ISC | Dev-only | Not shipped |
| node-red-node-test-helper | Apache-2.0 | Dev-only | Not shipped |

### License Compatibility Logic

```
BSD-3-Clause (our project)
  ├── ISC (modbus-serial)     → Compatible (ISC ≈ BSD-2)
  ├── MIT (xstate)            → Compatible (permissive)
  └── MIT (serialport)        → Compatible (permissive)

Rule: BSD-3 can include ISC and MIT.
      Our license is not "infected" (no copyleft).
```

---

## 3. Rationale for BSD-3-Clause

### Why BSD-3-Clause?

1. **Compatibility:** Compatible with all dependency licenses (ISC, MIT)
2. **Commercial use:** Allows use in proprietary products
3. **Industry standard:** Common in Node-RED ecosystem
4. **Patent protection:** No patent grant clause needed (no patent claims)
5. **Attribution:** Requires attribution (fair to authors)
6. **No copyleft:** No obligation to disclose proprietary integration code

### License Text

```
BSD 3-Clause License

Copyright (c) 2025, [Author]
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

---

## 4. Risk Assessment

### Identified Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| License incompatibility of future deps | Low | Medium | Check every new dep before adding |
| Incorrect source attribution | Low | Medium | Verify all references point to correct sources |
| Patent claim (Modbus protocol) | Very Low | Medium | Modbus is open since 2004 |
| Name conflict | Very Low | Low | "pro" suffix is unique |
| serialport native build issues | Medium | Low | Mark as optional dependency |

### Recommendations

1. **Do not copy code** from existing implementations
2. **Check license** of every new dependency before adding
3. **Verify source attribution** – ensure all references in the documentation point to the correct sources
4. **Attribution** in README for all used specifications and standards
