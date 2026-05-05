#include "app_nvs.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "esp_log.h"
#include <string.h>

#define TAG "app_nvs"
#define NVS_NS_NET   "net"    // WiFi + token + ws_url
#define NVS_NS_DEV   "dev"    // SN（出厂烧录，reset不清）

esp_err_t app_nvs_init(void)
{
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_LOGW(TAG, "NVS partition truncated, erasing");
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    return err;
}

static esp_err_t kv_set(const char *ns, const char *key, const char *val)
{
    nvs_handle_t h;
    esp_err_t err = nvs_open(ns, NVS_READWRITE, &h);
    if (err != ESP_OK) return err;
    err = nvs_set_str(h, key, val);
    if (err == ESP_OK) nvs_commit(h);
    nvs_close(h);
    return err;
}

static esp_err_t kv_get(const char *ns, const char *key, char *buf, size_t len)
{
    nvs_handle_t h;
    esp_err_t err = nvs_open(ns, NVS_READONLY, &h);
    if (err != ESP_OK) return err;
    err = nvs_get_str(h, key, buf, &len);
    nvs_close(h);
    return err;
}

esp_err_t app_nvs_set_wifi(const char *ssid, const char *password)
{
    esp_err_t err = kv_set(NVS_NS_NET, "ssid", ssid);
    if (err == ESP_OK) err = kv_set(NVS_NS_NET, "pass", password);
    return err;
}

esp_err_t app_nvs_get_wifi(char *ssid, size_t ssid_len, char *password, size_t pass_len)
{
    esp_err_t err = kv_get(NVS_NS_NET, "ssid", ssid, ssid_len);
    if (err == ESP_OK) err = kv_get(NVS_NS_NET, "pass", password, pass_len);
    return err;
}

bool app_nvs_has_wifi(void)
{
    char ssid[64];
    return kv_get(NVS_NS_NET, "ssid", ssid, sizeof(ssid)) == ESP_OK && ssid[0] != '\0';
}

esp_err_t app_nvs_set_token(const char *token)
{
    return kv_set(NVS_NS_NET, "token", token);
}

esp_err_t app_nvs_get_token(char *token, size_t len)
{
    return kv_get(NVS_NS_NET, "token", token, len);
}

bool app_nvs_has_token(void)
{
    char token[256];
    return kv_get(NVS_NS_NET, "token", token, sizeof(token)) == ESP_OK && token[0] != '\0';
}

esp_err_t app_nvs_set_ws_url(const char *url)
{
    return kv_set(NVS_NS_NET, "ws_url", url);
}

esp_err_t app_nvs_get_ws_url(char *url, size_t len)
{
    return kv_get(NVS_NS_NET, "ws_url", url, len);
}

esp_err_t app_nvs_set_sn(const char *sn)
{
    return kv_set(NVS_NS_DEV, "sn", sn);
}

esp_err_t app_nvs_get_sn(char *sn, size_t len)
{
    return kv_get(NVS_NS_DEV, "sn", sn, len);
}

esp_err_t app_nvs_factory_reset(void)
{
    nvs_handle_t h;
    esp_err_t err = nvs_open(NVS_NS_NET, NVS_READWRITE, &h);
    if (err != ESP_OK) return err;
    err = nvs_erase_all(h);
    if (err == ESP_OK) nvs_commit(h);
    nvs_close(h);
    ESP_LOGI(TAG, "factory reset done, SN preserved");
    return err;
}
