const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'xiaozhi123';

  if (username !== adminUser || password !== adminPass) {
    return res.status(401).json({ code: 40100, message: '用户名或密码错误' });
  }

  const token = jwt.sign(
    { username, type: 'admin', role: 'admin' },
    process.env.JWT_SECRET || 'xiaozhi-secret',
    { expiresIn: '7d' }
  );

  res.json({ code: 0, data: { token, username }, message: 'success' });
});

router.get('/me', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') && authHeader.slice(7);
  if (!token) return res.status(401).json({ code: 40100, message: '未登录' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'xiaozhi-secret');
    res.json({ code: 0, data: { username: decoded.username, role: decoded.role }, message: 'success' });
  } catch {
    res.status(401).json({ code: 40101, message: '令牌无效' });
  }
});

module.exports = router;
