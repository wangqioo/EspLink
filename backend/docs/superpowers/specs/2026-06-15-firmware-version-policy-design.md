# Firmware Version Policy Design

## Goal

Introduce a small firmware version policy seam that OTA decisions can reuse without adding firmware release storage yet.

## Scope

This phase only normalizes and compares stable semantic firmware versions. It does not add firmware release records, artifact URLs, checksums, rollout targeting, forced upgrades, or upload flows.

## Version Rules

`src/services/firmwareVersionPolicy.js` owns firmware version interpretation:

- Accept stable three-part semantic versions: `major.minor.patch`.
- Accept an optional leading `v` or `V`.
- Trim whitespace and remove numeric leading zeroes.
- Return `null` for blank, missing, prerelease, build-suffix, or malformed values.
- Compare only normalized stable versions.
- Classify update paths as `upgrade`, `same`, `downgrade`, or `unknown`.

Examples:

- `v02.004.001` becomes `2.4.1`.
- `latest`, `1.2`, and `1.2.3-beta` are unknown.

## Write Semantics

`devices.firmware` is now treated as the normalized stable firmware version when one is available. Malformed reported versions do not overwrite the stored value.

Both boot registration through `/api/ota/check` and WebSocket `hello` use the same policy so one device does not alternate between raw and normalized values.

## OTA Integration

`otaCheckService.checkBootReport` normalizes `firmware_version` before calling `wechatService.bootRegister`.

The OTA response remains a backward-compatible no-update envelope:

- `update_available: false`
- `ota: null`
- existing websocket auth fields unchanged

## Testing

Tests cover pure version normalization/comparison, OTA boot registration input normalization, malformed OTA version handling, and WebSocket `hello` firmware normalization.
