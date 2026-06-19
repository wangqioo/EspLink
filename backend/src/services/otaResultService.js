const prisma = require('../config/database');

const ACTIVE_STATUSES = ['started', 'downloaded', 'verified'];
const TERMINAL_STATUSES = ['success', 'download_failed', 'sha_mismatch', 'write_failed', 'aborted'];
const VALID_STATUSES = new Set([...ACTIVE_STATUSES, ...TERMINAL_STATUSES]);
const FAILURE_STATUSES = new Set(TERMINAL_STATUSES.filter((status) => status !== 'success'));

function serviceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeMac(mac) {
  if (typeof mac !== 'string') return '';
  const compact = mac.trim().replace(/-/g, ':').toUpperCase();
  return compact;
}

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw serviceError(40000, `${field} is required`);
  }
  return value.trim();
}

function normalizeNullableString(value) {
  if (value == null) return null;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeNullableInt(value, field) {
  if (value == null) return null;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0 || normalized > 2147483647) {
    throw serviceError(40000, `invalid ${field}`);
  }
  return normalized;
}

function normalizeReleaseId(value) {
  const normalized = normalizeNullableInt(value, 'release_id');
  return normalized && normalized > 0 ? normalized : null;
}

function normalizeStatus(status) {
  const normalized = requiredString(status, 'status');
  if (!VALID_STATUSES.has(normalized)) {
    throw serviceError(40000, 'invalid OTA status');
  }
  return normalized;
}

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(status);
}

async function recordOtaResult(input = {}) {
  const mac = normalizeMac(input.mac);
  if (!mac) throw serviceError(40000, 'mac is required');

  const boardType = requiredString(input.board_type, 'board_type');
  const targetVersion = requiredString(input.target_version, 'target_version');
  const status = normalizeStatus(input.status);
  const releaseId = normalizeReleaseId(input.release_id);
  const data = {
    status,
    error_code: normalizeNullableString(input.error_code),
    error_message: normalizeNullableString(input.error_message),
    bytes_written: normalizeNullableInt(input.bytes_written, 'bytes_written'),
  };

  if (isTerminalStatus(status)) {
    const attempt = await prisma.firmwareOtaAttempt.findFirst({
      where: {
        mac_address: mac,
        board_type: boardType,
        target_version: targetVersion,
        status: { in: ACTIVE_STATUSES },
      },
      orderBy: [{ started_at: 'desc' }],
    });

    if (attempt) {
      return prisma.firmwareOtaAttempt.update({
        where: { id: attempt.id },
        data: {
          ...data,
          finished_at: new Date(),
        },
      });
    }
  }

  return prisma.firmwareOtaAttempt.create({
    data: {
      mac_address: mac,
      board_type: boardType,
      from_version: normalizeNullableString(input.from_version),
      target_version: targetVersion,
      release_id: releaseId,
      ...data,
      started_at: new Date(),
      finished_at: isTerminalStatus(status) ? new Date() : null,
    },
  });
}

function emptySummary() {
  return {
    total: 0,
    success: 0,
    failed: 0,
    in_progress: 0,
    last_failure: null,
  };
}

async function buildReleaseOtaSummaries(releaseIds = []) {
  const ids = [...new Set(releaseIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return {};

  const summaries = Object.fromEntries(ids.map((id) => [id, emptySummary()]));
  const groups = await prisma.firmwareOtaAttempt.groupBy({
    by: ['release_id', 'status'],
    where: { release_id: { in: ids } },
    _count: { _all: true },
  });

  for (const group of groups) {
    const summary = summaries[group.release_id];
    if (!summary) continue;

    const count = group._count?._all || 0;
    summary.total += count;
    if (group.status === 'success') {
      summary.success += count;
    } else if (FAILURE_STATUSES.has(group.status)) {
      summary.failed += count;
    } else {
      summary.in_progress += count;
    }
  }

  await Promise.all(ids.map(async (releaseId) => {
    const latestFailure = await prisma.firmwareOtaAttempt.findFirst({
      where: {
        release_id: releaseId,
        status: { in: [...FAILURE_STATUSES] },
      },
      orderBy: [{ finished_at: 'desc' }, { started_at: 'desc' }],
    });

    if (latestFailure) {
      summaries[releaseId].last_failure = {
        status: latestFailure.status,
        error_code: latestFailure.error_code,
        error_message: latestFailure.error_message,
        finished_at: latestFailure.finished_at,
      };
    }
  }));

  return summaries;
}

module.exports = {
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  VALID_STATUSES,
  recordOtaResult,
  buildReleaseOtaSummaries,
};
