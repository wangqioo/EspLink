# 2026-06-16 Production Readiness Regression Runbook

This runbook validates the first production-readiness foundation for EspLink:
signed boot registration, OTA SHA256 enforcement, and WebSocket recovery.

## Preconditions

- Backend runs from `/Users/wq/EspLink/backend`.
- ESP-IDF is available from `/Users/wq/esp-idf/export.sh`.
- ESP32-S3 serial port is known.
- `backend/.env` is copied from `backend/.env.example`.
- `WS_BASE_URL` and `PUBLIC_BASE_URL` use the Mac LAN IP reachable by the device.
- Database migrations for `production_keys` and `firmware_releases` have been applied.

## 1. Unsigned Development Boot

Backend:

```bash
cd /Users/wq/EspLink/backend
perl -0pi -e 's/REQUIRE_DEVICE_PSK=true/REQUIRE_DEVICE_PSK=false/' .env
npm start
```

Firmware:

```bash
cd /Users/wq/EspLink/esplink-firmware
source /Users/wq/esp-idf/export.sh
idf.py build
idf.py -p /dev/cu.usbmodem111301 flash monitor
```

Expected serial observations:

```text
boot register signature disabled for development
boot register ok
app_ws: WebSocket connected
```

## 2. Signed Production Boot

Provision a production key row whose `mac_address` matches the device, `sn`
matches firmware SN, `psk_encrypted` equals the configured firmware PSK, and
`is_active` is true.

Backend:

```bash
cd /Users/wq/EspLink/backend
perl -0pi -e 's/REQUIRE_DEVICE_PSK=false/REQUIRE_DEVICE_PSK=true/' .env
npm start
```

Firmware config:

```text
CONFIG_ESPLINK_BOOT_PSK="device-secret"
CONFIG_ESPLINK_BOOT_SIGNATURE_REQUIRED=y
```

Expected serial observations:

```text
boot register signature enabled nonce=boot-
boot register ok
app_ws: WebSocket connected
```

Expected backend observation:

```text
POST /api/ota/check 200
```

## 3. Signature Failure Cases

Run one case at a time:

- `CONFIG_ESPLINK_BOOT_PSK` differs from backend `psk_encrypted`.
- `production_keys.is_active=false`.
- Reuse a previously accepted nonce by replaying the JSON body with curl.
- Send a timestamp older than 300 seconds with curl.

Expected backend responses:

```text
403 device_signature_invalid
403 device_not_provisioned
403 device_nonce_replayed
403 device_timestamp_stale
```

## 4. Normal OTA

Publish a release with the correct `board_type`, higher semantic `version`,
correct `.bin` URL, correct `sha256`, and `is_active=true`.

Expected serial observations:

```text
OTA available, upgrading...
OTA target sha256
OTA SHA256 verified
OTA success, restarting
device boot: board=esplink-v1 fw=<new-version>
```

## 5. Forced OTA

Publish a release with the same version and `force_update=true`.

Expected serial observations:

```text
OTA available, upgrading...
OTA success, restarting
```

## 6. Wrong SHA256

Publish a release with a valid URL but an intentionally wrong 64-character SHA256.

Expected serial observations:

```text
OTA SHA256 mismatch
OTA integrity verification failed
fatal error, restarting in 5s
```

Expected outcome: device does not boot the untrusted image.

## 7. Wrong Board Or Non-Newer Version

Publish a release for another `board_type`, then publish an older version for
the correct board.

Expected observations:

```text
boot register ok
app_ws: WebSocket connected
```

Expected outcome: no OTA starts.

## 8. Interrupted Download

Start OTA and stop the backend while the device downloads the `.bin`.

Expected observations:

```text
OTA failed
fatal error, restarting in 5s
```

Expected outcome: device reboots into the previous valid firmware.

## 9. Backend Restart And WebSocket Recovery

With the device online, restart the backend.

Expected observations:

```text
server disconnected
fatal error, restarting in 5s
boot register ok
app_ws: WebSocket connected
```

## Completion Criteria

- Backend `npm test` passes.
- Firmware builds with default development settings.
- Firmware builds with production signing settings.
- Signed boot succeeds with `REQUIRE_DEVICE_PSK=true`.
- Wrong SHA256 is rejected on hardware.
