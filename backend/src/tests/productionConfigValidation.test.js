const {
  assertProductionTransportConfig,
  isProductionTransportRequired,
  validateProductionTransportConfig,
} = require('../services/productionConfigValidation');

describe('productionConfigValidation', () => {
  test('does not require secure transport outside production', () => {
    expect(validateProductionTransportConfig({
      NODE_ENV: 'development',
      WS_BASE_URL: 'ws://localhost:8088',
      PUBLIC_BASE_URL: 'http://localhost:8088',
      FIRMWARE_PUBLIC_BASE_URL: 'http://localhost:8088/firmware',
    })).toEqual([]);
  });

  test('requires wss websocket base URL in production', () => {
    expect(validateProductionTransportConfig({
      NODE_ENV: 'production',
      WS_BASE_URL: 'ws://api.example.test',
    })).toEqual(['WS_BASE_URL must use wss:// in production']);
  });

  test('does not treat signed device mode as production transport mode', () => {
    expect(validateProductionTransportConfig({
      REQUIRE_DEVICE_PSK: 'true',
      WS_BASE_URL: 'ws://localhost:8088',
      PUBLIC_BASE_URL: 'http://localhost:8088',
    })).toEqual([]);
  });

  test('requires https public base URLs in production when configured', () => {
    expect(validateProductionTransportConfig({
      NODE_ENV: 'production',
      WS_BASE_URL: 'wss://api.example.test',
      PUBLIC_BASE_URL: 'http://api.example.test',
      FIRMWARE_PUBLIC_BASE_URL: 'http://api.example.test/firmware',
    })).toEqual([
      'PUBLIC_BASE_URL must use https:// in production',
      'FIRMWARE_PUBLIC_BASE_URL must use https:// in production',
    ]);
  });

  test('accepts secure production transport config', () => {
    expect(validateProductionTransportConfig({
      NODE_ENV: 'production',
      WS_BASE_URL: 'wss://api.example.test',
      PUBLIC_BASE_URL: 'https://api.example.test',
      FIRMWARE_PUBLIC_BASE_URL: 'https://api.example.test/firmware',
    })).toEqual([]);
  });

  test('treats NODE_ENV=production as production transport mode', () => {
    expect(isProductionTransportRequired({
      NODE_ENV: 'production',
    })).toBe(true);
  });

  test('assertion throws with all validation messages', () => {
    expect(() => assertProductionTransportConfig({
      NODE_ENV: 'production',
      WS_BASE_URL: 'ws://api.example.test',
      PUBLIC_BASE_URL: 'http://api.example.test',
    })).toThrow('Unsafe production transport config: WS_BASE_URL must use wss:// in production; PUBLIC_BASE_URL must use https:// in production');
  });
});
