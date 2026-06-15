jest.mock('../config/redis', () => ({
  eval: jest.fn(),
}));

const redis = require('../config/redis');

describe('shared rate limiter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns true when Redis allows the subject', async () => {
    redis.eval.mockResolvedValue(1);
    const { consume } = require('../services/rateLimiter');

    const allowed = await consume('api-key-1', {
      limit: 60,
      windowSeconds: 30,
      keyPrefix: 'ratelimit:http',
    });

    expect(allowed).toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'ratelimit:http:api-key-1',
      60,
      30
    );
  });

  test('returns false when Redis denies the subject', async () => {
    redis.eval.mockResolvedValue(0);
    const { consume } = require('../services/rateLimiter');

    await expect(consume('device-1', {
      limit: 20,
      windowSeconds: 60,
      keyPrefix: 'ratelimit:device-ai',
    })).resolves.toBe(false);
  });

  test('fails open by default when Redis is unavailable', async () => {
    redis.eval.mockRejectedValue(new Error('redis down'));
    const { consume } = require('../services/rateLimiter');

    await expect(consume('device-1', {
      limit: 20,
      windowSeconds: 60,
    })).resolves.toBe(true);
  });

  test('can fail closed when Redis is unavailable', async () => {
    redis.eval.mockRejectedValue(new Error('redis down'));
    const { consume } = require('../services/rateLimiter');

    await expect(consume('device-1', {
      limit: 20,
      windowSeconds: 60,
      failOpen: false,
    })).resolves.toBe(false);
  });
});
