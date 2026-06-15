# Multi-Instance Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add distributed-runtime seams for shared rate limiting and singleton cron execution.

**Architecture:** Keep existing Redis and cron libraries. Extract rate-limit Lua into a shared module, then add a Redis lease coordinator around usage aggregation. Leave WebSocket Redis presence for the next plan.

**Tech Stack:** Node.js, CommonJS, Jest, Redis via ioredis, node-cron, Prisma.

---

### Task 1: Shared RateLimiter

**Files:**
- Create: `src/services/rateLimiter.js`
- Create: `src/tests/rateLimiter.test.js`
- Modify: `src/middleware/rateLimiter.js`
- Modify: `src/ws/deviceWsManager.js`
- Modify: `src/tests/deviceWsRateLimit.test.js`

- [ ] Add failing tests for Redis allow, deny, and fail-open behavior.
- [ ] Implement `consume(subject, options)`.
- [ ] Route HTTP middleware and device AI checks through the shared module.
- [ ] Run `npx jest src/tests/rateLimiter.test.js src/tests/deviceWsRateLimit.test.js --runInBand --forceExit`.

### Task 2: JobCoordinator Lease

**Files:**
- Create: `src/services/jobCoordinator.js`
- Create: `src/tests/jobCoordinator.test.js`
- Modify: `src/jobs/usageAggregator.js`
- Modify: `src/tests/usageAggregator.test.js`

- [ ] Add failing tests for lease acquired, lease skipped, and Redis error fail-open.
- [ ] Implement `runWithLease(jobName, ttlMs, fn, options)`.
- [ ] Wrap `usageAggregator` cron execution in a lease.
- [ ] Run `npx jest src/tests/jobCoordinator.test.js src/tests/usageAggregator.test.js --runInBand --forceExit`.

### Task 3: Verification

**Files:**
- Verify backend files only.

- [ ] Run `npm test`.
- [ ] Review `git diff --check`.
- [ ] Commit only Phase 4 files.
