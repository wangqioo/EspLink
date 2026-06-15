const prisma = require('../config/database');
const redis = require('../config/redis');
const { generateApiKey } = require('../utils/uuid');

async function listKeys({ tenantId, isActive, page = 1, pageSize = 20, search }) {
  const where = {
    ...(tenantId && { tenant_id: parseInt(tenantId) }),
    ...(isActive !== undefined && { is_active: isActive === 'true' || isActive === true }),
    ...(search && { name: { contains: search } }),
  };

  const [list, total] = await Promise.all([
    prisma.apiKey.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { created_at: 'desc' },
      include: { tenant: { select: { id: true, name: true } } },
    }),
    prisma.apiKey.count({ where }),
  ]);

  return { list, total };
}

async function getKey(id) {
  return prisma.apiKey.findUnique({
    where: { id },
    include: { tenant: { select: { id: true, name: true } } },
  });
}

async function createKey({ tenantId, name, deviceLimit, dailyLimit, monthlyLimit, expiresAt }) {
  const tenant = await prisma.tenant.findUnique({ where: { id: parseInt(tenantId) } });
  if (!tenant) throw Object.assign(new Error('租户不存在'), { statusCode: 404, code: 40401 });

  return prisma.apiKey.create({
    data: {
      id: generateApiKey(),
      tenant_id: parseInt(tenantId),
      name: name || null,
      device_limit: deviceLimit || 1,
      daily_limit: dailyLimit || tenant.daily_limit,
      monthly_limit: monthlyLimit || tenant.monthly_limit,
      expires_at: expiresAt ? new Date(expiresAt) : null,
    },
    include: { tenant: { select: { id: true, name: true } } },
  });
}

async function updateKey(id, updates) {
  const data = {};
  if (updates.name !== undefined) data.name = updates.name;
  if (updates.isActive !== undefined) data.is_active = updates.isActive;
  if (updates.dailyLimit !== undefined) data.daily_limit = updates.dailyLimit;
  if (updates.monthlyLimit !== undefined) data.monthly_limit = updates.monthlyLimit;
  if (updates.deviceLimit !== undefined) data.device_limit = updates.deviceLimit;
  if (updates.expiresAt !== undefined) data.expires_at = updates.expiresAt ? new Date(updates.expiresAt) : null;

  const key = await prisma.apiKey.update({ where: { id }, data });
  await redis.del(`apikey:${id}`).catch(() => {});
  return key;
}

async function deleteKey(id) {
  await prisma.apiKey.delete({ where: { id } });
  await redis.del(`apikey:${id}`).catch(() => {});
}

async function resetUsage(id) {
  const key = await prisma.apiKey.update({
    where: { id },
    data: { used_today: 0, used_month: 0 },
  });
  await redis.del(`apikey:${id}`).catch(() => {});
  return key;
}

async function incrementUsage(id, inputTokens = 0, outputTokens = 0) {
  await prisma.apiKey.update({
    where: { id },
    data: {
      used_today: { increment: inputTokens + outputTokens },
      used_month: { increment: inputTokens + outputTokens },
    },
  });
  await redis.del(`apikey:${id}`).catch(() => {});
}

module.exports = { listKeys, getKey, createKey, updateKey, deleteKey, resetUsage, incrementUsage };
