jest.mock('../config/database', () => ({
  productionKey: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
}));

const crypto = require('crypto');
const prisma = require('../config/database');

function sign({ mac, sn, timestamp, nonce, psk }) {
  return crypto
    .createHmac('sha256', psk)
    .update(`${mac}\n${sn}\n${timestamp}\n${nonce}`)
    .digest('hex');
}

describe('deviceIdentityService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('allows unsigned boot requests when PSK is not required', async () => {
    delete process.env.REQUIRE_DEVICE_PSK;
    const { verifyBootRequest } = require('../services/deviceIdentityService');

    await expect(verifyBootRequest({ mac: 'AA:BB:CC:DD:EE:FF' })).resolves.toEqual({
      allowed: true,
      mode: 'development',
    });
    expect(prisma.productionKey.findUnique).not.toHaveBeenCalled();
  });

  test('rejects missing signature fields when PSK is required', async () => {
    process.env.REQUIRE_DEVICE_PSK = 'true';
    const { verifyBootRequest } = require('../services/deviceIdentityService');

    await expect(verifyBootRequest({ mac: 'AA:BB:CC:DD:EE:FF' })).resolves.toMatchObject({
      allowed: false,
      statusCode: 403,
      reason: 'device_signature_required',
    });
    expect(prisma.productionKey.findUnique).not.toHaveBeenCalled();
  });

  test('accepts valid signatures and updates nonce state', async () => {
    process.env.REQUIRE_DEVICE_PSK = 'true';
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = 'nonce-1';
    const psk = 'device-secret';
    const mac = 'AA:BB:CC:DD:EE:FF';
    const sn = 'SN001';
    prisma.productionKey.findUnique.mockResolvedValue({
      mac_address: mac,
      sn,
      psk_encrypted: psk,
      is_active: true,
      last_nonce: null,
    });
    prisma.productionKey.update.mockResolvedValue({});

    const { verifyBootRequest } = require('../services/deviceIdentityService');

    await expect(
      verifyBootRequest({
        mac: 'aa:bb:cc:dd:ee:ff',
        sn,
        timestamp,
        nonce,
        signature: sign({ mac, sn, timestamp, nonce, psk }),
      })
    ).resolves.toMatchObject({ allowed: true, mode: 'psk' });

    expect(prisma.productionKey.findUnique).toHaveBeenCalledWith({
      where: { mac_address: mac },
    });
    expect(prisma.productionKey.update).toHaveBeenCalledWith({
      where: { mac_address: mac },
      data: {
        last_nonce: nonce,
        last_seen_at: expect.any(Date),
      },
    });
  });

  test('rejects unknown production keys', async () => {
    process.env.REQUIRE_DEVICE_PSK = 'true';
    prisma.productionKey.findUnique.mockResolvedValue(null);
    const timestamp = Math.floor(Date.now() / 1000);
    const { verifyBootRequest } = require('../services/deviceIdentityService');

    await expect(
      verifyBootRequest({
        mac: 'AA:BB:CC:DD:EE:FF',
        sn: 'SN001',
        timestamp,
        nonce: 'nonce-1',
        signature: 'a'.repeat(64),
      })
    ).resolves.toMatchObject({ allowed: false, reason: 'device_not_provisioned' });
    expect(prisma.productionKey.update).not.toHaveBeenCalled();
  });

  test('rejects inactive production keys', async () => {
    process.env.REQUIRE_DEVICE_PSK = 'true';
    prisma.productionKey.findUnique.mockResolvedValue({
      mac_address: 'AA:BB:CC:DD:EE:FF',
      sn: 'SN001',
      psk_encrypted: 'device-secret',
      is_active: false,
      last_nonce: null,
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const { verifyBootRequest } = require('../services/deviceIdentityService');

    await expect(
      verifyBootRequest({
        mac: 'AA:BB:CC:DD:EE:FF',
        sn: 'SN001',
        timestamp,
        nonce: 'nonce-1',
        signature: 'a'.repeat(64),
      })
    ).resolves.toMatchObject({ allowed: false, reason: 'device_not_provisioned' });
    expect(prisma.productionKey.update).not.toHaveBeenCalled();
  });

  test('rejects stale timestamps before loading production keys', async () => {
    process.env.REQUIRE_DEVICE_PSK = 'true';
    const { verifyBootRequest } = require('../services/deviceIdentityService');

    await expect(
      verifyBootRequest({
        mac: 'AA:BB:CC:DD:EE:FF',
        sn: 'SN001',
        timestamp: Math.floor(Date.now() / 1000) - 301,
        nonce: 'nonce-1',
        signature: 'a'.repeat(64),
      })
    ).resolves.toMatchObject({ allowed: false, reason: 'device_timestamp_stale' });
    expect(prisma.productionKey.findUnique).not.toHaveBeenCalled();
  });

  test('rejects replayed nonce', async () => {
    process.env.REQUIRE_DEVICE_PSK = 'true';
    prisma.productionKey.findUnique.mockResolvedValue({
      mac_address: 'AA:BB:CC:DD:EE:FF',
      sn: 'SN001',
      psk_encrypted: 'device-secret',
      is_active: true,
      last_nonce: 'nonce-1',
    });
    const { verifyBootRequest } = require('../services/deviceIdentityService');

    await expect(
      verifyBootRequest({
        mac: 'AA:BB:CC:DD:EE:FF',
        sn: 'SN001',
        timestamp: Math.floor(Date.now() / 1000),
        nonce: 'nonce-1',
        signature: 'a'.repeat(64),
      })
    ).resolves.toMatchObject({ allowed: false, reason: 'device_nonce_replayed' });
    expect(prisma.productionKey.update).not.toHaveBeenCalled();
  });

  test('rejects serial number mismatch', async () => {
    process.env.REQUIRE_DEVICE_PSK = 'true';
    prisma.productionKey.findUnique.mockResolvedValue({
      mac_address: 'AA:BB:CC:DD:EE:FF',
      sn: 'SN001',
      psk_encrypted: 'device-secret',
      is_active: true,
      last_nonce: null,
    });
    const { verifyBootRequest } = require('../services/deviceIdentityService');

    await expect(
      verifyBootRequest({
        mac: 'AA:BB:CC:DD:EE:FF',
        sn: 'SN002',
        timestamp: Math.floor(Date.now() / 1000),
        nonce: 'nonce-2',
        signature: 'a'.repeat(64),
      })
    ).resolves.toMatchObject({ allowed: false, reason: 'device_serial_mismatch' });
    expect(prisma.productionKey.update).not.toHaveBeenCalled();
  });

  test('rejects keys without an available signing secret', async () => {
    process.env.REQUIRE_DEVICE_PSK = 'true';
    prisma.productionKey.findUnique.mockResolvedValue({
      mac_address: 'AA:BB:CC:DD:EE:FF',
      sn: 'SN001',
      psk_encrypted: null,
      is_active: true,
      last_nonce: null,
    });
    const { verifyBootRequest } = require('../services/deviceIdentityService');

    await expect(
      verifyBootRequest({
        mac: 'AA:BB:CC:DD:EE:FF',
        sn: 'SN001',
        timestamp: Math.floor(Date.now() / 1000),
        nonce: 'nonce-2',
        signature: 'a'.repeat(64),
      })
    ).resolves.toMatchObject({ allowed: false, reason: 'device_secret_unavailable' });
    expect(prisma.productionKey.update).not.toHaveBeenCalled();
  });

  test('rejects invalid signatures', async () => {
    process.env.REQUIRE_DEVICE_PSK = 'true';
    const mac = 'AA:BB:CC:DD:EE:FF';
    const sn = 'SN001';
    const timestamp = Math.floor(Date.now() / 1000);
    prisma.productionKey.findUnique.mockResolvedValue({
      mac_address: mac,
      sn,
      psk_encrypted: 'device-secret',
      is_active: true,
      last_nonce: null,
    });
    const { verifyBootRequest } = require('../services/deviceIdentityService');

    await expect(
      verifyBootRequest({
        mac,
        sn,
        timestamp,
        nonce: 'nonce-2',
        signature: sign({ mac, sn, timestamp, nonce: 'nonce-2', psk: 'wrong-secret' }),
      })
    ).resolves.toMatchObject({ allowed: false, reason: 'device_signature_invalid' });
    expect(prisma.productionKey.update).not.toHaveBeenCalled();
  });
});
