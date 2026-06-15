const prisma = require('../config/database');
const redis = require('../config/redis');

const CACHE_TTL = 60;

module.exports = async (req, res, next) => {
  const key = req.headers['x-api-key'] || req.query.api_key;

  if (!key) {
    return res.status(401).json({ code: 40101, message: '缺少API Key' });
  }

  try {
    let keyRecord;
    const cacheKey = `apikey:${key}`;
    const cached = await redis.get(cacheKey).catch(() => null);

    if (cached) {
      keyRecord = JSON.parse(cached);
    } else {
      keyRecord = await prisma.apiKey.findUnique({ where: { id: key } });
      if (keyRecord) {
        await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(keyRecord)).catch(() => {});
      }
    }

    if (!keyRecord) return res.status(401).json({ code: 40102, message: '无效的API Key' });
    if (!keyRecord.is_active) return res.status(403).json({ code: 40301, message: 'API Key已禁用' });
    if (keyRecord.expires_at && new Date() > new Date(keyRecord.expires_at)) {
      return res.status(403).json({ code: 40302, message: 'API Key已过期' });
    }
    if (keyRecord.daily_limit !== null && keyRecord.used_today >= keyRecord.daily_limit) {
      return res.status(429).json({ code: 42901, message: '今日额度已用完' });
    }
    if (keyRecord.monthly_limit !== null && keyRecord.used_month >= keyRecord.monthly_limit) {
      return res.status(429).json({ code: 42902, message: '本月额度已用完' });
    }

    req.apiKey = keyRecord;
    next();
  } catch (err) {
    next(err);
  }
};
