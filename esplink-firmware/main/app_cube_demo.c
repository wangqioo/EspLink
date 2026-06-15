#include "app_cube_demo.h"
#include "esp32_s3_szp.h"

#include "esp_heap_caps.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include <math.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *TAG = "cube_3d";

#define SCREEN_WIDTH  320
#define SCREEN_HEIGHT 240
#define CENTER_X      (SCREEN_WIDTH / 2)
#define CENTER_Y      (SCREEN_HEIGHT / 2)
#define CUBE_SIZE     50
#define FLUSH_LINES   10

#define SAMPLE_PERIOD_S 0.05f
#define DAMPING         0.95f
#define RESPONSE        0.35f
#define GYRO_DEADZONE   3.0f

typedef struct {
    float x;
    float y;
    float z;
} point3d_t;

typedef struct {
    int x;
    int y;
} point2d_t;

typedef struct {
    uint16_t *pixels;
    uint16_t *dma_lines;
} framebuffer_t;

static const point3d_t CUBE_VERTICES_TEMPLATE[8] = {
    {-1, -1, -1},
    { 1, -1, -1},
    { 1,  1, -1},
    {-1,  1, -1},
    {-1, -1,  1},
    { 1, -1,  1},
    { 1,  1,  1},
    {-1,  1,  1},
};

static const int CUBE_EDGES[12][2] = {
    {0, 1}, {1, 2}, {2, 3}, {3, 0},
    {4, 5}, {5, 6}, {6, 7}, {7, 4},
    {0, 4}, {1, 5}, {2, 6}, {3, 7},
};

static bool s_started;

static void calculate_angles_from_accel(int16_t acc_x,
                                        int16_t acc_y,
                                        int16_t acc_z,
                                        float *pitch,
                                        float *roll)
{
    *pitch = atan2f((float)acc_y,
                    sqrtf((float)acc_x * acc_x + (float)acc_z * acc_z));
    *roll = atan2f((float)acc_x,
                   sqrtf((float)acc_y * acc_y + (float)acc_z * acc_z));
}

static void rotate_x(point3d_t *p, float angle)
{
    float y = p->y;
    float z = p->z;
    p->y = y * cosf(angle) - z * sinf(angle);
    p->z = y * sinf(angle) + z * cosf(angle);
}

static void rotate_y(point3d_t *p, float angle)
{
    float x = p->x;
    float z = p->z;
    p->x = x * cosf(angle) + z * sinf(angle);
    p->z = -x * sinf(angle) + z * cosf(angle);
}

static void rotate_z(point3d_t *p, float angle)
{
    float x = p->x;
    float y = p->y;
    p->x = x * cosf(angle) - y * sinf(angle);
    p->y = x * sinf(angle) + y * cosf(angle);
}

static point2d_t project_3d_to_2d(point3d_t p3d)
{
    return (point2d_t) {
        .x = CENTER_X + (int)(p3d.x * CUBE_SIZE),
        .y = CENTER_Y + (int)(p3d.y * CUBE_SIZE),
    };
}

static void calibrate_initial_pose(t_sQMI8658 *qmi8658)
{
    float sum_pitch = 0.0f;
    float sum_roll = 0.0f;
    const int samples = 10;

    ESP_LOGI(TAG, "Calibrating initial pose...");
    for (int i = 0; i < samples; i++) {
        qmi8658_Read_AccAndGry(qmi8658);

        float pitch;
        float roll;
        calculate_angles_from_accel(qmi8658->acc_x,
                                    qmi8658->acc_y,
                                    qmi8658->acc_z,
                                    &pitch,
                                    &roll);

        sum_pitch += pitch;
        sum_roll += roll;
        vTaskDelay(pdMS_TO_TICKS(10));
    }

    ESP_LOGI(TAG, "Initial pose calibrated: pitch=%.2f, roll=%.2f rad",
             sum_pitch / samples,
             sum_roll / samples);
}

static esp_err_t framebuffer_init(framebuffer_t *fb)
{
    memset(fb, 0, sizeof(*fb));

    const size_t buffer_size = SCREEN_WIDTH * SCREEN_HEIGHT * sizeof(uint16_t);
    fb->pixels = (uint16_t *)heap_caps_malloc(buffer_size,
                                             MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!fb->pixels) {
        ESP_LOGW(TAG, "PSRAM framebuffer allocation failed, trying default heap");
        fb->pixels = (uint16_t *)heap_caps_malloc(buffer_size, MALLOC_CAP_8BIT);
    }

    if (!fb->pixels) {
        ESP_LOGE(TAG, "Failed to allocate framebuffer");
        return ESP_ERR_NO_MEM;
    }

    fb->dma_lines = (uint16_t *)heap_caps_malloc(
        SCREEN_WIDTH * FLUSH_LINES * sizeof(uint16_t),
        MALLOC_CAP_DMA | MALLOC_CAP_INTERNAL);
    if (!fb->dma_lines) {
        ESP_LOGE(TAG, "Failed to allocate LCD DMA line buffer");
        heap_caps_free(fb->pixels);
        memset(fb, 0, sizeof(*fb));
        return ESP_ERR_NO_MEM;
    }

    return ESP_OK;
}

static void framebuffer_free(framebuffer_t *fb)
{
    if (fb->dma_lines) {
        heap_caps_free(fb->dma_lines);
    }
    if (fb->pixels) {
        heap_caps_free(fb->pixels);
    }
    memset(fb, 0, sizeof(*fb));
}

static void framebuffer_flush(const framebuffer_t *fb)
{
    esp_lcd_panel_handle_t panel = lcd_get_panel_handle();
    for (int y = 0; y < SCREEN_HEIGHT; y += FLUSH_LINES) {
        int lines = SCREEN_HEIGHT - y;
        if (lines > FLUSH_LINES) {
            lines = FLUSH_LINES;
        }

        memcpy(fb->dma_lines,
               fb->pixels + y * SCREEN_WIDTH,
               SCREEN_WIDTH * lines * sizeof(uint16_t));
        esp_lcd_panel_draw_bitmap(panel, 0, y, SCREEN_WIDTH, y + lines, fb->dma_lines);
    }
}

static void draw_cube_frame(framebuffer_t *fb,
                            point3d_t cube_vertices[8],
                            float delta_x,
                            float delta_y,
                            float delta_z)
{
    if (!fb || !fb->pixels || !fb->dma_lines) {
        return;
    }

    for (int i = 0; i < SCREEN_WIDTH * SCREEN_HEIGHT; i++) {
        fb->pixels[i] = COLOR_BLACK;
    }

    for (int i = 0; i < 8; i++) {
        rotate_z(&cube_vertices[i], delta_z);
        rotate_x(&cube_vertices[i], delta_x);
        rotate_y(&cube_vertices[i], delta_y);
    }

    point2d_t projected[8];
    for (int i = 0; i < 8; i++) {
        projected[i] = project_3d_to_2d(cube_vertices[i]);
    }

    for (int i = 0; i < 12; i++) {
        point2d_t p1 = projected[CUBE_EDGES[i][0]];
        point2d_t p2 = projected[CUBE_EDGES[i][1]];

        int dx = abs(p2.x - p1.x);
        int dy = abs(p2.y - p1.y);
        int sx = (p1.x < p2.x) ? 1 : -1;
        int sy = (p1.y < p2.y) ? 1 : -1;
        int err = dx - dy;
        int x = p1.x;
        int y = p1.y;

        while (true) {
            if (x >= 0 && x < SCREEN_WIDTH && y >= 0 && y < SCREEN_HEIGHT) {
                fb->pixels[y * SCREEN_WIDTH + x] = COLOR_CYAN;
            }

            if (x == p2.x && y == p2.y) {
                break;
            }

            int e2 = 2 * err;
            if (e2 > -dy) {
                err -= dy;
                x += sx;
            }
            if (e2 < dx) {
                err += dx;
                y += sy;
            }
        }
    }

    for (int i = 0; i < 8; i++) {
        int cx = projected[i].x;
        int cy = projected[i].y;

        for (int dy = -1; dy <= 1; dy++) {
            for (int dx = -1; dx <= 1; dx++) {
                int x = cx + dx;
                int y = cy + dy;
                if (x >= 0 && x < SCREEN_WIDTH && y >= 0 && y < SCREEN_HEIGHT) {
                    fb->pixels[y * SCREEN_WIDTH + x] = COLOR_RED;
                }
            }
        }
    }

    framebuffer_flush(fb);
}

static void cube_demo_task(void *arg)
{
    (void)arg;
    ESP_LOGI(TAG, "=== 3D Cube with Gyroscope Control ===");

    framebuffer_t framebuffer;
    esp_err_t err = bsp_i2c_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "I2C init failed: %s", esp_err_to_name(err));
        goto exit;
    }
    ESP_LOGI(TAG, "I2C initialized");

    pca9557_init();
    ESP_LOGI(TAG, "PCA9557 initialized");

    err = bsp_lcd_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "LCD init failed: %s", esp_err_to_name(err));
        goto exit;
    }
    ESP_LOGI(TAG, "LCD initialized");

    err = framebuffer_init(&framebuffer);
    if (err != ESP_OK) {
        goto exit;
    }

    t_sQMI8658 qmi8658 = {0};
    qmi8658_init();
    ESP_LOGI(TAG, "QMI8658 initialized");

    lcd_set_color(COLOR_BLACK);

    point3d_t cube_vertices[8];
    for (int i = 0; i < 8; i++) {
        cube_vertices[i] = CUBE_VERTICES_TEMPLATE[i];
    }

    calibrate_initial_pose(&qmi8658);

    float angular_velocity_x = 0.0f;
    float angular_velocity_y = 0.0f;
    float angular_velocity_z = 0.0f;
    float angle_x = 0.0f;
    float angle_y = 0.0f;
    float angle_z = 0.0f;
    int frame_count = 0;

    ESP_LOGI(TAG, "Starting 3D cube rendering...");
    while (true) {
        qmi8658_Read_AccAndGry(&qmi8658);

        float gyro_scale = 512.0f / 32768.0f;
        float gyro_x_dps = qmi8658.gyr_x * gyro_scale;
        float gyro_y_dps = qmi8658.gyr_y * gyro_scale;
        float gyro_z_dps = qmi8658.gyr_z * gyro_scale;

        if (fabsf(gyro_x_dps) < GYRO_DEADZONE) gyro_x_dps = 0.0f;
        if (fabsf(gyro_y_dps) < GYRO_DEADZONE) gyro_y_dps = 0.0f;
        if (fabsf(gyro_z_dps) < GYRO_DEADZONE) gyro_z_dps = 0.0f;

        float gyro_x_rad = gyro_x_dps * M_PI / 180.0f;
        float gyro_y_rad = gyro_y_dps * M_PI / 180.0f;
        float gyro_z_rad = gyro_z_dps * M_PI / 180.0f;

        angular_velocity_x = angular_velocity_x * DAMPING - gyro_y_rad * RESPONSE;
        angular_velocity_y = angular_velocity_y * DAMPING - gyro_x_rad * RESPONSE;
        angular_velocity_z = angular_velocity_z * DAMPING - gyro_z_rad * RESPONSE;

        float delta_x = angular_velocity_x * SAMPLE_PERIOD_S;
        float delta_y = angular_velocity_y * SAMPLE_PERIOD_S;
        float delta_z = angular_velocity_z * SAMPLE_PERIOD_S;

        angle_x += delta_x;
        angle_y += delta_y;
        angle_z += delta_z;

        draw_cube_frame(&framebuffer, cube_vertices, delta_x, delta_y, delta_z);

        if (frame_count % 20 == 0) {
            ESP_LOGI(TAG,
                     "[%d] Gyro: %.1f %.1f %.1f dps | AngVel: %.2f %.2f %.2f | Angles: %.2f %.2f %.2f",
                     frame_count,
                     gyro_x_dps,
                     gyro_y_dps,
                     gyro_z_dps,
                     angular_velocity_x,
                     angular_velocity_y,
                     angular_velocity_z,
                     angle_x,
                     angle_y,
                     angle_z);
        }

        frame_count++;
        vTaskDelay(pdMS_TO_TICKS(50));
    }

exit:
    framebuffer_free(&framebuffer);
    s_started = false;
    vTaskDelete(NULL);
}

esp_err_t app_cube_demo_start(void)
{
    if (s_started) {
        return ESP_OK;
    }

    BaseType_t ok = xTaskCreate(cube_demo_task,
                                "cube_demo",
                                8192,
                                NULL,
                                4,
                                NULL);
    if (ok != pdPASS) {
        ESP_LOGE(TAG, "failed to start cube demo task");
        return ESP_ERR_NO_MEM;
    }

    s_started = true;
    return ESP_OK;
}
