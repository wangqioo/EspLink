#pragma once
#include "esp_err.h"

// gpio_num：恢复出厂按键引脚（低电平有效）
// 长按 5 秒触发 factory_reset_cb
esp_err_t app_button_init(int gpio_num, void (*factory_reset_cb)(void));
