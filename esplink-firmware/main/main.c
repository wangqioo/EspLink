#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_http_client.h"
#include "cJSON.h"
#include <string.h>
#include <stdio.h>

#include "app_nvs.h"
#include "app_device.h"
#include "app_blufi.h"
#include "app_wifi.h"
#include "app_ws.h"
#include "app_ota.h"
#include "app_button.h"

#define TAG "main"

#define FACTORY_RESET_GPIO  0
#define ACTIVATION_URL      "https://your-server.com/api/v1/device/activate"
#define OTA_CHECK_URL       "https://your-server.com/ota/check"

// ---------- 状态机 ----------

typedef enum {
    STATE_STARTING = 0,
    STATE_PROVISIONING,
    STATE_WIFI_CONNECTING,
    STATE_ACTIVATING,
    STATE_ONLINE,
    STATE_UPGRADING,
    STATE_FATAL_ERROR,
} device_state_t;

static volatile device_state_t s_state               = STATE_STARTING;
static volatile bool           s_act_started          = false;
static volatile bool           s_prov_waiting_wifi    = false;

static void set_state(device_state_t next)
{
    ESP_LOGI(TAG, "state %d -> %d", (int)s_state, (int)next);
    s_state = next;
}

// ---------- WebSocket 回调（占位，接入音频模块时补充） ----------

static void on_ws_connected(void)    { ESP_LOGI(TAG, "server connected"); }
static void on_ws_disconnected(void) { ESP_LOGW(TAG, "server disconnected"); }
static void on_ws_audio(const uint8_t *data, size_t len)
{
    // TODO: 送入音频解码/播放模块
    (void)data; (void)len;
}
static void on_ws_json(const char *json)
{
    ESP_LOGI(TAG, "server msg: %s", json);
    // TODO: 解析 type 字段，处理 OTA 触发、配置更新等
}

static void connect_to_server(void)
{
    char ws_url[256] = {0};
    char token[256]  = {0};
    app_nvs_get_ws_url(ws_url, sizeof(ws_url));
    app_nvs_get_token(token, sizeof(token));

    ws_callbacks_t cbs = {
        .on_connected    = on_ws_connected,
        .on_disconnected = on_ws_disconnected,
        .on_audio        = on_ws_audio,
        .on_json         = on_ws_json,
    };
    if (app_ws_init(ws_url, token, &cbs) != ESP_OK) {
        ESP_LOGE(TAG, "WebSocket init failed");
        set_state(STATE_FATAL_ERROR);
    }
}

// ---------- 激活 ----------

static char s_act_resp[512];
static int  s_act_resp_len;

static esp_err_t act_http_event(esp_http_client_event_t *evt)
{
    if (evt->event_id == HTTP_EVENT_ON_DATA) {
        int copy = evt->data_len;
        if (s_act_resp_len + copy >= (int)sizeof(s_act_resp) - 1)
            copy = (int)sizeof(s_act_resp) - 1 - s_act_resp_len;
        memcpy(s_act_resp + s_act_resp_len, evt->data, copy);
        s_act_resp_len += copy;
    }
    return ESP_OK;
}

static void activate_task(void *arg)
{
    ESP_LOGI(TAG, "activating: mac=%s sn=%s",
             app_device_get_mac_str(), app_device_get_sn());

    char body[256];
    snprintf(body, sizeof(body),
             "{\"mac\":\"%s\",\"sn\":\"%s\",\"firmware_version\":\"%s\"}",
             app_device_get_mac_str(),
             app_device_get_sn(),
             app_device_get_firmware_version());

    memset(s_act_resp, 0, sizeof(s_act_resp));
    s_act_resp_len = 0;

    esp_http_client_config_t cfg = {
        .url           = ACTIVATION_URL,
        .event_handler = act_http_event,
        .method        = HTTP_METHOD_POST,
    };
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_post_field(client, body, strlen(body));

    esp_err_t err = esp_http_client_perform(client);
    int status    = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);

    if (err != ESP_OK || status != 200) {
        ESP_LOGE(TAG, "activation failed: err=%s status=%d",
                 esp_err_to_name(err), status);
        set_state(STATE_FATAL_ERROR);
        vTaskDelete(NULL);
        return;
    }

    cJSON *root    = cJSON_Parse(s_act_resp);
    const char *token  = cJSON_GetStringValue(cJSON_GetObjectItem(root, "token"));
    const char *ws_url = cJSON_GetStringValue(cJSON_GetObjectItem(root, "ws_url"));

    if (!token || !ws_url) {
        ESP_LOGE(TAG, "activation response missing token or ws_url");
        cJSON_Delete(root);
        set_state(STATE_FATAL_ERROR);
        vTaskDelete(NULL);
        return;
    }

    app_nvs_set_token(token);
    app_nvs_set_ws_url(ws_url);
    ESP_LOGI(TAG, "activation success");
    cJSON_Delete(root);

    set_state(STATE_ONLINE);
    connect_to_server();
    vTaskDelete(NULL);
}

// ---------- 配网 / WiFi / 按键回调 ----------

static void on_prov_done(const char *ssid, const char *password)
{
    ESP_LOGI(TAG, "prov done, ssid=%s", ssid);
    app_nvs_set_wifi(ssid, password);
    // 不立刻停 BLE，等 WiFi 实际连上后再通知手机并停 BLE
    s_prov_waiting_wifi = true;
    set_state(STATE_WIFI_CONNECTING);
    app_wifi_connect(ssid, password);
}

static void on_wifi_connected(void)
{
    if (s_state != STATE_WIFI_CONNECTING) return;

    if (s_prov_waiting_wifi) {
        s_prov_waiting_wifi = false;
        app_blufi_notify_wifi_result(true);  // 发成功通知，500ms 后停 BLE
    }

    if (app_nvs_has_token()) {
        set_state(STATE_ONLINE);
        connect_to_server();
    } else {
        set_state(STATE_ACTIVATING);
    }
}

static void on_wifi_disconnected(void)
{
    if (s_prov_waiting_wifi) {
        // 配网期间 WiFi 连不上，通知手机失败，重新开始配网
        s_prov_waiting_wifi = false;
        app_blufi_notify_wifi_result(false);
        set_state(STATE_PROVISIONING);
        app_blufi_start(on_prov_done);
        return;
    }

    ESP_LOGW(TAG, "WiFi disconnected");
    if (s_state == STATE_ONLINE) {
        app_ws_stop();
        set_state(STATE_FATAL_ERROR);
    }
}

static void on_factory_reset(void)
{
    ESP_LOGW(TAG, "factory reset");
    app_ws_stop();
    app_nvs_factory_reset();
    esp_restart();
}

// ---------- app_main ----------

void app_main(void)
{
    ESP_LOGI(TAG, "=== device boot ===");

    ESP_ERROR_CHECK(app_nvs_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    ESP_ERROR_CHECK(app_wifi_init(on_wifi_connected, on_wifi_disconnected));
    ESP_ERROR_CHECK(app_device_init());
    ESP_ERROR_CHECK(app_button_init(FACTORY_RESET_GPIO, on_factory_reset));

    set_state(STATE_STARTING);

    if (app_nvs_has_wifi()) {
        char ssid[64] = {0}, pass[64] = {0};
        app_nvs_get_wifi(ssid, sizeof(ssid), pass, sizeof(pass));
        ESP_LOGI(TAG, "saved wifi: \"%s\", connecting", ssid);
        set_state(STATE_WIFI_CONNECTING);
        app_wifi_connect(ssid, pass);
    } else {
        ESP_LOGI(TAG, "no wifi credentials, starting BLE provisioning");
        set_state(STATE_PROVISIONING);
        app_blufi_start(on_prov_done);
    }

    while (1) {
        if (s_state == STATE_ACTIVATING && !s_act_started) {
            s_act_started = true;
            xTaskCreate(activate_task, "activate", 6144, NULL, 5, NULL);
        }

        if (s_state == STATE_FATAL_ERROR) {
            ESP_LOGE(TAG, "fatal error, restarting in 5s");
            vTaskDelay(pdMS_TO_TICKS(5000));
            esp_restart();
        }

        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}
