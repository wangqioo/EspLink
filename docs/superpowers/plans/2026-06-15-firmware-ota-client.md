# Firmware OTA Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the ESP32 firmware OTA client path so boot registration OTA decisions can trigger an ESP-IDF OTA upgrade.

**Architecture:** Keep `main.c` responsible for parsing backend JSON and state transitions. Put OTA metadata validation and `esp_https_ota` invocation behind `app_ota_upgrade`.

**Tech Stack:** ESP-IDF, C, `esp_https_ota`, `esp_http_client`, cJSON.

---

## File Structure

- Modify: `main/app_ota.h`
- Modify: `main/app_ota.c`
- Modify: `main/main.c`
- Modify: `main/app_device.c`
- Modify: `sdkconfig`

## Task 1: OTA Metadata Interface

- [ ] Add `app_ota_update_t` to `main/app_ota.h`.
- [ ] Add `app_ota_upgrade(const app_ota_update_t *update)`.
- [ ] Keep `app_ota_upgrade_from_url(const char *fw_url)` as a wrapper.

## Task 2: OTA Implementation

- [ ] In `main/app_ota.c`, include `<stdbool.h>`, `<stdio.h>`, and `<stdlib.h>` if needed.
- [ ] Add a URL scheme helper so local `http://` URLs use `HTTP_TRANSPORT_OVER_TCP` and `https://` URLs use `HTTP_TRANSPORT_OVER_SSL`.
- [ ] Add metadata logging for URL, version, size, force, and SHA256 prefix.
- [ ] In `app_ota_upgrade`, reject null update or missing URL with `ESP_ERR_INVALID_ARG`.
- [ ] If `version` is present and not newer than current firmware, skip with `ESP_ERR_NOT_FOUND` unless `force` is true.
- [ ] Call `esp_https_ota`.
- [ ] On success, call `esp_restart`.
- [ ] Make `app_ota_upgrade_from_url` build a minimal `app_ota_update_t` and call `app_ota_upgrade`.

## Task 3: Boot Registration OTA Parsing

- [ ] In `main.c`, parse `ota.version`, `ota.url`, `ota.sha256`, `ota.size_bytes`, and `ota.force`.
- [ ] Copy OTA strings before deleting the cJSON root.
- [ ] Call `app_ota_upgrade(&update)`.
- [ ] Free copied strings on failure paths.
- [ ] Keep the existing WebSocket `ota_push` URL-only path.

## Task 4: Firmware Version Source

- [ ] In `main/app_device.c`, include `board_config.h`.
- [ ] Remove the local `FIRMWARE_VER` literal.
- [ ] Make `app_device_get_firmware_version()` return `BOARD_FIRMWARE_VERSION`.
- [ ] Ensure boot logs use the same version.

## Task 5: Build Configuration And Verification

- [ ] Enable HTTP OTA for local validation by setting `CONFIG_ESP_HTTPS_OTA_ALLOW_HTTP=y` in `sdkconfig`.
- [ ] Run `idf.py build`.
- [ ] Confirm `build/partition_table/partition-table.bin` or generated partition CSV still includes `otadata`, `ota_0`, `ota_1`.
- [ ] Commit the firmware OTA client changes.
