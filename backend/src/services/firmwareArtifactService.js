const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_UPLOAD_DIR = path.join(__dirname, '../../uploads/firmware');

function serviceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getUploadDir() {
  return process.env.FIRMWARE_UPLOAD_DIR || DEFAULT_UPLOAD_DIR;
}

function toHttpOrigin(wsBase) {
  if (!wsBase) {
    return null;
  }

  const httpBase = wsBase.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
  try {
    return new URL(httpBase).origin;
  } catch {
    return httpBase;
  }
}

function getPublicBaseUrl() {
  if (process.env.FIRMWARE_PUBLIC_BASE_URL) {
    return process.env.FIRMWARE_PUBLIC_BASE_URL.replace(/\/+$/, '');
  }

  const derivedHost = toHttpOrigin(process.env.WS_BASE_URL);
  const host = process.env.PUBLIC_BASE_URL || derivedHost || `http://localhost:${process.env.PORT || 8088}`;
  return `${host.replace(/\/+$/, '')}/firmware`;
}

function normalizeFilename(filename) {
  const raw = typeof filename === 'string' ? filename.trim() : '';
  const base = path.basename(raw).replace(/[^A-Za-z0-9._-]/g, '-');

  if (!base || !base.toLowerCase().endsWith('.bin')) {
    throw serviceError(40000, 'firmware filename must end with .bin');
  }

  return base;
}

async function saveFirmwareArtifact({ filename, buffer }) {
  const safeFilename = normalizeFilename(filename);

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw serviceError(40000, 'firmware artifact is empty');
  }

  const uploadDir = getUploadDir();
  await fs.promises.mkdir(uploadDir, { recursive: true });

  const artifactPath = path.join(uploadDir, safeFilename);
  await fs.promises.writeFile(artifactPath, buffer);

  return {
    filename: safeFilename,
    artifact_url: `${getPublicBaseUrl()}/${encodeURIComponent(safeFilename)}`,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    size_bytes: buffer.length,
  };
}

module.exports = {
  getUploadDir,
  saveFirmwareArtifact,
};
