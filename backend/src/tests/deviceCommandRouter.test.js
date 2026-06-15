jest.mock('../ws/deviceWsManager', () => ({
  sendCommand: jest.fn(),
}));

const defaultTransport = require('../ws/deviceWsManager');

describe('DeviceCommandRouter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns delivered when default transport sendCommand succeeds', async () => {
    defaultTransport.sendCommand.mockReturnValue(true);
    const router = require('../services/deviceCommandRouter');

    const result = await router.send('AA:BB:CC:DD:EE:FF', { type: 'reboot' });

    expect(result).toEqual({ delivered: true, status: 'delivered' });
    expect(defaultTransport.sendCommand).toHaveBeenCalledWith(
      'AA:BB:CC:DD:EE:FF',
      { type: 'reboot' }
    );
  });

  test('returns offline when default transport sendCommand returns false', async () => {
    defaultTransport.sendCommand.mockReturnValue(false);
    const router = require('../services/deviceCommandRouter');
    const presence = {
      get: jest.fn(() => Promise.resolve({ online: false })),
    };

    const result = await router.send('AA:BB:CC:DD:EE:FF', { type: 'reboot' }, { presence });

    expect(result).toEqual({
      delivered: false,
      status: 'offline',
      reason: 'device_offline',
    });
  });

  test('publishes to remote owner instance when local delivery misses and Redis presence is online elsewhere', async () => {
    defaultTransport.sendCommand.mockReturnValue(false);
    const presence = {
      get: jest.fn(() => Promise.resolve({
        online: true,
        instanceId: 'instance-b',
        ownerId: 'instance-b:conn-1',
      })),
    };
    const broker = {
      publish: jest.fn(() => Promise.resolve({ published: true, subscribers: 1 })),
    };
    const router = require('../services/deviceCommandRouter');

    const result = await router.send(
      'AA:BB:CC:DD:EE:FF',
      { command: 'reboot' },
      { presence, broker, instanceId: 'instance-a' }
    );

    expect(result).toEqual({
      delivered: false,
      status: 'published',
      reason: 'remote_instance',
      instanceId: 'instance-b',
    });
    expect(presence.get).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF');
    expect(broker.publish).toHaveBeenCalledWith('instance-b', {
      mac: 'AA:BB:CC:DD:EE:FF',
      payload: { command: 'reboot' },
    });
  });

  test('returns offline when local delivery misses and Redis presence is not online', async () => {
    defaultTransport.sendCommand.mockReturnValue(false);
    const presence = {
      get: jest.fn(() => Promise.resolve({ online: false })),
    };
    const broker = {
      publish: jest.fn(),
    };
    const router = require('../services/deviceCommandRouter');

    const result = await router.send(
      'AA:BB:CC:DD:EE:FF',
      { command: 'reboot' },
      { presence, broker, instanceId: 'instance-a' }
    );

    expect(result).toEqual({
      delivered: false,
      status: 'offline',
      reason: 'device_offline',
    });
    expect(broker.publish).not.toHaveBeenCalled();
  });

  test('returns failed when remote publish throws', async () => {
    defaultTransport.sendCommand.mockReturnValue(false);
    const error = new Error('publish failed');
    const presence = {
      get: jest.fn(() => Promise.resolve({ online: true, instanceId: 'instance-b' })),
    };
    const broker = {
      publish: jest.fn(() => Promise.reject(error)),
    };
    const router = require('../services/deviceCommandRouter');

    const result = await router.send(
      'AA:BB:CC:DD:EE:FF',
      { command: 'reboot' },
      { presence, broker, instanceId: 'instance-a' }
    );

    expect(result).toEqual({
      delivered: false,
      status: 'failed',
      reason: 'broker_error',
      error,
    });
  });

  test('returns failed when transport throws', async () => {
    const error = new Error('ws failed');
    defaultTransport.sendCommand.mockImplementation(() => {
      throw error;
    });
    const router = require('../services/deviceCommandRouter');

    const result = await router.send('AA:BB:CC:DD:EE:FF', { type: 'reboot' });

    expect(result).toEqual({
      delivered: false,
      status: 'failed',
      reason: 'transport_error',
      error,
    });
  });

  test('uses injected transport instead of the default ws manager', async () => {
    defaultTransport.sendCommand.mockReturnValue(false);
    const transport = {
      sendCommand: jest.fn(() => true),
    };
    const router = require('../services/deviceCommandRouter');

    const result = await router.send(
      'AA:BB:CC:DD:EE:FF',
      { type: 'volume', value: 30 },
      { transport }
    );

    expect(result).toEqual({ delivered: true, status: 'delivered' });
    expect(transport.sendCommand).toHaveBeenCalledWith(
      'AA:BB:CC:DD:EE:FF',
      { type: 'volume', value: 30 }
    );
    expect(defaultTransport.sendCommand).not.toHaveBeenCalled();
  });
});
