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

test('OTA SHA256 verification compares backend artifact SHA over raw partition bytes', () => {
  const appOtaC = readMain('app_ota.c');

  assert.match(appOtaC, /#include\s+"mbedtls\/sha256\.h"/);
  assert.match(appOtaC, /esp_partition_read\s*\(/);
  assert.match(appOtaC, /mbedtls_sha256_update/);
  assert.match(appOtaC, /size_bytes\s*<=\s*0/);
  assert.doesNotMatch(appOtaC, /esp_partition_get_sha256\s*\(/);
  assert.match(appOtaC, /verify_boot_partition_(?:artifact_)?sha256\s*\([^)]*size_bytes/);
});
