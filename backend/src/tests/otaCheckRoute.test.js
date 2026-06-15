const express = require('express');
const request = require('supertest');

jest.mock('../services/otaCheckService', () => ({
  checkBootReport: jest.fn(),
}));

jest.mock('../services/deviceIdentityService', () => ({
  verifyBootRequest: jest.fn(),
}));

jest.mock('../services/deviceAbuseProtection', () => ({
  checkOtaRegistrationRate: jest.fn(),
}));

const otaCheckService = require('../services/otaCheckService');
const deviceIdentityService = require('../services/deviceIdentityService');
const deviceAbuseProtection = require('../services/deviceAbuseProtection');
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

describe('POST /api/ota/check', () => {
  const app = makeApp();

  beforeEach(() => {
    jest.clearAllMocks();
    deviceIdentityService.verifyBootRequest.mockResolvedValue({
      allowed: true,
      mode: 'development',
    });
    deviceAbuseProtection.checkOtaRegistrationRate.mockResolvedValue(true);
  });

  test('delegates boot report handling to otaCheckService', async () => {
    otaCheckService.checkBootReport.mockResolvedValue({
      token: 'device-token',
      websocket_url: 'ws://localhost:8088/ws/device',
      is_bound: false,
      update_available: false,
      ota: null,
      retry_policy: { retry_after_seconds: 30 },
    });

    const res = await request(app)
      .post('/api/ota/check')
      .send({
        mac: 'AA:BB:CC:DD:EE:FF',
        board_type: 'esp32-s3-box',
        firmware_version: '2.4.1',
      });

    expect(res.status).toBe(200);
    expect(deviceIdentityService.verifyBootRequest).toHaveBeenCalledWith({
      mac: 'AA:BB:CC:DD:EE:FF',
      board_type: 'esp32-s3-box',
      firmware_version: '2.4.1',
    });
    expect(deviceAbuseProtection.checkOtaRegistrationRate).toHaveBeenCalledWith({
      ip: expect.any(String),
      mac: 'AA:BB:CC:DD:EE:FF',
    });
    expect(otaCheckService.checkBootReport).toHaveBeenCalledWith({
      mac: 'AA:BB:CC:DD:EE:FF',
      board_type: 'esp32-s3-box',
      firmware_version: '2.4.1',
    });
    expect(res.body).toEqual({
      token: 'device-token',
      websocket_url: 'ws://localhost:8088/ws/device',
      is_bound: false,
      update_available: false,
      ota: null,
      retry_policy: { retry_after_seconds: 30 },
    });
  });

  test('rejects boot reports without mac before calling the service', async () => {
    const res = await request(app).post('/api/ota/check').send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ detail: 'mac 不能为空' });
    expect(deviceIdentityService.verifyBootRequest).not.toHaveBeenCalled();
    expect(deviceAbuseProtection.checkOtaRegistrationRate).not.toHaveBeenCalled();
    expect(otaCheckService.checkBootReport).not.toHaveBeenCalled();
  });

  test('rejects boot reports when device identity verification fails', async () => {
    deviceIdentityService.verifyBootRequest.mockResolvedValue({
      allowed: false,
      statusCode: 403,
      reason: 'device_signature_invalid',
    });

    const res = await request(app).post('/api/ota/check').send({
      mac: 'AA:BB:CC:DD:EE:FF',
      sn: 'SN001',
      timestamp: 123,
      nonce: 'nonce-1',
      signature: 'bad',
    });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ detail: 'device_signature_invalid' });
    expect(deviceIdentityService.verifyBootRequest).toHaveBeenCalledWith({
      mac: 'AA:BB:CC:DD:EE:FF',
      sn: 'SN001',
      timestamp: 123,
      nonce: 'nonce-1',
      signature: 'bad',
    });
    expect(otaCheckService.checkBootReport).not.toHaveBeenCalled();
  });

  test('rate limits boot reports before calling otaCheckService', async () => {
    deviceAbuseProtection.checkOtaRegistrationRate.mockResolvedValue(false);

    const res = await request(app)
      .post('/api/ota/check')
      .send({
        mac: 'AA:BB:CC:DD:EE:FF',
        board_type: 'esp32-s3-box',
        firmware_version: '2.4.1',
      });

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ code: 42900, message: '请求过于频繁，请稍后再试' });
    expect(deviceAbuseProtection.checkOtaRegistrationRate).toHaveBeenCalledWith({
      ip: expect.any(String),
      mac: 'AA:BB:CC:DD:EE:FF',
    });
    expect(otaCheckService.checkBootReport).not.toHaveBeenCalled();
  });
});
