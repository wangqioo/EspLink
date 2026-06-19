jest.mock('../config/database', () => ({
  firmwareRelease: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  firmwareOtaAttempt: {
    create: jest.fn(),
    update: jest.fn(),
    findFirst: jest.fn(),
    groupBy: jest.fn(),
  },
}));

const prisma = require('../config/database');

describe('otaResultService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('records a started OTA attempt from device report metadata', async () => {
    prisma.firmwareRelease.findFirst.mockResolvedValue({
      id: 4,
      board_type: 'esplink-v1',
      version: '1.0.4',
      channel: 'stable',
    });
    prisma.firmwareOtaAttempt.create.mockResolvedValue({
      id: 10,
      status: 'started',
      mac_address: 'AA:BB:CC:DD:EE:FF',
      target_version: '1.0.4',
    });

    const { recordOtaResult } = require('../services/otaResultService');
    const result = await recordOtaResult({
      mac: ' aa-bb-cc-dd-ee-ff ',
      board_type: 'esplink-v1',
      from_version: '1.0.3',
      target_version: '1.0.4',
      status: 'started',
      release_id: 4,
      bytes_written: 0,
    });

    expect(prisma.firmwareOtaAttempt.create).toHaveBeenCalledWith({
      data: {
        mac_address: 'AA:BB:CC:DD:EE:FF',
        board_type: 'esplink-v1',
        from_version: '1.0.3',
        target_version: '1.0.4',
        release_id: 4,
        status: 'started',
        error_code: null,
        error_message: null,
        bytes_written: 0,
        started_at: expect.any(Date),
        finished_at: null,
      },
    });
    expect(result.id).toBe(10);
  });

  test('treats release_id zero as an unlinked OTA attempt', async () => {
    prisma.firmwareOtaAttempt.create.mockResolvedValue({
      id: 11,
      status: 'started',
    });

    const { recordOtaResult } = require('../services/otaResultService');
    await recordOtaResult({
      mac: 'AA:BB:CC:DD:EE:FF',
      board_type: 'esplink-v1',
      target_version: '1.0.4',
      status: 'started',
      release_id: 0,
    });

    expect(prisma.firmwareOtaAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        release_id: null,
      }),
    });
  });

  test('updates the latest active attempt when a terminal result arrives', async () => {
    prisma.firmwareOtaAttempt.findFirst.mockResolvedValue({
      id: 10,
      status: 'started',
      mac_address: 'AA:BB:CC:DD:EE:FF',
    });
    prisma.firmwareOtaAttempt.update.mockResolvedValue({
      id: 10,
      status: 'sha_mismatch',
      error_code: 'sha_mismatch',
    });

    const { recordOtaResult } = require('../services/otaResultService');
    await recordOtaResult({
      mac: 'AA:BB:CC:DD:EE:FF',
      board_type: 'esplink-v1',
      target_version: '1.0.4',
      status: 'sha_mismatch',
      error_code: 'sha_mismatch',
      error_message: 'expected abc actual def',
    });

    expect(prisma.firmwareOtaAttempt.findFirst).toHaveBeenCalledWith({
      where: {
        mac_address: 'AA:BB:CC:DD:EE:FF',
        board_type: 'esplink-v1',
        target_version: '1.0.4',
        status: { in: ['started', 'downloaded', 'verified'] },
      },
      orderBy: [{ started_at: 'desc' }],
    });
    expect(prisma.firmwareOtaAttempt.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: {
        status: 'sha_mismatch',
        error_code: 'sha_mismatch',
        error_message: 'expected abc actual def',
        bytes_written: null,
        finished_at: expect.any(Date),
      },
    });
  });

  test('builds release summaries with success and failure counts', async () => {
    prisma.firmwareOtaAttempt.groupBy.mockResolvedValue([
      { release_id: 4, status: 'success', _count: { _all: 3 } },
      { release_id: 4, status: 'sha_mismatch', _count: { _all: 1 } },
      { release_id: 5, status: 'download_failed', _count: { _all: 2 } },
    ]);
    prisma.firmwareOtaAttempt.findFirst
      .mockResolvedValueOnce({
        release_id: 4,
        status: 'sha_mismatch',
        error_code: 'sha_mismatch',
        error_message: 'bad digest',
        finished_at: new Date('2026-06-18T01:00:00Z'),
      })
      .mockResolvedValueOnce({
        release_id: 5,
        status: 'download_failed',
        error_code: 'download_failed',
        error_message: 'timeout',
        finished_at: new Date('2026-06-18T02:00:00Z'),
      });

    const { buildReleaseOtaSummaries } = require('../services/otaResultService');
    const summaries = await buildReleaseOtaSummaries([4, 5]);

    expect(summaries).toEqual({
      4: {
        total: 4,
        success: 3,
        failed: 1,
        in_progress: 0,
        last_failure: {
          status: 'sha_mismatch',
          error_code: 'sha_mismatch',
          error_message: 'bad digest',
          finished_at: new Date('2026-06-18T01:00:00Z'),
        },
      },
      5: {
        total: 2,
        success: 0,
        failed: 2,
        in_progress: 0,
        last_failure: {
          status: 'download_failed',
          error_code: 'download_failed',
          error_message: 'timeout',
          finished_at: new Date('2026-06-18T02:00:00Z'),
        },
      },
    });
  });
});
