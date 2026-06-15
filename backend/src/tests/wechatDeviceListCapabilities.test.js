jest.mock('../config/database', () => ({
  device: {
    findMany: jest.fn(),
  },
}));

jest.mock('../services/deviceCapability', () => ({
  parseStoredCapabilities: jest.fn((deviceOrString) => {
    const stored =
      deviceOrString && typeof deviceOrString === 'object' ? deviceOrString.capabilities : deviceOrString;
    if (!stored) return null;
    try {
      return JSON.parse(stored);
    } catch (_error) {
      return null;
    }
  }),
  toClientCapabilitySummary: jest.fn((device) => ({
    board_type: device.board_type,
    has_capabilities: Boolean(device.capabilities),
  })),
}));

const prisma = require('../config/database');
const DeviceCapability = require('../services/deviceCapability');
const { getDeviceList } = require('../services/wechatService');

function makeDevice(overrides = {}) {
  return {
    mac_address: 'AA:BB:CC:DD:EE:FF',
    name: 'Desk Device',
    board_type: 'esp32-s3-box',
    firmware: '2.4.1',
    capabilities: JSON.stringify({ display: { width: 320 }, audio: { input: true } }),
    is_online: true,
    last_seen: new Date('2026-06-14T10:00:00.000Z'),
    created_at: new Date('2026-06-14T09:00:00.000Z'),
    ...overrides,
  };
}

describe('wechatService getDeviceList capability parsing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns parsed capabilities and delegated capability_summary for valid stored JSON', async () => {
    const device = makeDevice();
    prisma.device.findMany.mockResolvedValue([device]);

    const list = await getDeviceList(42);

    expect(prisma.device.findMany).toHaveBeenCalledWith({
      where: { wechat_user_id: 42 },
      orderBy: { created_at: 'desc' },
    });
    expect(DeviceCapability.toClientCapabilitySummary).toHaveBeenCalledWith(device);
    expect(list).toEqual([
      {
        id: 'AA-BB-CC-DD-EE-FF',
        mac: 'AA:BB:CC:DD:EE:FF',
        name: 'Desk Device',
        board_type: 'esp32-s3-box',
        firmware_version: '2.4.1',
        capabilities: { display: { width: 320 }, audio: { input: true } },
        capability_summary: {
          board_type: 'esp32-s3-box',
          has_capabilities: true,
        },
        is_online: true,
        last_seen_at: new Date('2026-06-14T10:00:00.000Z'),
      },
    ]);
  });

  test('returns null capabilities for malformed or null stored capabilities without throwing', async () => {
    const malformed = makeDevice({
      mac_address: 'AA:BB:CC:DD:EE:01',
      capabilities: '{not json',
    });
    const missing = makeDevice({
      mac_address: 'AA:BB:CC:DD:EE:02',
      capabilities: null,
    });
    prisma.device.findMany.mockResolvedValue([malformed, missing]);

    await expect(getDeviceList(42)).resolves.toMatchObject([
      {
        id: 'AA-BB-CC-DD-EE-01',
        capabilities: null,
        capability_summary: {
          board_type: 'esp32-s3-box',
          has_capabilities: true,
        },
      },
      {
        id: 'AA-BB-CC-DD-EE-02',
        capabilities: null,
        capability_summary: {
          board_type: 'esp32-s3-box',
          has_capabilities: false,
        },
      },
    ]);
    expect(DeviceCapability.toClientCapabilitySummary).toHaveBeenCalledWith(malformed);
    expect(DeviceCapability.toClientCapabilitySummary).toHaveBeenCalledWith(missing);
  });
});
