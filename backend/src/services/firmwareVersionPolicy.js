function normalizeVersion(version) {
  if (typeof version !== 'string') {
    return null;
  }

  const normalizedInput = version.trim().replace(/^v/i, '');
  const match = normalizedInput.match(/^(\d+)\.(\d+)\.(\d+)$/);

  if (!match) {
    return null;
  }

  return match
    .slice(1)
    .map((part) => String(Number(part)))
    .join('.');
}

function parseVersion(version) {
  const normalized = normalizeVersion(version);
  if (!normalized) {
    return null;
  }

  return normalized.split('.').map(Number);
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);

  if (!leftParts || !rightParts) {
    throw new Error('invalid firmware version');
  }

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] > rightParts[index]) {
      return 1;
    }

    if (leftParts[index] < rightParts[index]) {
      return -1;
    }
  }

  return 0;
}

function classifyUpdatePath(currentVersion, targetVersion) {
  try {
    const comparison = compareVersions(targetVersion, currentVersion);

    if (comparison > 0) {
      return 'upgrade';
    }

    if (comparison < 0) {
      return 'downgrade';
    }

    return 'same';
  } catch (error) {
    return 'unknown';
  }
}

module.exports = {
  normalizeVersion,
  compareVersions,
  classifyUpdatePath,
};
