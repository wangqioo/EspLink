const DEFAULT_SCHEMA_VERSION = 1;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonObject(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;

  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function parseStoredCapabilities(deviceOrString) {
  if (typeof deviceOrString === 'string') {
    return parseJsonObject(deviceOrString);
  }

  if (isPlainObject(deviceOrString)) {
    if (isPlainObject(deviceOrString.capabilities)) return deviceOrString.capabilities;
    return parseJsonObject(deviceOrString.capabilities);
  }

  return null;
}

function normalizeHelloCapabilities(input, context = {}) {
  const parsed = typeof input === 'string' ? parseJsonObject(input) : input;
  if (!isPlainObject(parsed)) return context.stringify ? null : null;

  const normalized = {
    schema_version: parsed.schema_version || DEFAULT_SCHEMA_VERSION,
    ...parsed,
  };

  return context.stringify ? JSON.stringify(normalized) : normalized;
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== false;
}

function asBoolean(value) {
  return value === true || value === 1 || value === 'true' || value === 'yes';
}

function arrayOfStrings(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string');
}

function summarizeDisplay(capabilities) {
  const display = capabilities?.display;
  if (!hasValue(display)) return { available: false };
  if (!isPlainObject(display)) return { available: true };

  return {
    available: true,
    ...(hasValue(display.width) && { width: display.width }),
    ...(hasValue(display.height) && { height: display.height }),
    ...(hasValue(display.touch) && { touch: asBoolean(display.touch) }),
  };
}

function summarizeAudio(capabilities) {
  const audio = capabilities?.audio;
  if (!isPlainObject(audio)) {
    return {
      input: asBoolean(audio),
      output: asBoolean(audio),
    };
  }

  return {
    input: asBoolean(audio.input || audio.microphone || audio.mic),
    output: asBoolean(audio.output || audio.speaker),
  };
}

function summarizeInput(capabilities) {
  const input = capabilities?.input;
  if (!hasValue(input)) return { available: false };
  if (!isPlainObject(input)) return { available: true };

  const buttons = arrayOfStrings(input.buttons);
  return {
    available: true,
    ...(buttons.length > 0 && { buttons }),
    ...(hasValue(input.touch) && { touch: asBoolean(input.touch) }),
  };
}

function summarizeOutput(capabilities) {
  const output = capabilities?.output;
  if (!hasValue(output)) return { available: false };
  if (!isPlainObject(output)) return { available: true };

  return {
    available: true,
    ...(hasValue(output.leds) && { leds: Boolean(output.leds) }),
    ...(hasValue(output.relay) && { relay: Boolean(output.relay) }),
  };
}

function toClientCapabilitySummary(device = {}) {
  const capabilities = parseStoredCapabilities(device);

  return {
    schema_version: capabilities?.schema_version ?? null,
    board_type: device.board_type || null,
    firmware: device.firmware || null,
    display: summarizeDisplay(capabilities),
    audio: summarizeAudio(capabilities),
    input: summarizeInput(capabilities),
    output: summarizeOutput(capabilities),
    commands: arrayOfStrings(capabilities?.commands),
  };
}

module.exports = {
  parseStoredCapabilities,
  normalizeHelloCapabilities,
  toClientCapabilitySummary,
};
