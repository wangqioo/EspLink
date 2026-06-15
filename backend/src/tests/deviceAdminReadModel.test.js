const { buildDeviceAdminRow, buildDeviceAdminList } = require('../services/deviceAdminReadModel');

function makeDevice(overrides = {}) {
  return {
    mac_address: 'AA:BB:CC:DD:EE:FF',
    name: 'Desk Device',
    board_type: 'esp32s3',
    firmware: '1.2.3',
    capabilities: JSON.stringify({ audio: true, display: false, wake_word: true }),
    is_online: false,
    last_seen: new Date('2026-06-14T04:59:30.000Z'),
    ...overrides,
  };
}

describe('deviceAdminReadModel', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-14T05:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('classifies a WS-connected device as online', () => {
    const row = buildDeviceAdminRow(makeDevice({
      is_online: false,
      api_key: { id: 'key-1', name: 'Desk Key' },
      tenant: { id: 7, name: 'Tenant A' },
      is_paired: true,
      device_id: 'device-123',
    }), { wsConnected: true });

    expect(row).toMatchObject({
      mac_address: 'AA:BB:CC:DD:EE:FF',
      name: 'Desk Device',
      board_type: 'esp32s3',
      firmware: '1.2.3',
      api_key: { id: 'key-1', name: 'Desk Key' },
      tenant: { id: 7, name: 'Tenant A' },
      is_paired: true,
      device_id: 'device-123',
      db_online: false,
      ws_connected: true,
      admin_status: 'online',
    });
  });

  test('classifies DB-online but WS-disconnected devices as stale_or_unknown', () => {
    const row = buildDeviceAdminRow(makeDevice({ is_online: true }), { wsConnected: false });

    expect(row.admin_status).toBe('stale_or_unknown');
    expect(row.db_online).toBe(true);
    expect(row.ws_connected).toBe(false);
  });

  test('classifies DB-offline and WS-disconnected devices as offline', () => {
    const row = buildDeviceAdminRow(makeDevice({ is_online: false }), { wsConnected: false });

    expect(row.admin_status).toBe('offline');
  });

  test('computes seconds_since_seen from last_seen', () => {
    const row = buildDeviceAdminRow(makeDevice({ last_seen: new Date('2026-06-14T04:58:45.000Z') }), {
      wsConnected: false,
    });

    expect(row.seconds_since_seen).toBe(75);
  });

  test('does not throw on malformed capabilities', () => {
    expect(() =>
      buildDeviceAdminRow(makeDevice({ capabilities: '{not json' }), { wsConnected: false })
    ).not.toThrow();
  });

  test('builds a list using the injected WS connection lookup', () => {
    const devices = [
      makeDevice({ mac_address: 'AA:BB:CC:DD:EE:01' }),
      makeDevice({ mac_address: 'AA:BB:CC:DD:EE:02', is_online: true }),
    ];
    const isConnected = jest.fn((mac) => mac.endsWith(':01'));

    const rows = buildDeviceAdminList(devices, { isConnected });

    expect(isConnected).toHaveBeenCalledWith('AA:BB:CC:DD:EE:01');
    expect(isConnected).toHaveBeenCalledWith('AA:BB:CC:DD:EE:02');
    expect(rows.map((row) => row.admin_status)).toEqual(['online', 'stale_or_unknown']);
  });
});
