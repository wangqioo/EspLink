const express = require('express');
const adminAuth = require('../middleware/adminAuth');
const { getSummary, getDailyStats, getStatsByKey, getStatsByModel, getLogs } = require('../services/usageService');
const { success, paginated } = require('../utils/response');
const router = express.Router();

router.use(adminAuth);

router.get('/summary', async (req, res, next) => {
  try {
    const data = await getSummary({ tenantId: req.query.tenantId });
    res.json(success(data));
  } catch (err) {
    next(err);
  }
});

router.get('/daily', async (req, res, next) => {
  try {
    const days = Math.min(90, parseInt(req.query.days) || 7);
    const data = await getDailyStats({ tenantId: req.query.tenantId, days });
    res.json(success(data));
  } catch (err) {
    next(err);
  }
});

router.get('/by-key/:keyId', async (req, res, next) => {
  try {
    const days = Math.min(90, parseInt(req.query.days) || 7);
    const data = await getStatsByKey(req.params.keyId, days);
    res.json(success(data));
  } catch (err) {
    next(err);
  }
});

router.get('/by-model', async (req, res, next) => {
  try {
    const days = Math.min(90, parseInt(req.query.days) || 30);
    const data = await getStatsByModel({ tenantId: req.query.tenantId, days });
    res.json(success(data));
  } catch (err) {
    next(err);
  }
});

router.get('/logs', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(200, parseInt(req.query.pageSize) || 50);
    const { list, total } = await getLogs({ tenantId: req.query.tenantId, keyId: req.query.keyId, page, pageSize });
    res.json(paginated(list, page, pageSize, total));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
