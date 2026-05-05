#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_http_client.h"
#include "cJSON.h"
#include <string.h>
#include <stdio.h>
#include <stdlib.h>

#include "app_nvs.h"
#include "app_device.h"
#include "app_blufi.h"
#include "app_wifi.h"
#include "app_ws.h"
#include "app_ota.h"
#include "app_button.h"
#include "board_config.h"

#define TAG "main"

#define FACTORY_RESET_GPIO  0

// 启动注册端点：合并了激活 + OTA 检查，设备每次上电请求一次
// 服务端根据 board_type 和 firmware_version 决定是否下发 OTA
#define BOOT_REGISTER_URL   "https://your-server.com/api/ota/check"

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

static volatile device_state_t s_state            = STATE_STARTING;
static volatile bool           s_act_started       = false;
static volatile bool           s_prov_waiting_wifi = false;

static void set_state(device_state_t next)
{
    ESP_LOGI(TAG, "state %d -> %d", (int)s_state, (int)next);
    s_state = next;
}

// ---------- WebSocket 回调 ----------

static void on_ws_connected(void)
{
    ESP_LOGI(TAG, "server connected");
}

static void on_ws_disconnected(void)
{
    ESP_LOGW(TAG, "server disconnected");
}

static void on_ws_audio(const uint8_t *data, size_t len)
{
    // TODO: 送入音频解码/播放模块（Phase 5）
    (void)data; (void)len;
}

// OTA 推送任务：在独立 task 里执行，避免阻塞 WebSocket 事件循环
static void ota_push_task(void *arg)
{
    char *url = (char *)arg;
    ESP_LOGI(TAG, "ota push task: %s", url);
    set_state(STATE_UPGRADING);
    app_ota_upgrade_from_url(url); // 成功时内部 restart，不会返回
    free(url);
    set_state(STATE_FATAL_ERROR);  // 只有升级失败才到这里
    vTaskDelete(NULL);
}

static void on_ws_json(const char *json)
{
    ESP_LOGI(TAG, "server msg: %s", json);

    cJSON *root = cJSON_Parse(json);
    if (!root) return;

    const char *type = cJSON_GetStringValue(cJSON_GetObjectItem(root, "type"));
    if (!type) {
        cJSON_Delete(root);
        return;
    }

    if (strcmp(type, "hello_ack") == 0) {
        // 服务端确认握手，告知绑定状态（供调试用）
        ESP_LOGI(TAG, "hello_ack: is_bound=%d",
                 cJSON_IsTrue(cJSON_GetObjectItem(root, "is_bound")));

    } else if (strcmp(type, "ota_push") == 0) {
        // 云端主动推送 OTA
        const char *url = cJSON_GetStringValue(cJSON_GetObjectItem(root, "url"));
        if (url) {
            char *url_copy = strdup(url);
            xTaskCreate(ota_push_task, "ota_push", 8192, url_copy, 5, NULL);
        }

    } else if (strcmp(type, "command") == 0) {
        // 产品控制指令，payload 格式由各产品自定义
        // TODO: Phase 4 按 BOARD_TYPE 派发到具体处理函数
        ESP_LOGI(TAG, "command received");

    } else if (strcmp(type, "config") == 0) {
        // 云端下发配置更新
        // TODO: Phase 4 解析并写入 NVS
        ESP_LOGI(TAG, "config update received");

    } else {
        ESP_LOGW(TAG, "unknown msg type: %s", type);
    }

    cJSON_Delete(root);
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

// ---------- 启动注册（合并激活 + OTA 检查） ----------

static char s_reg_resp[512];
static int  s_reg_resp_len;

static esp_err_t reg_http_event(esp_http_client_event_t *evt)
{
    if (evt->event_id == HTTP_EVENT_ON_DATA) {
        int copy = evt->data_len;
        if (s_reg_resp_len + copy >= (int)sizeof(s_reg_resp) - 1)
            copy = (int)sizeof(s_reg_resp) - 1 - s_reg_resp_len;
        memcpy(s_reg_resp + s_reg_resp_len, evt->data, copy);
        s_reg_resp_len += copy;
    }
    return ESP_OK;
}

static void boot_register_task(void *arg)
{
    ESP_LOGI(TAG, "boot register: mac=%s sn=%s board=%s fw=%s",
             app_device_get_mac_str(), app_device_get_sn(),
             BOARD_TYPE, BOARD_FIRMWARE_VERSION);

    char body[384];
    snprintf(body, sizeof(body),
             "{\"mac\":\"%s\",\"sn\":\"%s\","
             "\"board_type\":\"%s\",\"firmware_version\":\"%s\"}",
             app_device_get_mac_str(), app_device_get_sn(),
             BOARD_TYPE, BOARD_FIRMWARE_VERSION);

    memset(s_reg_resp, 0, sizeof(s_reg_resp));
    s_reg_resp_len = 0;

    esp_http_client_config_t cfg = {
        .url            = BOOT_REGISTER_URL,
        .event_handler  = reg_http_event,
        .method         = HTTP_METHOD_POST,
        .transport_type = HTTP_TRANSPORT_OVER_SSL,
    };
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_post_field(client, body, strlen(body));

    esp_err_t err = esp_http_client_perform(client);
    int status    = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);

    if (err != ESP_OK || status != 200) {
        ESP_LOGE(TAG, "boot register failed: %s status=%d",
                 esp_err_to_name(err), status);
        set_state(STATE_FATAL_ERROR);
        vTaskDelete(NULL);
        return;
    }

    cJSON *root = cJSON_Parse(s_reg_resp);
    if (!root) {
        ESP_LOGE(TAG, "boot register response parse failed");
        set_state(STATE_FATAL_ERROR);
        vTaskDelete(NULL);
        return;
    }

    // 1. 服务端如果在响应里包含 ota 对象，说明有固件更新，优先处理
    cJSON *ota_obj = cJSON_GetObjectItem(root, "ota");
    if (ota_obj) {
        const char *ota_url = cJSON_GetStringValue(
                                  cJSON_GetObjectItem(ota_obj, "url"));
        if (ota_url) {
            ESP_LOGI(TAG, "OTA available, upgrading...");
            cJSON_Delete(root);
            set_state(STATE_UPGRADING);
            app_ota_upgrade_from_url(ota_url); // 成功时内部 restart
            set_state(STATE_FATAL_ERROR);       // 升级失败才到这里
            vTaskDelete(NULL);
            return;
        }
    }

    // 2. 存储 token 和 websocket_url
    const char *token  = cJSON_GetStringValue(
                             cJSON_GetObjectItem(root, "token"));
    const char *ws_url = cJSON_GetStringValue(
                             cJSON_GetObjectItem(root, "websocket_url"));

    if (!token || !ws_url) {
        ESP_LOGE(TAG, "boot register: missing token or websocket_url");
        cJSON_Delete(root);
        set_state(STATE_FATAL_ERROR);
        vTaskDelete(NULL);
        return;
    }

    app_nvs_set_token(token);
    app_nvs_set_ws_url(ws_url);
    ESP_LOGI(TAG, "boot register ok, is_bound=%d",
             cJSON_IsTrue(cJSON_GetObjectItem(root, "is_bound")));
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
    s_prov_waiting_wifi = true;
    set_state(STATE_WIFI_CONNECTING);
    app_wifi_connect(ssid, password);
}

static void on_wifi_connected(void)
{
    if (s_state != STATE_WIFI_CONNECTING) return;

    if (s_prov_waiting_wifi) {
        s_prov_waiting_wifi = false;
        app_blufi_notify_wifi_result(true);
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
    ESP_LOGI(TAG, "=== device boot: board=%s fw=%s ===",
             BOARD_TYPE, BOARD_FIRMWARE_VERSION);

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
            xTaskCreate(boot_register_task, "boot_reg", 6144, NULL, 5, NULL);
        }

        if (s_state == STATE_FATAL_ERROR) {
            ESP_LOGE(TAG, "fatal error, restarting in 5s");
            vTaskDelay(pdMS_TO_TICKS(5000));
            esp_restart();
        }

        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}
