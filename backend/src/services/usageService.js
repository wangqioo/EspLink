const prisma = require('../config/database');

async function recordUsage({ apiKeyId, deviceMac, deviceId, model, inputTokens, outputTokens, latencyMs, success, errorMsg }) {
  return prisma.usageLog.create({
    data: {
      api_key_id: apiKeyId,
      device_mac: deviceMac || null,
      device_id: deviceId || null,
      model: model || null,
      input_tokens: inputTokens || 0,
      output_tokens: outputTokens || 0,
      latency_ms: latencyMs || null,
      success: success !== false,
      error_msg: errorMsg || null,
    },
  });
}

async function getSummary({ tenantId } = {}) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const keyWhere = tenantId ? { api_key: { tenant_id: parseInt(tenantId) } } : {};
  const deviceWhere = tenantId ? { tenant_id: parseInt(tenantId) } : {};

  const [todayCount, monthCount, totalCount, onlineDevices, totalDevices, tenantCount] = await Promise.all([
    prisma.usageLog.count({ where: { ...keyWhere, timestamp: { gte: todayStart } } }),
    prisma.usageLog.count({ where: { ...keyWhere, timestamp: { gte: monthStart } } }),
    prisma.usageLog.count({ where: keyWhere }),
    prisma.device.count({ where: { is_online: true, ...deviceWhere } }),
    prisma.device.count({ where: deviceWhere }),
    prisma.tenant.count(),
  ]);

  return {
    today_calls: todayCount,
    month_calls: monthCount,
    total_calls: totalCount,
    online_count: onlineDevices,
    online_devices: onlineDevices,
    total_devices: totalDevices,
    tenant_count: tenantCount,
  };
}

async function getDailyStats({ tenantId, days = 7 }) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // 优先查聚合表（usage_hourly），按天合并
  const hourlyData = await prisma.usageHourly.groupBy({
    by: ['hour_timestamp'],
    where: {
      hour_timestamp: { gte: since },
      ...(tenantId && { tenant_id: parseInt(tenantId) }),
    },
    _sum: { call_count: true, input_tokens: true, output_tokens: true },
    orderBy: { hour_timestamp: 'asc' },
  });

  if (hourlyData.length > 0) {
    const dailyMap = {};
    for (const row of hourlyData) {
      const day = row.hour_timestamp.toISOString().slice(0, 10);
      if (!dailyMap[day]) dailyMap[day] = { date: day, calls: 0, input_tokens: 0, output_tokens: 0 };
      dailyMap[day].calls += row._sum.call_count || 0;
      dailyMap[day].input_tokens += row._sum.input_tokens || 0;
      dailyMap[day].output_tokens += row._sum.output_tokens || 0;
    }
    return Object.values(dailyMap);
  }

  // 兜底：聚合表为空（首次部署，还没跑过聚合任务）时直接查明细表
  let apiKeyIds;
  if (tenantId) {
    const keys = await prisma.apiKey.findMany({
      where: { tenant_id: parseInt(tenantId) },
      select: { id: true },
    });
    apiKeyIds = keys.map((k) => k.id);
  }

  const logs = await prisma.usageLog.findMany({
    where: {
      timestamp: { gte: since },
      ...(apiKeyIds && { api_key_id: { in: apiKeyIds } }),
    },
    select: { timestamp: true, input_tokens: true, output_tokens: true },
    orderBy: { timestamp: 'asc' },
  });

  const dailyMap = {};
  for (const log of logs) {
    const day = log.timestamp.toISOString().slice(0, 10);
    if (!dailyMap[day]) dailyMap[day] = { date: day, calls: 0, input_tokens: 0, output_tokens: 0 };
    dailyMap[day].calls += 1;
    dailyMap[day].input_tokens += log.input_tokens;
    dailyMap[day].output_tokens += log.output_tokens;
  }
  return Object.values(dailyMap);
}

async function getStatsByKey(keyId, days = 7) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.usageHourly.aggregate({
    where: { api_key_id: keyId, hour_timestamp: { gte: since } },
    _sum: { call_count: true, input_tokens: true, output_tokens: true, fail_count: true },
  });

  return {
    calls: rows._sum.call_count || 0,
    input_tokens: rows._sum.input_tokens || 0,
    output_tokens: rows._sum.output_tokens || 0,
    fail_count: rows._sum.fail_count || 0,
  };
}

async function getStatsByModel({ tenantId, days = 30 }) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // groupBy 不支持关联字段过滤，需先把 keyId 列表查出来
  let apiKeyIds;
  if (tenantId) {
    const keys = await prisma.apiKey.findMany({
      where: { tenant_id: parseInt(tenantId) },
      select: { id: true },
    });
    apiKeyIds = keys.map((k) => k.id);
  }

  const where = {
    timestamp: { gte: since },
    model: { not: null },
    ...(apiKeyIds && { api_key_id: { in: apiKeyIds } }),
  };

  const groups = await prisma.usageLog.groupBy({
    by: ['model'],
    where,
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
  });

  const total = groups.reduce((s, g) => s + g._count.id, 0);
  return groups.map((g) => ({
    model: g.model,
    count: g._count.id,
    percentage: total ? Math.round((g._count.id / total) * 100) : 0,
  }));
}

async function getLogs({ tenantId, keyId, page = 1, pageSize = 50 }) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const where = {
    timestamp: { gte: sevenDaysAgo },
    ...(keyId && { api_key_id: keyId }),
    ...(tenantId && { api_key: { tenant_id: parseInt(tenantId) } }),
  };

  const [list, total] = await Promise.all([
    prisma.usageLog.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: Math.min(pageSize, 200),
      orderBy: { timestamp: 'desc' },
      include: { api_key: { select: { id: true, name: true } } },
    }),
    prisma.usageLog.count({ where }),
  ]);

  return { list, total };
}

module.exports = { recordUsage, getSummary, getDailyStats, getStatsByKey, getStatsByModel, getLogs };
