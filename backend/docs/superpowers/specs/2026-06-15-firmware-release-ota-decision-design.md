# Firmware Release OTA Decision Design

## Goal

Build the first backend OTA product loop: an admin-created firmware release can be selected by `/api/ota/check`, and devices can receive a deterministic update envelope when a newer compatible release exists.

## Scope

This phase adds backend release records and OTA decision logic only.

In scope:

- Store firmware release metadata in MySQL.
- Select the latest active release for a device `board_type`.
- Compare the device's normalized firmware version with the release version.
- Return a backward-compatible no-update envelope when no valid update exists.
- Return an OTA envelope when a newer compatible release exists.
- Add minimal admin API endpoints for release create/list/toggle so records can be managed without direct SQL.

Out of scope:

- Firmware binary upload/storage.
- Artifact signing.
- Percentage rollout or cohort targeting.
- Frontend admin page.
- Forced downgrade.
- Device-side download confirmation or install result reporting.

## Data Model

Add `FirmwareRelease` to Prisma:

- `id`: autoincrement integer primary key.
- `board_type`: release target board, e.g. `esp32-s3-box`.
- `version`: normalized stable SemVer string.
- `artifact_url`: externally hosted firmware URL.
- `sha256`: hex checksum supplied by admin.
- `size_bytes`: optional integer.
- `channel`: string, default `stable`.
- `is_active`: boolean, default `true`.
- `force_update`: boolean, default `false`.
- `release_notes`: optional text.
- `created_at`, `updated_at`.

Indexes:

- `board_type, channel, is_active`
- `board_type, version`
- Unique: `board_type, channel, version`

Release versions use the existing `firmwareVersionPolicy`. Malformed release versions are rejected at service/API boundaries.

## OTA Selection

`firmwareReleaseService` owns release persistence and selection:

- `createRelease(input)`
- `listReleases({ boardType, channel, page, pageSize })`
- `setReleaseActive(id, isActive)`
- `findLatestActiveRelease({ boardType, channel })`

The first implementation uses application-level SemVer comparison after fetching active releases for the board/channel. This avoids relying on lexicographic SQL ordering for versions.

Selection rules:

1. Normalize the device `firmware_version`.
2. Register/update the device through `bootRegister` as today.
3. If `board_type` is missing, return no update.
4. If current firmware is unknown/malformed, return no update.
5. Find the latest active stable release for the device board and channel.
6. If no release exists, return no update.
7. If release version is greater than current version, return update available.
8. If release version is same or older, return no update.

The default channel is `stable`. Channel selection is not exposed to devices yet; it stays a service-level default so later device cohorts can opt into channels without changing the response contract.

## OTA Response

No-update responses stay compatible:

```json
{
  "token": "device-token",
  "websocket_url": "ws://host/ws/device",
  "is_bound": false,
  "update_available": false,
  "ota": null,
  "retry_policy": { "retry_after_seconds": 30 }
}
```

Update responses add release metadata under `ota`:

```json
{
  "token": "device-token",
  "websocket_url": "ws://host/ws/device",
  "is_bound": false,
  "update_available": true,
  "ota": {
    "version": "2.5.0",
    "url": "https://firmware.example.test/esp32-s3-box-2.5.0.bin",
    "sha256": "hex-checksum",
    "size_bytes": 1048576,
    "force": false,
    "release_notes": "optional text"
  },
  "retry_policy": { "retry_after_seconds": 30 }
}
```

## Admin API

Add routes under `/api/v1/firmware/releases`, protected by `adminAuth`:

- `GET /firmware/releases`: list releases with optional `boardType` and `channel`.
- `POST /firmware/releases`: create a release.
- `PATCH /firmware/releases/:id/active`: toggle `is_active`.

The API uses existing response helpers where practical and follows the current admin route style.

## Error Handling

- Invalid release version returns `400`.
- Missing `board_type`, `version`, `artifact_url`, or `sha256` returns `400`.
- Duplicate releases for the same board/channel/version are rejected by service validation.
- OTA check never fails solely because release selection fails; it should log and return no update, preserving device boot compatibility.

## Testing

Backend tests cover:

- Release creation normalizes versions and rejects malformed versions.
- Latest active release selection uses semantic version comparison.
- Inactive releases are ignored.
- OTA check returns no update for unknown board, unknown current version, no release, same version, or older release.
- OTA check returns update envelope for newer active release.
- Admin routes require admin auth and delegate to the release service.

Full verification remains:

- Targeted Jest tests for release service, OTA service, and firmware routes.
- `git diff --check`.
- `npm test`.
