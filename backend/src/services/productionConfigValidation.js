function isProductionTransportRequired(env = process.env) {
  return env.NODE_ENV === 'production';
}

function hasScheme(value, scheme) {
  return typeof value === 'string' && value.trim().toLowerCase().startsWith(scheme);
}

function validateProductionTransportConfig(env = process.env) {
  if (!isProductionTransportRequired(env)) {
    return [];
  }

  const errors = [];

  if (!env.WS_BASE_URL) {
    errors.push('WS_BASE_URL must be set when production transport is required');
  } else if (!hasScheme(env.WS_BASE_URL, 'wss://')) {
    errors.push('WS_BASE_URL must use wss:// in production');
  }

  if (env.PUBLIC_BASE_URL && !hasScheme(env.PUBLIC_BASE_URL, 'https://')) {
    errors.push('PUBLIC_BASE_URL must use https:// in production');
  }

  if (env.FIRMWARE_PUBLIC_BASE_URL && !hasScheme(env.FIRMWARE_PUBLIC_BASE_URL, 'https://')) {
    errors.push('FIRMWARE_PUBLIC_BASE_URL must use https:// in production');
  }

  return errors;
}

function assertProductionTransportConfig(env = process.env) {
  const errors = validateProductionTransportConfig(env);
  if (errors.length === 0) {
    return;
  }

  throw new Error(`Unsafe production transport config: ${errors.join('; ')}`);
}

function isHttpsUrl(value) {
  return hasScheme(value, 'https://');
}

module.exports = {
  assertProductionTransportConfig,
  isHttpsUrl,
  isProductionTransportRequired,
  validateProductionTransportConfig,
};
