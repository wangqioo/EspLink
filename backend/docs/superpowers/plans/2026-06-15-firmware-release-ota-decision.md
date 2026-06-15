# Firmware Release OTA Decision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add backend firmware release records and make `/api/ota/check` return a real OTA update envelope when a newer compatible release exists.

**Architecture:** Add a Prisma `FirmwareRelease` model and a focused `firmwareReleaseService` for validation, listing, toggling, and semantic latest-release selection. Keep OTA response shaping in `otaCheckService`; it calls the release service after boot registration and falls back to the existing no-update envelope whenever selection is unavailable or unsafe.

**Tech Stack:** Node.js, CommonJS, Express, Prisma/MySQL, Jest, Supertest.

---

## File Structure

- `prisma/schema.prisma`: add `FirmwareRelease`.
- `src/services/firmwareReleaseService.js`: release validation, CRUD-lite operations, latest active selection.
- `src/tests/firmwareReleaseService.test.js`: service unit tests with mocked Prisma.
- `src/services/otaCheckService.js`: call release selection and build update/no-update OTA envelope.
- `src/tests/otaCheckService.test.js`: OTA decision tests with mocked release service.
- `src/routes/firmware.js`: admin routes for release list/create/toggle.
- `src/routes/index.js`: mount `/api/v1/firmware`.
- `src/tests/firmwareRoutes.test.js`: route tests with mocked admin auth and service.

## Task 1: FirmwareRelease Schema

**Files:**
- Modify: `prisma/schema.prisma`

- [x] **Step 1: Add the Prisma model**

Append this model after `UsageHourly`:

```prisma
model FirmwareRelease {
  id            Int      @id @default(autoincrement())
  board_type    String   @db.VarChar(64)
  version       String   @db.VarChar(64)
  artifact_url  String   @db.Text
  sha256        String   @db.VarChar(128)
  size_bytes    Int?
  channel       String   @default("stable") @db.VarChar(32)
  is_active     Boolean  @default(true)
  force_update  Boolean  @default(false)
  release_notes String?  @db.Text
  created_at    DateTime @default(now()) @db.DateTime(0)
  updated_at    DateTime @updatedAt @db.DateTime(0)

  @@unique([board_type, channel, version])
  @@index([board_type, channel, is_active])
  @@index([board_type, version])
  @@map("firmware_releases")
}
```

- [x] **Step 2: Validate schema formatting**

Run:

```bash
npx prisma format
```

Expected: command exits 0 and keeps the new model in `prisma/schema.prisma`.

- [x] **Step 3: Commit schema**

```bash
git add prisma/schema.prisma
git commit -m "feat: add firmware release schema"
```

Do not stage `package-lock.json` or `admin-frontend/package-lock.json`.

## Task 2: Firmware Release Service

**Files:**
- Create: `src/services/firmwareReleaseService.js`
- Create: `src/tests/firmwareReleaseService.test.js`

- [x] **Step 1: Write failing service tests**

Create `src/tests/firmwareReleaseService.test.js`:

```js
jest.mock('../config/database', () => ({
  firmwareRelease: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
}));

const prisma = require('../config/database');

describe('firmwareReleaseService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('createRelease normalizes versions and applies defaults', async () => {
    prisma.firmwareRelease.findFirst.mockResolvedValue(null);
    prisma.firmwareRelease.create.mockResolvedValue({
      id: 1,
      board_type: 'esp32-s3-box',
      version: '2.5.0',
      channel: 'stable',
      is_active: true,
      force_update: false,
    });

    const { createRelease } = require('../services/firmwareReleaseService');
    const release = await createRelease({
      board_type: 'esp32-s3-box',
      version: 'v02.005.000',
      artifact_url: 'https://firmware.example.test/esp32.bin',
      sha256: 'a'.repeat(64),
    });

    expect(prisma.firmwareRelease.create).toHaveBeenCalledWith({
      data: {
        board_type: 'esp32-s3-box',
        version: '2.5.0',
        artifact_url: 'https://firmware.example.test/esp32.bin',
        sha256: 'a'.repeat(64),
        size_bytes: null,
        channel: 'stable',
        is_active: true,
        force_update: false,
        release_notes: null,
      },
    });
    expect(release.version).toBe('2.5.0');
  });

  test('createRelease rejects malformed release versions', async () => {
    const { createRelease } = require('../services/firmwareReleaseService');

    await expect(createRelease({
      board_type: 'esp32-s3-box',
      version: 'latest',
      artifact_url: 'https://firmware.example.test/esp32.bin',
      sha256: 'a'.repeat(64),
    })).rejects.toMatchObject({ code: 40000, message: 'invalid firmware version' });
  });

  test('createRelease rejects duplicate board channel version', async () => {
    prisma.firmwareRelease.findFirst.mockResolvedValue({ id: 7 });
    const { createRelease } = require('../services/firmwareReleaseService');

    await expect(createRelease({
      board_type: 'esp32-s3-box',
      version: '2.5.0',
      artifact_url: 'https://firmware.example.test/esp32.bin',
      sha256: 'a'.repeat(64),
      channel: 'stable',
    })).rejects.toMatchObject({ code: 40900, message: 'firmware release already exists' });
  });

  test('findLatestActiveRelease selects highest semantic version', async () => {
    prisma.firmwareRelease.findMany.mockResolvedValue([
      { id: 1, board_type: 'esp32-s3-box', channel: 'stable', version: '2.9.0', is_active: true },
      { id: 2, board_type: 'esp32-s3-box', channel: 'stable', version: '2.10.0', is_active: true },
      { id: 3, board_type: 'esp32-s3-box', channel: 'stable', version: '2.2.99', is_active: true },
    ]);

    const { findLatestActiveRelease } = require('../services/firmwareReleaseService');
    const release = await findLatestActiveRelease({ boardType: 'esp32-s3-box' });

    expect(prisma.firmwareRelease.findMany).toHaveBeenCalledWith({
      where: {
        board_type: 'esp32-s3-box',
        channel: 'stable',
        is_active: true,
      },
    });
    expect(release.id).toBe(2);
  });

  test('listReleases returns paginated releases', async () => {
    prisma.firmwareRelease.findMany.mockResolvedValue([{ id: 1 }]);
    prisma.firmwareRelease.count.mockResolvedValue(1);

    const { listReleases } = require('../services/firmwareReleaseService');
    const result = await listReleases({
      boardType: 'esp32-s3-box',
      channel: 'stable',
      page: 2,
      pageSize: 10,
    });

    expect(prisma.firmwareRelease.findMany).toHaveBeenCalledWith({
      where: { board_type: 'esp32-s3-box', channel: 'stable' },
      orderBy: [{ created_at: 'desc' }],
      skip: 10,
      take: 10,
    });
    expect(result).toEqual({ list: [{ id: 1 }], total: 1 });
  });

  test('setReleaseActive toggles release active state', async () => {
    prisma.firmwareRelease.update.mockResolvedValue({ id: 1, is_active: false });
    const { setReleaseActive } = require('../services/firmwareReleaseService');

    await expect(setReleaseActive(1, false)).resolves.toEqual({ id: 1, is_active: false });
    expect(prisma.firmwareRelease.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { is_active: false },
    });
  });
});
```

- [x] **Step 2: Run tests to verify RED**

Run:

```bash
npx jest src/tests/firmwareReleaseService.test.js --runInBand --forceExit
```

Expected: FAIL with `Cannot find module '../services/firmwareReleaseService'`.

- [x] **Step 3: Implement release service**

Create `src/services/firmwareReleaseService.js`:

```js
const prisma = require('../config/database');
const { normalizeVersion, compareVersions } = require('./firmwareVersionPolicy');

function serviceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeChannel(channel) {
  return (typeof channel === 'string' && channel.trim()) ? channel.trim() : 'stable';
}

function validateRequired(input) {
  for (const field of ['board_type', 'version', 'artifact_url', 'sha256']) {
    if (!input[field]) {
      throw serviceError(40000, `${field} is required`);
    }
  }
}

async function createRelease(input) {
  validateRequired(input);
  const version = normalizeVersion(input.version);
  if (!version) {
    throw serviceError(40000, 'invalid firmware version');
  }

  const channel = normalizeChannel(input.channel);
  const boardType = String(input.board_type).trim();
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
      size_bytes: input.size_bytes == null ? null : Number(input.size_bytes),
      channel,
      is_active: input.is_active !== undefined ? Boolean(input.is_active) : true,
      force_update: input.force_update !== undefined ? Boolean(input.force_update) : false,
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
  if (!boardType) {
    return null;
  }

  const releases = await prisma.firmwareRelease.findMany({
    where: {
      board_type: boardType,
      channel: normalizeChannel(channel),
      is_active: true,
    },
  });

  return releases.reduce((latest, release) => {
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
```

- [x] **Step 4: Run service tests**

Run:

```bash
npx jest src/tests/firmwareReleaseService.test.js --runInBand --forceExit
```

Expected: PASS, 6 tests.

- [x] **Step 5: Commit service**

```bash
git add src/services/firmwareReleaseService.js src/tests/firmwareReleaseService.test.js
git commit -m "feat: add firmware release service"
```

## Task 3: OTA Decision Integration

**Files:**
- Modify: `src/services/otaCheckService.js`
- Modify: `src/tests/otaCheckService.test.js`

**Dependency:** Task 2 must be committed first so `src/services/firmwareReleaseService.js` exists for Jest mocks.

- [x] **Step 1: Extend OTA service mocks and tests**

Update the top of `src/tests/otaCheckService.test.js`:

```js
jest.mock('../services/wechatService', () => ({
  bootRegister: jest.fn(),
}));

jest.mock('../services/firmwareReleaseService', () => ({
  findLatestActiveRelease: jest.fn(),
}));

const wechatService = require('../services/wechatService');
const firmwareReleaseService = require('../services/firmwareReleaseService');
```

Add these tests inside the existing `describe('otaCheckService', () => { ... })` block:

```js
  test('returns update envelope when a newer active firmware release exists', async () => {
    process.env.WS_BASE_URL = 'ws://device.example.test';
    wechatService.bootRegister.mockResolvedValue({
      device_key: 'device-token',
      device: {
        mac_address: 'AA:BB:CC:DD:EE:FF',
        board_type: 'esp32-s3-box',
        firmware: '2.4.1',
        wechat_user_id: null,
      },
    });
    firmwareReleaseService.findLatestActiveRelease.mockResolvedValue({
      version: '2.5.0',
      artifact_url: 'https://firmware.example.test/esp32.bin',
      sha256: 'a'.repeat(64),
      size_bytes: 1024,
      force_update: false,
      release_notes: 'bug fixes',
    });
    const { checkBootReport } = require('../services/otaCheckService');

    const result = await checkBootReport({
      mac: 'AA:BB:CC:DD:EE:FF',
      board_type: 'esp32-s3-box',
      firmware_version: '2.4.1',
    });

    expect(firmwareReleaseService.findLatestActiveRelease).toHaveBeenCalledWith({
      boardType: 'esp32-s3-box',
      channel: 'stable',
    });
    expect(result).toMatchObject({
      token: 'device-token',
      update_available: true,
      ota: {
        version: '2.5.0',
        url: 'https://firmware.example.test/esp32.bin',
        sha256: 'a'.repeat(64),
        size_bytes: 1024,
        force: false,
        release_notes: 'bug fixes',
      },
    });
  });

  test('returns no update when release version is same or older', async () => {
    wechatService.bootRegister.mockResolvedValue({
      device_key: 'device-token',
      device: { board_type: 'esp32-s3-box', firmware: '2.5.0', wechat_user_id: null },
    });
    firmwareReleaseService.findLatestActiveRelease.mockResolvedValue({
      version: '2.5.0',
      artifact_url: 'https://firmware.example.test/esp32.bin',
      sha256: 'a'.repeat(64),
    });
    const { checkBootReport } = require('../services/otaCheckService');

    await expect(checkBootReport({
      mac: 'AA:BB:CC:DD:EE:FF',
      board_type: 'esp32-s3-box',
      firmware_version: '2.5.0',
    })).resolves.toMatchObject({
      update_available: false,
      ota: null,
    });
  });

  test('returns no update when current firmware is unknown', async () => {
    wechatService.bootRegister.mockResolvedValue({
      device_key: 'device-token',
      device: { board_type: 'esp32-s3-box', firmware: null, wechat_user_id: null },
    });
    const { checkBootReport } = require('../services/otaCheckService');

    await expect(checkBootReport({
      mac: 'AA:BB:CC:DD:EE:FF',
      board_type: 'esp32-s3-box',
      firmware_version: 'latest',
    })).resolves.toMatchObject({
      update_available: false,
      ota: null,
    });
    expect(firmwareReleaseService.findLatestActiveRelease).not.toHaveBeenCalled();
  });

  test('keeps boot compatible when release lookup fails', async () => {
    wechatService.bootRegister.mockResolvedValue({
      device_key: 'device-token',
      device: { board_type: 'esp32-s3-box', firmware: '2.4.1', wechat_user_id: null },
    });
    firmwareReleaseService.findLatestActiveRelease.mockRejectedValue(new Error('redis or db failure'));
    const { checkBootReport } = require('../services/otaCheckService');

    await expect(checkBootReport({
      mac: 'AA:BB:CC:DD:EE:FF',
      board_type: 'esp32-s3-box',
      firmware_version: '2.4.1',
    })).resolves.toMatchObject({
      update_available: false,
      ota: null,
    });
  });
```

- [x] **Step 2: Run tests to verify RED**

Run:

```bash
npx jest src/tests/otaCheckService.test.js --runInBand --forceExit
```

Expected: FAIL because `otaCheckService` still returns `update_available: false`.

- [x] **Step 3: Implement OTA decision**

Update `src/services/otaCheckService.js` to import:

```js
const { normalizeVersion, compareVersions } = require('./firmwareVersionPolicy');
const firmwareReleaseService = require('./firmwareReleaseService');
```

Add helpers:

```js
function noUpdateResponse({ device, device_key, wsBase }) {
  return {
    token: device_key,
    websocket_url: `${wsBase}/ws/device`,
    is_bound: device?.wechat_user_id != null,
    update_available: false,
    ota: null,
    retry_policy: {
      retry_after_seconds: 30,
    },
  };
}

function updateResponse({ device, device_key, wsBase, release }) {
  return {
    token: device_key,
    websocket_url: `${wsBase}/ws/device`,
    is_bound: device?.wechat_user_id != null,
    update_available: true,
    ota: {
      version: release.version,
      url: release.artifact_url,
      sha256: release.sha256,
      size_bytes: release.size_bytes ?? null,
      force: Boolean(release.force_update),
      release_notes: release.release_notes ?? null,
    },
    retry_policy: {
      retry_after_seconds: 30,
    },
  };
}
```

Change `checkBootReport` after `bootRegister`:

```js
  const currentVersion = normalizeVersion(firmware_version);
  const boardType = board_type || device?.board_type;
  const baseResponse = noUpdateResponse({ device, device_key, wsBase });

  if (!boardType || !currentVersion) {
    return baseResponse;
  }

  try {
    const release = await firmwareReleaseService.findLatestActiveRelease({
      boardType,
      channel: 'stable',
    });
    if (!release || compareVersions(release.version, currentVersion) <= 0) {
      return baseResponse;
    }

    return updateResponse({ device, device_key, wsBase, release });
  } catch (error) {
    console.error('[OTA] release lookup failed:', error.message);
    return baseResponse;
  }
```

Keep the existing boot registration normalization before `bootRegister`.

- [x] **Step 4: Run OTA tests**

Run:

```bash
npx jest src/tests/otaCheckService.test.js src/tests/firmwareReleaseService.test.js --runInBand --forceExit
```

Expected: PASS.

- [x] **Step 5: Commit OTA decision**

```bash
git add src/services/otaCheckService.js src/tests/otaCheckService.test.js
git commit -m "feat: select firmware release for ota checks"
```

## Task 4: Admin Firmware Routes

**Files:**
- Create: `src/routes/firmware.js`
- Modify: `src/routes/index.js`
- Create: `src/tests/firmwareRoutes.test.js`

- [x] **Step 1: Write failing route tests**

Create `src/tests/firmwareRoutes.test.js`:

```js
const express = require('express');
const request = require('supertest');

jest.mock('../middleware/adminAuth', () => (req, _res, next) => {
  req.admin = { username: 'admin', type: 'admin', role: 'admin' };
  next();
});

jest.mock('../services/firmwareReleaseService', () => ({
  createRelease: jest.fn(),
  listReleases: jest.fn(),
  setReleaseActive: jest.fn(),
}));

const firmwareReleaseService = require('../services/firmwareReleaseService');

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
});
```

- [x] **Step 2: Run route tests to verify RED**

Run:

```bash
npx jest src/tests/firmwareRoutes.test.js --runInBand --forceExit
```

Expected: FAIL with `Cannot find module '../routes/firmware'`.

- [x] **Step 3: Implement routes**

Create `src/routes/firmware.js`:

```js
const express = require('express');
const adminAuth = require('../middleware/adminAuth');
const { success, paginated, error } = require('../utils/response');
const {
  createRelease,
  listReleases,
  setReleaseActive,
} = require('../services/firmwareReleaseService');

const router = express.Router();

router.use(adminAuth);

router.get('/releases', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, parseInt(req.query.pageSize, 10) || 20);
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
    const release = await setReleaseActive(Number(req.params.id), req.body?.is_active);
    res.json(success(release));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

Modify `src/routes/index.js`:

```js
router.use('/firmware', require('./firmware'));
```

Place it with the other admin route mounts.

- [x] **Step 4: Run route tests**

Run:

```bash
npx jest src/tests/firmwareRoutes.test.js --runInBand --forceExit
```

Expected: PASS, 4 tests.

- [x] **Step 5: Commit routes**

```bash
git add src/routes/firmware.js src/routes/index.js src/tests/firmwareRoutes.test.js
git commit -m "feat: add firmware release admin routes"
```

## Task 5: Verification

**Files:**
- Verify backend files only.

- [x] **Step 1: Run targeted tests**

Run:

```bash
npx jest src/tests/firmwareReleaseService.test.js src/tests/otaCheckService.test.js src/tests/firmwareRoutes.test.js --runInBand --forceExit
```

Expected: PASS.

- [x] **Step 2: Check formatting diff**

Run:

```bash
git diff --check
```

Expected: no output, exit 0.

- [x] **Step 3: Run full backend tests**

Run:

```bash
npm test
```

Expected: all Jest suites pass.

- [x] **Step 4: Final status check**

Run:

```bash
git status --short
```

Expected: only known unrelated lockfile changes may remain:

```text
 M admin-frontend/package-lock.json
 M package-lock.json
```

- [x] **Step 5: Commit plan progress if this file was updated**

If you checked off items in this plan during execution, commit the plan update with the final implementation commit or amend the relevant task commit. Do not create a docs-only commit just for checkbox churn unless all code is already committed.
