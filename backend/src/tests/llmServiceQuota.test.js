jest.mock('../config/database', () => ({
  device: {
    findUnique: jest.fn(),
  },
}));

const prisma = require('../config/database');
const { getModelForDevice } = require('../services/llmService');

describe('getModelForDevice API Key enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rejects disabled API Keys before AI chat starts', async () => {
    prisma.device.findUnique.mockResolvedValue({
      api_key_id: 'sk-disabled',
      api_key: {
        id: 'sk-disabled',
        is_active: false,
        expires_at: null,
        daily_limit: 100,
        monthly_limit: 1000,
        used_today: 0,
        used_month: 0,
      },
      tenant: { ai_model: 'deepseek-chat' },
    });

    await expect(getModelForDevice('AA:BB:CC:DD:EE:FF')).rejects.toThrow('API Key已禁用');
  });

  test('rejects exhausted daily quota before AI chat starts', async () => {
    prisma.device.findUnique.mockResolvedValue({
      api_key_id: 'sk-exhausted',
      api_key: {
        id: 'sk-exhausted',
        is_active: true,
        expires_at: null,
        daily_limit: 100,
        monthly_limit: 1000,
        used_today: 100,
        used_month: 100,
      },
      tenant: { ai_model: 'deepseek-chat' },
    });

    await expect(getModelForDevice('AA:BB:CC:DD:EE:FF')).rejects.toThrow('今日额度已用完');
  });

  test('allows devices without assigned API Key to use the tenant or default model', async () => {
    prisma.device.findUnique.mockResolvedValue({
      api_key_id: null,
      api_key: null,
      tenant: { ai_model: 'qwen-turbo' },
    });

    await expect(getModelForDevice('AA:BB:CC:DD:EE:FF')).resolves.toEqual({
      model: 'qwen-turbo',
      apiKeyId: null,
    });
  });
});
