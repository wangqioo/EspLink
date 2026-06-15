const { consume } = require('./rateLimiter');

const DEFAULTS = {
  otaCheckRateLimit: 10,
  otaCheckRateWindowSeconds: 60,
  deviceAiRateLimit: 20,
  deviceAiRateWindowSeconds: 60,
  unboundDeviceAiRateLimit: 3,
  unboundDeviceAiRateWindowSeconds: 300,
};

function readPositiveInt(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeMac(mac) {
  return typeof mac === 'string' ? mac.trim().toUpperCase() : '';
}

function getAbuseProtectionConfig() {
  return {
    otaCheckRateLimit: readPositiveInt('OTA_CHECK_RATE_LIMIT', DEFAULTS.otaCheckRateLimit),
    otaCheckRateWindowSeconds: readPositiveInt(
      'OTA_CHECK_RATE_WINDOW_SECONDS',
      DEFAULTS.otaCheckRateWindowSeconds
    ),
    deviceAiRateLimit: readPositiveInt('DEVICE_AI_RATE_LIMIT', DEFAULTS.deviceAiRateLimit),
    deviceAiRateWindowSeconds: readPositiveInt(
      'DEVICE_AI_RATE_WINDOW_SECONDS',
      DEFAULTS.deviceAiRateWindowSeconds
    ),
    unboundDeviceAiRateLimit: readPositiveInt(
      'UNBOUND_DEVICE_AI_RATE_LIMIT',
      DEFAULTS.unboundDeviceAiRateLimit
    ),
    unboundDeviceAiRateWindowSeconds: readPositiveInt(
      'UNBOUND_DEVICE_AI_RATE_WINDOW_SECONDS',
      DEFAULTS.unboundDeviceAiRateWindowSeconds
    ),
  };
}

async function checkOtaRegistrationRate({ ip, mac }) {
  const config = getAbuseProtectionConfig();
  return consume(`${ip || 'unknown'}:${normalizeMac(mac)}`, {
    limit: config.otaCheckRateLimit,
    windowSeconds: config.otaCheckRateWindowSeconds,
    keyPrefix: 'ratelimit:ota-check',
  });
}

async function checkAiChatRate({ mac, isBound }) {
  const config = getAbuseProtectionConfig();
  const limit = isBound ? config.deviceAiRateLimit : config.unboundDeviceAiRateLimit;
  const windowSeconds = isBound
    ? config.deviceAiRateWindowSeconds
    : config.unboundDeviceAiRateWindowSeconds;

  return consume(normalizeMac(mac), {
    limit,
    windowSeconds,
    keyPrefix: 'ratelimit:device-ai',
  });
}

module.exports = {
  checkOtaRegistrationRate,
  checkAiChatRate,
  getAbuseProtectionConfig,
};
