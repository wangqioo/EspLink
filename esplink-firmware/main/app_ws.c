#include "app_ws.h"
#include "app_device.h"
#include "board_config.h"
#include "esp_websocket_client.h"
#include "esp_log.h"
#include "cJSON.h"
#include <string.h>
#include <stdio.h>

#define TAG "app_ws"

static esp_websocket_client_handle_t s_client;
static ws_callbacks_t                s_cbs;
static bool                          s_connected;

static void send_hello(void)
{
    cJSON *root = cJSON_CreateObject();
    cJSON_AddStringToObject(root, "type",             "hello");
    cJSON_AddNumberToObject(root, "version",          1);
    cJSON_AddStringToObject(root, "mac",              app_device_get_mac_str());
    cJSON_AddStringToObject(root, "sn",               app_device_get_sn());
    cJSON_AddStringToObject(root, "board_type",       BOARD_TYPE);
    cJSON_AddStringToObject(root, "firmware_version", BOARD_FIRMWARE_VERSION);

    // 设备能力描述：云端和小程序据此路由功能页
    cJSON *caps = cJSON_Parse(BOARD_CAPABILITIES_JSON);
    if (caps) {
        cJSON_AddItemToObject(root, "capabilities", caps);
    }

    char *str = cJSON_PrintUnformatted(root);
    esp_websocket_client_send_text(s_client, str, strlen(str), portMAX_DELAY);
    ESP_LOGI(TAG, "sent hello: board=%s fw=%s", BOARD_TYPE, BOARD_FIRMWARE_VERSION);
    free(str);
    cJSON_Delete(root);
}

static void ws_event_handler(void *arg, esp_event_base_t base,
                              int32_t event_id, void *event_data)
{
    esp_websocket_event_data_t *data = (esp_websocket_event_data_t *)event_data;

    switch (event_id) {
    case WEBSOCKET_EVENT_CONNECTED:
        ESP_LOGI(TAG, "WebSocket connected");
        s_connected = true;
        send_hello();
        if (s_cbs.on_connected) s_cbs.on_connected();
        break;

    case WEBSOCKET_EVENT_DISCONNECTED:
        ESP_LOGW(TAG, "WebSocket disconnected");
        s_connected = false;
        if (s_cbs.on_disconnected) s_cbs.on_disconnected();
        break;

    case WEBSOCKET_EVENT_DATA:
        if (data->op_code == 0x02) {
            // 二进制帧：下行音频
            if (s_cbs.on_audio) {
                s_cbs.on_audio((const uint8_t *)data->data_ptr, data->data_len);
            }
        } else if (data->op_code == 0x01 && data->data_len > 0) {
            // 文本帧：JSON 消息
            char *buf = malloc(data->data_len + 1);
            if (buf) {
                memcpy(buf, data->data_ptr, data->data_len);
                buf[data->data_len] = '\0';
                if (s_cbs.on_json) s_cbs.on_json(buf);
                free(buf);
            }
        }
        break;

    case WEBSOCKET_EVENT_ERROR:
        ESP_LOGE(TAG, "WebSocket error");
        break;

    default:
        break;
    }
}

esp_err_t app_ws_init(const char *url, const char *token,
                      const ws_callbacks_t *cbs)
{
    memcpy(&s_cbs, cbs, sizeof(ws_callbacks_t));
    s_connected = false;

    // 拼接 Authorization header
    char auth_header[320];
    snprintf(auth_header, sizeof(auth_header), "Authorization: Bearer %s", token);

    esp_websocket_client_config_t cfg = {
        .uri                = url,
        .headers            = auth_header,
        .reconnect_timeout_ms = 5000,
        .network_timeout_ms   = 10000,
        .ping_interval_sec    = 30,
    };

    s_client = esp_websocket_client_init(&cfg);
    if (!s_client) return ESP_FAIL;

    esp_websocket_register_events(s_client, WEBSOCKET_EVENT_ANY,
                                  ws_event_handler, NULL);
    return esp_websocket_client_start(s_client);
}

esp_err_t app_ws_send_audio(const uint8_t *data, size_t len)
{
    if (!s_connected) return ESP_ERR_INVALID_STATE;
    int sent = esp_websocket_client_send_bin(s_client,
                                             (const char *)data, len,
                                             pdMS_TO_TICKS(1000));
    return (sent >= 0) ? ESP_OK : ESP_FAIL;
}

esp_err_t app_ws_send_json(const char *json)
{
    if (!s_connected) return ESP_ERR_INVALID_STATE;
    int sent = esp_websocket_client_send_text(s_client, json, strlen(json),
                                              pdMS_TO_TICKS(1000));
    return (sent >= 0) ? ESP_OK : ESP_FAIL;
}

void app_ws_stop(void)
{
    if (s_client) {
        esp_websocket_client_stop(s_client);
        esp_websocket_client_destroy(s_client);
        s_client = NULL;
    }
}
