#include "app_ota.h"
#include "app_device.h"
#include "esp_https_ota.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "cJSON.h"
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define TAG          "app_ota"
#define RESP_BUF_LEN 1024

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
        .size_bytes = 0,
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

    if (update->version && update->version[0] &&
        !update->force &&
        !version_newer(update->version, app_device_get_firmware_version())) {
        ESP_LOGI(TAG, "OTA target %s is not newer than current %s",
                 update->version,
                 app_device_get_firmware_version());
        return ESP_ERR_NOT_FOUND;
    }

    log_update_metadata(update);
    esp_https_ota_config_t ota_cfg = {
        .http_config = &(esp_http_client_config_t){
            .url                     = update->url,
            .transport_type          = transport_for_url(update->url),
            .skip_cert_common_name_check = false,
        },
    };

    esp_err_t err = esp_https_ota(&ota_cfg);
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "OTA success, restarting");
        esp_restart();
    } else {
        ESP_LOGE(TAG, "OTA failed: %s", esp_err_to_name(err));
    }
    return err;
}

esp_err_t app_ota_upgrade_from_url(const char *fw_url)
{
    app_ota_update_t update = {
        .url = fw_url,
        .version = NULL,
        .sha256 = NULL,
        .size_bytes = 0,
        .force = true,
    };
    return app_ota_upgrade(&update);
}
