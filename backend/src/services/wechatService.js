const https = require('https');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const prisma = require('../config/database');
const { touchDevice } = require('../utils/dbTime');
const DeviceCapability = require('./deviceCapability');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// 微信 code 换 openid，未配置 WX_APPID/WX_SECRET 时用 dev 模式
async function code2openid(code) {
  const appid = process.env.WX_APPID;
  const secret = process.env.WX_SECRET;
  if (appid && secret) {
    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}&secret=${secret}&js_code=${code}&grant_type=authorization_code`;
    const raw = await httpsGet(url);
    const data = JSON.parse(raw);
    if (data.errcode) throw new Error(`WeChat: ${data.errmsg}`);
    return data.openid;
  }
  // dev 模式：code 直接当 openid
  return `dev_${code}`;
}

async function wechatLogin(code) {
  const openid = await code2openid(code);
  let user = await prisma.wechatUser.findUnique({ where: { openid } });
  if (!user) {
    user = await prisma.wechatUser.create({ data: { openid } });
  }
  const token = jwt.sign(
    { type: 'wechat', userId: user.id, openid: user.openid },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
  return { token, user_id: user.id };
}

// 固件启动注册：新设备自动创建，已有设备刷新 last_seen
async function bootRegister({ mac, board_type, firmware_version }) {
  let device = await prisma.device.findUnique({ where: { mac_address: mac } });
  const device_key = device?.device_key || crypto.randomBytes(32).toString('hex');
  if (!device) {
    device = await prisma.device.create({
      data: {
        mac_address: mac,
        board_type: board_type || null,
        firmware: firmware_version || null,
        device_key,
        is_online: false,
      },
    });
    await touchDevice(mac);
  } else {
    device = await prisma.device.update({
      where: { mac_address: mac },
      data: {
        board_type: board_type || device.board_type,
        firmware: firmware_version || device.firmware,
        device_key,
      },
    });
    await touchDevice(mac);
  }
  return { device, device_key };
}

// MAC 后缀 "AABBCC" → "AA:BB:CC"（最后三字节带冒号形式）
function macSuffixToColon(suffix) {
  const s = suffix.toUpperCase();
  return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`;
}

// 按 MAC 后缀查找最近 5 分钟上线、未被其他用户绑定的设备
async function lookupDevice(macSuffix) {
  const colonSuffix = macSuffixToColon(macSuffix);
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const rows = await prisma.$queryRaw`
    SELECT mac_address, board_type, is_online, wechat_user_id
    FROM devices
    WHERE mac_address LIKE ${`%${colonSuffix}`}
      AND last_seen > ${fiveMinAgo}
      AND wechat_user_id IS NULL
    LIMIT 1
  `;
  if (!rows || rows.length === 0) throw new Error('device not found or not online');
  const d = rows[0];
  return {
    id: d.mac_address.replace(/:/g, '-'),
    mac: d.mac_address,
    board_type: d.board_type,
    is_bound: false,
    is_online: Boolean(d.is_online),
  };
}

// 绑定设备到微信用户
async function bindDevice(mac, wechatUserId) {
  const device = await prisma.device.findUnique({ where: { mac_address: mac } });
  if (!device) throw new Error('device not found');
  if (device.wechat_user_id && device.wechat_user_id !== wechatUserId) {
    throw new Error('device already bound to another user');
  }
  await prisma.device.update({
    where: { mac_address: mac },
    data: { wechat_user_id: wechatUserId, is_paired: true, paired_at: new Date() },
  });
}

// 获取用户的设备列表
async function getDeviceList(wechatUserId) {
  const devices = await prisma.device.findMany({
    where: { wechat_user_id: wechatUserId },
    orderBy: { created_at: 'desc' },
  });
  return devices.map((d) => ({
    id: d.mac_address.replace(/:/g, '-'),
    mac: d.mac_address,
    name: d.name || d.board_type || d.mac_address,
    board_type: d.board_type,
    firmware_version: d.firmware,
    capabilities: DeviceCapability.parseStoredCapabilities(d.capabilities),
    capability_summary: DeviceCapability.toClientCapabilitySummary(d),
    is_online: d.is_online,
    last_seen_at: d.last_seen,
  }));
}

module.exports = { wechatLogin, bootRegister, lookupDevice, bindDevice, getDeviceList };
