#pragma once
#include "esp_err.h"

#define DEVICE_SN_LEN     32
#define DEVICE_TOKEN_LEN  256
#define DEVICE_WS_URL_LEN 256

// 初始化：读取 MAC，加载 SN
esp_err_t app_device_init(void);

// "XX:XX:XX:XX:XX:XX" 格式 MAC
const char *app_device_get_mac_str(void);

// NVS 中的序列号
const char *app_device_get_sn(void);

// BLE 广播设备名，如 "Device-A1B2C3"
const char *app_device_get_ble_name(void);

// 固件版本字符串
const char *app_device_get_firmware_version(void);
