const { bootRegister } = require('./wechatService');
const { normalizeVersion, compareVersions } = require('./firmwareVersionPolicy');
const firmwareReleaseService = require('./firmwareReleaseService');

function buildBaseResponse({ device, device_key, wsBase }) {
  return {
    token: device_key,
    websocket_url: `${wsBase}/ws/device`,
    is_bound: device?.wechat_user_id != null,
    update_available: false,
    ota: null,
    retry_policy: {
      retry_after_seconds: 30,
    },
  };
}

function buildUpdateResponse({ device, device_key, wsBase, release }) {
  return {
    token: device_key,
    websocket_url: `${wsBase}/ws/device`,
    is_bound: device?.wechat_user_id != null,
    update_available: true,
    ota: {
      version: release.version,
      url: release.artifact_url,
      sha256: release.sha256,
      size_bytes: release.size_bytes ?? null,
      force: Boolean(release.force_update),
      release_notes: release.release_notes ?? null,
    },
    retry_policy: {
      retry_after_seconds: 30,
    },
  };
}

function getWebSocketBaseUrl() {
  return process.env.WS_BASE_URL || `ws://localhost:${process.env.PORT || 8088}`;
}

function normalizeBoardType(boardType) {
  return typeof boardType === 'string' ? boardType.trim() : '';
}

async function checkBootReport({ mac, board_type, firmware_version }) {
  const currentVersion = normalizeVersion(firmware_version);
  const { device, device_key } = await bootRegister({
    mac,
    board_type,
    firmware_version: currentVersion,
  });
  const wsBase = getWebSocketBaseUrl();
  const baseResponse = buildBaseResponse({ device, device_key, wsBase });
  const boardType = normalizeBoardType(board_type || device?.board_type);

  if (!boardType || !currentVersion) {
    return baseResponse;
  }

  try {
    const release = await firmwareReleaseService.findLatestActiveRelease({
      boardType,
      channel: 'stable',
    });

    if (!release || compareVersions(release.version, currentVersion) <= 0) {
      return baseResponse;
    }

    return buildUpdateResponse({ device, device_key, wsBase, release });
  } catch (error) {
    console.error('[OTA] release lookup failed:', error.message);
    return baseResponse;
  }
}

module.exports = { checkBootReport, getWebSocketBaseUrl };
