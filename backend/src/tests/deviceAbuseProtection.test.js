jest.mock('../services/rateLimiter', () => ({
  consume: jest.fn(),
}));

const { consume } = require('../services/rateLimiter');

describe('deviceAbuseProtection', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('uses default OTA registration limit with IP and normalized MAC subject', async () => {
    consume.mockResolvedValue(true);
    const { checkOtaRegistrationRate } = require('../services/deviceAbuseProtection');

    await expect(checkOtaRegistrationRate({
      ip: '::ffff:127.0.0.1',
      mac: 'aa:bb:cc:dd:ee:ff',
    })).resolves.toBe(true);

    expect(consume).toHaveBeenCalledWith('::ffff:127.0.0.1:AA:BB:CC:DD:EE:FF', {
      limit: 10,
      windowSeconds: 60,
      keyPrefix: 'ratelimit:ota-check',
    });
  });

  test('uses env overrides for OTA registration limits', async () => {
    process.env.OTA_CHECK_RATE_LIMIT = '2';
    process.env.OTA_CHECK_RATE_WINDOW_SECONDS = '15';
    consume.mockResolvedValue(false);
    const { checkOtaRegistrationRate } = require('../services/deviceAbuseProtection');

    await expect(checkOtaRegistrationRate({
      ip: '10.0.0.2',
      mac: 'AA:BB:CC:DD:EE:FF',
    })).resolves.toBe(false);

    expect(consume).toHaveBeenCalledWith('10.0.0.2:AA:BB:CC:DD:EE:FF', {
      limit: 2,
      windowSeconds: 15,
      keyPrefix: 'ratelimit:ota-check',
    });
  });

  test('uses bound-device AI limit for bound devices', async () => {
    consume.mockResolvedValue(true);
    const { checkAiChatRate } = require('../services/deviceAbuseProtection');

    await expect(checkAiChatRate({
      mac: 'aa:bb:cc:dd:ee:ff',
      isBound: true,
    })).resolves.toBe(true);

    expect(consume).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF', {
      limit: 20,
      windowSeconds: 60,
      keyPrefix: 'ratelimit:device-ai',
    });
  });

  test('uses stricter unbound-device AI limit for unbound devices', async () => {
    consume.mockResolvedValue(false);
    const { checkAiChatRate } = require('../services/deviceAbuseProtection');

    await expect(checkAiChatRate({
      mac: 'AA:BB:CC:DD:EE:FF',
      isBound: false,
    })).resolves.toBe(false);

    expect(consume).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF', {
      limit: 3,
      windowSeconds: 300,
      keyPrefix: 'ratelimit:device-ai',
    });
  });
});
