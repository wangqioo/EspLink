# OTA Check Service Design

## Goal

Move `/api/ota/check` boot-report handling behind an `otaCheckService` seam and introduce an explicit no-update OTA decision envelope.

## Scope

This phase keeps the external route backward compatible and does not add firmware release storage, artifact URLs, checksum validation, rollout targeting, or version comparison. It only separates registration/auth response shaping from the Express route.

## Module

`src/services/otaCheckService.js` exposes:

- `checkBootReport({ mac, board_type, firmware_version })`
- `getWebSocketBaseUrl()`

`checkBootReport` delegates device registration to `wechatService.bootRegister`, resolves the WebSocket URL, and returns:

- `token`
- `websocket_url`
- `is_bound`
- `update_available: false`
- `ota: null`
- `retry_policy`

## Route Flow

`POST /api/ota/check` validates `mac`, delegates to `otaCheckService.checkBootReport`, and returns the service result unchanged.

## Testing

Unit tests cover service response shaping and fallback WebSocket base URL. Route tests cover delegation and missing-MAC validation.
