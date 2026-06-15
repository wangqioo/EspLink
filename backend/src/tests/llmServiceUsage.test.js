jest.mock('openai', () => ({
  OpenAI: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(async function* create() {
          yield {
            choices: [{ delta: { content: 'hello' } }],
            usage: { prompt_tokens: 2, completion_tokens: 3 },
          };
        }),
      },
    },
  })),
}));

jest.mock('../config/database', () => ({
  llmProvider: {
    findFirst: jest.fn(),
  },
  usageLog: {
    create: jest.fn(),
  },
  apiKey: {
    update: jest.fn(),
    findUnique: jest.fn(),
  },
}));

jest.mock('../config/redis', () => ({
  del: jest.fn(() => Promise.resolve()),
}));

jest.mock('../services/alertService', () => ({
  checkAndAlert: jest.fn(() => Promise.resolve()),
}));

const prisma = require('../config/database');
const redis = require('../config/redis');
const { checkAndAlert } = require('../services/alertService');
const { streamChat } = require('../services/llmService');

describe('streamChat usage accounting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.llmProvider.findFirst.mockResolvedValue({
      provider: 'deepseek',
      api_key: 'provider-key',
      is_active: true,
    });
    prisma.usageLog.create.mockResolvedValue({});
    prisma.apiKey.update.mockResolvedValue({});
    prisma.apiKey.findUnique.mockResolvedValue({
      id: 'sk-test',
      used_today: 25,
      tenant: {
        id: 7,
        name: 'Tenant',
        daily_limit: 100,
        alert_threshold: 0.8,
        usage_alert_webhook: 'https://example.com/hook',
      },
    });
  });

  test('logs usage, increments API Key counters, invalidates cache, and checks alerts', async () => {
    const chunks = [];
    const done = jest.fn();

    await streamChat({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'deepseek-chat',
      mac: 'AA:BB:CC:DD:EE:FF',
      apiKeyId: 'sk-test',
      onChunk: (delta) => chunks.push(delta),
      onDone: done,
      onError: jest.fn(),
    });

    expect(chunks).toEqual(['hello']);
    expect(done).toHaveBeenCalledWith({ inputTokens: 2, outputTokens: 3 });
    expect(prisma.usageLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        api_key_id: 'sk-test',
        device_mac: 'AA:BB:CC:DD:EE:FF',
        model: 'deepseek-chat',
        input_tokens: 2,
        output_tokens: 3,
        success: true,
      }),
    });
    expect(prisma.apiKey.update).toHaveBeenCalledWith({
      where: { id: 'sk-test' },
      data: {
        used_today: { increment: 5 },
        used_month: { increment: 5 },
      },
    });
    expect(redis.del).toHaveBeenCalledWith('apikey:sk-test');
    expect(checkAndAlert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
      25
    );
  });
});
