describe('runWithLease', () => {
  let runWithLease;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../config/redis', () => ({
      set: jest.fn(),
    }));
    ({ runWithLease } = require('../services/jobCoordinator'));
  });

  afterEach(() => {
    jest.dontMock('../config/redis');
  });

  test('executes the job when the redis lease is acquired', async () => {
    const redisClient = { set: jest.fn().mockResolvedValue('OK') };
    const job = jest.fn().mockResolvedValue('done');

    const outcome = await runWithLease('usageAggregator', 600000, job, { redisClient });

    expect(redisClient.set).toHaveBeenCalledWith(
      'jobCoordinator:usageAggregator',
      expect.any(String),
      'NX',
      'PX',
      600000
    );
    expect(job).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ acquired: true, result: 'done' });
  });

  test('skips the job when another worker holds the redis lease', async () => {
    const redisClient = { set: jest.fn().mockResolvedValue(null) };
    const job = jest.fn();

    const outcome = await runWithLease('usageAggregator', 600000, job, { redisClient });

    expect(job).not.toHaveBeenCalled();
    expect(outcome).toEqual({ acquired: false, result: null });
  });

  test('fails open and executes the job when redis errors', async () => {
    const redisClient = { set: jest.fn().mockRejectedValue(new Error('redis down')) };
    const job = jest.fn().mockResolvedValue('aggregated');

    const outcome = await runWithLease('usageAggregator', 600000, job, { redisClient });

    expect(job).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      acquired: null,
      failOpen: true,
      result: 'aggregated',
    });
  });

  test('propagates job errors after acquiring the lease without retrying the job', async () => {
    const redisClient = { set: jest.fn().mockResolvedValue('OK') };
    const jobError = new Error('aggregation failed');
    const job = jest.fn().mockRejectedValue(jobError);

    await expect(runWithLease('usageAggregator', 600000, job, { redisClient })).rejects.toThrow(jobError);

    expect(job).toHaveBeenCalledTimes(1);
  });
});
