jest.mock('../config/database', () => ({
  device: {
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
  },
}));

jest.mock('../ws/deviceWsManager', () => ({
  isConnected: jest.fn(),
}));

const prisma = require('../config/database');
const deviceWsManager = require('../ws/deviceWsManager');
const { listDevices, getDevice } = require('../services/deviceService');

function makeDevice(overrides = {}) {
  return {
    mac_address: 'AA:BB:CC:DD:EE:FF',
    name: 'Desk Device',
    device_id: 'device-123',
    board_type: 'esp32-s3-box',
    firmware: '2.4.1',
    capabilities: JSON.stringify({ display: true, commands: ['reboot'] }),
    is_online: true,
    is_paired: true,
    last_seen: new Date(Date.now() - 30 * 1000),
    api_key: { id: 'key-1', name: 'Desk Key' },
    tenant: { id: 7, name: 'Tenant A' },
    ...overrides,
  };
}

describe('deviceService admin read model integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('listDevices returns admin read model fields while preserving existing device fields', async () => {
    prisma.device.findMany.mockResolvedValue([makeDevice()]);
    prisma.device.count.mockResolvedValue(1);
    deviceWsManager.isConnected.mockReturnValue(true);

    const result = await listDevices({ page: 1, pageSize: 20 });

    expect(result.total).toBe(1);
    expect(result.list[0]).toMatchObject({
      mac_address: 'AA:BB:CC:DD:EE:FF',
      device_id: 'device-123',
      api_key: { id: 'key-1', name: 'Desk Key' },
      tenant: { id: 7, name: 'Tenant A' },
      is_paired: true,
      board_type: 'esp32-s3-box',
      ws_connected: true,
      db_online: true,
      admin_status: 'online',
    });
    expect(result.list[0].capabilities_summary).toEqual(['commands', 'display']);
  });

  test('getDevice returns null when the device does not exist', async () => {
    prisma.device.findUnique.mockResolvedValue(null);

    await expect(getDevice('AA:BB:CC:DD:EE:FF')).resolves.toBeNull();
  });
});
