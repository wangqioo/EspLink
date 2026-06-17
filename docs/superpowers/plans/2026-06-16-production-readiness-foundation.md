# Production Readiness Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make EspLink's first production-readiness path explicit and testable: signed firmware boot registration, OTA SHA256 enforcement, repository-owned environment setup, and a repeatable hardware regression runbook.

**Architecture:** Keep the backend as the authority for production device identity through the existing `deviceIdentityService` canonical HMAC payload. Add firmware-side signing and OTA integrity helpers behind small interfaces so `main.c` keeps the boot state machine shape. Treat repository-local environment docs and hardware validation as first-class deliverables because this phase changes how the system is operated.

**Tech Stack:** ESP-IDF C, mbedTLS, ESP HTTPS OTA APIs, Node.js/Express, Prisma/MySQL, Redis, Jest/Supertest, Markdown runbooks.

---

## File Structure

- Create: `esplink-firmware/main/app_boot_signing.h`
  - Interface for building optional boot registration signatures.
- Create: `esplink-firmware/main/app_boot_signing.c`
  - HMAC-SHA256 signing, nonce generation, timestamp handling, and JSON append helper.
- Modify: `esplink-firmware/main/CMakeLists.txt`
  - Add `app_boot_signing.c` to firmware sources.
- Modify: `esplink-firmware/main/Kconfig.projbuild`
  - Add PSK signing and production transport configuration knobs.
- Modify: `esplink-firmware/main/main.c`
  - Use the signing helper when constructing `/api/ota/check` body.
- Modify: `esplink-firmware/main/app_ota.c`
  - Validate OTA SHA256 metadata and verify the written OTA partition before reboot.
- Modify: `backend/.env.example`
  - Create or update the repository-owned backend environment template.
- Modify: `README.md`
  - Replace legacy `.env` dependency with repo-local setup.
- Modify: `backend/README.md`
  - Replace legacy local validation setup and document production PSK mode.
- Modify: `docs/2026-06-16-development-status.md`
  - Mark repo-local env as resolved after `.env.example` is in place.
- Create: `docs/2026-06-16-production-readiness-regression.md`
  - Hardware regression checklist for signed boot, OTA integrity, and reconnection.

## Task 1: Firmware Boot Signing Configuration

**Files:**
- Modify: `esplink-firmware/main/Kconfig.projbuild`

- [ ] **Step 1: Add signing and production transport Kconfig options**

Update `esplink-firmware/main/Kconfig.projbuild` inside the existing `menu "EspLink"` block:

```text
config ESPLINK_BOOT_REGISTER_URL
    string "Boot register URL"
    default "http://192.168.1.26:8088/api/ota/check"
    help
        Endpoint called after WiFi connects. The response provides the
        WebSocket URL, device token, binding state, and optional OTA decision.

config ESPLINK_BOOT_PSK
    string "Boot registration PSK"
    default ""
    help
        Optional pre-shared key used to sign POST /api/ota/check. Leave empty
        for development servers where REQUIRE_DEVICE_PSK is not true. Production
        validation must configure this to the same secret stored in the backend
        production_keys.psk_encrypted field for this device.

config ESPLINK_BOOT_SIGNATURE_REQUIRED
    bool "Require signed boot registration"
    default n
    help
        When enabled, firmware refuses to call the boot registration endpoint
        unless ESPLINK_BOOT_PSK is configured. This is intended for production
        builds and production-readiness validation.

config ESPLINK_PRODUCTION_TRANSPORT
    bool "Require production transport settings"
    default n
    help
        When enabled, firmware treats plain HTTP boot registration and OTA URLs
        as invalid. Use this with HTTPS/WSS deployment and certificate
        verification before shipping devices.

config ESPLINK_TEST_AUTO_WIFI
    bool "Enable local test WiFi injection"
    default n
    help
        Test-only shortcut. When enabled, firmware reads SSID/password from
        main/local_wifi_config.h, writes them into NVS during boot, and skips
        BLE provisioning. Keep disabled for normal development and production.
```

- [ ] **Step 2: Verify Kconfig parses**

Run:

```bash
cd esplink-firmware
idf.py reconfigure
```

Expected: command exits `0` and the generated configuration includes the new `CONFIG_ESPLINK_BOOT_PSK`, `CONFIG_ESPLINK_BOOT_SIGNATURE_REQUIRED`, and `CONFIG_ESPLINK_PRODUCTION_TRANSPORT` options.

- [ ] **Step 3: Commit**

```bash
git add esplink-firmware/main/Kconfig.projbuild
git commit -m "feat: add firmware production readiness config"
```

## Task 2: Firmware Boot Signing Helper

**Files:**
- Create: `esplink-firmware/main/app_boot_signing.h`
- Create: `esplink-firmware/main/app_boot_signing.c`
- Modify: `esplink-firmware/main/CMakeLists.txt`

- [ ] **Step 1: Create the helper interface**

Create `esplink-firmware/main/app_boot_signing.h`:

```c
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

typedef struct {
    const char *mac;
    const char *sn;
    int64_t timestamp;
    const char *nonce;
    const char *signature;
} app_boot_signature_t;

bool app_boot_signing_is_configured(void);
esp_err_t app_boot_signing_build(app_boot_signature_t *signature,
                                 char *nonce_buf,
                                 size_t nonce_buf_len,
                                 char *signature_buf,
                                 size_t signature_buf_len);
esp_err_t app_boot_signing_append_json(char *body,
                                       size_t body_len,
                                       const app_boot_signature_t *signature);
```

- [ ] **Step 2: Implement HMAC signing**

Create `esplink-firmware/main/app_boot_signing.c`:

```c
#include "app_boot_signing.h"
#include "app_device.h"
#include "esp_log.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "mbedtls/md.h"
#include "sdkconfig.h"
#include <stdio.h>
#include <string.h>

#define TAG "boot_sign"

static void bytes_to_hex(const unsigned char *bytes, size_t len, char *out, size_t out_len)
{
    static const char hex[] = "0123456789abcdef";
    if (out_len < (len * 2) + 1) {
        if (out_len > 0) out[0] = '\0';
        return;
    }

    for (size_t i = 0; i < len; i++) {
        out[i * 2] = hex[(bytes[i] >> 4) & 0x0f];
        out[i * 2 + 1] = hex[bytes[i] & 0x0f];
    }
    out[len * 2] = '\0';
}

static int64_t current_timestamp_seconds(void)
{
    int64_t now_us = esp_timer_get_time();
    return now_us > 0 ? now_us / 1000000 : 0;
}

bool app_boot_signing_is_configured(void)
{
    return strlen(CONFIG_ESPLINK_BOOT_PSK) > 0;
}

esp_err_t app_boot_signing_build(app_boot_signature_t *signature,
                                 char *nonce_buf,
                                 size_t nonce_buf_len,
                                 char *signature_buf,
                                 size_t signature_buf_len)
{
    if (!signature || !nonce_buf || nonce_buf_len < 24 || !signature_buf || signature_buf_len < 65) {
        return ESP_ERR_INVALID_ARG;
    }

    if (!app_boot_signing_is_configured()) {
#if CONFIG_ESPLINK_BOOT_SIGNATURE_REQUIRED
        ESP_LOGE(TAG, "boot signature required but CONFIG_ESPLINK_BOOT_PSK is empty");
        return ESP_ERR_INVALID_STATE;
#else
        memset(signature, 0, sizeof(*signature));
        return ESP_ERR_NOT_FOUND;
#endif
    }

    uint32_t random_a = esp_random();
    uint32_t random_b = esp_random();
    snprintf(nonce_buf, nonce_buf_len, "boot-%08lx%08lx",
             (unsigned long)random_a,
             (unsigned long)random_b);

    int64_t timestamp = current_timestamp_seconds();
    char payload[192];
    int payload_len = snprintf(payload,
                               sizeof(payload),
                               "%s\n%s\n%lld\n%s",
                               app_device_get_mac_str(),
                               app_device_get_sn(),
                               (long long)timestamp,
                               nonce_buf);
    if (payload_len < 0 || payload_len >= (int)sizeof(payload)) {
        return ESP_ERR_NO_MEM;
    }

    unsigned char digest[32];
    int rc = mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),
                             (const unsigned char *)CONFIG_ESPLINK_BOOT_PSK,
                             strlen(CONFIG_ESPLINK_BOOT_PSK),
                             (const unsigned char *)payload,
                             strlen(payload),
                             digest);
    if (rc != 0) {
        ESP_LOGE(TAG, "HMAC calculation failed: %d", rc);
        return ESP_FAIL;
    }

    bytes_to_hex(digest, sizeof(digest), signature_buf, signature_buf_len);

    signature->mac = app_device_get_mac_str();
    signature->sn = app_device_get_sn();
    signature->timestamp = timestamp;
    signature->nonce = nonce_buf;
    signature->signature = signature_buf;
    return ESP_OK;
}

esp_err_t app_boot_signing_append_json(char *body,
                                       size_t body_len,
                                       const app_boot_signature_t *signature)
{
    if (!body || !signature || !signature->nonce || !signature->signature) {
        return ESP_ERR_INVALID_ARG;
    }

    size_t used = strlen(body);
    if (used == 0 || used >= body_len || body[used - 1] != '}') {
        return ESP_ERR_INVALID_ARG;
    }

    body[used - 1] = '\0';
    int written = snprintf(body + used - 1,
                           body_len - used + 1,
                           ",\"timestamp\":%lld,\"nonce\":\"%s\",\"signature\":\"%s\"}",
                           (long long)signature->timestamp,
                           signature->nonce,
                           signature->signature);
    if (written < 0 || written >= (int)(body_len - used + 1)) {
        return ESP_ERR_NO_MEM;
    }

    return ESP_OK;
}
```

- [ ] **Step 3: Register the helper source**

Update `esplink-firmware/main/CMakeLists.txt` by adding `app_boot_signing.c` to the `SRCS` list. The final source list must include:

```cmake
        "main.c"
        "app_nvs.c"
        "app_device.c"
        "app_blufi.c"
        "app_wifi.c"
        "app_ws.c"
        "app_ota.c"
        "app_button.c"
        "app_cube_demo.c"
        "app_boot_signing.c"
```

- [ ] **Step 4: Build**

Run:

```bash
cd esplink-firmware
idf.py build
```

Expected: command exits `0`.

- [ ] **Step 5: Commit**

```bash
git add esplink-firmware/main/app_boot_signing.h esplink-firmware/main/app_boot_signing.c esplink-firmware/main/CMakeLists.txt
git commit -m "feat: add firmware boot signing helper"
```

## Task 3: Signed Firmware Boot Registration

**Files:**
- Modify: `esplink-firmware/main/main.c`

- [ ] **Step 1: Include the signing helper**

Add this include near the other app includes in `esplink-firmware/main/main.c`:

```c
#include "app_boot_signing.h"
```

- [ ] **Step 2: Build and append the optional signature**

In `boot_register_task`, after the initial `snprintf(body, sizeof(body), ...)` call and before `esp_http_client_init`, add:

```c
    app_boot_signature_t signature;
    char nonce[32] = {0};
    char signature_hex[65] = {0};
    esp_err_t sign_err = app_boot_signing_build(&signature,
                                                nonce,
                                                sizeof(nonce),
                                                signature_hex,
                                                sizeof(signature_hex));
    if (sign_err == ESP_OK) {
        sign_err = app_boot_signing_append_json(body, sizeof(body), &signature);
        if (sign_err != ESP_OK) {
            ESP_LOGE(TAG, "failed to append boot signature: %s", esp_err_to_name(sign_err));
            set_state(STATE_FATAL_ERROR);
            vTaskDelete(NULL);
            return;
        }
        ESP_LOGI(TAG, "boot register signature enabled nonce=%s", nonce);
    } else if (sign_err == ESP_ERR_NOT_FOUND) {
        ESP_LOGW(TAG, "boot register signature disabled for development");
    } else {
        ESP_LOGE(TAG, "boot register signature failed: %s", esp_err_to_name(sign_err));
        set_state(STATE_FATAL_ERROR);
        vTaskDelete(NULL);
        return;
    }
```

- [ ] **Step 3: Build default development firmware**

Run:

```bash
cd esplink-firmware
idf.py build
```

Expected: command exits `0` with default unsigned development configuration.

- [ ] **Step 4: Build production-signing configuration**

Run:

```bash
cd esplink-firmware
idf.py -D SDKCONFIG_DEFAULTS=sdkconfig.defaults build
```

Then use `idf.py menuconfig` or `sdkconfig` for local validation to set:

```text
CONFIG_ESPLINK_BOOT_PSK="device-secret"
CONFIG_ESPLINK_BOOT_SIGNATURE_REQUIRED=y
```

Run:

```bash
idf.py build
```

Expected: command exits `0`.

- [ ] **Step 5: Commit**

```bash
git add esplink-firmware/main/main.c
git commit -m "feat: sign firmware boot registration"
```

## Task 4: OTA SHA256 Enforcement

**Files:**
- Modify: `esplink-firmware/main/app_ota.c`

- [ ] **Step 1: Add partition and SHA helpers**

Add these includes to `esplink-firmware/main/app_ota.c`:

```c
#include "esp_ota_ops.h"
#include "esp_partition.h"
```

Add helper functions below `transport_for_url`:

```c
static bool is_hex_char(char ch)
{
    return (ch >= '0' && ch <= '9') ||
           (ch >= 'a' && ch <= 'f') ||
           (ch >= 'A' && ch <= 'F');
}

static bool valid_sha256_hex(const char *sha256)
{
    if (!sha256 || !sha256[0]) {
        return true;
    }

    if (strlen(sha256) != 64) {
        return false;
    }

    for (int i = 0; i < 64; i++) {
        if (!is_hex_char(sha256[i])) {
            return false;
        }
    }
    return true;
}

static void bytes_to_hex(const uint8_t *bytes, size_t len, char *out, size_t out_len)
{
    static const char hex[] = "0123456789abcdef";
    if (out_len < (len * 2) + 1) {
        if (out_len > 0) out[0] = '\0';
        return;
    }

    for (size_t i = 0; i < len; i++) {
        out[i * 2] = hex[(bytes[i] >> 4) & 0x0f];
        out[i * 2 + 1] = hex[bytes[i] & 0x0f];
    }
    out[len * 2] = '\0';
}

static esp_err_t verify_pending_partition_sha256(const char *expected_sha256)
{
    if (!expected_sha256 || !expected_sha256[0]) {
        return ESP_OK;
    }

    const esp_partition_t *partition = esp_ota_get_next_update_partition(NULL);
    if (!partition) {
        ESP_LOGE(TAG, "unable to locate pending OTA partition for SHA256 verification");
        return ESP_ERR_NOT_FOUND;
    }

    uint8_t digest[32];
    esp_err_t err = esp_partition_get_sha256(partition, digest);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "failed to read OTA partition SHA256: %s", esp_err_to_name(err));
        return err;
    }

    char actual[65];
    bytes_to_hex(digest, sizeof(digest), actual, sizeof(actual));
    if (strcasecmp(actual, expected_sha256) != 0) {
        ESP_LOGE(TAG, "OTA SHA256 mismatch expected=%s actual=%s", expected_sha256, actual);
        return ESP_ERR_INVALID_CRC;
    }

    ESP_LOGI(TAG, "OTA SHA256 verified %.16s...", actual);
    return ESP_OK;
}
```

- [ ] **Step 2: Reject invalid metadata before download**

In `app_ota_upgrade`, after URL scheme validation and before version comparison, add:

```c
    if (!valid_sha256_hex(update->sha256)) {
        ESP_LOGE(TAG, "invalid OTA sha256 metadata");
        return ESP_ERR_INVALID_ARG;
    }

#if CONFIG_ESPLINK_PRODUCTION_TRANSPORT
    if (!is_https_url(update->url)) {
        ESP_LOGE(TAG, "production transport requires HTTPS OTA url: %s", update->url);
        return ESP_ERR_INVALID_ARG;
    }
#endif
```

- [ ] **Step 3: Verify SHA before restart**

Replace the success branch in `app_ota_upgrade`:

```c
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "OTA success, restarting");
        esp_restart();
    } else {
        ESP_LOGE(TAG, "OTA failed: %s", esp_err_to_name(err));
    }
```

with:

```c
    if (err == ESP_OK) {
        err = verify_pending_partition_sha256(update->sha256);
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "OTA integrity verification failed: %s", esp_err_to_name(err));
            return err;
        }
        ESP_LOGI(TAG, "OTA success, restarting");
        esp_restart();
    } else {
        ESP_LOGE(TAG, "OTA failed: %s", esp_err_to_name(err));
    }
```

- [ ] **Step 4: Build**

Run:

```bash
cd esplink-firmware
idf.py build
```

Expected: command exits `0`.

- [ ] **Step 5: Commit**

```bash
git add esplink-firmware/main/app_ota.c
git commit -m "feat: enforce firmware ota sha256"
```

## Task 5: Backend Environment Template

**Files:**
- Create or modify: `backend/.env.example`

- [ ] **Step 1: Write repository-local env template**

Create or replace `backend/.env.example` with:

```dotenv
# Server
NODE_ENV=development
PORT=8088
CORS_ORIGIN=*
PUBLIC_BASE_URL=http://127.0.0.1:8088
WS_BASE_URL=ws://127.0.0.1:8088
INSTANCE_ID=local-dev-1

# Database
DATABASE_URL="mysql://root:password@localhost:3306/xiaozhi"
DB_LOG=false

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Auth
JWT_SECRET=replace-with-a-long-random-secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-me

# WeChat mini program
WX_APPID=
WX_SECRET=

# LLM defaults
DEFAULT_AI_MODEL=deepseek-chat

# Firmware artifacts
FIRMWARE_UPLOAD_DIR=uploads/firmware
FIRMWARE_PUBLIC_BASE_URL=
FIRMWARE_UPLOAD_MAX_BYTES=8mb

# Device boot registration
REQUIRE_DEVICE_PSK=false
OTA_CHECK_RATE_LIMIT=30
OTA_CHECK_RATE_WINDOW_SECONDS=60

# Device WebSocket abuse protection
UNBOUND_DEVICE_AI_CHAT_ENABLED=false
DEVICE_AI_RATE_LIMIT=20
DEVICE_AI_RATE_WINDOW_SECONDS=60
```

- [ ] **Step 2: Confirm required env names match code**

Run:

```bash
cd backend
rg -n "process\\.env\\.[A-Z0-9_]+" src | sort
```

Expected: every production-relevant variable in code is either represented in `.env.example` or intentionally optional with a safe default.

- [ ] **Step 3: Commit**

```bash
git add backend/.env.example
git commit -m "chore: add backend env example"
```

## Task 6: Repository-Local Startup Documentation

**Files:**
- Modify: `README.md`
- Modify: `backend/README.md`
- Modify: `docs/2026-06-16-development-status.md`

- [ ] **Step 1: Update top-level backend quick start**

In `README.md`, ensure the backend quick start uses:

```bash
cd backend
cp .env.example .env
# edit .env: DATABASE_URL, REDIS_HOST, JWT_SECRET, ADMIN_PASSWORD, WS_BASE_URL, PUBLIC_BASE_URL
npm install
npm run db:generate
npm test
npm run dev
```

Add a short note:

```markdown
For hardware validation, set `WS_BASE_URL` and `PUBLIC_BASE_URL` to the Mac LAN
address reachable by the ESP32, for example `ws://192.168.1.26:8088` and
`http://192.168.1.26:8088`.
```

- [ ] **Step 2: Update backend README hardware test section**

Replace the block that sources `/Users/wq/ai_deploy_backend/.env` with:

```bash
export PATH="/opt/homebrew/bin:$PATH"
brew services start mysql
brew services start redis
cd /Users/wq/EspLink/backend
cp .env.example .env

# edit .env:
# DATABASE_URL="mysql://root:<db-password>@localhost:3306/xiaozhi"
# REDIS_HOST=localhost
# WS_BASE_URL=ws://192.168.1.26:8088
# PUBLIC_BASE_URL=http://192.168.1.26:8088
# REQUIRE_DEVICE_PSK=false

npm install
npm run db:generate
npm start
```

- [ ] **Step 3: Update development status**

In `docs/2026-06-16-development-status.md`, replace the repo-local env remaining-work item with:

```markdown
- Repo-local `.env` 流程：已补 `backend/.env.example`，本地验证应从当前仓库复制 `.env` 并填写数据库、Redis、`WS_BASE_URL` 和 `PUBLIC_BASE_URL`。
```

- [ ] **Step 4: Verify documentation no longer uses old env as the normal path**

Run:

```bash
rg -n "ai_deploy_backend/.env|当前仓库还没有提交真实 `.env`|临时复用旧后端" README.md backend/README.md docs/2026-06-16-development-status.md
```

Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add README.md backend/README.md docs/2026-06-16-development-status.md
git commit -m "docs: document repository local backend setup"
```

## Task 7: Production Readiness Hardware Regression Runbook

**Files:**
- Create: `docs/2026-06-16-production-readiness-regression.md`

- [ ] **Step 1: Create the runbook**

Create `docs/2026-06-16-production-readiness-regression.md`:

```markdown
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
```

- [ ] **Step 2: Link runbook from status doc**

Add this bullet to `docs/2026-06-16-development-status.md` under "建议继续验证":

```markdown
- 生产化回归：按 [Production Readiness Regression Runbook](./2026-06-16-production-readiness-regression.md) 验证签名注册、SHA256 OTA、断线恢复。
```

- [ ] **Step 3: Commit**

```bash
git add docs/2026-06-16-production-readiness-regression.md docs/2026-06-16-development-status.md
git commit -m "docs: add production readiness regression runbook"
```

## Task 8: Final Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run backend tests**

Run:

```bash
cd backend
npm test -- --runInBand
```

Expected: all Jest suites pass.

- [ ] **Step 2: Run firmware build**

Run:

```bash
cd esplink-firmware
idf.py build
```

Expected: build exits `0`.

- [ ] **Step 3: Check formatting and accidental secrets**

Run:

```bash
git diff --check
rg -n "password|secret|psk|ssid" backend/.env esplink-firmware/main/local_wifi_config.h 2>/dev/null
```

Expected: `git diff --check` exits `0`. The second command should not find committed secret files because `backend/.env` and `local_wifi_config.h` must remain untracked.

- [ ] **Step 4: Review changed files**

Run:

```bash
git status --short
git log --oneline -8
```

Expected: only intentional changes remain, or the working tree is clean if every task committed successfully.

## Self-Review

- Spec coverage: signed boot registration is covered by Tasks 1-3; OTA SHA256 enforcement by Task 4; repo-local environment by Tasks 5-6; hardware regression by Task 7; verification by Task 8.
- Placeholder scan: this plan intentionally contains no placeholder markers.
- Type consistency: firmware helper names are introduced in Task 2 and used unchanged in Task 3; backend environment variable names match existing `process.env` references.
