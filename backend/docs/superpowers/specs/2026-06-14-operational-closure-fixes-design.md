# Operational Closure Fixes Design

## Context

The backend serves two trusted surfaces:

- Admin API under `/api/v1/*`, used by the React management console.
- EspLink API and `/ws/device`, used by the WeChat mini-program and ESP32 firmware.

The current implementation has clear operational gaps:

- Admin authentication accepts any JWT signed by `JWT_SECRET`, including WeChat user tokens.
- API Key usage limits, Redis rate limiting, and alert webhooks exist as code or data fields but are not wired into the main AI chat flow.
- Device unbind leaves `wechat_user_id` in place, so the mini-program ownership relation survives the admin unbind action.
- Usage aggregation does not explicitly exclude nullable `api_key_id` records.
- Frontend usage and dashboard pages read `online_count`, while the backend returns `online_devices`.

## Goals

1. Enforce a hard token boundary between admin users and WeChat users.
2. Make usage accounting real for WebSocket AI chat when a device has an assigned API Key.
3. Keep device unbind semantics consistent across admin UI and WeChat ownership.
4. Make stats endpoints and frontend field names agree.
5. Make usage aggregation safe around nullable `usage_logs.api_key_id`.
6. Add tests that fail on the current behavior and pass after the fix.

## Non-Goals

- No redesign of tenant/package modelling.
- No change to LLM provider registry structure.
- No new persistent tables.
- No change to firmware or mini-program API paths.

## Design

### Admin Token Boundary

Admin login will sign tokens with `type: "admin"` and `role: "admin"`.

`adminAuth` will:

- Verify the JWT with the configured admin secret.
- Reject tokens whose payload is not `type: "admin"` or `role: "admin"`.
- Keep the current 401 response shape.

This prevents WeChat tokens (`type: "wechat"`) from authorizing management routes.

### Usage Accounting

WebSocket `ai_chat` already resolves `{ model, apiKeyId }` from the device. When `apiKeyId` exists, the LLM flow will account for usage after each attempt:

- Create a `usage_logs` row.
- Increment `api_keys.used_today` and `api_keys.used_month`.
- Invalidate the Redis API key cache.
- Load the owning tenant and check the alert threshold.

Token count is the accounting unit because existing limits and counters are integer usage counters and `incrementUsage(id, inputTokens, outputTokens)` already increments by token total.

When `apiKeyId` is absent, the request may still use the default model, but it will remain outside API Key quota accounting. That keeps current behavior while making assigned-Key devices enforceable.

### Redis Rate Limiting

`ai_chat` requests will be rate-limited before calling the LLM provider.

The limiter key will be device scoped:

```text
ratelimit:device-ai:<mac_address>
```

The default policy will be conservative and local to the WebSocket path. Management API route behavior will not change in this pass.

### Device Unbind

Admin unbind will clear:

- `api_key_id`
- `tenant_id`
- `wechat_user_id`
- `is_paired`
- `paired_at`

After this, the device can be discovered and bound by a different WeChat user.

### Stats Field Compatibility

`getSummary()` will return both:

- `online_devices`
- `online_count`

Both values will be identical. This fixes the current frontend without breaking older consumers that may read `online_devices`.

### Nullable Usage Aggregation

`usageAggregator` will only aggregate logs where `api_key_id` is not null. It will also filter nulls before looking up API Keys.

### Frontend Safety

The Usage page will render nullable `api_key_id` as `-` instead of calling `.slice()` on null.

## Test Plan

Add or update Jest tests for:

- `adminAuth` accepts admin tokens and rejects WeChat tokens.
- `getSummary()` exposes `online_count` and `online_devices`.
- `unbindDevice()` clears `wechat_user_id`.
- `aggregateHour()` excludes null `api_key_id` logs from key lookup and hourly upsert.
- `streamChat()` records usage and calls API Key increment/alert flow when `apiKeyId` exists.

Run:

```bash
npm test
cd admin-frontend && npm run build
```
