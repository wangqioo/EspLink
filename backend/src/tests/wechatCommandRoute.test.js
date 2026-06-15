const express = require('express');
const request = require('supertest');

jest.mock('../middleware/wechatAuth', () => (req, _res, next) => {
  req.wechatUser = { userId: 42 };
  next();
});

jest.mock('../config/database', () => ({
  device: {
    findUnique: jest.fn(),
  },
}));

jest.mock('../services/deviceCommandPolicy', () => ({
  canSendCommand: jest.fn(),
}));

jest.mock('../services/deviceCommandRouter', () => ({
  send: jest.fn(),
}));

const prisma = require('../config/database');
const policy = require('../services/deviceCommandPolicy');
const commandRouter = require('../services/deviceCommandRouter');
const esplinkRoutes = require('../routes/esplink');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', esplinkRoutes);
  app.use((err, _req, res, _next) => {
    res.status(500).json({ detail: err.message });
  });
  return app;
}

describe('POST /api/device/:mac/command', () => {
  const app = makeApp();
  const device = {
    mac_address: 'AA:BB:CC:DD:EE:FF',
    wechat_user_id: 42,
  };
  const payload = { type: 'display_text', text: 'hello' };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.device.findUnique.mockResolvedValue(device);
    policy.canSendCommand.mockReturnValue({ allowed: true });
    commandRouter.send.mockResolvedValue({ status: 'delivered' });
  });

  test('normalizes route mac, loads the device, checks wechat policy, and returns delivered', async () => {
    const res = await request(app)
      .post('/api/device/AA-BB-CC-DD-EE-FF/command')
      .send({ payload });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, status: 'delivered' });
    expect(prisma.device.findUnique).toHaveBeenCalledWith({
      where: { mac_address: 'AA:BB:CC:DD:EE:FF' },
    });
    expect(policy.canSendCommand).toHaveBeenCalledWith({
      actor: { type: 'wechat', userId: 42 },
      device,
      payload,
    });
    expect(commandRouter.send).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF', payload);
  });

  test('returns policy rejection status and reason without sending', async () => {
    policy.canSendCommand.mockReturnValue({
      allowed: false,
      statusCode: 403,
      reason: '无权控制该设备',
    });

    const res = await request(app)
      .post('/api/device/AA-BB-CC-DD-EE-FF/command')
      .send({ payload });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ detail: '无权控制该设备' });
    expect(commandRouter.send).not.toHaveBeenCalled();
  });

  test('returns 503 when the command router reports offline', async () => {
    commandRouter.send.mockResolvedValue({ status: 'offline' });

    const res = await request(app)
      .post('/api/device/AA-BB-CC-DD-EE-FF/command')
      .send({ payload });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ detail: '设备当前不在线' });
  });

  test('returns accepted when the command router publishes to a remote instance', async () => {
    commandRouter.send.mockResolvedValue({ status: 'published', instanceId: 'instance-b' });

    const res = await request(app)
      .post('/api/device/AA-BB-CC-DD-EE-FF/command')
      .send({ payload });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, status: 'published' });
  });

  test('returns 502 when the command router reports a delivery failure', async () => {
    commandRouter.send.mockResolvedValue({ status: 'failed', reason: 'transport_error' });

    const res = await request(app)
      .post('/api/device/AA-BB-CC-DD-EE-FF/command')
      .send({ payload });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ detail: 'transport_error' });
  });
});
