#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_http_client.h"
#include "sdkconfig.h"
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
#include "app_cube_demo.h"
#include "app_boot_signing.h"
#include "board_config.h"

#if CONFIG_ESPLINK_TEST_AUTO_WIFI
#include "local_wifi_config.h"
#endif

#define TAG "main"

#define FACTORY_RESET_GPIO  0

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

    } else if (strcmp(type, "pong") == 0) {
        // 业务心跳回复
        ESP_LOGD(TAG, "pong");

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

static char *json_strdup(cJSON *object, const char *name)
{
    const char *value = cJSON_GetStringValue(cJSON_GetObjectItem(object, name));
    return value ? strdup(value) : NULL;
}

static void free_ota_update(app_ota_update_t *update)
{
    free((void *)update->url);
    free((void *)update->version);
    free((void *)update->sha256);
    memset(update, 0, sizeof(*update));
}

static bool parse_ota_update(cJSON *ota_obj, app_ota_update_t *update)
{
    if (!ota_obj || !update) return false;
    memset(update, 0, sizeof(*update));

    update->url = json_strdup(ota_obj, "url");
    if (!update->url) {
        free_ota_update(update);
        return false;
    }

    update->version = json_strdup(ota_obj, "version");
    update->sha256 = json_strdup(ota_obj, "sha256");

    cJSON *size = cJSON_GetObjectItem(ota_obj, "size_bytes");
    update->size_bytes = cJSON_IsNumber(size) ? size->valueint : 0;
    update->force = cJSON_IsTrue(cJSON_GetObjectItem(ota_obj, "force"));
    return true;
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

static void start_product_app(void)
{
    esp_err_t err = app_cube_demo_start();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "product app start failed: %s", esp_err_to_name(err));
    }
}

static void apply_test_auto_wifi(void)
{
#if CONFIG_ESPLINK_TEST_AUTO_WIFI
    if (strlen(ESPLINK_LOCAL_WIFI_SSID) == 0) {
        ESP_LOGW(TAG, "test auto WiFi enabled but SSID is empty");
        return;
    }

    ESP_LOGW(TAG, "test auto WiFi enabled, writing local SSID to NVS");
    esp_err_t err = app_nvs_set_wifi(
        ESPLINK_LOCAL_WIFI_SSID,
        ESPLINK_LOCAL_WIFI_PASSWORD
    );
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "failed to write local WiFi credentials: %s",
                 esp_err_to_name(err));
    }
#endif
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

static esp_http_client_transport_t transport_for_url(const char *url)
{
    if (url && strncmp(url, "http://", 7) == 0) {
        return HTTP_TRANSPORT_OVER_TCP;
    }
    return HTTP_TRANSPORT_OVER_SSL;
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

    memset(s_reg_resp, 0, sizeof(s_reg_resp));
    s_reg_resp_len = 0;

    esp_http_client_config_t cfg = {
        .url            = CONFIG_ESPLINK_BOOT_REGISTER_URL,
        .event_handler  = reg_http_event,
        .method         = HTTP_METHOD_POST,
        .transport_type = transport_for_url(CONFIG_ESPLINK_BOOT_REGISTER_URL),
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

    esp_err_t valid_err = app_ota_mark_running_valid();
    if (valid_err != ESP_OK) {
        ESP_LOGE(TAG, "failed to mark OTA app valid: %s", esp_err_to_name(valid_err));
        cJSON_Delete(root);
        set_state(STATE_FATAL_ERROR);
        vTaskDelete(NULL);
        return;
    }

    // 1. 服务端如果在响应里包含 ota 对象，说明有固件更新，优先处理
    cJSON *ota_obj = cJSON_GetObjectItem(root, "ota");
    app_ota_update_t update;
    if (parse_ota_update(ota_obj, &update)) {
        ESP_LOGI(TAG, "OTA available, upgrading...");
        set_state(STATE_UPGRADING);
        esp_err_t ota_err = app_ota_upgrade(&update); // 成功时内部 restart
        free_ota_update(&update);
        if (ota_err == ESP_ERR_NOT_FOUND) {
            ESP_LOGI(TAG, "OTA skipped, continuing boot register");
        } else {
            cJSON_Delete(root);
            ESP_LOGE(TAG, "OTA upgrade failed: %s", esp_err_to_name(ota_err));
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
    start_product_app();
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

    s_act_started = false;
    set_state(STATE_ACTIVATING);
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
    apply_test_auto_wifi();

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
