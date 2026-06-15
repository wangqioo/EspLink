const express = require('express');
const prisma = require('../config/database');
const redis = require('../config/redis');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({ code: 0, data: { status: 'ok', uptime: process.uptime() }, message: 'success' });
});

router.get('/ready', async (req, res) => {
  const checks = { db: false, redis: false };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = true;
  } catch {}

  try {
    await redis.ping();
    checks.redis = true;
  } catch {}

  const allOk = Object.values(checks).every(Boolean);
  res.status(allOk ? 200 : 503).json({
    code: allOk ? 0 : 50300,
    data: checks,
    message: allOk ? 'ready' : 'not ready',
  });
});

module.exports = router;
