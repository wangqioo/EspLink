#include "app_ota.h"
#include "app_boot_signing.h"
#include "app_device.h"
#include "board_config.h"
#include "esp_crt_bundle.h"
#include "esp_https_ota.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "esp_partition.h"
#include "cJSON.h"
#include "mbedtls/sha256.h"
#include "sdkconfig.h"
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define TAG          "app_ota"
#define RESP_BUF_LEN 1024
#define SHA_READ_CHUNK 4096

static char s_resp_buf[RESP_BUF_LEN];
static int  s_resp_len;

static esp_err_t http_event_handler(esp_http_client_event_t *evt)
{
    if (evt->event_id == HTTP_EVENT_ON_DATA) {
        int copy = evt->data_len;
        if (s_resp_len + copy >= RESP_BUF_LEN - 1)
            copy = RESP_BUF_LEN - 1 - s_resp_len;
        memcpy(s_resp_buf + s_resp_len, evt->data, copy);
        s_resp_len += copy;
    }
    return ESP_OK;
}

// 简单语义版本比较："1.0.1" > "1.0.0" 返回 true
static bool version_newer(const char *remote, const char *current)
{
    int rv[3] = {0}, cv[3] = {0};
    sscanf(remote,  "%d.%d.%d", &rv[0], &rv[1], &rv[2]);
    sscanf(current, "%d.%d.%d", &cv[0], &cv[1], &cv[2]);
    for (int i = 0; i < 3; i++) {
        if (rv[i] > cv[i]) return true;
        if (rv[i] < cv[i]) return false;
    }
    return false;
}

static bool is_http_url(const char *url)
{
    return url && strncmp(url, "http://", 7) == 0;
}

static bool is_https_url(const char *url)
{
    return url && strncmp(url, "https://", 8) == 0;
}

static esp_http_client_transport_t transport_for_url(const char *url)
{
    return is_http_url(url) ? HTTP_TRANSPORT_OVER_TCP : HTTP_TRANSPORT_OVER_SSL;
}

static const char *default_result_url(void)
{
    static char url[256];
    const char *check_url = CONFIG_ESPLINK_BOOT_REGISTER_URL;
    const char *check_suffix = "/api/ota/check";
    const char *result_suffix = "/api/ota/result";
    size_t check_len = strlen(check_url);
    size_t suffix_len = strlen(check_suffix);

    if (check_len >= suffix_len &&
        strcmp(check_url + check_len - suffix_len, check_suffix) == 0) {
        size_t prefix_len = check_len - suffix_len;
        if (prefix_len + strlen(result_suffix) < sizeof(url)) {
            memcpy(url, check_url, prefix_len);
            strcpy(url + prefix_len, result_suffix);
            return url;
        }
    }

    return NULL;
}

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

esp_err_t app_ota_mark_running_valid(void)
{
    const esp_partition_t *running = esp_ota_get_running_partition();
    if (!running) {
        ESP_LOGE(TAG, "unable to locate running partition for OTA validation");
        return ESP_ERR_NOT_FOUND;
    }

    esp_ota_img_states_t state;
    esp_err_t err = esp_ota_get_state_partition(running, &state);
    if (err == ESP_ERR_NOT_SUPPORTED || err == ESP_ERR_NOT_FOUND) {
        return ESP_OK;
    }
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "failed to read running OTA state: %s", esp_err_to_name(err));
        return err;
    }

    if (state != ESP_OTA_IMG_PENDING_VERIFY) {
        return ESP_OK;
    }

    err = esp_ota_mark_app_valid_cancel_rollback();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "failed to mark OTA app valid: %s", esp_err_to_name(err));
        return err;
    }

    ESP_LOGI(TAG, "OTA app marked valid");
    return ESP_OK;
}

static esp_err_t verify_boot_partition_artifact_sha256(const char *expected_sha256, int size_bytes)
{
    if (!expected_sha256 || !expected_sha256[0]) {
        return ESP_OK;
    }

    if (size_bytes <= 0) {
        ESP_LOGE(TAG, "OTA sha256 metadata requires positive size_bytes");
        return ESP_ERR_INVALID_ARG;
    }

    const esp_partition_t *partition = esp_ota_get_boot_partition();
    if (!partition) {
        ESP_LOGE(TAG, "unable to locate configured OTA boot partition for SHA256 verification");
        return ESP_ERR_NOT_FOUND;
    }

    if ((size_t)size_bytes > partition->size) {
        ESP_LOGE(TAG, "OTA size %d exceeds boot partition size %u",
                 size_bytes,
                 (unsigned int)partition->size);
        return ESP_ERR_INVALID_SIZE;
    }

    uint8_t *buf = malloc(SHA_READ_CHUNK);
    if (!buf) {
        return ESP_ERR_NO_MEM;
    }

    uint8_t digest[32];
    mbedtls_sha256_context ctx;
    mbedtls_sha256_init(&ctx);

    int rc = mbedtls_sha256_starts(&ctx, 0);
    esp_err_t err = ESP_OK;
    if (rc != 0) {
        err = ESP_FAIL;
        goto cleanup;
    }

    size_t remaining = (size_t)size_bytes;
    size_t offset = 0;
    while (remaining > 0) {
        size_t to_read = remaining > SHA_READ_CHUNK ? SHA_READ_CHUNK : remaining;
        err = esp_partition_read(partition, offset, buf, to_read);
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "failed to read OTA partition bytes: %s", esp_err_to_name(err));
            goto cleanup;
        }

        rc = mbedtls_sha256_update(&ctx, buf, to_read);
        if (rc != 0) {
            err = ESP_FAIL;
            goto cleanup;
        }

        offset += to_read;
        remaining -= to_read;
    }

    rc = mbedtls_sha256_finish(&ctx, digest);
    if (rc != 0) {
        err = ESP_FAIL;
        goto cleanup;
    }

    char actual[65];
    bytes_to_hex(digest, sizeof(digest), actual, sizeof(actual));
    if (strcasecmp(actual, expected_sha256) != 0) {
        ESP_LOGE(TAG, "OTA SHA256 mismatch expected=%s actual=%s", expected_sha256, actual);
        err = ESP_ERR_INVALID_CRC;
        goto cleanup;
    }

    ESP_LOGI(TAG, "OTA artifact SHA256 verified %.16s...", actual);

cleanup:
    mbedtls_sha256_free(&ctx);
    free(buf);
    return err;
}

static void log_update_metadata(const app_ota_update_t *update)
{
    ESP_LOGI(TAG, "OTA target url=%s", update->url);
    ESP_LOGI(TAG, "OTA target version=%s force=%d size=%d",
             update->version ? update->version : "(unknown)",
             update->force,
             update->size_bytes);
    if (update->sha256 && update->sha256[0]) {
        ESP_LOGI(TAG, "OTA target sha256 %.16s...", update->sha256);
    }
}

static void restore_running_partition_for_failed_ota(void)
{
    const esp_partition_t *running = esp_ota_get_running_partition();
    if (!running) {
        ESP_LOGE(TAG, "unable to locate running partition after OTA integrity failure");
        return;
    }

    esp_err_t err = esp_ota_set_boot_partition(running);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "failed to restore running partition as boot target: %s",
                 esp_err_to_name(err));
        return;
    }

    ESP_LOGW(TAG, "restored running partition as boot target after OTA integrity failure");
}

static esp_err_t app_ota_report_result(const app_ota_update_t *update,
                                       const char *status,
                                       const char *error_code,
                                       const char *error_message)
{
    const char *url = update && update->result_url && update->result_url[0]
        ? update->result_url
        : default_result_url();
    if (!url || !status) {
        return ESP_ERR_INVALID_ARG;
    }

#if CONFIG_ESPLINK_PRODUCTION_TRANSPORT
    if (!is_https_url(url)) {
        ESP_LOGE(TAG, "production transport requires HTTPS OTA result url: %s", url);
        return ESP_ERR_INVALID_ARG;
    }
#endif

    char body[768];
    int written = snprintf(body,
                           sizeof(body),
                           "{\"mac\":\"%s\",\"sn\":\"%s\",\"board_type\":\"%s\","
                           "\"from_version\":\"%s\",\"target_version\":\"%s\","
                           "\"status\":\"%s\",\"release_id\":%d,\"bytes_written\":%d",
                           app_device_get_mac_str(),
                           app_device_get_sn(),
                           BOARD_TYPE,
                           app_device_get_firmware_version(),
                           update && update->version ? update->version : "",
                           status,
                           update ? update->release_id : 0,
                           update ? update->size_bytes : 0);
    if (written < 0 || written >= (int)sizeof(body)) {
        return ESP_ERR_NO_MEM;
    }

    size_t used = strlen(body);
    if (error_code && error_code[0]) {
        written = snprintf(body + used,
                           sizeof(body) - used,
                           ",\"error_code\":\"%s\"",
                           error_code);
        if (written < 0 || written >= (int)(sizeof(body) - used)) {
            return ESP_ERR_NO_MEM;
        }
        used = strlen(body);
    }

    if (error_message && error_message[0]) {
        written = snprintf(body + used,
                           sizeof(body) - used,
                           ",\"error_message\":\"%s\"",
                           error_message);
        if (written < 0 || written >= (int)(sizeof(body) - used)) {
            return ESP_ERR_NO_MEM;
        }
        used = strlen(body);
    }

    if (used + 2 > sizeof(body)) {
        return ESP_ERR_NO_MEM;
    }
    body[used++] = '}';
    body[used] = '\0';

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
            ESP_LOGE(TAG, "failed to append OTA result signature: %s", esp_err_to_name(sign_err));
            return sign_err;
        }
        ESP_LOGI(TAG, "OTA result signature enabled nonce=%s", nonce);
    } else if (sign_err == ESP_ERR_NOT_FOUND) {
        ESP_LOGD(TAG, "OTA result signature disabled for development");
    } else {
        ESP_LOGE(TAG, "OTA result signature failed: %s", esp_err_to_name(sign_err));
        return sign_err;
    }

    esp_http_client_config_t cfg = {
        .url = url,
        .transport_type = transport_for_url(url),
        .crt_bundle_attach = esp_crt_bundle_attach,
        .skip_cert_common_name_check = false,
    };
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    if (!client) {
        return ESP_FAIL;
    }

    esp_http_client_set_method(client, HTTP_METHOD_POST);
    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_post_field(client, body, strlen(body));
    esp_err_t err = esp_http_client_perform(client);
    int http_status = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);

    if (err != ESP_OK || http_status < 200 || http_status >= 300) {
        ESP_LOGW(TAG, "OTA result report failed: %s status=%d",
                 esp_err_to_name(err),
                 http_status);
        return err == ESP_OK ? ESP_FAIL : err;
    }

    ESP_LOGI(TAG, "OTA result reported: %s", status);
    return ESP_OK;
}

esp_err_t app_ota_check_and_upgrade(const char *check_url)
{
    memset(s_resp_buf, 0, sizeof(s_resp_buf));
    s_resp_len = 0;

    esp_http_client_config_t cfg = {
        .url            = check_url,
        .event_handler  = http_event_handler,
        .transport_type = HTTP_TRANSPORT_OVER_TCP,
        .skip_cert_common_name_check = false,
    };

    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    esp_http_client_set_method(client, HTTP_METHOD_GET);
    esp_http_client_set_header(client, "Device-ID",
                               app_device_get_mac_str());
    esp_http_client_set_header(client, "Device-SN",
                               app_device_get_sn());
    esp_http_client_set_header(client, "Firmware-Version",
                               app_device_get_firmware_version());

    esp_err_t err = esp_http_client_perform(client);
    esp_http_client_cleanup(client);

    if (err != ESP_OK) {
        ESP_LOGE(TAG, "OTA check request failed: %s", esp_err_to_name(err));
        return err;
    }

    // 解析响应：{"version":"x.y.z","url":"https://..."}
    cJSON *root = cJSON_Parse(s_resp_buf);
    if (!root) {
        ESP_LOGE(TAG, "OTA response parse failed");
        return ESP_ERR_INVALID_RESPONSE;
    }

    cJSON *firmware = cJSON_GetObjectItem(root, "firmware");
    const char *remote_ver = NULL;
    const char *fw_url     = NULL;

    if (firmware) {
        remote_ver = cJSON_GetStringValue(cJSON_GetObjectItem(firmware, "version"));
        fw_url     = cJSON_GetStringValue(cJSON_GetObjectItem(firmware, "url"));
    }

    if (!remote_ver || !fw_url) {
        ESP_LOGI(TAG, "no firmware info in response");
        cJSON_Delete(root);
        return ESP_ERR_NOT_FOUND;
    }

    if (!version_newer(remote_ver, app_device_get_firmware_version())) {
        ESP_LOGI(TAG, "firmware up to date (%s)", app_device_get_firmware_version());
        cJSON_Delete(root);
        return ESP_ERR_NOT_FOUND;
    }

    char *remote_ver_copy = strdup(remote_ver);
    char *fw_url_copy = strdup(fw_url);
    if (!remote_ver_copy || !fw_url_copy) {
        free(remote_ver_copy);
        free(fw_url_copy);
        cJSON_Delete(root);
        return ESP_ERR_NO_MEM;
    }

    ESP_LOGI(TAG, "new firmware %s, downloading from %s", remote_ver_copy, fw_url_copy);

    app_ota_update_t update = {
        .url = fw_url_copy,
        .version = remote_ver_copy,
        .sha256 = NULL,
        .result_url = NULL,
        .size_bytes = 0,
        .release_id = 0,
        .force = false,
    };
    cJSON_Delete(root);
    err = app_ota_upgrade(&update);
    free(remote_ver_copy);
    free(fw_url_copy);
    return err;
}

esp_err_t app_ota_upgrade(const app_ota_update_t *update)
{
    if (!update || !update->url || !update->url[0]) {
        ESP_LOGE(TAG, "OTA update missing url");
        return ESP_ERR_INVALID_ARG;
    }

    if (!is_http_url(update->url) && !is_https_url(update->url)) {
        ESP_LOGE(TAG, "unsupported OTA url scheme: %s", update->url);
        return ESP_ERR_INVALID_ARG;
    }

    if (!valid_sha256_hex(update->sha256)) {
        ESP_LOGE(TAG, "invalid OTA sha256 metadata");
        return ESP_ERR_INVALID_ARG;
    }

    if (update->sha256 && update->sha256[0] && update->size_bytes <= 0) {
        ESP_LOGE(TAG, "OTA sha256 metadata missing positive size_bytes");
        return ESP_ERR_INVALID_ARG;
    }

#if CONFIG_ESPLINK_PRODUCTION_TRANSPORT
    if (!is_https_url(update->url)) {
        ESP_LOGE(TAG, "production transport requires HTTPS OTA url: %s", update->url);
        return ESP_ERR_INVALID_ARG;
    }
#endif

    if (update->version && update->version[0] &&
        !update->force &&
        !version_newer(update->version, app_device_get_firmware_version())) {
        ESP_LOGI(TAG, "OTA target %s is not newer than current %s",
                 update->version,
                 app_device_get_firmware_version());
        return ESP_ERR_NOT_FOUND;
    }

    log_update_metadata(update);
    app_ota_report_result(update, "started", NULL, NULL);
    esp_https_ota_config_t ota_cfg = {
        .http_config = &(esp_http_client_config_t){
            .url                     = update->url,
            .transport_type          = transport_for_url(update->url),
            .crt_bundle_attach       = esp_crt_bundle_attach,
            .skip_cert_common_name_check = false,
        },
    };

    esp_err_t err = esp_https_ota(&ota_cfg);
    if (err == ESP_OK) {
        err = verify_boot_partition_artifact_sha256(update->sha256, update->size_bytes);
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "OTA integrity verification failed: %s", esp_err_to_name(err));
            restore_running_partition_for_failed_ota();
            app_ota_report_result(update, "sha_mismatch", "sha_mismatch", esp_err_to_name(err));
            return err;
        }
        ESP_LOGI(TAG, "OTA success, restarting");
        app_ota_report_result(update, "success", NULL, NULL);
        esp_restart();
    } else {
        ESP_LOGE(TAG, "OTA failed: %s", esp_err_to_name(err));
        app_ota_report_result(update, "download_failed", "download_failed", esp_err_to_name(err));
    }
    return err;
}

esp_err_t app_ota_upgrade_from_url(const char *fw_url)
{
    app_ota_update_t update = {
        .url = fw_url,
        .version = NULL,
        .sha256 = NULL,
        .result_url = NULL,
        .size_bytes = 0,
        .release_id = 0,
        .force = true,
    };
    return app_ota_upgrade(&update);
}
