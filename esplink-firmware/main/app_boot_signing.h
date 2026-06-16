#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

typedef struct {
    const char *mac;
    const char *sn;
    int64_t timestamp;
    const char *nonce;
    const char *signature;
} app_boot_signature_t;

bool app_boot_signing_is_configured(void);
esp_err_t app_boot_signing_build(app_boot_signature_t *signature,
                                 char *nonce_buf,
                                 size_t nonce_buf_len,
                                 char *signature_buf,
                                 size_t signature_buf_len);
esp_err_t app_boot_signing_append_json(char *body,
                                       size_t body_len,
                                       const app_boot_signature_t *signature);
