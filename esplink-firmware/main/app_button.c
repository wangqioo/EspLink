#include "app_button.h"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/timers.h"
#include "esp_log.h"

#define TAG              "app_button"
#define LONG_PRESS_MS    5000
#define POLL_INTERVAL_MS 50

static int      s_gpio;
static void   (*s_factory_reset_cb)(void);
static bool     s_pressed;
static uint32_t s_press_start_ms;

static void button_task(void *arg)
{
    while (1) {
        int level = gpio_get_level(s_gpio);

        if (level == 0 && !s_pressed) {
            s_pressed = true;
            s_press_start_ms = xTaskGetTickCount() * portTICK_PERIOD_MS;
        } else if (level == 1 && s_pressed) {
            s_pressed = false;
        }

        if (s_pressed) {
            uint32_t held = xTaskGetTickCount() * portTICK_PERIOD_MS - s_press_start_ms;
            if (held >= LONG_PRESS_MS) {
                ESP_LOGW(TAG, "long press %lu ms, triggering factory reset", (unsigned long)held);
                s_pressed = false;
                if (s_factory_reset_cb) s_factory_reset_cb();
            }
        }

        vTaskDelay(pdMS_TO_TICKS(POLL_INTERVAL_MS));
    }
}

esp_err_t app_button_init(int gpio_num, void (*factory_reset_cb)(void))
{
    s_gpio             = gpio_num;
    s_factory_reset_cb = factory_reset_cb;
    s_pressed          = false;

    gpio_config_t cfg = {
        .pin_bit_mask = (1ULL << gpio_num),
        .mode         = GPIO_MODE_INPUT,
        .pull_up_en   = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type    = GPIO_INTR_DISABLE,
    };
    gpio_config(&cfg);

    xTaskCreate(button_task, "button", 2048, NULL, 3, NULL);
    ESP_LOGI(TAG, "button init GPIO%d, long press %ds = factory reset",
             gpio_num, LONG_PRESS_MS / 1000);
    return ESP_OK;
}
