const {
  parseStoredCapabilities,
  normalizeHelloCapabilities,
  toClientCapabilitySummary,
} = require('../services/deviceCapability');

describe('deviceCapability', () => {
  describe('parseStoredCapabilities', () => {
    test('returns null for null, blank, and invalid stored JSON without throwing', () => {
      expect(() => parseStoredCapabilities(null)).not.toThrow();
      expect(() => parseStoredCapabilities('')).not.toThrow();
      expect(() => parseStoredCapabilities('{bad json')).not.toThrow();

      expect(parseStoredCapabilities(null)).toBeNull();
      expect(parseStoredCapabilities('')).toBeNull();
      expect(parseStoredCapabilities('{bad json')).toBeNull();
    });

    test('accepts either a stored JSON string or a device row with capabilities text', () => {
      const stored = JSON.stringify({ schema_version: 2, display: { kind: 'lcd' } });

      expect(parseStoredCapabilities(stored)).toEqual({
        schema_version: 2,
        display: { kind: 'lcd' },
      });
      expect(parseStoredCapabilities({ capabilities: stored })).toEqual({
        schema_version: 2,
        display: { kind: 'lcd' },
      });
    });
  });

  describe('normalizeHelloCapabilities', () => {
    test('preserves unknown object fields and adds a default schema_version', () => {
      const normalized = normalizeHelloCapabilities({
        display: { width: 320, height: 240 },
        vendor_feature: { mode: 'lab' },
      });

      expect(normalized).toEqual({
        schema_version: 1,
        display: { width: 320, height: 240 },
        vendor_feature: { mode: 'lab' },
      });
    });

    test('can return a storable JSON string when requested', () => {
      const normalized = normalizeHelloCapabilities(
        { schema_version: 3, audio: { input: true } },
        { stringify: true }
      );

      expect(typeof normalized).toBe('string');
      expect(JSON.parse(normalized)).toEqual({
        schema_version: 3,
        audio: { input: true },
      });
    });
  });

  describe('toClientCapabilitySummary', () => {
    test('builds a conservative UI summary from capabilities, board_type, and firmware', () => {
      const summary = toClientCapabilitySummary({
        board_type: 'esp32-s3-box',
        firmware: '2.4.1',
        capabilities: JSON.stringify({
          schema_version: 2,
          display: { width: 320, height: 240, touch: true },
          audio: { input: true, output: true },
          input: { buttons: ['boot'], touch: true },
          output: { leds: 1 },
          commands: ['reboot', 'ota'],
          experimental_sensor: { present: true },
        }),
      });

      expect(summary).toEqual({
        schema_version: 2,
        board_type: 'esp32-s3-box',
        firmware: '2.4.1',
        display: { available: true, width: 320, height: 240, touch: true },
        audio: { input: true, output: true },
        input: { available: true, buttons: ['boot'], touch: true },
        output: { available: true, leds: true },
        commands: ['reboot', 'ota'],
      });
    });

    test('returns empty conservative defaults when stored capabilities are missing or invalid', () => {
      expect(toClientCapabilitySummary({ board_type: 'esp32-c3', firmware: '1.0.0', capabilities: '{bad' })).toEqual({
        schema_version: null,
        board_type: 'esp32-c3',
        firmware: '1.0.0',
        display: { available: false },
        audio: { input: false, output: false },
        input: { available: false },
        output: { available: false },
        commands: [],
      });
    });
  });
});
