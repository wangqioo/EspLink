const jwt = require('jsonwebtoken');

module.exports = function wechatAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ detail: '未登录' });
  }
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.type !== 'wechat') throw new Error('invalid token type');
    req.wechatUser = payload;
    next();
  } catch {
    return res.status(401).json({ detail: '登录已过期' });
  }
};
