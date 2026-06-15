const { consume } = require('../services/rateLimiter');

module.exports = (limit = 60, windowSec = 60) => {
  return async (req, res, next) => {
    const identifier = req.apiKey?.id || req.ip;

    const allowed = await consume(identifier, {
      limit,
      windowSeconds: windowSec,
      keyPrefix: 'ratelimit:http',
    });
    if (!allowed) {
      return res.status(429).json({ code: 42900, message: '请求过于频繁，请稍后再试' });
    }

    next();
  };
};
