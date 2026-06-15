# Device Command Policy And Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe command eligibility checks and a command delivery seam for device WebSocket commands.

**Architecture:** Keep the existing single-process WebSocket transport. Add `DeviceCommandPolicy` for authorization/capability checks and `DeviceCommandRouter` for structured delivery results, then wire the WeChat command route through both modules.

**Tech Stack:** Node.js, CommonJS, Jest, Express, Prisma Client, WebSocket transport adapter.

---

### Task 1: DeviceCommandPolicy Module

**Files:**
- Create: `src/services/deviceCommandPolicy.js`
- Create: `src/tests/deviceCommandPolicy.test.js`

- [ ] Add failing tests for WeChat ownership rejection, unknown command rejection, unsupported capability command, malformed capability JSON, and allowed command.
- [ ] Implement command normalization and policy decisions.
- [ ] Run `npx jest src/tests/deviceCommandPolicy.test.js --runInBand --forceExit`.

### Task 2: DeviceCommandRouter Module

**Files:**
- Create: `src/services/deviceCommandRouter.js`
- Create: `src/tests/deviceCommandRouter.test.js`

- [ ] Add failing tests for transport success, offline boolean false, transport exception, and injected test transport.
- [ ] Implement `send(mac, payload, { transport })`.
- [ ] Run `npx jest src/tests/deviceCommandRouter.test.js --runInBand --forceExit`.

### Task 3: WeChat Command Route Integration

**Files:**
- Modify: `src/routes/esplink.js`
- Create: `src/tests/wechatCommandRoute.test.js`

- [ ] Add failing route tests for policy rejection, offline route response, and successful delivery.
- [ ] Query the device by MAC before policy evaluation.
- [ ] Replace direct `wsManager.sendCommand` with `DeviceCommandPolicy` and `DeviceCommandRouter`.
- [ ] Run `npx jest src/tests/wechatCommandRoute.test.js --runInBand --forceExit`.

### Task 4: Verification

**Files:**
- Verify backend files only.

- [ ] Run `npm test`.
- [ ] Review `git diff --check`.
- [ ] Commit only Phase 3 files.
