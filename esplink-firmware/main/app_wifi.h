#pragma once
#include "esp_err.h"

typedef void (*wifi_connected_cb_t)(void);
typedef void (*wifi_disconnected_cb_t)(void);

esp_err_t app_wifi_init(wifi_connected_cb_t on_connected,
                        wifi_disconnected_cb_t on_disconnected);

// 用存储的凭证连接
esp_err_t app_wifi_connect(const char *ssid, const char *password);

void app_wifi_disconnect(void);
