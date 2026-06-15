# Device Presence Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Redis TTL projection for device WebSocket presence without changing current online-state truth.

**Architecture:** Keep `DevicePresence` as the database source for this phase. Add `DevicePresenceProjection` as a Redis side projection, then write it from WebSocket lifecycle events using owner IDs.

**Tech Stack:** Node.js, CommonJS, Jest, Redis via ioredis, WebSocket server.

---

### Task 1: DevicePresenceProjection Module

**Files:**
- Create: `src/services/devicePresenceProjection.js`
- Create: `src/tests/devicePresenceProjection.test.js`

- [ ] Add failing tests for register TTL writes, owner-guarded heartbeat, owner-guarded disconnect, get/isOnline, and Redis error unknown state.
- [ ] Implement Redis key/value helpers and owner-guarded Lua scripts.
- [ ] Run `npx jest src/tests/devicePresenceProjection.test.js --runInBand --forceExit`.

### Task 2: WebSocket Projection Writes

**Files:**
- Modify: `src/ws/deviceWsManager.js`
- Modify: `src/tests/deviceWsPresence.test.js`

- [ ] Add failing WebSocket tests proving active connection owner IDs are used for register/heartbeat/disconnect.
- [ ] Generate an owner ID for each authenticated socket.
- [ ] Write projection on connect, hello/ping heartbeat, and active close.
- [ ] Run `npx jest src/tests/deviceWsPresence.test.js --runInBand --forceExit`.

### Task 3: Verification

**Files:**
- Verify backend files only.

- [ ] Run `npm test`.
- [ ] Review `git diff --check`.
- [ ] Commit only Phase 4.2 files.
