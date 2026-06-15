jest.mock('../config/database', () => ({
  firmwareRelease: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
}));

const prisma = require('../config/database');

describe('firmwareReleaseService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('createRelease normalizes versions and applies defaults', async () => {
    prisma.firmwareRelease.findFirst.mockResolvedValue(null);
    prisma.firmwareRelease.create.mockResolvedValue({
      id: 1,
      board_type: 'esp32-s3-box',
      version: '2.5.0',
      channel: 'stable',
      is_active: true,
      force_update: false,
    });

    const { createRelease } = require('../services/firmwareReleaseService');
    const release = await createRelease({
      board_type: 'esp32-s3-box',
      version: 'v02.005.000',
      artifact_url: 'https://firmware.example.test/esp32.bin',
      sha256: 'a'.repeat(64),
    });

    expect(prisma.firmwareRelease.create).toHaveBeenCalledWith({
      data: {
        board_type: 'esp32-s3-box',
        version: '2.5.0',
        artifact_url: 'https://firmware.example.test/esp32.bin',
        sha256: 'a'.repeat(64),
        size_bytes: null,
        channel: 'stable',
        is_active: true,
        force_update: false,
        release_notes: null,
      },
    });
    expect(release.version).toBe('2.5.0');
  });

  test('createRelease rejects malformed release versions', async () => {
    const { createRelease } = require('../services/firmwareReleaseService');

    await expect(createRelease({
      board_type: 'esp32-s3-box',
      version: 'latest',
      artifact_url: 'https://firmware.example.test/esp32.bin',
      sha256: 'a'.repeat(64),
    })).rejects.toMatchObject({ code: 40000, message: 'invalid firmware version' });
  });

  test('createRelease rejects duplicate board channel version', async () => {
    prisma.firmwareRelease.findFirst.mockResolvedValue({ id: 7 });
    const { createRelease } = require('../services/firmwareReleaseService');

    await expect(createRelease({
      board_type: 'esp32-s3-box',
      version: '2.5.0',
      artifact_url: 'https://firmware.example.test/esp32.bin',
      sha256: 'a'.repeat(64),
      channel: 'stable',
    })).rejects.toMatchObject({ code: 40900, message: 'firmware release already exists' });
  });

  test('createRelease rejects invalid size_bytes values', async () => {
    prisma.firmwareRelease.findFirst.mockResolvedValue(null);
    const { createRelease } = require('../services/firmwareReleaseService');

    await expect(createRelease({
      board_type: 'esp32-s3-box',
      version: '2.5.0',
      artifact_url: 'https://firmware.example.test/esp32.bin',
      sha256: 'a'.repeat(64),
      size_bytes: 'abc',
    })).rejects.toMatchObject({ code: 40000, message: 'invalid size_bytes' });
  });

  test('createRelease rejects string boolean flags', async () => {
    prisma.firmwareRelease.findFirst.mockResolvedValue(null);
    const { createRelease } = require('../services/firmwareReleaseService');

    await expect(createRelease({
      board_type: 'esp32-s3-box',
      version: '2.5.0',
      artifact_url: 'https://firmware.example.test/esp32.bin',
      sha256: 'a'.repeat(64),
      force_update: 'false',
    })).rejects.toMatchObject({ code: 40000, message: 'force_update must be boolean' });
  });

  test('findLatestActiveRelease selects highest semantic version', async () => {
    prisma.firmwareRelease.findMany.mockResolvedValue([
      { id: 1, board_type: 'esp32-s3-box', channel: 'stable', version: '2.9.0', is_active: true },
      { id: 2, board_type: 'esp32-s3-box', channel: 'stable', version: '2.10.0', is_active: true },
      { id: 3, board_type: 'esp32-s3-box', channel: 'stable', version: '2.2.99', is_active: true },
    ]);

    const { findLatestActiveRelease } = require('../services/firmwareReleaseService');
    const release = await findLatestActiveRelease({ boardType: 'esp32-s3-box' });

    expect(prisma.firmwareRelease.findMany).toHaveBeenCalledWith({
      where: {
        board_type: 'esp32-s3-box',
        channel: 'stable',
        is_active: true,
      },
    });
    expect(release.id).toBe(2);
  });

  test('findLatestActiveRelease ignores malformed release rows', async () => {
    prisma.firmwareRelease.findMany.mockResolvedValue([
      { id: 1, board_type: 'esp32-s3-box', channel: 'stable', version: 'bad', is_active: true },
      { id: 2, board_type: 'esp32-s3-box', channel: 'stable', version: '2.10.0', is_active: true },
    ]);

    const { findLatestActiveRelease } = require('../services/firmwareReleaseService');
    const release = await findLatestActiveRelease({ boardType: ' esp32-s3-box ' });

    expect(prisma.firmwareRelease.findMany).toHaveBeenCalledWith({
      where: {
        board_type: 'esp32-s3-box',
        channel: 'stable',
        is_active: true,
      },
    });
    expect(release.id).toBe(2);
  });

  test('listReleases returns paginated releases', async () => {
    prisma.firmwareRelease.findMany.mockResolvedValue([{ id: 1 }]);
    prisma.firmwareRelease.count.mockResolvedValue(1);

    const { listReleases } = require('../services/firmwareReleaseService');
    const result = await listReleases({
      boardType: 'esp32-s3-box',
      channel: 'stable',
      page: 2,
      pageSize: 10,
    });

    expect(prisma.firmwareRelease.findMany).toHaveBeenCalledWith({
      where: { board_type: 'esp32-s3-box', channel: 'stable' },
      orderBy: [{ created_at: 'desc' }],
      skip: 10,
      take: 10,
    });
    expect(result).toEqual({ list: [{ id: 1 }], total: 1 });
  });

  test('setReleaseActive toggles release active state', async () => {
    prisma.firmwareRelease.update.mockResolvedValue({ id: 1, is_active: false });
    const { setReleaseActive } = require('../services/firmwareReleaseService');

    await expect(setReleaseActive(1, false)).resolves.toEqual({ id: 1, is_active: false });
    expect(prisma.firmwareRelease.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { is_active: false },
    });
  });
});
