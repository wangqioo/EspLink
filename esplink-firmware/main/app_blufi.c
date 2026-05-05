#include "app_blufi.h"
#include "app_device.h"
#include "esp_blufi_api.h"
#include "esp_blufi.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/timers.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "host/ble_hs.h"
#include "host/util/util.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"
#include <string.h>

#define TAG             "app_blufi"
#define PROV_TIMEOUT_MS (10 * 60 * 1000)

static blufi_prov_done_cb_t s_on_done;
static TimerHandle_t        s_timeout_timer;
static char                 s_ssid[64];
static char                 s_password[64];
static bool                 s_got_ssid;
static bool                 s_got_pass;

// ---------- NimBLE host task ----------

static void ble_host_task(void *param)
{
    nimble_port_run();
    nimble_port_freertos_deinit();
}

// ---------- BluFi 同步回调（BLE 就绪后启动配网广播） ----------

static void blufi_on_sync(void)
{
    esp_blufi_profile_init();
    esp_blufi_adv_start_with_name(app_device_get_ble_name());
    ESP_LOGI(TAG, "BLE advertising as \"%s\"", app_device_get_ble_name());
}

static void blufi_on_reset(int reason)
{
    ESP_LOGW(TAG, "BLE reset, reason=%d", reason);
}

// ---------- 超时 ----------

static void timeout_cb(TimerHandle_t xTimer)
{
    ESP_LOGW(TAG, "provisioning timeout, stopping BLE");
    app_blufi_stop();
}

// ---------- BluFi 事件回调 ----------

static void blufi_event_cb(esp_blufi_cb_event_t event, esp_blufi_cb_param_t *param)
{
    switch (event) {
    case ESP_BLUFI_EVENT_BLE_CONNECT:
        ESP_LOGI(TAG, "phone connected, stop advertising");
        esp_blufi_adv_stop();
        break;

    case ESP_BLUFI_EVENT_BLE_DISCONNECT:
        ESP_LOGI(TAG, "phone disconnected");
        if (!s_got_ssid) {
            esp_blufi_adv_start_with_name(app_device_get_ble_name());
        }
        break;

    case ESP_BLUFI_EVENT_RECV_STA_SSID:
        if (param->sta_ssid.ssid_len > 0 &&
            param->sta_ssid.ssid_len < sizeof(s_ssid)) {
            memcpy(s_ssid, param->sta_ssid.ssid, param->sta_ssid.ssid_len);
            s_ssid[param->sta_ssid.ssid_len] = '\0';
            s_got_ssid = true;
            ESP_LOGI(TAG, "got SSID: %s", s_ssid);
        }
        break;

    case ESP_BLUFI_EVENT_RECV_STA_PASSWD:
        if (param->sta_passwd.passwd_len < sizeof(s_password)) {
            memcpy(s_password, param->sta_passwd.passwd,
                   param->sta_passwd.passwd_len);
            s_password[param->sta_passwd.passwd_len] = '\0';
            s_got_pass = true;
        }
        break;

    case ESP_BLUFI_EVENT_REQ_CONNECT_TO_AP:
        if (s_got_ssid && s_got_pass) {
            if (s_timeout_timer) xTimerStop(s_timeout_timer, 0);
            if (s_on_done) s_on_done(s_ssid, s_password);
            // 不在这里发 conn report，等 WiFi 实际连上/失败后再通知手机
        }
        break;

    default:
        break;
    }
}

static esp_blufi_callbacks_t s_blufi_cbs = {
    .event_cb = blufi_event_cb,
};

// ---------- 公共接口 ----------

esp_err_t app_blufi_start(blufi_prov_done_cb_t on_done)
{
    s_on_done  = on_done;
    s_got_ssid = false;
    s_got_pass = false;
    memset(s_ssid,     0, sizeof(s_ssid));
    memset(s_password, 0, sizeof(s_password));

    nimble_port_init();

    ble_hs_cfg.reset_cb          = blufi_on_reset;
    ble_hs_cfg.sync_cb           = blufi_on_sync;
    ble_hs_cfg.gatts_register_cb = esp_blufi_gatt_svr_register_cb;
    ble_hs_cfg.store_status_cb   = ble_store_util_status_rr;
    ble_hs_cfg.sm_sc             = 0;

    esp_blufi_gatt_svr_init();
    ble_svc_gap_device_name_set(app_device_get_ble_name());
    esp_blufi_btc_init();

    ESP_ERROR_CHECK(esp_blufi_register_callbacks(&s_blufi_cbs));

    nimble_port_freertos_init(ble_host_task);

    s_timeout_timer = xTimerCreate("prov_timeout",
                                   pdMS_TO_TICKS(PROV_TIMEOUT_MS),
                                   pdFALSE, NULL, timeout_cb);
    xTimerStart(s_timeout_timer, 0);

    ESP_LOGI(TAG, "BLE provisioning started (10 min timeout)");
    return ESP_OK;
}

static void ble_result_task(void *arg)
{
    bool success = (bool)(intptr_t)arg;
    esp_blufi_extra_info_t info = {0};
    esp_blufi_send_wifi_conn_report(
        WIFI_MODE_STA,
        success ? ESP_BLUFI_STA_CONN_SUCCESS : ESP_BLUFI_STA_CONN_FAIL,
        0, &info);
    vTaskDelay(pdMS_TO_TICKS(500));
    app_blufi_stop();
    vTaskDelete(NULL);
}

void app_blufi_notify_wifi_result(bool success)
{
    xTaskCreate(ble_result_task, "ble_result", 2048,
                (void *)(intptr_t)success, 5, NULL);
}

void app_blufi_stop(void)
{
    if (s_timeout_timer) {
        xTimerStop(s_timeout_timer, 0);
        xTimerDelete(s_timeout_timer, 0);
        s_timeout_timer = NULL;
    }
    esp_blufi_adv_stop();
    esp_blufi_profile_deinit();
    esp_blufi_gatt_svr_deinit();
    esp_blufi_btc_deinit();
    nimble_port_stop();
    ESP_LOGI(TAG, "BLE stopped");
}
