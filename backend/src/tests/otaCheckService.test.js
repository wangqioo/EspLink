jest.mock('../services/wechatService', () => ({
  bootRegister: jest.fn(),
}));

jest.mock('../services/firmwareReleaseService', () => ({
  findLatestActiveRelease: jest.fn(),
}));

const wechatService = require('../services/wechatService');
const firmwareReleaseService = require('../services/firmwareReleaseService');

describe('otaCheckService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('registers the boot report and returns backward-compatible websocket auth fields', async () => {
    process.env.WS_BASE_URL = 'ws://device.example.test';
    wechatService.bootRegister.mockResolvedValue({
      device_key: 'device-token',
      device: {
        mac_address: 'AA:BB:CC:DD:EE:FF',
        wechat_user_id: 42,
      },
    });
    const { checkBootReport } = require('../services/otaCheckService');

    const result = await checkBootReport({
      mac: 'AA:BB:CC:DD:EE:FF',
      board_type: 'esp32-s3-box',
      firmware_version: '2.4.1',
    });

    expect(wechatService.bootRegister).toHaveBeenCalledWith({
      mac: 'AA:BB:CC:DD:EE:FF',
      board_type: 'esp32-s3-box',
      firmware_version: '2.4.1',
    });
    expect(result).toEqual({
      token: 'device-token',
      websocket_url: 'ws://device.example.test/ws/device',
      is_bound: true,
      update_available: false,
      ota: null,
      retry_policy: {
        retry_after_seconds: 30,
      },
    });
  });

  test('uses localhost websocket base URL when WS_BASE_URL is not configured', async () => {
    delete process.env.WS_BASE_URL;
    process.env.PORT = '9090';
    wechatService.bootRegister.mockResolvedValue({
      device_key: 'device-token',
      device: { wechat_user_id: null },
    });
    const { checkBootReport } = require('../services/otaCheckService');

    await expect(checkBootReport({ mac: 'AA:BB:CC:DD:EE:FF' })).resolves.toMatchObject({
      websocket_url: 'ws://localhost:9090/ws/device',
      is_bound: false,
      update_available: false,
      ota: null,
    });
  });

  test('normalizes reported firmware version before boot registration', async () => {
    wechatService.bootRegister.mockResolvedValue({
      device_key: 'device-token',
      device: { wechat_user_id: null },
    });
    const { checkBootReport } = require('../services/otaCheckService');

    await checkBootReport({
      mac: 'AA:BB:CC:DD:EE:FF',
      board_type: 'esp32-s3-box',
      firmware_version: 'v02.004.001',
    });

    expect(wechatService.bootRegister).toHaveBeenCalledWith({
      mac: 'AA:BB:CC:DD:EE:FF',
      board_type: 'esp32-s3-box',
      firmware_version: '2.4.1',
    });
  });

  test('passes null firmware version when the device reports a malformed version', async () => {
    wechatService.bootRegister.mockResolvedValue({
      device_key: 'device-token',
      device: { wechat_user_id: null },
    });
    const { checkBootReport } = require('../services/otaCheckService');

    await checkBootReport({
      mac: 'AA:BB:CC:DD:EE:FF',
      board_type: 'esp32-s3-box',
      firmware_version: 'latest',
    });

    expect(wechatService.bootRegister).toHaveBeenCalledWith({
      mac: 'AA:BB:CC:DD:EE:FF',
      board_type: 'esp32-s3-box',
      firmware_version: null,
    });
  });

  test('returns update envelope when a newer active firmware release exists', async () => {
    process.env.WS_BASE_URL = 'ws://device.example.test';
    wechatService.bootRegister.mockResolvedValue({
      device_key: 'device-token',
      device: {
        mac_address: 'AA:BB:CC:DD:EE:FF',
        board_type: 'esp32-s3-box',
        firmware: '2.4.1',
        wechat_user_id: null,
      },
    });
    firmwareReleaseService.findLatestActiveRelease.mockResolvedValue({
      version: '2.5.0',
      artifact_url: 'https://firmware.example.test/esp32.bin',
      sha256: 'a'.repeat(64),
      size_bytes: 1024,
      force_update: false,
      release_notes: 'bug fixes',
    });
    const { checkBootReport } = require('../services/otaCheckService');

    const result = await checkBootReport({
      mac: 'AA:BB:CC:DD:EE:FF',
      board_type: 'esp32-s3-box',
      firmware_version: '2.4.1',
    });

    expect(firmwareReleaseService.findLatestActiveRelease).toHaveBeenCalledWith({
      boardType: 'esp32-s3-box',
      channel: 'stable',
    });
    expect(result).toMatchObject({
      token: 'device-token',
      update_available: true,
      ota: {
        version: '2.5.0',
        url: 'https://firmware.example.test/esp32.bin',
        sha256: 'a'.repeat(64),
        size_bytes: 1024,
        force: false,
        release_notes: 'bug fixes',
      },
    });
  });

  test('normalizes reported board type before release lookup', async () => {
    wechatService.bootRegister.mockResolvedValue({
      device_key: 'device-token',
      device: {
        board_type: 'esp32-s3-box',
        firmware: '2.4.1',
        wechat_user_id: null,
      },
    });
    firmwareReleaseService.findLatestActiveRelease.mockResolvedValue(null);
    const { checkBootReport } = require('../services/otaCheckService');

    await checkBootReport({
      mac: 'AA:BB:CC:DD:EE:FF',
      board_type: ' esp32-s3-box ',
      firmware_version: '2.4.1',
    });

    expect(firmwareReleaseService.findLatestActiveRelease).toHaveBeenCalledWith({
      boardType: 'esp32-s3-box',
      channel: 'stable',
    });
  });

  test('returns no update when release version is same or older', async () => {
    wechatService.bootRegister.mockResolvedValue({
      device_key: 'device-token',
      device: { board_type: 'esp32-s3-box', firmware: '2.5.0', wechat_user_id: null },
    });
    firmwareReleaseService.findLatestActiveRelease.mockResolvedValue({
      version: '2.5.0',
      artifact_url: 'https://firmware.example.test/esp32.bin',
      sha256: 'a'.repeat(64),
    });
    const { checkBootReport } = require('../services/otaCheckService');

    await expect(checkBootReport({
      mac: 'AA:BB:CC:DD:EE:FF',
      board_type: 'esp32-s3-box',
      firmware_version: '2.5.0',
    })).resolves.toMatchObject({
      update_available: false,
      ota: null,
    });
  });

  test('returns no update when current firmware is unknown', async () => {
    wechatService.bootRegister.mockResolvedValue({
      device_key: 'device-token',
      device: { board_type: 'esp32-s3-box', firmware: null, wechat_user_id: null },
    });
    const { checkBootReport } = require('../services/otaCheckService');

    await expect(checkBootReport({
      mac: 'AA:BB:CC:DD:EE:FF',
      board_type: 'esp32-s3-box',
      firmware_version: 'latest',
    })).resolves.toMatchObject({
      update_available: false,
      ota: null,
    });
    expect(firmwareReleaseService.findLatestActiveRelease).not.toHaveBeenCalled();
  });

  test('keeps boot compatible when release lookup fails', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    wechatService.bootRegister.mockResolvedValue({
      device_key: 'device-token',
      device: { board_type: 'esp32-s3-box', firmware: '2.4.1', wechat_user_id: null },
    });
    firmwareReleaseService.findLatestActiveRelease.mockRejectedValue(new Error('redis or db failure'));
    const { checkBootReport } = require('../services/otaCheckService');

    await expect(checkBootReport({
      mac: 'AA:BB:CC:DD:EE:FF',
      board_type: 'esp32-s3-box',
      firmware_version: '2.4.1',
    })).resolves.toMatchObject({
      update_available: false,
      ota: null,
    });
    expect(consoleSpy).toHaveBeenCalledWith('[OTA] release lookup failed:', 'redis or db failure');
    consoleSpy.mockRestore();
  });
});
