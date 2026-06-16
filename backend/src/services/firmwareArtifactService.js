const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_UPLOAD_DIR = path.join(__dirname, '../../uploads/firmware');
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const ESP_IMAGE_HEADER_MAGIC = 0xe9;
const ESP_IMAGE_HEADER_MIN_BYTES = 24;

function serviceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getUploadDir() {
  return process.env.FIRMWARE_UPLOAD_DIR || DEFAULT_UPLOAD_DIR;
}

function parseMaxBytes(value) {
  if (!value) {
    return DEFAULT_MAX_BYTES;
  }

  const raw = String(value).trim().toLowerCase();
  const match = raw.match(/^(\d+)(b|kb|mb)?$/);
  if (!match) {
    return DEFAULT_MAX_BYTES;
  }

  const amount = Number(match[1]);
  const unit = match[2] || 'b';
  if (unit === 'mb') return amount * 1024 * 1024;
  if (unit === 'kb') return amount * 1024;
  return amount;
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

  const maxBytes = parseMaxBytes(process.env.FIRMWARE_UPLOAD_MAX_BYTES);
  if (buffer.length > maxBytes) {
    throw serviceError(40000, 'firmware artifact exceeds max size');
  }

  if (buffer.length < ESP_IMAGE_HEADER_MIN_BYTES || buffer[0] !== ESP_IMAGE_HEADER_MAGIC) {
    throw serviceError(40000, 'firmware artifact is not an ESP image');
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
  parseMaxBytes,
  saveFirmwareArtifact,
};
