const express = require('express');
const adminAuth = require('../middleware/adminAuth');
const { success, paginated, error } = require('../utils/response');
const {
  createRelease,
  listReleases,
  setReleaseActive,
} = require('../services/firmwareReleaseService');
const { saveFirmwareArtifact } = require('../services/firmwareArtifactService');

const router = express.Router();

router.use(adminAuth);

router.post('/artifacts', express.raw({
  type: ['application/octet-stream', 'application/x-binary', 'application/macbinary'],
  limit: process.env.FIRMWARE_UPLOAD_MAX_BYTES || '8mb',
}), async (req, res, next) => {
  try {
    const artifact = await saveFirmwareArtifact({
      filename: req.headers['x-firmware-filename'],
      buffer: req.body,
    });
    res.status(201).json(success(artifact));
  } catch (err) {
    if (err.code === 40000) return res.status(400).json(error(err.code, err.message));
    next(err);
  }
});

router.get('/releases', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.max(1, Math.min(100, parseInt(req.query.pageSize, 10) || 20));
    const { list, total } = await listReleases({
      boardType: req.query.boardType,
      channel: req.query.channel,
      page,
      pageSize,
    });
    res.json(paginated(list, page, pageSize, total));
  } catch (err) {
    next(err);
  }
});

router.post('/releases', async (req, res, next) => {
  try {
    const { board_type, version, artifact_url, sha256 } = req.body || {};
    if (!board_type || !version || !artifact_url || !sha256) {
      return res.status(400).json(error(40000, 'board_type/version/artifact_url/sha256 are required'));
    }

    const release = await createRelease(req.body);
    res.status(201).json(success(release));
  } catch (err) {
    if (err.code === 40000) return res.status(400).json(error(err.code, err.message));
    if (err.code === 40900) return res.status(409).json(error(err.code, err.message));
    next(err);
  }
});

router.patch('/releases/:id/active', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json(error(40000, 'invalid release id'));
    }

    if (typeof req.body?.is_active !== 'boolean') {
      return res.status(400).json(error(40000, 'is_active must be boolean'));
    }

    const release = await setReleaseActive(id, req.body.is_active);
    res.json(success(release));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
