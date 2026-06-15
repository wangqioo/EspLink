jest.mock('../config/database', () => ({
  usageLog: {
    count: jest.fn(),
  },
  device: {
    count: jest.fn(),
  },
  tenant: {
    count: jest.fn(),
  },
}));

const prisma = require('../config/database');
const { getSummary } = require('../services/usageService');

describe('getSummary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.usageLog.count
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(9)
      .mockResolvedValueOnce(20);
    prisma.device.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(5);
    prisma.tenant.count.mockResolvedValue(4);
  });

  test('returns both online_count and online_devices for compatibility', async () => {
    const summary = await getSummary();

    expect(summary.online_count).toBe(2);
    expect(summary.online_devices).toBe(2);
    expect(summary.total_devices).toBe(5);
  });
});
