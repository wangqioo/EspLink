jest.mock('../services/deviceAbuseProtection', () => ({
  checkAiChatRate: jest.fn(),
}));

jest.mock('../config/database', () => ({
  device: {
    findFirst: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
  },
}));

jest.mock('../services/devicePresence', () => ({
  markConnected: jest.fn(() => Promise.resolve()),
  markHeartbeat: jest.fn(() => Promise.resolve()),
  markDisconnected: jest.fn(() => Promise.resolve()),
}));

jest.mock('../services/llmService', () => ({
  getModelForDevice: jest.fn(),
  streamChat: jest.fn(),
}));

const deviceAbuseProtection = require('../services/deviceAbuseProtection');

describe('device WS AI rate limit helper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('passes bound state to abuse protection for AI chat', async () => {
    deviceAbuseProtection.checkAiChatRate.mockResolvedValue(true);
    const { checkAiRateLimit } = require('../ws/deviceWsManager');

    await expect(checkAiRateLimit('AA:BB:CC:DD:EE:FF', true)).resolves.toBe(true);

    expect(deviceAbuseProtection.checkAiChatRate).toHaveBeenCalledWith({
      mac: 'AA:BB:CC:DD:EE:FF',
      isBound: true,
    });
  });

  test('returns false when abuse protection denies unbound device AI chat', async () => {
    deviceAbuseProtection.checkAiChatRate.mockResolvedValue(false);
    const { checkAiRateLimit } = require('../ws/deviceWsManager');

    await expect(checkAiRateLimit('AA:BB:CC:DD:EE:FF', false)).resolves.toBe(false);
  });
});
