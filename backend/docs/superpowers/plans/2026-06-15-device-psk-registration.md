# Device PSK Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require signed `/api/ota/check` boot registration requests when `REQUIRE_DEVICE_PSK=true`, while preserving unsigned development-mode registration by default.

**Architecture:** Add a `ProductionKey` persistence model and a focused `deviceIdentityService` seam for HMAC verification. Keep route code thin: `POST /api/ota/check` delegates identity verification before calling `otaCheckService`.

**Tech Stack:** Node.js, CommonJS, Express, Prisma/MySQL, Jest, Supertest, Node `crypto`.

---

## File Structure

- `prisma/schema.prisma`: add `ProductionKey`.
- `db/migrations/2026-06-15-create-production-keys.sql`: manual MySQL migration.
- `src/services/deviceIdentityService.js`: PSK/HMAC verification seam.
- `src/tests/deviceIdentityService.test.js`: service unit tests with mocked Prisma.
- `src/routes/esplink.js`: call identity verification before OTA check.
- `src/tests/otaCheckRoute.test.js`: route tests for 403 and compatibility.

## Task 1: ProductionKey Schema And SQL

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `db/migrations/2026-06-15-create-production-keys.sql`

- [ ] Add `ProductionKey` model:

```prisma
model ProductionKey {
  id            Int       @id @default(autoincrement())
  mac_address   String    @unique @db.VarChar(64)
  sn            String?   @db.VarChar(128)
  psk_hash      String    @db.VarChar(128)
  psk_encrypted String?   @db.Text
  is_active     Boolean   @default(true)
  last_nonce    String?   @db.VarChar(128)
  last_seen_at  DateTime? @db.DateTime(0)
  created_at    DateTime  @default(now()) @db.DateTime(0)
  updated_at    DateTime  @updatedAt @db.DateTime(0)

  @@index([sn])
  @@index([is_active])
  @@map("production_keys")
}
```

- [ ] Create SQL migration:

```sql
CREATE TABLE IF NOT EXISTS `production_keys` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `mac_address` VARCHAR(64) NOT NULL,
  `sn` VARCHAR(128) NULL,
  `psk_hash` VARCHAR(128) NOT NULL,
  `psk_encrypted` TEXT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `last_nonce` VARCHAR(128) NULL,
  `last_seen_at` DATETIME(0) NULL,
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`),
  UNIQUE KEY `production_keys_mac_address_key` (`mac_address`),
  KEY `production_keys_sn_idx` (`sn`),
  KEY `production_keys_is_active_idx` (`is_active`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

- [ ] Run:

```bash
npx prisma format
npx prisma validate
```

Expected: both commands exit 0.

## Task 2: Device Identity Service

**Files:**
- Create: `src/services/deviceIdentityService.js`
- Create: `src/tests/deviceIdentityService.test.js`

- [ ] Write failing tests covering:

```js
jest.mock('../config/database', () => ({
  productionKey: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
}));

const crypto = require('crypto');
const prisma = require('../config/database');

function sign({ mac, sn, timestamp, nonce, psk }) {
  return crypto
    .createHmac('sha256', psk)
    .update(`${mac}\n${sn}\n${timestamp}\n${nonce}`)
    .digest('hex');
}

describe('deviceIdentityService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('allows unsigned boot requests when PSK is not required', async () => {
    delete process.env.REQUIRE_DEVICE_PSK;
    const { verifyBootRequest } = require('../services/deviceIdentityService');

    await expect(verifyBootRequest({ mac: 'AA:BB:CC:DD:EE:FF' })).resolves.toEqual({
      allowed: true,
      mode: 'development',
    });
    expect(prisma.productionKey.findUnique).not.toHaveBeenCalled();
  });

  test('rejects missing signature fields when PSK is required', async () => {
    process.env.REQUIRE_DEVICE_PSK = 'true';
    const { verifyBootRequest } = require('../services/deviceIdentityService');

    await expect(verifyBootRequest({ mac: 'AA:BB:CC:DD:EE:FF' })).resolves.toMatchObject({
      allowed: false,
      statusCode: 403,
      reason: 'device_signature_required',
    });
  });

  test('accepts valid signatures and updates nonce state', async () => {
    process.env.REQUIRE_DEVICE_PSK = 'true';
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = 'nonce-1';
    const psk = 'device-secret';
    const mac = 'AA:BB:CC:DD:EE:FF';
    const sn = 'SN001';
    prisma.productionKey.findUnique.mockResolvedValue({
      mac_address: mac,
      sn,
      psk_encrypted: psk,
      is_active: true,
      last_nonce: null,
    });
    prisma.productionKey.update.mockResolvedValue({});

    const { verifyBootRequest } = require('../services/deviceIdentityService');
    await expect(verifyBootRequest({
      mac,
      sn,
      timestamp,
      nonce,
      signature: sign({ mac, sn, timestamp, nonce, psk }),
    })).resolves.toMatchObject({ allowed: true, mode: 'psk' });

    expect(prisma.productionKey.update).toHaveBeenCalledWith({
      where: { mac_address: mac },
      data: {
        last_nonce: nonce,
        last_seen_at: expect.any(Date),
      },
    });
  });

  test('rejects unknown or inactive production keys', async () => {
    process.env.REQUIRE_DEVICE_PSK = 'true';
    prisma.productionKey.findUnique.mockResolvedValue(null);
    const { verifyBootRequest } = require('../services/deviceIdentityService');

    await expect(verifyBootRequest({
      mac: 'AA:BB:CC:DD:EE:FF',
      sn: 'SN001',
      timestamp: Math.floor(Date.now() / 1000),
      nonce: 'nonce-1',
      signature: 'a'.repeat(64),
    })).resolves.toMatchObject({ allowed: false, reason: 'device_not_provisioned' });
  });

  test('rejects stale timestamps and replayed nonce', async () => {
    process.env.REQUIRE_DEVICE_PSK = 'true';
    prisma.productionKey.findUnique.mockResolvedValue({
      mac_address: 'AA:BB:CC:DD:EE:FF',
      sn: 'SN001',
      psk_encrypted: 'device-secret',
      is_active: true,
      last_nonce: 'nonce-1',
    });
    const { verifyBootRequest } = require('../services/deviceIdentityService');

    await expect(verifyBootRequest({
      mac: 'AA:BB:CC:DD:EE:FF',
      sn: 'SN001',
      timestamp: Math.floor(Date.now() / 1000),
      nonce: 'nonce-1',
      signature: 'a'.repeat(64),
    })).resolves.toMatchObject({ allowed: false, reason: 'device_nonce_replayed' });
  });
});
```

- [ ] Run:

```bash
npx jest src/tests/deviceIdentityService.test.js --runInBand --forceExit
```

Expected: fails because the service module does not exist.

- [ ] Implement `src/services/deviceIdentityService.js` with:

```js
const crypto = require('crypto');
const prisma = require('../config/database');

const MAX_SKEW_SECONDS = 300;

function isRequired() {
  return process.env.REQUIRE_DEVICE_PSK === 'true';
}

function normalizeMac(mac) {
  return typeof mac === 'string' ? mac.trim().toUpperCase() : '';
}

function canonicalPayload({ mac, sn, timestamp, nonce }) {
  return `${mac}\n${sn}\n${timestamp}\n${nonce}`;
}

function hmacHex(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function safeEqualHex(left, right) {
  if (!/^[0-9a-fA-F]+$/.test(left) || !/^[0-9a-fA-F]+$/.test(right)) return false;
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function denied(reason) {
  return { allowed: false, statusCode: 403, reason };
}

function parseTimestampSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric > 9999999999 ? Math.floor(numeric / 1000) : Math.floor(numeric);
}

function timestampFresh(timestamp) {
  const seconds = parseTimestampSeconds(timestamp);
  if (!seconds) return false;
  return Math.abs(Math.floor(Date.now() / 1000) - seconds) <= MAX_SKEW_SECONDS;
}

async function verifyBootRequest(input) {
  if (!isRequired()) {
    return { allowed: true, mode: 'development' };
  }

  const mac = normalizeMac(input.mac);
  const { sn, timestamp, nonce, signature } = input;
  if (!mac || !sn || !timestamp || !nonce || !signature) {
    return denied('device_signature_required');
  }
  if (!timestampFresh(timestamp)) {
    return denied('device_timestamp_stale');
  }

  const key = await prisma.productionKey.findUnique({ where: { mac_address: mac } });
  if (!key || !key.is_active) {
    return denied('device_not_provisioned');
  }
  if (key.sn && key.sn !== sn) {
    return denied('device_serial_mismatch');
  }
  if (key.last_nonce && key.last_nonce === nonce) {
    return denied('device_nonce_replayed');
  }
  if (!key.psk_encrypted) {
    return denied('device_secret_unavailable');
  }

  const expected = hmacHex(canonicalPayload({ mac, sn, timestamp, nonce }), key.psk_encrypted);
  if (!safeEqualHex(expected, signature)) {
    return denied('device_signature_invalid');
  }

  await prisma.productionKey.update({
    where: { mac_address: mac },
    data: {
      last_nonce: nonce,
      last_seen_at: new Date(),
    },
  });

  return { allowed: true, mode: 'psk' };
}

module.exports = {
  verifyBootRequest,
  canonicalPayload,
  hmacHex,
};
```

- [ ] Run service tests again and expect PASS.

## Task 3: OTA Route Integration

**Files:**
- Modify: `src/routes/esplink.js`
- Modify: `src/tests/otaCheckRoute.test.js`

- [ ] Update route tests to mock `deviceIdentityService`:

```js
jest.mock('../services/deviceIdentityService', () => ({
  verifyBootRequest: jest.fn(),
}));
```

- [ ] Add route tests:

```js
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
  expect(otaCheckService.checkBootReport).not.toHaveBeenCalled();
});
```

- [ ] Modify `src/routes/esplink.js` to:

```js
const deviceIdentityService = require('../services/deviceIdentityService');
```

Inside `/ota/check`, before `checkBootReport`:

```js
const identity = await deviceIdentityService.verifyBootRequest(req.body);
if (!identity.allowed) {
  return res.status(identity.statusCode || 403).json({ detail: identity.reason });
}
```

- [ ] Run:

```bash
npx jest src/tests/otaCheckRoute.test.js src/tests/deviceIdentityService.test.js --runInBand --forceExit
```

Expected: PASS.

## Task 4: Verification

- [ ] Run:

```bash
npx prisma format
npx prisma validate
npx jest src/tests/deviceIdentityService.test.js src/tests/otaCheckRoute.test.js --runInBand --forceExit
npm test
git diff --check
```

- [ ] Run `npm run db:generate`.
- [ ] Commit only PSK files. Do not include `package-lock.json` or `admin-frontend/package-lock.json`.
