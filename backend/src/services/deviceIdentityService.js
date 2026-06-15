const crypto = require('crypto');
const prisma = require('../config/database');

const MAX_SKEW_SECONDS = 300;

function isRequired() {
  return process.env.REQUIRE_DEVICE_PSK === 'true';
}

function normalizeMac(mac) {
  return typeof mac === 'string' ? mac.trim().toUpperCase() : '';
}

function canonicalPayload({ mac, sn, timestamp, nonce }) {
  return `${mac}\n${sn}\n${timestamp}\n${nonce}`;
}

function hmacHex(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function safeEqualHex(left, right) {
  if (!/^[0-9a-fA-F]+$/.test(left) || !/^[0-9a-fA-F]+$/.test(right)) {
    return false;
  }

  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function denied(reason) {
  return { allowed: false, statusCode: 403, reason };
}

function parseTimestampSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric > 9999999999 ? Math.floor(numeric / 1000) : Math.floor(numeric);
}

function timestampFresh(timestamp) {
  const seconds = parseTimestampSeconds(timestamp);
  if (!seconds) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  return Math.abs(now - seconds) <= MAX_SKEW_SECONDS;
}

async function verifyBootRequest(input = {}) {
  if (!isRequired()) {
    return { allowed: true, mode: 'development' };
  }

  const mac = normalizeMac(input.mac);
  const { sn, timestamp, nonce, signature } = input;
  if (!mac || !sn || !timestamp || !nonce || !signature) {
    return denied('device_signature_required');
  }

  if (!timestampFresh(timestamp)) {
    return denied('device_timestamp_stale');
  }

  const key = await prisma.productionKey.findUnique({
    where: { mac_address: mac },
  });
  if (!key || !key.is_active) {
    return denied('device_not_provisioned');
  }
  if (key.sn && key.sn !== sn) {
    return denied('device_serial_mismatch');
  }
  if (key.last_nonce && key.last_nonce === nonce) {
    return denied('device_nonce_replayed');
  }
  if (!key.psk_encrypted) {
    return denied('device_secret_unavailable');
  }

  const expected = hmacHex(canonicalPayload({ mac, sn, timestamp, nonce }), key.psk_encrypted);
  if (!safeEqualHex(expected, signature)) {
    return denied('device_signature_invalid');
  }

  await prisma.productionKey.update({
    where: { mac_address: mac },
    data: {
      last_nonce: nonce,
      last_seen_at: new Date(),
    },
  });

  return { allowed: true, mode: 'psk' };
}

module.exports = {
  verifyBootRequest,
  canonicalPayload,
  hmacHex,
};
