const jwt = require('jsonwebtoken');

describe('adminAuth', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV, JWT_SECRET: 'test-secret' };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  function runMiddleware(token) {
    const adminAuth = require('../middleware/adminAuth');
    const req = {
      headers: {
        authorization: token ? `Bearer ${token}` : undefined,
      },
    };
    const res = {
      statusCode: 200,
      body: null,
      status: jest.fn(function status(code) {
        this.statusCode = code;
        return this;
      }),
      json: jest.fn(function json(body) {
        this.body = body;
        return this;
      }),
    };
    const next = jest.fn();

    adminAuth(req, res, next);
    return { req, res, next };
  }

  test('accepts admin tokens with admin type and role', () => {
    const token = jwt.sign(
      { username: 'admin', type: 'admin', role: 'admin' },
      'test-secret'
    );

    const { req, res, next } = runMiddleware(token);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.admin.username).toBe('admin');
    expect(res.status).not.toHaveBeenCalled();
  });

  test('rejects WeChat tokens signed with the same secret', () => {
    const token = jwt.sign(
      { type: 'wechat', userId: 1, openid: 'dev_user' },
      'test-secret'
    );

    const { res, next } = runMiddleware(token);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      code: 40101,
      message: '登录令牌无效',
    });
  });
});
