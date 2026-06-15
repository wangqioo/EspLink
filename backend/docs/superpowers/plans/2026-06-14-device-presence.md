# Device Presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize device online-state writes behind a `DevicePresence` module.

**Architecture:** Keep the current MySQL `devices.last_seen` and `devices.is_online` fields as the source of truth for this phase. Add one service module as the seam for connect, heartbeat, disconnect, and stale-expiry behavior, then route WebSocket and cron callers through it.

**Tech Stack:** Node.js, CommonJS, Jest, Prisma Client, MySQL raw SQL through Prisma.

---

### Task 1: DevicePresence Module

**Files:**
- Create: `src/services/devicePresence.js`
- Create: `src/tests/devicePresence.test.js`

- [ ] Write failing tests for `markConnected`, `markHeartbeat`, `markDisconnected`, and `expireStale`.
- [ ] Run `npx jest src/tests/devicePresence.test.js --runInBand --forceExit` and confirm the module is missing.
- [ ] Implement `src/services/devicePresence.js` by wrapping `touchDevice` and Prisma raw SQL.
- [ ] Run the same Jest command and confirm the tests pass.

### Task 2: WebSocket Integration

**Files:**
- Modify: `src/ws/deviceWsManager.js`
- Modify: `src/tests/deviceWsRateLimit.test.js`

- [ ] Replace direct `touchDevice` calls with `devicePresence.markConnected` and `devicePresence.markHeartbeat`.
- [ ] Replace direct close-path `prisma.device.update(...is_online=false)` with `devicePresence.markDisconnected`.
- [ ] Update WS tests to mock `devicePresence`.
- [ ] Run `npx jest src/tests/deviceWsRateLimit.test.js --runInBand --forceExit`.

### Task 3: Heartbeat Checker Integration

**Files:**
- Modify: `src/jobs/heartbeatChecker.js`
- Create: `src/tests/heartbeatChecker.test.js`

- [ ] Write a failing cron test proving the scheduled job calls `devicePresence.expireStale({ staleMinutes: 2 })`.
- [ ] Run `npx jest src/tests/heartbeatChecker.test.js --runInBand --forceExit` and confirm failure.
- [ ] Update `heartbeatChecker` to delegate to `devicePresence.expireStale`.
- [ ] Run the heartbeat checker test and confirm it passes.

### Task 4: Verification

**Files:**
- Verify changed backend files only.

- [ ] Run `npm test`.
- [ ] Review `git diff --check`.
- [ ] Commit only the files changed for this phase.
