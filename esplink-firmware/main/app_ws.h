#pragma once
#include "esp_err.h"
#include <stdint.h>
#include <stddef.h>

typedef void (*ws_connected_cb_t)(void);
typedef void (*ws_disconnected_cb_t)(void);
typedef void (*ws_audio_cb_t)(const uint8_t *data, size_t len);
typedef void (*ws_json_cb_t)(const char *json);

typedef struct {
    ws_connected_cb_t    on_connected;
    ws_disconnected_cb_t on_disconnected;
    ws_audio_cb_t        on_audio;      // 收到服务器下行音频（OPUS 帧）
    ws_json_cb_t         on_json;       // 收到服务器 JSON 消息
} ws_callbacks_t;

esp_err_t app_ws_init(const char *url, const char *token,
                      const ws_callbacks_t *cbs);

// 发送上行音频（OPUS 二进制帧）
esp_err_t app_ws_send_audio(const uint8_t *data, size_t len);

// 发送 JSON 文本消息
esp_err_t app_ws_send_json(const char *json);

void app_ws_stop(void);
