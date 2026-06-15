const prisma = require('../config/database');
const { normalizeVersion, compareVersions } = require('./firmwareVersionPolicy');

function serviceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeChannel(channel) {
  return typeof channel === 'string' && channel.trim() ? channel.trim() : 'stable';
}

function normalizeBoardType(boardType) {
  return typeof boardType === 'string' ? boardType.trim() : '';
}

function validateRequired(input) {
  for (const field of ['board_type', 'version', 'artifact_url', 'sha256']) {
    if (!input[field]) {
      throw serviceError(40000, `${field} is required`);
    }
  }
}

function normalizeOptionalBoolean(input, field, defaultValue) {
  if (input[field] === undefined) {
    return defaultValue;
  }

  if (typeof input[field] !== 'boolean') {
    throw serviceError(40000, `${field} must be boolean`);
  }

  return input[field];
}

function normalizeOptionalSizeBytes(sizeBytes) {
  if (sizeBytes == null) {
    return null;
  }

  const normalized = Number(sizeBytes);
  if (!Number.isInteger(normalized) || normalized < 0 || normalized > 2147483647) {
    throw serviceError(40000, 'invalid size_bytes');
  }

  return normalized;
}

async function createRelease(input) {
  validateRequired(input);

  const version = normalizeVersion(input.version);
  if (!version) {
    throw serviceError(40000, 'invalid firmware version');
  }

  const boardType = normalizeBoardType(input.board_type);
  const channel = normalizeChannel(input.channel);
  const duplicate = await prisma.firmwareRelease.findFirst({
    where: { board_type: boardType, channel, version },
  });

  if (duplicate) {
    throw serviceError(40900, 'firmware release already exists');
  }

  return prisma.firmwareRelease.create({
    data: {
      board_type: boardType,
      version,
      artifact_url: String(input.artifact_url).trim(),
      sha256: String(input.sha256).trim(),
      size_bytes: normalizeOptionalSizeBytes(input.size_bytes),
      channel,
      is_active: normalizeOptionalBoolean(input, 'is_active', true),
      force_update: normalizeOptionalBoolean(input, 'force_update', false),
      release_notes: input.release_notes || null,
    },
  });
}

async function listReleases({ boardType, channel, page = 1, pageSize = 20 } = {}) {
  const where = {
    ...(boardType && { board_type: boardType }),
    ...(channel && { channel }),
  };

  const [list, total] = await Promise.all([
    prisma.firmwareRelease.findMany({
      where,
      orderBy: [{ created_at: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.firmwareRelease.count({ where }),
  ]);

  return { list, total };
}

async function setReleaseActive(id, isActive) {
  return prisma.firmwareRelease.update({
    where: { id: Number(id) },
    data: { is_active: Boolean(isActive) },
  });
}

async function findLatestActiveRelease({ boardType, channel = 'stable' }) {
  const normalizedBoardType = normalizeBoardType(boardType);
  if (!normalizedBoardType) {
    return null;
  }

  const releases = await prisma.firmwareRelease.findMany({
    where: {
      board_type: normalizedBoardType,
      channel: normalizeChannel(channel),
      is_active: true,
    },
  });

  const validReleases = releases.filter((release) => normalizeVersion(release.version));

  return validReleases.reduce((latest, release) => {
    if (!latest) {
      return release;
    }

    return compareVersions(release.version, latest.version) > 0 ? release : latest;
  }, null);
}

module.exports = {
  createRelease,
  listReleases,
  setReleaseActive,
  findLatestActiveRelease,
};
