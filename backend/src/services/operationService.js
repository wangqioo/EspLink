const prisma = require('../config/database');

async function getOverview() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [tenantCount, keyCount, deviceCount, onlineCount, todayPaired, todayCalls, monthCalls] = await Promise.all([
    prisma.tenant.count(),
    prisma.apiKey.count({ where: { is_active: true } }),
    prisma.device.count(),
    prisma.device.count({ where: { is_online: true } }),
    prisma.device.count({ where: { is_paired: true, paired_at: { gte: todayStart } } }),
    prisma.usageLog.count({ where: { timestamp: { gte: todayStart } } }),
    prisma.usageLog.count({ where: { timestamp: { gte: monthStart } } }),
  ]);

  return {
    tenant_count: tenantCount,
    active_key_count: keyCount,
    device_count: deviceCount,
    online_count: onlineCount,
    today_paired: todayPaired,
    today_calls: todayCalls,
    month_calls: monthCalls,
  };
}

async function getTopTenants(limit = 10) {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const rows = await prisma.usageHourly.groupBy({
    by: ['tenant_id'],
    where: { hour_timestamp: { gte: monthStart } },
    _sum: { call_count: true },
    orderBy: { _sum: { call_count: 'desc' } },
    take: limit,
  });

  if (!rows.length) return [];

  const tenantIds = rows.map((r) => r.tenant_id);
  const tenants = await prisma.tenant.findMany({
    where: { id: { in: tenantIds } },
    select: { id: true, name: true, level: true },
  });

  const tenantMap = Object.fromEntries(tenants.map((t) => [t.id, t]));
  return rows.map((r) => ({
    ...tenantMap[r.tenant_id],
    month_calls: r._sum.call_count || 0,
  }));
}

async function getActiveDevices() {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const active = await prisma.device.count({
    where: { last_seen: { gte: monthStart } },
  });
  const total = await prisma.device.count();

  return { active_this_month: active, total };
}

module.exports = { getOverview, getTopTenants, getActiveDevices };
