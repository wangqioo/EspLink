#pragma once
#include "esp_err.h"

// 检查并执行 OTA 升级
// check_url: 版本检查接口，如 "https://your-server/ota/check"
// 返回 ESP_OK 表示已触发升级（设备会重启），ESP_ERR_NOT_FOUND 表示无新版本
esp_err_t app_ota_check_and_upgrade(const char *check_url);
