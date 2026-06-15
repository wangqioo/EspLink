const prisma = require('../config/database');
const deviceWsManager = require('../ws/deviceWsManager');
const { buildDeviceAdminList, buildDeviceAdminRow } = require('./deviceAdminReadModel');

async function listDevices({ tenantId, isOnline, isPaired, page = 1, pageSize = 20, search }) {
  const where = {
    ...(tenantId && { tenant_id: parseInt(tenantId) }),
    ...(isOnline !== undefined && { is_online: isOnline === 'true' || isOnline === true }),
    ...(isPaired !== undefined && { is_paired: isPaired === 'true' || isPaired === true }),
    ...(search && {
      OR: [{ mac_address: { contains: search } }, { name: { contains: search } }, { device_id: { contains: search } }],
    }),
  };

  const [list, total] = await Promise.all([
    prisma.device.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { last_seen: 'desc' },
      include: {
        api_key: { select: { id: true, name: true } },
        tenant: { select: { id: true, name: true } },
      },
    }),
    prisma.device.count({ where }),
  ]);

  return {
    list: buildDeviceAdminList(list, { isConnected: deviceWsManager.isConnected }),
    total,
  };
}

async function getDevice(mac) {
  const device = await prisma.device.findUnique({
    where: { mac_address: mac },
    include: {
      api_key: { select: { id: true, name: true, is_active: true } },
      tenant: { select: { id: true, name: true } },
    },
  });
  if (!device) return null;
  return buildDeviceAdminRow(device, { wsConnected: deviceWsManager.isConnected(mac) });
}

async function registerDevice({ mac_address, device_id, firmware, name }) {
  return prisma.device.upsert({
    where: { mac_address },
    create: {
      mac_address,
      device_id: device_id || null,
      firmware: firmware || null,
      name: name || null,
      last_seen: new Date(),
      is_online: true,
    },
    update: {
      ...(device_id && { device_id }),
      ...(firmware && { firmware }),
      ...(name && { name }),
      last_seen: new Date(),
      is_online: true,
    },
  });
}

async function kickDevice(mac) {
  return prisma.device.update({
    where: { mac_address: mac },
    data: { is_online: false },
  });
}

async function unbindDevice(mac) {
  return prisma.device.update({
    where: { mac_address: mac },
    data: {
      api_key_id: null,
      tenant_id: null,
      wechat_user_id: null,
      is_paired: false,
      paired_at: null,
    },
  });
}

async function getDeviceStats(mac, days = 7) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const logs = await prisma.usageLog.findMany({
    where: { device_mac: mac, timestamp: { gte: since } },
    select: { timestamp: true, input_tokens: true, output_tokens: true, success: true },
    orderBy: { timestamp: 'asc' },
  });

  return {
    total_calls: logs.length,
    success_calls: logs.filter((l) => l.success).length,
    total_tokens: logs.reduce((s, l) => s + l.input_tokens + l.output_tokens, 0),
    logs,
  };
}

module.exports = { listDevices, getDevice, registerDevice, kickDevice, unbindDevice, getDeviceStats };
