#pragma once
#include <stdbool.h>
#include "esp_err.h"

typedef struct {
    const char *url;
    const char *version;
    const char *sha256;
    int size_bytes;
    bool force;
} app_ota_update_t;

// 旧接口：设备主动 GET check_url 检查版本，如有新固件则下载刷写
// 返回 ESP_OK 表示已触发升级（设备会重启），ESP_ERR_NOT_FOUND 表示无新版本
esp_err_t app_ota_check_and_upgrade(const char *check_url);

// 使用启动注册响应或云端推送给出的 OTA 元数据刷写固件。
// 成功时内部调用 esp_restart()，失败返回错误码。
esp_err_t app_ota_upgrade(const app_ota_update_t *update);

// OTA 分区启动并完成自检后，确认当前 app 有效，允许后续 OTA。
esp_err_t app_ota_mark_running_valid(void);

// 新接口：由启动注册响应或云端推送直接给出 fw_url，跳过版本检查直接刷写
// 成功时内部调用 esp_restart()，失败返回错误码
esp_err_t app_ota_upgrade_from_url(const char *fw_url);
