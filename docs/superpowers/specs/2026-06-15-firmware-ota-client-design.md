# Firmware OTA Client Design

## Goal

Make `esplink-firmware` consume the backend OTA decision from `POST /api/ota/check` and perform an ESP-IDF OTA upgrade path that can be built and then verified on hardware.

## Scope

This phase completes the firmware client side enough for local and hardware validation. It does not add manufacturing PSK signing or production certificate pinning.

In scope:

- Keep the existing OTA partition layout with `otadata`, `ota_0`, and `ota_1`.
- Use the backend `ota` object returned by boot registration.
- Pass `url`, `version`, `sha256`, `size_bytes`, and `force` into the OTA module.
- Log the target OTA metadata before starting a download.
- Allow HTTP firmware URLs for local development while keeping the code compatible with HTTPS URLs.
- Unify firmware version reporting so the board config is the single source of truth.
- Preserve WebSocket `ota_push` support by routing push URLs through the same OTA module with partial metadata.

Out of scope:

- Full SHA256 post-download verification beyond ESP-IDF's image validation. The backend `sha256` is parsed and logged now; strict image digest verification can be added after the first hardware upgrade loop is proven.
- Secure boot, flash encryption, signed app enforcement, and anti-rollback.
- UI progress reporting.
- Resume downloads.

## Firmware Contract

The backend returns:

```json
{
  "update_available": true,
  "ota": {
    "version": "1.0.1",
    "url": "http://192.168.1.26:8088/firmware/esplink-v1-1.0.1.bin",
    "sha256": "64 hex chars",
    "size_bytes": 1048576,
    "force": false,
    "release_notes": "..."
  }
}
```

The firmware only starts OTA when `ota.url` is present. If `ota.version` is present and is not newer than the current firmware, the firmware skips upgrade unless `ota.force` is true.

## Module Interface

`main/app_ota.h` exposes:

```c
typedef struct {
    const char *url;
    const char *version;
    const char *sha256;
    int size_bytes;
    bool force;
} app_ota_update_t;

esp_err_t app_ota_upgrade(const app_ota_update_t *update);
esp_err_t app_ota_upgrade_from_url(const char *fw_url);
```

`app_ota_upgrade_from_url` remains as a compatibility wrapper for WebSocket `ota_push` messages that only contain a URL.

## HTTP / HTTPS Behavior

For local validation, the OTA client should allow `http://` artifact URLs. For production, use `https://` URLs and configure certificates before relying on OTA over the public internet.

## Testing

Build-time verification is the minimum gate:

- `idf.py build` must complete.
- The generated partition table must still contain `otadata`, `ota_0`, and `ota_1`.

Hardware verification comes next:

1. Flash firmware version `1.0.0`.
2. Publish an active backend firmware release `1.0.1` with an accessible artifact URL.
3. Boot the ESP32.
4. Confirm `/api/ota/check` returns `update_available=true`.
5. Confirm firmware starts OTA, restarts, and then reports `1.0.1`.
