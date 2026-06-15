jest.mock('../config/redis', () => ({
  publish: jest.fn(),
  duplicate: jest.fn(),
}));

const redis = require('../config/redis');

describe('deviceCommandBroker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('publishes commands to the target instance channel', async () => {
    redis.publish.mockResolvedValue(1);
    const broker = require('../services/deviceCommandBroker');

    const result = await broker.publish('instance-a', {
      mac: 'AA:BB:CC:DD:EE:FF',
      payload: { command: 'reboot' },
    });

    expect(result).toEqual({ published: true, subscribers: 1 });
    expect(redis.publish).toHaveBeenCalledWith(
      'device:commands:instance-a',
      JSON.stringify({
        mac: 'AA:BB:CC:DD:EE:FF',
        payload: { command: 'reboot' },
      })
    );
  });

  test('subscribes to instance channel and dispatches parsed command messages', async () => {
    const subscriber = {
      subscribe: jest.fn((channel, callback) => callback(null, 1)),
      on: jest.fn(),
    };
    redis.duplicate.mockReturnValue(subscriber);
    const handler = jest.fn();
    const broker = require('../services/deviceCommandBroker');

    const result = await broker.subscribe('instance-a', handler);
    const messageHandler = subscriber.on.mock.calls.find(([event]) => event === 'message')[1];
    messageHandler('device:commands:instance-a', JSON.stringify({
      mac: 'AA:BB:CC:DD:EE:FF',
      payload: { command: 'reboot' },
    }));

    expect(result.channel).toBe('device:commands:instance-a');
    expect(subscriber.subscribe).toHaveBeenCalledWith('device:commands:instance-a', expect.any(Function));
    expect(handler).toHaveBeenCalledWith({
      mac: 'AA:BB:CC:DD:EE:FF',
      payload: { command: 'reboot' },
    });
  });

  test('ignores malformed pubsub messages', async () => {
    const subscriber = {
      subscribe: jest.fn((channel, callback) => callback(null, 1)),
      on: jest.fn(),
    };
    redis.duplicate.mockReturnValue(subscriber);
    const handler = jest.fn();
    const broker = require('../services/deviceCommandBroker');

    await broker.subscribe('instance-a', handler);
    const messageHandler = subscriber.on.mock.calls.find(([event]) => event === 'message')[1];
    expect(() => messageHandler('device:commands:instance-a', '{bad')).not.toThrow();

    expect(handler).not.toHaveBeenCalled();
  });
});
