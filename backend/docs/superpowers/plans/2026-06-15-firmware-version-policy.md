# Firmware Version Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a reusable firmware version policy and route OTA/WS firmware writes through it.

**Architecture:** Keep release storage out of scope. Add a pure policy module and use it at the two existing firmware write boundaries.

**Tech Stack:** Node.js, CommonJS, Jest.

---

### Task 1: Policy Module

**Files:**
- Create: `src/services/firmwareVersionPolicy.js`
- Create: `src/tests/firmwareVersionPolicy.test.js`

- [x] Add failing tests for normalization, malformed values, comparison, and update path classification.
- [x] Implement the pure policy functions.
- [x] Run `npx jest src/tests/firmwareVersionPolicy.test.js --runInBand --forceExit`.

### Task 2: OTA Check Integration

**Files:**
- Modify: `src/services/otaCheckService.js`
- Modify: `src/tests/otaCheckService.test.js`

- [x] Add failing tests for normalized and malformed boot-report versions.
- [x] Normalize `firmware_version` before `bootRegister`.
- [x] Keep the OTA no-update response envelope unchanged.

### Task 3: WebSocket Hello Integration

**Files:**
- Modify: `src/ws/deviceWsManager.js`
- Modify: `src/tests/deviceWsPresence.test.js`

- [x] Add failing tests for normalized and malformed `hello.firmware_version`.
- [x] Normalize firmware before writing `devices.firmware`.
- [x] Do not update firmware when the reported value is malformed.

### Task 4: Verification

- [x] Run targeted Jest tests for policy, OTA service, and WS presence.
- [x] Run `git diff --check`.
- [x] Run `npm test`.
- [x] Commit only this phase; do not include lockfile changes.
