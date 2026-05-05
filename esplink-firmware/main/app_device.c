#include "app_device.h"
#include "app_nvs.h"
#include "esp_wifi.h"
#include "esp_mac.h"
#include "esp_log.h"
#include <string.h>
#include <stdio.h>

#define TAG             "app_device"
#define FIRMWARE_VER    "1.0.0"

static char s_mac_str[18];
static char s_sn[DEVICE_SN_LEN];
static char s_ble_name[32];

esp_err_t app_device_init(void)
{
    uint8_t mac[6];
    esp_err_t err = esp_wifi_get_mac(WIFI_IF_STA, mac);
    if (err != ESP_OK) {
        esp_efuse_mac_get_default(mac);
    }
    snprintf(s_mac_str, sizeof(s_mac_str), "%02X:%02X:%02X:%02X:%02X:%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

    // BLE 广播名：后3字节 hex，例 "Device-A1B2C3"
    snprintf(s_ble_name, sizeof(s_ble_name), "Device-%02X%02X%02X",
             mac[3], mac[4], mac[5]);

    // 加载 SN
    if (app_nvs_get_sn(s_sn, sizeof(s_sn)) != ESP_OK || s_sn[0] == '\0') {
        // 无序列号时用 MAC 兜底（生产时应烧录真实 SN）
        snprintf(s_sn, sizeof(s_sn), "MAC-%02X%02X%02X%02X%02X%02X",
                 mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
        ESP_LOGW(TAG, "no SN in NVS, using MAC as SN: %s", s_sn);
    }

    ESP_LOGI(TAG, "MAC=%s  SN=%s  BLE_NAME=%s  FW=%s",
             s_mac_str, s_sn, s_ble_name, FIRMWARE_VER);
    return ESP_OK;
}

const char *app_device_get_mac_str(void)        { return s_mac_str; }
const char *app_device_get_sn(void)             { return s_sn; }
const char *app_device_get_ble_name(void)       { return s_ble_name; }
const char *app_device_get_firmware_version(void) { return FIRMWARE_VER; }
