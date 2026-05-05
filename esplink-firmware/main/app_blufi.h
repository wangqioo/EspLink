#pragma once
#include "esp_err.h"
#include <stdbool.h>

// 配网完成回调：ssid/password 是设备收到的 WiFi 凭证
typedef void (*blufi_prov_done_cb_t)(const char *ssid, const char *password);

// 启动 BLE 配网广播（10 分钟超时后自动停止）
esp_err_t app_blufi_start(blufi_prov_done_cb_t on_done);

// 手动停止（配网成功后调用）
void app_blufi_stop(void);

// WiFi 连接结果出来后调用：发通知给手机，然后停止 BLE
void app_blufi_notify_wifi_result(bool success);
