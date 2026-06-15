# OTA Check Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract OTA check route logic into a service that returns a backward-compatible boot response plus explicit OTA decision fields.

**Architecture:** Keep existing `wechatService.bootRegister` as the registration adapter. Add `otaCheckService` as the OTA decision seam and keep the route thin.

**Tech Stack:** Node.js, CommonJS, Jest, Express, Supertest.

---

### Task 1: OTA Check Service

**Files:**
- Create: `src/services/otaCheckService.js`
- Create: `src/tests/otaCheckService.test.js`

- [ ] Add failing tests for boot-register delegation, WebSocket URL resolution, `is_bound`, and no-update OTA envelope.
- [ ] Implement `checkBootReport`.
- [ ] Run `npx jest src/tests/otaCheckService.test.js --runInBand --forceExit`.

### Task 2: OTA Check Route Integration

**Files:**
- Modify: `src/routes/esplink.js`
- Create: `src/tests/otaCheckRoute.test.js`

- [ ] Add failing route tests for service delegation and missing MAC.
- [ ] Replace inline route response shaping with `otaCheckService.checkBootReport`.
- [ ] Run `npx jest src/tests/otaCheckRoute.test.js --runInBand --forceExit`.

### Task 3: Verification

**Files:**
- Verify backend files only.

- [ ] Run `npm test`.
- [ ] Review `git diff --check`.
- [ ] Commit only this phase.
