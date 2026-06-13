#include "app_ws.h"
#include "app_device.h"
#include "board_config.h"
#include "esp_websocket_client.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "cJSON.h"
#include <string.h>
#include <stdio.h>

#define TAG "app_ws"
#define WS_APP_PING_INTERVAL_MS 30000

static esp_websocket_client_handle_t s_client;
static ws_callbacks_t                s_cbs;
static bool                          s_connected;
static TaskHandle_t                  s_ping_task;

static void ping_task(void *arg)
{
    (void)arg;
    while (s_client) {
        vTaskDelay(pdMS_TO_TICKS(WS_APP_PING_INTERVAL_MS));
        if (s_client && s_connected) {
            esp_err_t err = app_ws_send_json("{\"type\":\"ping\"}");
            if (err == ESP_OK) {
                ESP_LOGD(TAG, "sent app ping");
            } else {
                ESP_LOGW(TAG, "app ping failed: %s", esp_err_to_name(err));
            }
        }
    }
    s_ping_task = NULL;
    vTaskDelete(NULL);
}

static void ensure_ping_task(void)
{
    if (s_ping_task) return;
    BaseType_t ok = xTaskCreate(ping_task, "ws_app_ping", 3072, NULL, 5, &s_ping_task);
    if (ok != pdPASS) {
        ESP_LOGE(TAG, "failed to create app ping task");
        s_ping_task = NULL;
    }
}

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
        ensure_ping_task();
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
    ESP_LOGI(TAG, "connecting to %s", url);

    // 拼接 Authorization header
    char auth_header[320];
    snprintf(auth_header, sizeof(auth_header), "Authorization: Bearer %s\r\n", token);

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
        s_connected = false;
        esp_websocket_client_stop(s_client);
        esp_websocket_client_destroy(s_client);
        s_client = NULL;
    }
}
