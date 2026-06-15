module.exports = (err, req, res, next) => {
  console.error(`[${req.requestId}]`, err.message, err.stack);

  if (err.code === 'P2025') {
    return res.status(404).json({ code: 40400, message: '资源不存在' });
  }
  if (err.code === 'P2002') {
    return res.status(409).json({ code: 40900, message: '数据已存在，请勿重复创建' });
  }

  res.status(500).json({
    code: 50000,
    message: process.env.NODE_ENV === 'production' ? '服务器内部错误' : err.message,
  });
};
