#pragma once
#include <stdbool.h>
#include "esp_err.h"

esp_err_t app_nvs_init(void);

// WiFi 凭证
esp_err_t app_nvs_set_wifi(const char *ssid, const char *password);
esp_err_t app_nvs_get_wifi(char *ssid, size_t ssid_len, char *password, size_t pass_len);
bool      app_nvs_has_wifi(void);

// 服务器 token
esp_err_t app_nvs_set_token(const char *token);
esp_err_t app_nvs_get_token(char *token, size_t len);
bool      app_nvs_has_token(void);

// WebSocket URL（激活时服务器下发）
esp_err_t app_nvs_set_ws_url(const char *url);
esp_err_t app_nvs_get_ws_url(char *url, size_t len);

// 出厂序列号（生产时烧录）
esp_err_t app_nvs_set_sn(const char *sn);
esp_err_t app_nvs_get_sn(char *sn, size_t len);

// 恢复出厂：清除 WiFi + token + ws_url（保留 SN）
esp_err_t app_nvs_factory_reset(void);
