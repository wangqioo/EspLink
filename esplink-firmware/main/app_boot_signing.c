#include "app_boot_signing.h"
#include "app_device.h"
#include "esp_log.h"
#include "esp_random.h"
#include "mbedtls/md.h"
#include "sdkconfig.h"
#include <stdio.h>
#include <string.h>
#include <time.h>

#define TAG "boot_sign"

static void bytes_to_hex(const unsigned char *bytes, size_t len, char *out, size_t out_len)
{
    static const char hex[] = "0123456789abcdef";
    if (out_len < (len * 2) + 1) {
        if (out_len > 0) out[0] = '\0';
        return;
    }

    for (size_t i = 0; i < len; i++) {
        out[i * 2] = hex[(bytes[i] >> 4) & 0x0f];
        out[i * 2 + 1] = hex[bytes[i] & 0x0f];
    }
    out[len * 2] = '\0';
}

static int64_t current_timestamp_seconds(void)
{
    return (int64_t)time(NULL);
}

bool app_boot_signing_is_configured(void)
{
    return strlen(CONFIG_ESPLINK_BOOT_PSK) > 0;
}

esp_err_t app_boot_signing_build(app_boot_signature_t *signature,
                                 char *nonce_buf,
                                 size_t nonce_buf_len,
                                 char *signature_buf,
                                 size_t signature_buf_len)
{
    if (!signature || !nonce_buf || nonce_buf_len < 24 || !signature_buf || signature_buf_len < 65) {
        return ESP_ERR_INVALID_ARG;
    }

    if (!app_boot_signing_is_configured()) {
#if CONFIG_ESPLINK_BOOT_SIGNATURE_REQUIRED
        ESP_LOGE(TAG, "boot signature required but CONFIG_ESPLINK_BOOT_PSK is empty");
        return ESP_ERR_INVALID_STATE;
#else
        memset(signature, 0, sizeof(*signature));
        return ESP_ERR_NOT_FOUND;
#endif
    }

    uint32_t random_a = esp_random();
    uint32_t random_b = esp_random();
    snprintf(nonce_buf, nonce_buf_len, "boot-%08lx%08lx",
             (unsigned long)random_a,
             (unsigned long)random_b);

    int64_t timestamp = current_timestamp_seconds();
    char payload[192];
    int payload_len = snprintf(payload,
                               sizeof(payload),
                               "%s\n%s\n%lld\n%s",
                               app_device_get_mac_str(),
                               app_device_get_sn(),
                               (long long)timestamp,
                               nonce_buf);
    if (payload_len < 0 || payload_len >= (int)sizeof(payload)) {
        return ESP_ERR_NO_MEM;
    }

    unsigned char digest[32];
    int rc = mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),
                             (const unsigned char *)CONFIG_ESPLINK_BOOT_PSK,
                             strlen(CONFIG_ESPLINK_BOOT_PSK),
                             (const unsigned char *)payload,
                             strlen(payload),
                             digest);
    if (rc != 0) {
        ESP_LOGE(TAG, "HMAC calculation failed: %d", rc);
        return ESP_FAIL;
    }

    bytes_to_hex(digest, sizeof(digest), signature_buf, signature_buf_len);

    signature->mac = app_device_get_mac_str();
    signature->sn = app_device_get_sn();
    signature->timestamp = timestamp;
    signature->nonce = nonce_buf;
    signature->signature = signature_buf;
    return ESP_OK;
}

esp_err_t app_boot_signing_append_json(char *body,
                                       size_t body_len,
                                       const app_boot_signature_t *signature)
{
    if (!body || !signature || !signature->nonce || !signature->signature) {
        return ESP_ERR_INVALID_ARG;
    }

    size_t used = strlen(body);
    if (used == 0 || used >= body_len || body[used - 1] != '}') {
        return ESP_ERR_INVALID_ARG;
    }

    body[used - 1] = '\0';
    int written = snprintf(body + used - 1,
                           body_len - used + 1,
                           ",\"timestamp\":%lld,\"nonce\":\"%s\",\"signature\":\"%s\"}",
                           (long long)signature->timestamp,
                           signature->nonce,
                           signature->signature);
    if (written < 0 || written >= (int)(body_len - used + 1)) {
        return ESP_ERR_NO_MEM;
    }

    return ESP_OK;
}
