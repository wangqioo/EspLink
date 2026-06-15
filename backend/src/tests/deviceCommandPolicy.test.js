const {
  canSendCommand,
  normalizeCommand,
} = require('../services/deviceCommandPolicy');

describe('deviceCommandPolicy', () => {
  describe('normalizeCommand', () => {
    test('accepts payload.command or payload.type as the command name', () => {
      expect(normalizeCommand({ command: 'reboot' })).toBe('reboot');
      expect(normalizeCommand({ type: 'ping' })).toBe('ping');
    });

    test('returns null for missing, blank, or non-string command names', () => {
      expect(normalizeCommand({})).toBeNull();
      expect(normalizeCommand({ command: '' })).toBeNull();
      expect(normalizeCommand({ type: 123 })).toBeNull();
      expect(normalizeCommand(null)).toBeNull();
    });
  });

  describe('canSendCommand', () => {
    test('rejects wechat actors when the device belongs to a different user', () => {
      expect(
        canSendCommand({
          actor: { type: 'wechat', userId: 42 },
          device: { wechat_user_id: 7 },
          payload: { command: 'reboot' },
        })
      ).toEqual({
        allowed: false,
        command: 'reboot',
        reason: 'forbidden',
        statusCode: 403,
      });
    });

    test('rejects commands outside the policy whitelist', () => {
      expect(
        canSendCommand({
          actor: { type: 'wechat', userId: 42 },
          device: { wechat_user_id: 42 },
          payload: { command: 'factory_reset' },
        })
      ).toEqual({
        allowed: false,
        command: 'factory_reset',
        reason: 'unknown_command',
        statusCode: 400,
      });
    });

    test('rejects commands missing from a non-empty device capability command list', () => {
      expect(
        canSendCommand({
          actor: { type: 'wechat', userId: 42 },
          device: {
            wechat_user_id: 42,
            capabilities: JSON.stringify({ commands: ['ping'] }),
          },
          payload: { command: 'reboot' },
        })
      ).toEqual({
        allowed: false,
        command: 'reboot',
        reason: 'unsupported',
        statusCode: 400,
      });
    });

    test('allows a whitelisted command supported by device capabilities', () => {
      expect(
        canSendCommand({
          actor: { type: 'wechat', userId: 42 },
          device: {
            wechat_user_id: 42,
            capabilities: { commands: ['reboot', 'ping'] },
          },
          payload: { type: 'ping' },
        })
      ).toEqual({
        allowed: true,
        command: 'ping',
        reason: null,
        statusCode: 200,
      });
    });

    test('does not throw for malformed capabilities and falls back to whitelist checks', () => {
      expect(() =>
        canSendCommand({
          actor: { type: 'wechat', userId: 42 },
          device: { wechat_user_id: 42, capabilities: '{bad json' },
          payload: { command: 'set_volume' },
        })
      ).not.toThrow();

      expect(
        canSendCommand({
          actor: { type: 'wechat', userId: 42 },
          device: { wechat_user_id: 42, capabilities: '{bad json' },
          payload: { command: 'set_volume' },
        })
      ).toEqual({
        allowed: true,
        command: 'set_volume',
        reason: null,
        statusCode: 200,
      });
    });

    test('returns not_found when the device does not exist', () => {
      expect(
        canSendCommand({
          actor: { type: 'wechat', userId: 42 },
          device: null,
          payload: { command: 'ping' },
        })
      ).toEqual({
        allowed: false,
        command: 'ping',
        reason: 'not_found',
        statusCode: 404,
      });
    });
  });
});
