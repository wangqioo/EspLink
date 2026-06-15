jest.mock('../utils/dbTime', () => ({
  touchDevice: jest.fn(() => Promise.resolve()),
}));

jest.mock('../config/database', () => ({
  device: {
    update: jest.fn(),
  },
  $executeRawUnsafe: jest.fn(() => Promise.resolve(0)),
}));

const prisma = require('../config/database');
const { touchDevice } = require('../utils/dbTime');

describe('devicePresence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('markConnected refreshes database-side last_seen and marks device online', async () => {
    const { markConnected } = require('../services/devicePresence');

    await markConnected('AA:BB:CC:DD:EE:FF');

    expect(touchDevice).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF', { is_online: true });
  });

  test('markHeartbeat refreshes database-side last_seen and keeps device online', async () => {
    const { markHeartbeat } = require('../services/devicePresence');

    await markHeartbeat('AA:BB:CC:DD:EE:FF');

    expect(touchDevice).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF', { is_online: true });
  });

  test('markDisconnected marks the device offline without changing last_seen', async () => {
    const { markDisconnected } = require('../services/devicePresence');

    await markDisconnected('AA:BB:CC:DD:EE:FF');

    expect(prisma.device.update).toHaveBeenCalledWith({
      where: { mac_address: 'AA:BB:CC:DD:EE:FF' },
      data: { is_online: false },
    });
  });

  test('expireStale marks online devices offline using MySQL-side time comparison', async () => {
    const { expireStale } = require('../services/devicePresence');

    await expireStale({ staleMinutes: 2 });

    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('last_seen < (NOW() - INTERVAL 2 MINUTE)')
    );
  });
});
