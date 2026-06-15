const { generateRequestId } = require('../utils/uuid');

module.exports = (req, res, next) => {
  req.requestId = generateRequestId();
  res.setHeader('X-Request-ID', req.requestId);

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      return originalJson({ ...body, requestId: req.requestId });
    }
    return originalJson(body);
  };

  next();
};
