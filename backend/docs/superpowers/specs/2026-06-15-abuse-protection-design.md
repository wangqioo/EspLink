# Abuse Protection Design

## Goal

Reduce public-surface abuse after device PSK registration by rate-limiting boot registration and tightening AI chat allowance for unbound devices.

## Scope

This phase reuses the existing Redis-backed `RateLimiter` seam. It does not add a new dependency or change the tenant quota/accounting model.

In scope:

- Add a dedicated OTA boot registration rate-limit decision before `otaCheckService.checkBootReport`.
- Use `IP + normalized MAC` as the boot registration subject so one noisy MAC cannot hide behind a shared IP, and one noisy IP cannot spray unlimited MACs without separate counters.
- Add environment variables for boot registration and unbound-device AI limits.
- Keep existing bound-device AI chat behavior at `20 requests / 60 seconds` by default.
- Apply a stricter default for unbound devices: `3 requests / 300 seconds`.
- Return clear `429` errors for denied boot registration and `ai_error` for denied WebSocket AI chat.

Out of scope:

- Token rotation after WebSocket disconnect.
- Full billing or per-tenant quota changes.
- Admin UI for rate-limit settings.
- CAPTCHA, WAF, or IP reputation.
- Changing the PSK signature contract.

## Configuration

Defaults are intentionally conservative for public endpoints but compatible with existing tests and local development:

```env
OTA_CHECK_RATE_LIMIT=10
OTA_CHECK_RATE_WINDOW_SECONDS=60
DEVICE_AI_RATE_LIMIT=20
DEVICE_AI_RATE_WINDOW_SECONDS=60
UNBOUND_DEVICE_AI_RATE_LIMIT=3
UNBOUND_DEVICE_AI_RATE_WINDOW_SECONDS=300
```

Invalid or missing numeric env values fall back to these defaults.

## Modules

### Device Abuse Protection

Create `src/services/deviceAbuseProtection.js` as the dedicated module for device-facing abuse decisions.

Interface:

- `checkOtaRegistrationRate({ ip, mac })`
- `checkAiChatRate({ mac, isBound })`
- `getAbuseProtectionConfig()`

The module hides key construction, config parsing, and shared `RateLimiter.consume` calls from routes and WebSocket code.

### OTA Route

`POST /api/ota/check` keeps the existing order:

1. Validate `mac`.
2. Verify PSK identity if configured.
3. Check boot registration rate.
4. Register or refresh device through `otaCheckService`.

The rate-limit subject is:

```text
${ip}:${normalizedMac}
```

The Redis key prefix is `ratelimit:ota-check`.

If denied, return:

```json
{ "code": 42900, "message": "请求过于频繁，请稍后再试" }
```

## WebSocket AI Chat

The WebSocket manager already has an AI chat limit seam. This phase deepens it by passing binding state into the abuse-protection module:

- Bound devices use `DEVICE_AI_RATE_LIMIT` and `DEVICE_AI_RATE_WINDOW_SECONDS`.
- Unbound devices use `UNBOUND_DEVICE_AI_RATE_LIMIT` and `UNBOUND_DEVICE_AI_RATE_WINDOW_SECONDS`.

The subject remains the normalized MAC.

Denied AI chat continues to send:

```json
{ "type": "ai_error", "session_id": "...", "error": "请求过于频繁，请稍后再试" }
```

## Error Handling

The shared `RateLimiter` keeps its existing fail-open default. Redis outages should not block boot registration or AI chat during this phase.

## Testing

Tests cover:

- Config defaults and env overrides.
- OTA boot registration allows when the limiter allows and calls `otaCheckService`.
- OTA boot registration returns `429` before device registration when denied.
- Missing `mac` still returns `400` before rate limiting.
- Bound device AI chat uses the bound-device limit.
- Unbound device AI chat uses the stricter unbound-device limit.
- Existing WebSocket denial behavior remains an `ai_error`.

## Deployment

Operators may tune the new env vars without schema changes. Defaults are safe to deploy immediately:

- Boot registration: `10 / 60s` per `IP + MAC`.
- Bound-device AI: `20 / 60s` per MAC.
- Unbound-device AI: `3 / 300s` per MAC.
