jest.mock('../config/database', () => ({
  device: {
    upsert: jest.fn(),
    update: jest.fn(),
  },
}));

const prisma = require('../config/database');
const { registerDevice, unbindDevice } = require('../services/deviceService');

describe('registerDevice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('registers device metadata without consulting legacy pairing records', async () => {
    prisma.device.upsert.mockResolvedValue({
      mac_address: 'AA:BB:CC:DD:EE:FF',
      device_id: 'device-123',
      is_paired: false,
      tenant_id: null,
    });

    await registerDevice({
      mac_address: 'AA:BB:CC:DD:EE:FF',
      device_id: 'device-123',
      firmware: '1.0.0',
      name: 'Desk Device',
    });

    expect(prisma.device.upsert).toHaveBeenCalledWith({
      where: { mac_address: 'AA:BB:CC:DD:EE:FF' },
      create: {
        mac_address: 'AA:BB:CC:DD:EE:FF',
        device_id: 'device-123',
        firmware: '1.0.0',
        name: 'Desk Device',
        last_seen: expect.any(Date),
        is_online: true,
      },
      update: {
        device_id: 'device-123',
        firmware: '1.0.0',
        name: 'Desk Device',
        last_seen: expect.any(Date),
        is_online: true,
      },
    });
  });

  test('admin unbind clears API Key, tenant, pairing, and WeChat owner', async () => {
    prisma.device.update.mockResolvedValue({
      mac_address: 'AA:BB:CC:DD:EE:FF',
      api_key_id: null,
      tenant_id: null,
      wechat_user_id: null,
      is_paired: false,
    });

    await unbindDevice('AA:BB:CC:DD:EE:FF');

    expect(prisma.device.update).toHaveBeenCalledWith({
      where: { mac_address: 'AA:BB:CC:DD:EE:FF' },
      data: {
        api_key_id: null,
        tenant_id: null,
        wechat_user_id: null,
        is_paired: false,
        paired_at: null,
      },
    });
  });
});
