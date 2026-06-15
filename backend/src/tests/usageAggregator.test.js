jest.mock('node-cron', () => ({
  schedule: jest.fn(),
}));

jest.mock('../config/database', () => ({
  usageLog: {
    groupBy: jest.fn(),
  },
  apiKey: {
    findMany: jest.fn(),
  },
  usageHourly: {
    upsert: jest.fn(),
  },
}));

jest.mock('../services/jobCoordinator', () => ({
  runWithLease: jest.fn(),
}));

const prisma = require('../config/database');
const cron = require('node-cron');
const { runWithLease } = require('../services/jobCoordinator');
const { aggregateHour } = require('../jobs/usageAggregator');

describe('aggregateHour', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('excludes usage logs with null api_key_id from key lookup and hourly upsert', async () => {
    prisma.usageLog.groupBy
      .mockResolvedValueOnce([
        {
          api_key_id: null,
          _count: { id: 2 },
          _sum: { input_tokens: 10, output_tokens: 4 },
        },
        {
          api_key_id: 'sk-real',
          _count: { id: 1 },
          _sum: { input_tokens: 3, output_tokens: 7 },
        },
      ])
      .mockResolvedValueOnce([
        { api_key_id: 'sk-real', success: true, _count: { id: 1 } },
      ]);
    prisma.apiKey.findMany.mockResolvedValue([
      { id: 'sk-real', tenant_id: 123 },
    ]);

    await aggregateHour(new Date('2026-06-14T08:00:00.000Z'));

    expect(prisma.usageLog.groupBy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          api_key_id: { not: null },
        }),
      })
    );
    expect(prisma.apiKey.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['sk-real'] } },
      select: { id: true, tenant_id: true },
    });
    expect(prisma.usageHourly.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.usageHourly.upsert.mock.calls[0][0].create.api_key_id).toBe('sk-real');
  });
});

describe('usageAggregator cron handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-14T09:05:00.000Z'));
    runWithLease.mockImplementation(async (_jobName, _ttlMs, fn) => ({
      acquired: true,
      result: await fn(),
    }));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('runs the previous-hour aggregate through the job coordinator lease', async () => {
    const { start } = require('../jobs/usageAggregator');
    prisma.usageLog.groupBy.mockResolvedValue([]);

    start();
    await cron.schedule.mock.calls[0][1]();

    expect(cron.schedule).toHaveBeenCalledWith('5 * * * *', expect.any(Function));
    expect(runWithLease).toHaveBeenCalledWith(
      'usageAggregator',
      10 * 60 * 1000,
      expect.any(Function)
    );
    expect(prisma.usageLog.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          timestamp: {
            gte: new Date('2026-06-14T08:00:00.000Z'),
            lt: new Date('2026-06-14T09:00:00.000Z'),
          },
        }),
      })
    );
  });
});
