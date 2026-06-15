const express = require('express');
const adminAuth = require('../middleware/adminAuth');
const { getOverview, getTopTenants, getActiveDevices } = require('../services/operationService');
const { success } = require('../utils/response');
const router = express.Router();

router.use(adminAuth);

router.get('/overview', async (req, res, next) => {
  try {
    res.json(success(await getOverview()));
  } catch (err) {
    next(err);
  }
});

router.get('/top-tenants', async (req, res, next) => {
  try {
    const limit = Math.min(20, parseInt(req.query.limit) || 10);
    res.json(success(await getTopTenants(limit)));
  } catch (err) {
    next(err);
  }
});

router.get('/active-devices', async (req, res, next) => {
  try {
    res.json(success(await getActiveDevices()));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
