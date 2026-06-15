const express = require('express');
const prisma = require('../config/database');
const adminAuth = require('../middleware/adminAuth');
const { success, paginated, error } = require('../utils/response');
const router = express.Router();

router.use(adminAuth);

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, parseInt(req.query.pageSize) || 20);
    const search = req.query.search || '';
    const where = search ? { name: { contains: search } } : {};

    const [list, total] = await Promise.all([
      prisma.tenant.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { created_at: 'desc' },
        include: { _count: { select: { api_keys: true, devices: true } } },
      }),
      prisma.tenant.count({ where }),
    ]);

    res.json(paginated(list, page, pageSize, total));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: parseInt(req.params.id) },
      include: { _count: { select: { api_keys: true, devices: true } } },
    });
    if (!tenant) return res.status(404).json(error(40401, '租户不存在'));
    res.json(success(tenant));
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, level, daily_limit, monthly_limit, usage_alert_webhook, alert_threshold, ai_model } = req.body || {};
    if (!name) return res.status(400).json(error(40000, '租户名称不能为空'));

    const tenant = await prisma.tenant.create({
      data: {
        name,
        level: level || 'free',
        daily_limit: daily_limit || 1000,
        monthly_limit: monthly_limit || 10000,
        usage_alert_webhook: usage_alert_webhook || null,
        alert_threshold: alert_threshold ?? 0.8,
        ai_model: ai_model || null,
      },
    });
    res.status(201).json(success(tenant));
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const { name, level, daily_limit, monthly_limit, usage_alert_webhook, alert_threshold, ai_model } = req.body || {};
    const data = {};
    if (name !== undefined) data.name = name;
    if (level !== undefined) data.level = level;
    if (daily_limit !== undefined) data.daily_limit = daily_limit;
    if (monthly_limit !== undefined) data.monthly_limit = monthly_limit;
    if (usage_alert_webhook !== undefined) data.usage_alert_webhook = usage_alert_webhook;
    if (alert_threshold !== undefined) data.alert_threshold = alert_threshold;
    if (ai_model !== undefined) data.ai_model = ai_model || null;

    const tenant = await prisma.tenant.update({ where: { id: parseInt(req.params.id) }, data });
    res.json(success(tenant));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.tenant.delete({ where: { id: parseInt(req.params.id) } });
    res.json(success(null, '删除成功'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
