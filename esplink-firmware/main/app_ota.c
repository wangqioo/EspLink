#include "app_ota.h"
#include "app_device.h"
#include "esp_https_ota.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "cJSON.h"
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

esp_err_t app_ota_check_and_upgrade(const char *check_url)
{
    memset(s_resp_buf, 0, sizeof(s_resp_buf));
    s_resp_len = 0;

    esp_http_client_config_t cfg = {
        .url            = check_url,
        .event_handler  = http_event_handler,
        .transport_type = HTTP_TRANSPORT_OVER_SSL,
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

    ESP_LOGI(TAG, "new firmware %s, downloading from %s", remote_ver, fw_url);
    cJSON_Delete(root);

    esp_https_ota_config_t ota_cfg = {
        .http_config = &(esp_http_client_config_t){
            .url            = fw_url,
            .skip_cert_common_name_check = false,
        },
    };

    err = esp_https_ota(&ota_cfg);
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "OTA success, restarting");
        esp_restart();
    } else {
        ESP_LOGE(TAG, "OTA failed: %s", esp_err_to_name(err));
    }
    return err;
}
