# Device Capability And Admin Read Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make device capabilities safe to parse and visible in admin-oriented read models.

**Architecture:** Keep the current `devices.capabilities` text field. Add a `DeviceCapability` module as the capability seam, a `DeviceAdminReadModel` module as the admin projection seam, then wire read paths and UI to consume those derived fields.

**Tech Stack:** Node.js, CommonJS, Jest, React, Vite, Ant Design.

---

### Task 1: DeviceCapability Module

**Files:**
- Create: `src/services/deviceCapability.js`
- Create: `src/tests/deviceCapability.test.js`

- [ ] Add failing tests for null capabilities, malformed JSON, object preservation, default schema version, and client summary generation.
- [ ] Implement safe parsing, hello normalization, and summary helpers.
- [ ] Run `npx jest src/tests/deviceCapability.test.js --runInBand --forceExit`.

### Task 2: DeviceAdminReadModel Module

**Files:**
- Create: `src/services/deviceAdminReadModel.js`
- Create: `src/tests/deviceAdminReadModel.test.js`

- [ ] Add failing tests for `online`, `stale_or_unknown`, and `offline` status derivation.
- [ ] Add failing tests for `seconds_since_seen` and malformed capabilities.
- [ ] Implement row/list builders.
- [ ] Run `npx jest src/tests/deviceAdminReadModel.test.js --runInBand --forceExit`.

### Task 3: WeChat Device List Safety

**Files:**
- Modify: `src/services/wechatService.js`
- Create: `src/tests/wechatDeviceListCapabilities.test.js`

- [ ] Add failing tests proving malformed capabilities do not throw.
- [ ] Wire `getDeviceList` through `DeviceCapability`.
- [ ] Run `npx jest src/tests/wechatDeviceListCapabilities.test.js --runInBand --forceExit`.

### Task 4: Admin Device UI Compatibility

**Files:**
- Modify: `admin-frontend/src/pages/Devices/index.jsx`

- [ ] Show `board_type`, capability summary, and clearer online status while preserving old-field compatibility.
- [ ] Run `cd admin-frontend && npm run build`.

### Task 5: Route Integration And Verification

**Files:**
- Modify: `src/services/deviceService.js`

- [ ] Map `listDevices` and `getDevice` through `DeviceAdminReadModel`.
- [ ] Run `npm test`.
- [ ] Run `cd admin-frontend && npm run build`.
- [ ] Review `git diff --check`.
- [ ] Commit only Phase 2 files.
