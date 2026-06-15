function safeParseCapabilities(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function summarizeCapabilities(raw) {
  const capabilities = safeParseCapabilities(raw);
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) return [];

  return Object.entries(capabilities)
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key)
    .sort();
}

function secondsSinceSeen(lastSeen, now = new Date()) {
  if (!lastSeen) return null;

  const seenAt = lastSeen instanceof Date ? lastSeen : new Date(lastSeen);
  const seenMs = seenAt.getTime();
  if (Number.isNaN(seenMs)) return null;

  return Math.max(0, Math.floor((now.getTime() - seenMs) / 1000));
}

function resolveAdminStatus({ dbOnline, wsConnected }) {
  if (wsConnected) return 'online';
  if (dbOnline) return 'stale_or_unknown';
  return 'offline';
}

function buildDeviceAdminRow(device, { wsConnected } = {}) {
  const dbOnline = Boolean(device?.is_online);
  const connected = Boolean(wsConnected);

  return {
    ...(device || {}),
    mac_address: device?.mac_address ?? null,
    name: device?.name ?? null,
    board_type: device?.board_type ?? null,
    firmware: device?.firmware ?? null,
    capabilities_summary: summarizeCapabilities(device?.capabilities),
    db_online: dbOnline,
    ws_connected: connected,
    seconds_since_seen: secondsSinceSeen(device?.last_seen),
    admin_status: resolveAdminStatus({ dbOnline, wsConnected: connected }),
  };
}

function buildDeviceAdminList(devices, { isConnected } = {}) {
  const lookup = typeof isConnected === 'function' ? isConnected : () => false;

  return (devices || []).map((device) =>
    buildDeviceAdminRow(device, {
      wsConnected: lookup(device?.mac_address),
    })
  );
}

module.exports = {
  buildDeviceAdminRow,
  buildDeviceAdminList,
};
