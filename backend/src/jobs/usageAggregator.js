const cron = require('node-cron');
const prisma = require('../config/database');
const { runWithLease } = require('../services/jobCoordinator');

async function aggregateHour(hourStart) {
  const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);

  // 按 api_key_id 分组统计
  const groups = await prisma.usageLog.groupBy({
    by: ['api_key_id'],
    where: {
      timestamp: { gte: hourStart, lt: hourEnd },
      api_key_id: { not: null },
    },
    _count: { id: true },
    _sum: { input_tokens: true, output_tokens: true },
  });

  if (!groups.length) return;

  // 获取每个 key 的 tenant_id
  const keyIds = groups.map((g) => g.api_key_id).filter(Boolean);
  if (!keyIds.length) return;
  const keys = await prisma.apiKey.findMany({ where: { id: { in: keyIds } }, select: { id: true, tenant_id: true } });
  const keyTenantMap = Object.fromEntries(keys.map((k) => [k.id, k.tenant_id]));

  // 查成功/失败计数
  const successGroups = await prisma.usageLog.groupBy({
    by: ['api_key_id', 'success'],
    where: {
      timestamp: { gte: hourStart, lt: hourEnd },
      api_key_id: { not: null },
    },
    _count: { id: true },
  });

  const successMap = {};
  for (const g of successGroups) {
    if (!successMap[g.api_key_id]) successMap[g.api_key_id] = { ok: 0, fail: 0 };
    g.success ? (successMap[g.api_key_id].ok += g._count.id) : (successMap[g.api_key_id].fail += g._count.id);
  }

  for (const g of groups) {
    const tenantId = keyTenantMap[g.api_key_id];
    if (!tenantId) continue;

    await prisma.usageHourly.upsert({
      where: { api_key_id_hour_timestamp: { api_key_id: g.api_key_id, hour_timestamp: hourStart } },
      create: {
        api_key_id: g.api_key_id,
        tenant_id: tenantId,
        hour_timestamp: hourStart,
        call_count: g._count.id,
        input_tokens: g._sum.input_tokens || 0,
        output_tokens: g._sum.output_tokens || 0,
        success_count: successMap[g.api_key_id]?.ok || 0,
        fail_count: successMap[g.api_key_id]?.fail || 0,
      },
      update: {
        call_count: g._count.id,
        input_tokens: g._sum.input_tokens || 0,
        output_tokens: g._sum.output_tokens || 0,
        success_count: successMap[g.api_key_id]?.ok || 0,
        fail_count: successMap[g.api_key_id]?.fail || 0,
      },
    });
  }

  console.log(`[UsageAggregator] 聚合 ${hourStart.toISOString()} 的数据，${groups.length} 个 Key`);
}

function start() {
  // 每小时第5分钟执行，聚合上一整点的数据
  cron.schedule('5 * * * *', async () => {
    try {
      const now = new Date();
      const lastHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() - 1);
      await runWithLease('usageAggregator', 10 * 60 * 1000, () => aggregateHour(lastHour));
    } catch (err) {
      console.error('[UsageAggregator] 错误:', err.message);
    }
  });
}

module.exports = { start, aggregateHour };
