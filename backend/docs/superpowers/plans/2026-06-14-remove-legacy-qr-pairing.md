# Remove Legacy QR Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the unused QR-code pairing routes, persistence model, and registration coupling while preserving the EspLink Device association flow.

**Architecture:** Device registration becomes independent of pairing records, and EspLink registration plus WeChat binding remains the sole supported association path. Tests cover the removed route surface and the simplified registration behavior before production code changes.

**Tech Stack:** Node.js, Express 4, Jest 29, Supertest, Prisma 5, MySQL

---

## File Map

- Create `src/tests/deviceRegistration.test.js`: focused registration behavior with a mocked Prisma adapter.
- Create `src/tests/legacyPairRoutes.test.js`: HTTP regression proving legacy routes are absent.
- Modify `src/services/deviceService.js`: remove PairRecord lookup and inferred association.
- Modify `src/routes/index.js`: stop mounting the legacy router.
- Delete `src/routes/pair.js`: remove the unsupported transport module.
- Modify `prisma/schema.prisma`: remove the PairRecord model and Tenant relation.
- Modify `README.md`, `CLAUDE.md`, `AGENTS.md`, and `open.md`: remove legacy flow and correct model/table descriptions.

### Task 1: Lock Registration Behavior

**Files:**
- Create: `src/tests/deviceRegistration.test.js`
- Modify: `src/services/deviceService.js:40-87`

- [ ] **Step 1: Write the failing registration test**

```js
jest.mock('../config/database', () => ({
  device: {
    upsert: jest.fn(),
  },
}));

const prisma = require('../config/database');
const { registerDevice } = require('../services/deviceService');

describe('registerDevice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('registers device metadata without consulting legacy pairing records', async () => {
    prisma.device.upsert.mockResolvedValue({
      mac_address: 'AA:BB:CC:DD:EE:FF',
      device_id: 'device-123',
      is_paired: false,
      tenant_id: null,
    });

    await registerDevice({
      mac_address: 'AA:BB:CC:DD:EE:FF',
      device_id: 'device-123',
      firmware: '1.0.0',
      name: 'Desk Device',
    });

    expect(prisma.device.upsert).toHaveBeenCalledWith({
      where: { mac_address: 'AA:BB:CC:DD:EE:FF' },
      create: {
        mac_address: 'AA:BB:CC:DD:EE:FF',
        device_id: 'device-123',
        firmware: '1.0.0',
        name: 'Desk Device',
        last_seen: expect.any(Date),
        is_online: true,
      },
      update: {
        device_id: 'device-123',
        firmware: '1.0.0',
        name: 'Desk Device',
        last_seen: expect.any(Date),
        is_online: true,
      },
    });
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm test -- src/tests/deviceRegistration.test.js
```

Expected: FAIL because the current implementation calls `prisma.pairRecord.findFirst`.

- [ ] **Step 3: Remove PairRecord coupling from registration**

Replace the `registerDevice()` implementation with:

```js
async function registerDevice({ mac_address, device_id, firmware, name }) {
  return prisma.device.upsert({
    where: { mac_address },
    create: {
      mac_address,
      device_id: device_id || null,
      firmware: firmware || null,
      name: name || null,
      last_seen: new Date(),
      is_online: true,
    },
    update: {
      ...(device_id && { device_id }),
      ...(firmware && { firmware }),
      ...(name && { name }),
      last_seen: new Date(),
      is_online: true,
    },
  });
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```bash
npm test -- src/tests/deviceRegistration.test.js
```

Expected: PASS with one passing test.

### Task 2: Remove the Legacy Route Surface

**Files:**
- Create: `src/tests/legacyPairRoutes.test.js`
- Modify: `src/routes/index.js:10`
- Delete: `src/routes/pair.js`

- [ ] **Step 1: Write the failing route test**

```js
const request = require('supertest');
const app = require('../app');

describe('legacy QR pairing routes', () => {
  test.each([
    ['post', '/api/v1/pair/verify'],
    ['post', '/api/v1/pair/confirm'],
    ['get', '/api/v1/pair/status/device-123'],
  ])('%s %s is not mounted', async (method, path) => {
    const response = await request(app)[method](path).send({});
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npm test -- src/tests/legacyPairRoutes.test.js
```

Expected: FAIL because at least the mounted POST routes return validation status `400`.

- [ ] **Step 3: Remove the route mount and file**

Delete this line from `src/routes/index.js`:

```js
router.use('/pair', require('./pair'));
```

Delete `src/routes/pair.js`.

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```bash
npm test -- src/tests/legacyPairRoutes.test.js
```

Expected: PASS with three route cases returning `404`.

### Task 3: Remove PairRecord Persistence

**Files:**
- Modify: `prisma/schema.prisma:23`
- Modify: `prisma/schema.prisma:144-161`

- [ ] **Step 1: Remove the Tenant relation**

Delete:

```prisma
pair_records        PairRecord[]
```

- [ ] **Step 2: Remove the PairRecord model**

Delete the complete `model PairRecord` declaration, including its indexes and `@@map("pair_records")`.

- [ ] **Step 3: Validate the Prisma schema**

Run:

```bash
npx prisma validate
```

Expected: `The schema at prisma/schema.prisma is valid`.

- [ ] **Step 4: Verify production references are absent**

Run:

```bash
rg -n "PairRecord|pairRecord|pair_records|routes/pair|require\\('./pair'\\)" src prisma
```

Expected: no output and exit status `1`.

Do not run `prisma db push`; dropping the live table is a separate operational action.

### Task 4: Align Repository Documentation

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`
- Modify: `open.md`

- [ ] **Step 1: Remove QR pairing descriptions**

Remove the QR pairing feature bullet, endpoint rows, flow section, route tree entry, PairRecord model description, and `pair_records` table description.

- [ ] **Step 2: Correct structure and counts**

Describe `deviceService.js` as Device CRUD and registration without PairRecord linking. Remove `PairRecord` from Prisma model lists and decrement documented custom table counts where applicable.

- [ ] **Step 3: Describe the supported association flow**

Keep the documented flow:

```text
BLE provisioning -> POST /api/ota/check -> /ws/device online
-> GET /api/device/lookup -> POST /api/device/bind
```

- [ ] **Step 4: Verify stale documentation is absent**

Run:

```bash
rg -n "PairRecord|pairRecord|pair_records|/api/v1/pair|扫码配对|二维码配对" README.md CLAUDE.md AGENTS.md open.md
```

Expected: no output and exit status `1`.

### Task 5: Full Verification

**Files:**
- Test: `src/tests/deviceRegistration.test.js`
- Test: `src/tests/legacyPairRoutes.test.js`
- Validate: `prisma/schema.prisma`

- [ ] **Step 1: Run all Jest tests**

Run:

```bash
npm test
```

Expected: both test suites pass with four tests total.

- [ ] **Step 2: Validate Prisma again**

Run:

```bash
npx prisma validate
```

Expected: schema validation succeeds.

- [ ] **Step 3: Inspect the final diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; unrelated existing changes to lockfiles remain untouched.
