#include "app_wifi.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include <string.h>

#define TAG            "app_wifi"
#define MAX_RETRY      5

static wifi_connected_cb_t    s_on_connected;
static wifi_disconnected_cb_t s_on_disconnected;
static int                    s_retry;

static void wifi_event_handler(void *arg, esp_event_base_t base,
                                int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        if (s_retry < MAX_RETRY) {
            s_retry++;
            ESP_LOGW(TAG, "reconnecting (%d/%d)", s_retry, MAX_RETRY);
            esp_wifi_connect();
        } else {
            ESP_LOGE(TAG, "WiFi lost after %d retries", MAX_RETRY);
            if (s_on_disconnected) s_on_disconnected();
        }
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        s_retry = 0;
        ip_event_got_ip_t *ev = (ip_event_got_ip_t *)data;
        ESP_LOGI(TAG, "got IP: " IPSTR, IP2STR(&ev->ip_info.ip));
        if (s_on_connected) s_on_connected();
    }
}

esp_err_t app_wifi_init(wifi_connected_cb_t on_connected,
                        wifi_disconnected_cb_t on_disconnected)
{
    s_on_connected    = on_connected;
    s_on_disconnected = on_disconnected;

    ESP_ERROR_CHECK(esp_netif_init());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));

    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID,
                                               wifi_event_handler, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP,
                                               wifi_event_handler, NULL));
    return esp_wifi_start();
}

esp_err_t app_wifi_connect(const char *ssid, const char *password)
{
    s_retry = 0;
    wifi_config_t cfg = {0};
    strlcpy((char *)cfg.sta.ssid,     ssid,     sizeof(cfg.sta.ssid));
    strlcpy((char *)cfg.sta.password, password, sizeof(cfg.sta.password));
    cfg.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;

    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &cfg));
    esp_err_t err = esp_wifi_connect();
    ESP_LOGI(TAG, "connecting to \"%s\"", ssid);
    return err;
}

void app_wifi_disconnect(void)
{
    esp_wifi_disconnect();
}
