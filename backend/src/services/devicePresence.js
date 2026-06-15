const prisma = require('../config/database');
const { touchDevice } = require('../utils/dbTime');

async function markConnected(mac) {
  return touchDevice(mac, { is_online: true });
}

async function markHeartbeat(mac) {
  return touchDevice(mac, { is_online: true });
}

async function markDisconnected(mac) {
  return prisma.device.update({
    where: { mac_address: mac },
    data: { is_online: false },
  });
}

function normalizeStaleMinutes(staleMinutes) {
  const minutes = Number(staleMinutes);
  if (!Number.isInteger(minutes) || minutes <= 0) {
    throw new Error('staleMinutes must be a positive integer');
  }
  return minutes;
}

async function expireStale({ staleMinutes = 2 } = {}) {
  const minutes = normalizeStaleMinutes(staleMinutes);
  return prisma.$executeRawUnsafe(`
    UPDATE devices
    SET is_online = false
    WHERE is_online = true
      AND last_seen < (NOW() - INTERVAL ${minutes} MINUTE)
  `);
}

module.exports = { markConnected, markHeartbeat, markDisconnected, expireStale };
