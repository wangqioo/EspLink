const express = require('express');
const adminAuth = require('../middleware/adminAuth');
const { listKeys, getKey, createKey, updateKey, deleteKey, resetUsage } = require('../services/keyService');
const { success, paginated, error } = require('../utils/response');
const router = express.Router();

router.use(adminAuth);

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, parseInt(req.query.pageSize) || 20);
    const { list, total } = await listKeys({ ...req.query, page, pageSize });
    res.json(paginated(list, page, pageSize, total));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const key = await getKey(req.params.id);
    if (!key) return res.status(404).json(error(40401, 'API Key不存在'));
    res.json(success(key));
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { tenantId, name, deviceLimit, dailyLimit, monthlyLimit, expiresAt } = req.body || {};
    if (!tenantId) return res.status(400).json(error(40000, '必须指定所属租户'));

    const key = await createKey({ tenantId, name, deviceLimit, dailyLimit, monthlyLimit, expiresAt });
    res.status(201).json(success(key));
  } catch (err) {
    if (err.code === 40401) return res.status(404).json(error(err.code, err.message));
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const { name, isActive, dailyLimit, monthlyLimit, deviceLimit, expiresAt } = req.body || {};
    const key = await updateKey(req.params.id, { name, isActive, dailyLimit, monthlyLimit, deviceLimit, expiresAt });
    res.json(success(key));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await deleteKey(req.params.id);
    res.json(success(null, '删除成功'));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/reset-usage', async (req, res, next) => {
  try {
    const key = await resetUsage(req.params.id);
    res.json(success(key, '用量已重置'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
