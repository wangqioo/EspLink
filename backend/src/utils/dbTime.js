const prisma = require('../config/database');

async function touchDevice(mac, data = {}) {
  const sets = ['last_seen = NOW()'];
  const values = [];

  for (const [key, value] of Object.entries(data)) {
    sets.push(`${key} = ?`);
    values.push(value);
  }

  return prisma.$executeRawUnsafe(
    `UPDATE devices SET ${sets.join(', ')} WHERE mac_address = ?`,
    ...values,
    mac
  );
}

module.exports = { touchDevice };
