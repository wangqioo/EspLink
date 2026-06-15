const express = require('express');
const adminAuth = require('../middleware/adminAuth');
const { listDevices, getDevice, registerDevice, kickDevice, unbindDevice, getDeviceStats } = require('../services/deviceService');
const { success, paginated, error } = require('../utils/response');
const router = express.Router();

// 设备自注册（固件调用，无需管理员认证）
router.post('/register', async (req, res, next) => {
  try {
    const { mac_address, device_id, firmware, name } = req.body || {};
    if (!mac_address) return res.status(400).json(error(40000, 'MAC地址不能为空'));

    const device = await registerDevice({ mac_address, device_id, firmware, name });
    res.json(success({ mac_address: device.mac_address, is_paired: device.is_paired, api_key_id: device.api_key_id }));
  } catch (err) {
    next(err);
  }
});

// 以下路由需要管理员认证
router.use(adminAuth);

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, parseInt(req.query.pageSize) || 20);
    const { list, total } = await listDevices({ ...req.query, page, pageSize });
    res.json(paginated(list, page, pageSize, total));
  } catch (err) {
    next(err);
  }
});

router.get('/:mac', async (req, res, next) => {
  try {
    const device = await getDevice(req.params.mac);
    if (!device) return res.status(404).json(error(40401, '设备不存在'));
    res.json(success(device));
  } catch (err) {
    next(err);
  }
});

router.get('/:mac/stats', async (req, res, next) => {
  try {
    const days = Math.min(30, parseInt(req.query.days) || 7);
    const stats = await getDeviceStats(req.params.mac, days);
    res.json(success(stats));
  } catch (err) {
    next(err);
  }
});

router.post('/:mac/kick', async (req, res, next) => {
  try {
    await kickDevice(req.params.mac);
    res.json(success(null, '设备已强制下线'));
  } catch (err) {
    next(err);
  }
});

router.post('/:mac/unbind', async (req, res, next) => {
  try {
    await unbindDevice(req.params.mac);
    res.json(success(null, '设备已解绑'));
  } catch (err) {
    next(err);
  }
});

// 管理员手动分配 API Key 给设备
router.post('/:mac/assign-key', async (req, res, next) => {
  try {
    const prisma = require('../config/database');
    const { api_key_id } = req.body || {};
    if (!api_key_id) return res.status(400).json(error(40000, '必须指定API Key'));

    const apiKey = await prisma.apiKey.findUnique({ where: { id: api_key_id }, select: { tenant_id: true } });
    if (!apiKey) return res.status(404).json(error(40401, 'API Key 不存在'));

    const device = await prisma.device.update({
      where: { mac_address: req.params.mac },
      data: { api_key_id, tenant_id: apiKey.tenant_id },
    });
    res.json(success(device));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
