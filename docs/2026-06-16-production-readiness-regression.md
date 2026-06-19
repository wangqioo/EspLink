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

2026-06-19 hardware result: passed on `/dev/cu.usbmodem112301` with device
`10:51:DB:80:E2:E8` and backend `REQUIRE_DEVICE_PSK=true`. The firmware used a
local PSK only for the validation build and sent signed boot registration after
SNTP epoch synchronization:

```text
syncing time before signed boot register
time synced for signed boot register: 1781868778
boot register signature enabled nonce=boot-
boot register ok, is_bound=1
app_ws: WebSocket connected
hello_ack: is_bound=1
```

The backend accepted `/api/ota/check` with HTTP 200 and updated the
`production_keys.last_nonce` / `last_seen_at` fields. Two hardware fixes were
identified during this run: signed boot must resync SNTP instead of trusting a
stale RTC epoch, and the ESP-IDF crt bundle must only be attached for
HTTPS/WSS URLs so local HTTP validation does not reset the connection.

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

2026-06-19 hardware result: passed on `/dev/cu.usbmodem112301` with device
`10:51:DB:80:E2:E8`. A temporary inactive-after-test release `1.0.6` pointed at
the known-good `esplink-v1-1.0.5.bin` artifact but used an all-zero SHA256.
The device reported `sha_mismatch` with `ESP_ERR_INVALID_CRC`, restored the
running partition as boot target, and rebooted back into factory offset
`0x20000` running `fw=1.0.5`. Backend `firmware_ota_attempts` recorded
`status=sha_mismatch`; the temporary release was reset to `is_active=0` and
`force_update=0`.

2026-06-19 signed-result extension: the same wrong-SHA run was repeated with
backend `REQUIRE_DEVICE_PSK=true` and firmware OTA result signing enabled. Both
the `started` and terminal `sha_mismatch` reports included a signature nonce
and the backend accepted `/api/ota/result` with HTTP 200:

```text
OTA result signature enabled nonce=boot-
OTA result reported: started
OTA SHA256 mismatch
restored running partition as boot target after OTA integrity failure
OTA result signature enabled nonce=boot-
OTA result reported: sha_mismatch
```

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

Start OTA from an artifact URL that closes the firmware download connection
early while the backend API stays online. Do not stop the backend if this case
is expected to record `/api/ota/result`; stopping the backend also prevents the
device from reporting `download_failed`.

Suggested local steps:

1. Start the normal backend on port `8088`.
2. Start the one-shot interrupted artifact server:

```bash
cd backend
node scripts/interrupted-firmware-server.js ../esplink-firmware/build/esp32s3_device.bin 131072 8099
```

3. Create a temporary active release for the device board with a higher version,
   correct `sha256` and `size_bytes` for the same `.bin`, and `artifact_url` set
   to `http://<LAN-IP>:8099/interrupted.bin`.
4. Power-cycle or reset the device so boot registration returns the OTA envelope.
5. Leave the device running until OTA fails, it reports the result, and it
   restarts into the previous firmware.
6. Disable the temporary release.

Expected observations:

```text
OTA available, upgrading...
OTA result reported: started
OTA failed
OTA result reported: download_failed
fatal error, restarting in 5s
```

Expected outcome: device reboots into the previous valid firmware and backend
`firmware_ota_attempts` records `status=download_failed`,
`error_code=download_failed`, and a non-null `finished_at`.

2026-06-19 hardware result: passed on `/dev/cu.usbmodem112301` after a full
`erase-flash flash` restored the EspLink OTA partition table. Temporary release
`id=7 / version=1.0.7` used `artifact_url=http://192.168.1.26:8099/interrupted.bin`
and the correct SHA256/size for the current `esp32s3_device.bin`; the one-shot
artifact server advertised `1343056` bytes and closed the connection after
`131072` bytes. Backend accepted `/api/ota/result` with HTTP 200 and recorded:

```text
release_id=7 target_version=1.0.7 status=download_failed error_code=download_failed
error_message=ESP_FAIL finished_at=2026-06-19 15:21:53
```

Because the one-shot artifact server exits after the first interrupted stream,
the device's immediate retry attempts also produced `download_failed` rows with
`ESP_ERR_HTTP_CONNECT`; this is expected for this local harness. The temporary
release was reset to `is_active=0` and `force_update=0`. A final boot check
confirmed the device returned to `fw=1.0.5`, `boot register ok`, WebSocket
connected, and `hello_ack`.

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

2026-06-20 hardware result: PASS on `/dev/cu.usbmodem112301`,
MAC `10:51:DB:80:E2:E8`, SN `MAC-1051DB80E2E8`.

Temporary release `id=8 / version=1.0.8` used artifact
`http://192.168.1.26:8088/firmware/esplink-v1-1.0.8-bootfail.bin`,
SHA256 `0cadde9c8535b3c1465561c51862ae61e86de57b8842c388b9c6dc3ac81369b1`,
and `size_bytes=219264`. The image was built only for this rollback test: it
kept `board_type=esplink-v1`, reported firmware `1.0.8`, then aborted before
the app could confirm the OTA boot as valid.

Evidence:

```text
OTA target version=1.0.8
OTA artifact SHA256 verified 0cadde9c8535b3c1...
OTA success, restarting
OTA result reported: success
boot: Loaded app from partition at offset 0x1a0000
main: === device boot: board=esplink-v1 fw=1.0.8 ===
boot-fail rollback validation image aborting before OTA validation
abort() was called
boot: Defaulting to factory image
boot: Loaded app from partition at offset 0x20000
main: === device boot: board=esplink-v1 fw=1.0.5 ===
boot register ok, is_bound=1
app_ws: WebSocket connected
server msg: {"type":"hello_ack","is_bound":true}
```

Observation: the OTA transport and SHA verification completed successfully, so
the backend OTA attempt records the install as `success`. The rollback decision
is verified by the bootloader and device logs: the test image failed before
`app_ota_mark_running_valid()`, the bootloader rejected the pending OTA image,
and the device returned online on the previous valid `1.0.5` factory app. The
temporary release was disabled after validation, and the board was re-flashed
with default development firmware with `CONFIG_ESPLINK_TEST_AUTO_WIFI` disabled.

## 9. Backend Restart And WebSocket Recovery

With the device online, restart the backend.

Expected observations:

```text
server disconnected
fatal error, restarting in 5s
boot register ok
app_ws: WebSocket connected
```

2026-06-20 hardware result: PASS on `/dev/cu.usbmodem112301`,
MAC `10:51:DB:80:E2:E8`, SN `MAC-1051DB80E2E8`.

Evidence:

```text
boot register ok, is_bound=1
app_ws: WebSocket connected
server msg: {"type":"hello_ack","is_bound":true}
transport_ws: Error connecting to host 192.168.1.26:8088
websocket_client: Reconnect after 5000 ms
app_ws: WebSocket disconnected
main: server disconnected
[WS] device connected: 10:51:DB:80:E2:E8
```

Observation: after backend stop the firmware stayed alive and retried the
WebSocket connection every 5 seconds. After the backend restarted, backend logs
recorded the same device MAC reconnecting. The serial monitor produced heavy
display-loop output and disconnected before capturing the final `hello_ack` line
after restart, so the accepted recovery evidence is the paired firmware-side
retry loop plus backend-side reconnect record.

## Completion Criteria

- Backend `npm test` passes.
- Firmware builds with default development settings.
- Firmware builds with production signing settings.
- Signed boot succeeds with `REQUIRE_DEVICE_PSK=true`.
- Correct OTA artifact SHA256 is accepted on hardware.
- Wrong SHA256 is rejected on hardware.
- OTA-booted firmware confirms itself valid before accepting a second OTA.
