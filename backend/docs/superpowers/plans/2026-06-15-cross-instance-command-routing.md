# Cross-Instance Command Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route commands to the backend instance that owns the target device WebSocket.

**Architecture:** Keep local WebSocket delivery as the first path. Use Redis presence projection to find a remote owner instance, then publish commands to `device:commands:{instanceId}`. The owning instance subscribes and forwards to its local socket.

**Tech Stack:** Node.js, CommonJS, Jest, Redis pub/sub, WebSocket manager.

---

### Task 1: DeviceCommandBroker

**Files:**
- Create: `src/services/deviceCommandBroker.js`
- Create: `src/tests/deviceCommandBroker.test.js`

- [ ] Add failing tests for publish channel/payload and subscribe JSON dispatch.
- [ ] Implement publish/subscribe using Redis pub/sub-compatible client methods.
- [ ] Run `npx jest src/tests/deviceCommandBroker.test.js --runInBand --forceExit`.

### Task 2: DeviceCommandRouter Remote Publish

**Files:**
- Modify: `src/services/deviceCommandRouter.js`
- Modify: `src/tests/deviceCommandRouter.test.js`

- [ ] Add failing tests for local delivery, remote presence publish, offline presence, unknown Redis presence, and broker failure.
- [ ] Inject `presence` and `broker` dependencies for tests.
- [ ] Return `published` for successful remote publish.
- [ ] Run `npx jest src/tests/deviceCommandRouter.test.js --runInBand --forceExit`.

### Task 3: WebSocket Command Subscription

**Files:**
- Modify: `src/ws/deviceWsManager.js`
- Modify: `src/tests/deviceWsPresence.test.js`

- [ ] Add failing test proving `setup()` subscribes for the instance ID and forwards messages through local command delivery.
- [ ] Subscribe to `device:commands:{INSTANCE_ID}` during setup.
- [ ] Route received command messages to local `sendCommand`.
- [ ] Run `npx jest src/tests/deviceWsPresence.test.js --runInBand --forceExit`.

### Task 4: Verification

**Files:**
- Verify backend files only.

- [ ] Run `npm test`.
- [ ] Review `git diff --check`.
- [ ] Commit only this phase.
