const express = require('express');
const request = require('supertest');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const uploadDir = path.join(__dirname, '../../tmp/test-firmware-uploads');

jest.mock('../middleware/adminAuth', () => (req, _res, next) => {
  req.admin = { username: 'admin', type: 'admin', role: 'admin' };
  next();
});

process.env.FIRMWARE_UPLOAD_DIR = uploadDir;
process.env.FIRMWARE_PUBLIC_BASE_URL = 'http://backend.test/firmware';

jest.mock('../services/firmwareReleaseService', () => ({
  createRelease: jest.fn(),
  listReleases: jest.fn(),
  setReleaseActive: jest.fn(),
}));

jest.mock('../services/otaCheckService', () => ({
  previewOtaDecision: jest.fn(),
}));

const firmwareReleaseService = require('../services/firmwareReleaseService');
const otaCheckService = require('../services/otaCheckService');

function makeEspImage(size = 32) {
  const buffer = Buffer.alloc(size, 0);
  buffer[0] = 0xe9;
  return buffer;
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/firmware', require('../routes/firmware'));
  app.use((err, _req, res, _next) => {
    res.status(err.code === 40000 ? 400 : err.code === 40900 ? 409 : 500).json({
      code: err.code || 50000,
      message: err.message,
    });
  });
  return app;
}

describe('firmware admin routes', () => {
  const app = makeApp();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FIRMWARE_UPLOAD_DIR = uploadDir;
    process.env.FIRMWARE_PUBLIC_BASE_URL = 'http://backend.test/firmware';
    delete process.env.WS_BASE_URL;
    fs.rmSync(uploadDir, { recursive: true, force: true });
  });

  afterAll(() => {
    fs.rmSync(uploadDir, { recursive: true, force: true });
  });

  test('lists firmware releases', async () => {
    firmwareReleaseService.listReleases.mockResolvedValue({
      list: [{ id: 1, board_type: 'esp32-s3-box', version: '2.5.0' }],
      total: 1,
    });

    const res = await request(app)
      .get('/api/v1/firmware/releases')
      .query({ boardType: 'esp32-s3-box', channel: 'stable', page: 2, pageSize: 10 });

    expect(res.status).toBe(200);
    expect(firmwareReleaseService.listReleases).toHaveBeenCalledWith({
      boardType: 'esp32-s3-box',
      channel: 'stable',
      page: 2,
      pageSize: 10,
    });
    expect(res.body.data.pagination.total).toBe(1);
  });

  test('clamps invalid pagination values when listing firmware releases', async () => {
    firmwareReleaseService.listReleases.mockResolvedValue({ list: [], total: 0 });

    const res = await request(app)
      .get('/api/v1/firmware/releases')
      .query({ page: -3, pageSize: -1 });

    expect(res.status).toBe(200);
    expect(firmwareReleaseService.listReleases).toHaveBeenCalledWith({
      boardType: undefined,
      channel: undefined,
      page: 1,
      pageSize: 1,
    });
  });

  test('creates firmware release', async () => {
    firmwareReleaseService.createRelease.mockResolvedValue({
      id: 1,
      board_type: 'esp32-s3-box',
      version: '2.5.0',
    });

    const payload = {
      board_type: 'esp32-s3-box',
      version: 'v2.5.0',
      artifact_url: 'https://firmware.example.test/esp32.bin',
      sha256: 'a'.repeat(64),
    };
    const res = await request(app).post('/api/v1/firmware/releases').send(payload);

    expect(res.status).toBe(201);
    expect(firmwareReleaseService.createRelease).toHaveBeenCalledWith(payload);
    expect(res.body.data.version).toBe('2.5.0');
  });

  test('previews OTA decision without device registration side effects', async () => {
    otaCheckService.previewOtaDecision.mockResolvedValue({
      board_type: 'esplink-v1',
      firmware_version: '1.0.5',
      update_available: true,
      reason: 'update_available',
      ota: { version: '1.0.6', release_id: 6 },
    });

    const res = await request(app)
      .get('/api/v1/firmware/ota-preview')
      .query({ board_type: 'esplink-v1', firmware_version: '1.0.5', channel: 'stable' });

    expect(res.status).toBe(200);
    expect(otaCheckService.previewOtaDecision).toHaveBeenCalledWith({
      board_type: 'esplink-v1',
      firmware_version: '1.0.5',
      channel: 'stable',
    });
    expect(res.body.data).toMatchObject({
      update_available: true,
      ota: { version: '1.0.6' },
    });
  });

  test('validates required OTA preview query fields', async () => {
    const res = await request(app)
      .get('/api/v1/firmware/ota-preview')
      .query({ board_type: 'esplink-v1' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('board_type and firmware_version are required');
    expect(otaCheckService.previewOtaDecision).not.toHaveBeenCalled();
  });

  test('validates required create fields before service call', async () => {
    const res = await request(app).post('/api/v1/firmware/releases').send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('board_type/version/artifact_url/sha256 are required');
    expect(firmwareReleaseService.createRelease).not.toHaveBeenCalled();
  });

  test('toggles firmware release active state', async () => {
    firmwareReleaseService.setReleaseActive.mockResolvedValue({ id: 1, is_active: false });

    const res = await request(app)
      .patch('/api/v1/firmware/releases/1/active')
      .send({ is_active: false });

    expect(res.status).toBe(200);
    expect(firmwareReleaseService.setReleaseActive).toHaveBeenCalledWith(1, false);
    expect(res.body.data.is_active).toBe(false);
  });

  test('rejects invalid active toggle payloads', async () => {
    const res = await request(app)
      .patch('/api/v1/firmware/releases/1/active')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('is_active must be boolean');
    expect(firmwareReleaseService.setReleaseActive).not.toHaveBeenCalled();
  });

  test('rejects invalid release ids when toggling active state', async () => {
    const res = await request(app)
      .patch('/api/v1/firmware/releases/foo/active')
      .send({ is_active: true });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('invalid release id');
    expect(firmwareReleaseService.setReleaseActive).not.toHaveBeenCalled();
  });

  test('uploads firmware binaries and returns artifact metadata', async () => {
    const payload = makeEspImage();

    const res = await request(app)
      .post('/api/v1/firmware/artifacts')
      .set('Content-Type', 'application/octet-stream')
      .set('X-Firmware-Filename', 'esplink-v1-1.0.2.bin')
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({
      filename: 'esplink-v1-1.0.2.bin',
      artifact_url: 'http://backend.test/firmware/esplink-v1-1.0.2.bin',
      sha256: crypto.createHash('sha256').update(payload).digest('hex'),
      size_bytes: payload.length,
    });
    expect(fs.readFileSync(path.join(uploadDir, 'esplink-v1-1.0.2.bin'))).toEqual(payload);
  });

  test('derives firmware artifact public URL from WS_BASE_URL when explicit base URL is absent', async () => {
    delete process.env.FIRMWARE_PUBLIC_BASE_URL;
    process.env.WS_BASE_URL = 'ws://192.168.1.26:8088';

    const res = await request(app)
      .post('/api/v1/firmware/artifacts')
      .set('Content-Type', 'application/octet-stream')
      .set('X-Firmware-Filename', 'esplink-v1-1.0.3.bin')
      .send(makeEspImage());

    expect(res.status).toBe(201);
    expect(res.body.data.artifact_url).toBe('http://192.168.1.26:8088/firmware/esplink-v1-1.0.3.bin');
  });

  test('rejects firmware artifacts without a bin filename', async () => {
    const res = await request(app)
      .post('/api/v1/firmware/artifacts')
      .set('Content-Type', 'application/octet-stream')
      .set('X-Firmware-Filename', 'notes.txt')
      .send(Buffer.from('not firmware'));

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('firmware filename must end with .bin');
  });

  test('rejects bin uploads that are not ESP application images', async () => {
    const res = await request(app)
      .post('/api/v1/firmware/artifacts')
      .set('Content-Type', 'application/octet-stream')
      .set('X-Firmware-Filename', 'not-esp.bin')
      .send(Buffer.from('not an esp image'));

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('firmware artifact is not an ESP image');
  });

  test('rejects empty firmware artifact uploads', async () => {
    const res = await request(app)
      .post('/api/v1/firmware/artifacts')
      .set('Content-Type', 'application/octet-stream')
      .set('X-Firmware-Filename', 'empty.bin')
      .send(Buffer.alloc(0));

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('firmware artifact is empty');
  });

  test('rejects firmware artifacts larger than the configured upload limit', async () => {
    process.env.FIRMWARE_UPLOAD_MAX_BYTES = '16b';
    const limitedApp = makeApp();

    const res = await request(limitedApp)
      .post('/api/v1/firmware/artifacts')
      .set('Content-Type', 'application/octet-stream')
      .set('X-Firmware-Filename', 'oversized.bin')
      .send(Buffer.alloc(17, 0xe9));

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('firmware artifact exceeds max size');
  });
});
