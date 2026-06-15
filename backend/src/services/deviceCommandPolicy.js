const { parseStoredCapabilities } = require('./deviceCapability');

const ALLOWED_COMMANDS = new Set([
  'reboot',
  'ota_check',
  'set_volume',
  'display_message',
  'ping',
]);

function normalizeCommand(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;

  const command = payload.command ?? payload.type;
  if (typeof command !== 'string') return null;

  const normalized = command.trim();
  return normalized || null;
}

function denied(command, reason, statusCode) {
  return {
    allowed: false,
    command,
    reason,
    statusCode,
  };
}

function allowed(command) {
  return {
    allowed: true,
    command,
    reason: null,
    statusCode: 200,
  };
}

function capabilityCommands(device) {
  const capabilities = parseStoredCapabilities(device);
  if (!capabilities || !Array.isArray(capabilities.commands)) return [];

  return capabilities.commands.filter((command) => typeof command === 'string');
}

function canSendCommand({ actor, device, payload } = {}) {
  const command = normalizeCommand(payload);

  if (!device) return denied(command, 'not_found', 404);

  if (actor?.type === 'wechat' && device.wechat_user_id !== actor.userId) {
    return denied(command, 'forbidden', 403);
  }

  if (!command || !ALLOWED_COMMANDS.has(command)) {
    return denied(command, 'unknown_command', 400);
  }

  const supportedCommands = capabilityCommands(device);
  if (supportedCommands.length > 0 && !supportedCommands.includes(command)) {
    return denied(command, 'unsupported', 400);
  }

  return allowed(command);
}

module.exports = {
  ALLOWED_COMMANDS,
  normalizeCommand,
  canSendCommand,
};
