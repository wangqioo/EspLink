const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const firmwareRoot = path.resolve(__dirname, '..');
const readMain = (file) => fs.readFileSync(path.join(firmwareRoot, 'main', file), 'utf8');

test('OTA app valid marker is exposed by the OTA module and called during boot registration', () => {
  const appOtaC = readMain('app_ota.c');
  const appOtaH = readMain('app_ota.h');
  const mainC = readMain('main.c');

  assert.match(appOtaH, /app_ota_mark_running_valid\s*\(/);
  assert.match(appOtaC, /esp_err_t\s+app_ota_mark_running_valid\s*\(/);
  assert.match(appOtaC, /esp_ota_mark_app_valid_cancel_rollback\s*\(/);
  assert.match(mainC, /cJSON_Parse\(s_reg_resp\)[\s\S]*app_ota_mark_running_valid\s*\(/);
});

test('OTA app is marked valid before applying a boot-register OTA envelope', () => {
  const mainC = readMain('main.c');
  const markIndex = mainC.indexOf('app_ota_mark_running_valid()');
  const upgradeIndex = mainC.indexOf('app_ota_upgrade(&update)');

  assert.notEqual(markIndex, -1);
  assert.notEqual(upgradeIndex, -1);
  assert.ok(markIndex < upgradeIndex);
});

test('boot registration response buffer can hold an OTA envelope', () => {
  const mainC = readMain('main.c');
  const match = mainC.match(/static char\s+s_reg_resp\[(\d+)\]/);

  assert.ok(match);
  assert.ok(Number(match[1]) >= 2048);
});

test('OTA SHA256 verification compares backend artifact SHA over raw partition bytes', () => {
  const appOtaC = readMain('app_ota.c');

  assert.match(appOtaC, /#include\s+"mbedtls\/sha256\.h"/);
  assert.match(appOtaC, /esp_partition_read\s*\(/);
  assert.match(appOtaC, /mbedtls_sha256_update/);
  assert.match(appOtaC, /size_bytes\s*<=\s*0/);
  assert.doesNotMatch(appOtaC, /esp_partition_get_sha256\s*\(/);
  assert.match(appOtaC, /verify_boot_partition_(?:artifact_)?sha256\s*\([^)]*size_bytes/);
});

test('OTA upgrade reports lifecycle results back to the backend', () => {
  const appOtaC = readMain('app_ota.c');
  const appOtaH = readMain('app_ota.h');

  assert.match(appOtaH, /result_url/);
  assert.match(appOtaC, /app_ota_report_result\s*\(/);
  assert.match(appOtaC, /"started"/);
  assert.match(appOtaC, /"download_failed"/);
  assert.match(appOtaC, /"sha_mismatch"/);
  assert.match(appOtaC, /"success"/);
  assert.match(appOtaC, /HTTP_METHOD_POST/);
  assert.match(appOtaC, /\/api\/ota\/result/);
});

test('OTA result reports include boot signing fields when boot PSK is configured', () => {
  const appOtaC = readMain('app_ota.c');

  assert.match(appOtaC, /#include\s+"app_boot_signing\.h"/);
  assert.match(appOtaC, /app_boot_signing_build\s*\(/);
  assert.match(appOtaC, /app_boot_signing_append_json\s*\(/);
  assert.match(appOtaC, /OTA result signature enabled/);
});

test('signed boot registration uses epoch time synchronized by SNTP', () => {
  const signingC = readMain('app_boot_signing.c');
  const mainC = readMain('main.c');

  assert.match(signingC, /#include\s+<time\.h>/);
  assert.match(signingC, /time\s*\(\s*NULL\s*\)/);
  assert.doesNotMatch(signingC, /esp_timer_get_time\s*\(/);
  assert.match(mainC, /#include\s+"esp_netif_sntp\.h"/);
  assert.match(mainC, /sync_epoch_time_for_signing\s*\(/);
  assert.match(mainC, /esp_netif_sntp_deinit\s*\(\s*\)/);
  assert.match(mainC, /esp_netif_sntp_sync_wait\s*\(/);
  assert.match(mainC, /SNTP sync failed before signed boot register/);
});

test('production transport rejects insecure boot register, OTA result, and WebSocket URLs', () => {
  const appOtaC = readMain('app_ota.c');
  const appWsC = readMain('app_ws.c');
  const mainC = readMain('main.c');

  assert.match(mainC, /CONFIG_ESPLINK_PRODUCTION_TRANSPORT[\s\S]*production transport requires HTTPS boot register URL/);
  assert.match(appOtaC, /CONFIG_ESPLINK_PRODUCTION_TRANSPORT[\s\S]*production transport requires HTTPS OTA result url/);
  assert.match(appWsC, /CONFIG_ESPLINK_PRODUCTION_TRANSPORT[\s\S]*production transport requires WSS WebSocket url/);
});

test('HTTPS and WSS clients attach the ESP-IDF crt bundle only for TLS URLs', () => {
  const appOtaC = readMain('app_ota.c');
  const appWsC = readMain('app_ws.c');
  const mainC = readMain('main.c');
  const cmake = readMain('CMakeLists.txt');

  assert.match(appOtaC, /#include\s+"esp_crt_bundle\.h"/);
  assert.match(appWsC, /#include\s+"esp_crt_bundle\.h"/);
  assert.match(mainC, /#include\s+"esp_crt_bundle\.h"/);
  assert.match(appOtaC, /crt_bundle_for_url[\s\S]*is_https_url\(url\) \? esp_crt_bundle_attach : NULL/);
  assert.match(appWsC, /crt_bundle_for_url[\s\S]*is_wss_url\(url\) \? esp_crt_bundle_attach : NULL/);
  assert.match(mainC, /crt_bundle_for_url[\s\S]*strncmp\(url, "https:\/\/", 8\) == 0\) \? esp_crt_bundle_attach : NULL/);
  assert.match(cmake, /esp-tls/);
});

test('OTA SHA256 failure restores the current running partition before returning', () => {
  const appOtaC = readMain('app_ota.c');
  const mismatchIndex = appOtaC.indexOf('"sha_mismatch"');
  const restoreIndex = appOtaC.indexOf('esp_ota_set_boot_partition');
  const restartIndex = appOtaC.indexOf('esp_restart()');

  assert.notEqual(mismatchIndex, -1);
  assert.notEqual(restoreIndex, -1);
  assert.ok(restoreIndex < mismatchIndex);
  assert.ok(mismatchIndex < restartIndex);
  assert.match(appOtaC, /esp_ota_get_running_partition\s*\(/);
  assert.match(appOtaC, /esp_ota_set_boot_partition\s*\(\s*running\s*\)/);
});
