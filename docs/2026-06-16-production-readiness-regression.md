# 2026-06-16 Production Readiness Regression Runbook

This runbook validates the first production-readiness foundation for EspLink:
signed boot registration, OTA SHA256 enforcement, and WebSocket recovery.

## Preconditions

- Backend runs from `/Users/wq/EspLink/backend`.
- ESP-IDF is available from `/Users/wq/esp-idf/export.sh`.
- ESP32-S3 serial port is known. Current hardware uses `/dev/cu.usbmodem112301`.
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
idf.py -p /dev/cu.usbmodem112301 flash monitor
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
OTA artifact SHA256 verified
OTA success, restarting
device boot: board=esplink-v1 fw=<new-version>
```

2026-06-17 hardware note: the backend `sha256` value is the raw uploaded
`.bin` artifact digest. Firmware verification must compute SHA256 over the raw
artifact bytes written to the target OTA partition, bounded by `size_bytes`.
`esp_partition_get_sha256()` returns the ESP image digest and must not be used
to compare with the backend artifact SHA256.

2026-06-17 hardware result: normal OTA from a temporary `1.0.3` build to
`1.0.4` passed with raw artifact SHA256
`d4cf96af27893672d138e640b51c238dab62110453f4df26cce0e90400ec20bb`.

## 5. Forced OTA

Publish a release with the same version and `force_update=true`.

Automated coverage:

```bash
cd /Users/wq/EspLink/backend
npm test -- otaCheckService.test.js --runInBand
```

The `returns forced update envelope when release version matches current firmware`
case verifies that `/api/ota/check` still returns an OTA envelope when the
release version equals the device version and `force_update=true`.

Expected serial observations:

```text
OTA available, upgrading...
OTA artifact SHA256 verified
OTA success, restarting
app_ota: OTA app marked valid
boot register ok
```

2026-06-17 hardware finding: before the fix, forced same-version OTA reached
the device but firmware could fail before download with:

```text
ESP_ERR_OTA_ROLLBACK_INVALID_STATE
Running app has not confirmed state (ESP_OTA_IMG_PENDING_VERIFY)
```

Fix verified in `1.0.4`: after a freshly OTA-booted app completes boot
registration, firmware calls `esp_ota_mark_app_valid_cancel_rollback()` through
`app_ota_mark_running_valid()`. Forced same-version OTA `1.0.4 -> 1.0.4`
passed on hardware, and the final boot completed `boot register ok` plus
WebSocket `hello_ack`.

## 6. Wrong SHA256

Publish a release with a valid URL but an intentionally wrong 64-character SHA256.

Expected serial observations:

```text
OTA SHA256 mismatch
OTA integrity verification failed
restored running partition as boot target after OTA integrity failure
OTA result reported: sha_mismatch
```

Expected outcome: device does not reboot into the untrusted image. The backend
records `status=sha_mismatch`, and the next boot stays on the previously running
valid firmware.

Before this case can be trusted, the normal OTA case must first pass with a
correct backend artifact SHA256. As of `1.0.4`, correct raw artifact SHA256 is
accepted on hardware. As of `1.0.5`, firmware also restores the current running
partition as the boot target when raw artifact SHA256 verification fails.

## 6.1 Invalid Firmware Uploads

Automated coverage:

```bash
cd /Users/wq/EspLink/backend
npm test -- firmwareRoutes.test.js --runInBand
```

Expected covered cases:

- valid ESP image upload returns artifact metadata;
- non-`.bin` filename is rejected;
- empty `.bin` upload is rejected;
- `.bin` whose first byte is not ESP image magic `0xE9` is rejected;
- upload larger than `FIRMWARE_UPLOAD_MAX_BYTES` is rejected.

The backend check is an upload guard, not a replacement for the bootloader.
Wrong chip target, bad app descriptor, corrupted segment table, and boot fail
rollback still require the hardware cases below.

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

Suggested local steps:

1. Start the backend with a release that points to a large valid `.bin`.
2. Power-cycle or reset the device so boot registration returns the OTA envelope.
3. Watch serial logs until `OTA target url=` appears.
4. Stop the backend process before download completion.
5. Leave the device running until it restarts and reports the previous firmware.

Expected observations:

```text
OTA failed
fatal error, restarting in 5s
```

Expected outcome: device reboots into the previous valid firmware.

## 8.1 Boot Fail Recovery

Publish an ESP image that passes upload and download checks but cannot boot the
application successfully on the target hardware.

Expected observations:

```text
OTA success, restarting
bootloader selects new OTA partition
application fails before confirming boot
bootloader rolls back to previous partition
device boot: board=esplink-v1 fw=<previous-version>
```

Expected outcome: device returns online on the previous valid firmware and
does not remain stuck on the failed image.

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
- Correct OTA artifact SHA256 is accepted on hardware.
- Wrong SHA256 is rejected on hardware.
- OTA-booted firmware confirms itself valid before accepting a second OTA.
