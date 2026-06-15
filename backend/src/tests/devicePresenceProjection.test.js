jest.mock('../config/redis', () => ({
  set: jest.fn(),
  eval: jest.fn(),
  get: jest.fn(),
  ttl: jest.fn(),
}));

const redis = require('../config/redis');

describe('devicePresenceProjection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-06-15T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('register stores owner metadata with a TTL', async () => {
    redis.set.mockResolvedValue('OK');
    const projection = require('../services/devicePresenceProjection');

    const result = await projection.register('AA:BB:CC:DD:EE:FF', {
      ownerId: 'instance-1:conn-1',
      instanceId: 'instance-1',
      ttlSeconds: 90,
    });

    expect(result).toEqual({ projected: true });
    expect(redis.set).toHaveBeenCalledWith(
      'device:presence:AA:BB:CC:DD:EE:FF',
      JSON.stringify({
        owner_id: 'instance-1:conn-1',
        instance_id: 'instance-1',
        connected_at: '2026-06-15T00:00:00.000Z',
        last_seen_at: '2026-06-15T00:00:00.000Z',
      }),
      'EX',
      90
    );
  });

  test('heartbeat refreshes only when owner matches', async () => {
    redis.eval.mockResolvedValue(1);
    const projection = require('../services/devicePresenceProjection');

    const result = await projection.heartbeat('AA:BB:CC:DD:EE:FF', {
      ownerId: 'instance-1:conn-1',
      ttlSeconds: 90,
    });

    expect(result).toEqual({ projected: true, ownerMatched: true });
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('owner_id'),
      1,
      'device:presence:AA:BB:CC:DD:EE:FF',
      'instance-1:conn-1',
      '2026-06-15T00:00:00.000Z',
      90
    );
  });

  test('disconnect deletes only when owner matches', async () => {
    redis.eval.mockResolvedValue(1);
    const projection = require('../services/devicePresenceProjection');

    const result = await projection.disconnect('AA:BB:CC:DD:EE:FF', {
      ownerId: 'instance-1:conn-1',
    });

    expect(result).toEqual({ projected: true, ownerMatched: true });
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('DEL'),
      1,
      'device:presence:AA:BB:CC:DD:EE:FF',
      'instance-1:conn-1'
    );
  });

  test('get returns online presence metadata and ttl', async () => {
    redis.get.mockResolvedValue(JSON.stringify({
      owner_id: 'instance-1:conn-1',
      instance_id: 'instance-1',
      connected_at: '2026-06-15T00:00:00.000Z',
      last_seen_at: '2026-06-15T00:00:00.000Z',
    }));
    redis.ttl.mockResolvedValue(88);
    const projection = require('../services/devicePresenceProjection');

    await expect(projection.get('AA:BB:CC:DD:EE:FF')).resolves.toEqual({
      online: true,
      ownerId: 'instance-1:conn-1',
      instanceId: 'instance-1',
      connectedAt: '2026-06-15T00:00:00.000Z',
      lastSeenAt: '2026-06-15T00:00:00.000Z',
      ttlSeconds: 88,
    });
  });

  test('returns unknown instead of throwing when Redis is unavailable', async () => {
    redis.get.mockRejectedValue(new Error('redis down'));
    const projection = require('../services/devicePresenceProjection');

    await expect(projection.get('AA:BB:CC:DD:EE:FF')).resolves.toMatchObject({
      online: null,
      error: expect.any(Error),
    });
  });
});
