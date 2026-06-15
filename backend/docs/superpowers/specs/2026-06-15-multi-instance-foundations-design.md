# Multi-Instance Foundations Design

## Goal

Reduce duplicated distributed-runtime assumptions before moving the WebSocket/device presence layer to multi-instance operation.

## Scope

This phase implements two low-risk seams:

- Shared `RateLimiter` for HTTP and device AI chat limits.
- `JobCoordinator` Redis lease for `usageAggregator`.

Redis-backed device presence and cross-instance command routing are intentionally left for the next phase because they change WebSocket ownership semantics.

## Modules

### RateLimiter

`src/services/rateLimiter.js` owns Redis Lua rate-limit logic.

- `consume(subject, { limit, windowSeconds, keyPrefix, failOpen })`
- Returns `true` when a request may proceed.
- Returns `false` when Redis denies the request.
- Preserves fail-open behavior when configured.

### JobCoordinator

`src/services/jobCoordinator.js` owns distributed cron lease behavior.

- `runWithLease(jobName, ttlMs, fn, { redisClient })`
- Runs `fn` only when Redis `SET NX PX` acquires the lease.
- Skips execution when another instance owns the lease.
- Fails open on Redis errors for this phase so operational jobs do not silently stop.

## Data Flow

HTTP rate-limit middleware and WebSocket `checkAiRateLimit` both call `RateLimiter.consume`. `usageAggregator` cron wraps hourly aggregation in `JobCoordinator.runWithLease`.

## Testing

Unit tests cover Redis allow/deny/error paths for `RateLimiter`, lease acquire/skip/error paths for `JobCoordinator`, and updated caller tests for WebSocket AI limits and usage aggregation cron behavior.
