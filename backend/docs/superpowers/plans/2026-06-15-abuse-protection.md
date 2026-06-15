# Abuse Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rate-limit abuse protection to OTA boot registration and tighten AI chat limits for unbound devices.

**Architecture:** Reuse the existing Redis-backed `RateLimiter.consume` seam through a new `deviceAbuseProtection` module. Keep route and WebSocket callers thin: they ask the module for allow/deny decisions and preserve existing response shapes.

**Tech Stack:** Node.js, CommonJS, Express, WebSocket `ws`, Jest, Supertest, Redis Lua through existing `rateLimiter`.

---

## File Structure

- Create: `src/services/deviceAbuseProtection.js`
- Create: `src/tests/deviceAbuseProtection.test.js`
- Modify: `src/routes/esplink.js`
- Modify: `src/tests/otaCheckRoute.test.js`
- Modify: `src/ws/deviceWsManager.js`
- Modify: `src/tests/deviceWsRateLimit.test.js`
- Modify: `.env.example`
- Modify: `DEPLOY-NOTES.md`
- Modify: `open.md`

## Task 1: Device Abuse Protection Service

**Files:**
- Create: `src/services/deviceAbuseProtection.js`
- Create: `src/tests/deviceAbuseProtection.test.js`

- [ ] **Step 1: Write failing service tests**

Create `src/tests/deviceAbuseProtection.test.js`:

```js
jest.mock('../services/rateLimiter', () => ({
  consume: jest.fn(),
}));

const { consume } = require('../services/rateLimiter');

describe('deviceAbuseProtection', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('uses default OTA registration limit with IP and normalized MAC subject', async () => {
    consume.mockResolvedValue(true);
    const { checkOtaRegistrationRate } = require('../services/deviceAbuseProtection');

    await expect(checkOtaRegistrationRate({
      ip: '::ffff:127.0.0.1',
      mac: 'aa:bb:cc:dd:ee:ff',
    })).resolves.toBe(true);

    expect(consume).toHaveBeenCalledWith('::ffff:127.0.0.1:AA:BB:CC:DD:EE:FF', {
      limit: 10,
      windowSeconds: 60,
      keyPrefix: 'ratelimit:ota-check',
    });
  });

  test('uses env overrides for OTA registration limits', async () => {
    process.env.OTA_CHECK_RATE_LIMIT = '2';
    process.env.OTA_CHECK_RATE_WINDOW_SECONDS = '15';
    consume.mockResolvedValue(false);
    const { checkOtaRegistrationRate } = require('../services/deviceAbuseProtection');

    await expect(checkOtaRegistrationRate({
      ip: '10.0.0.2',
      mac: 'AA:BB:CC:DD:EE:FF',
    })).resolves.toBe(false);

    expect(consume).toHaveBeenCalledWith('10.0.0.2:AA:BB:CC:DD:EE:FF', {
      limit: 2,
      windowSeconds: 15,
      keyPrefix: 'ratelimit:ota-check',
    });
  });

  test('uses bound-device AI limit for bound devices', async () => {
    consume.mockResolvedValue(true);
    const { checkAiChatRate } = require('../services/deviceAbuseProtection');

    await expect(checkAiChatRate({
      mac: 'aa:bb:cc:dd:ee:ff',
      isBound: true,
    })).resolves.toBe(true);

    expect(consume).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF', {
      limit: 20,
      windowSeconds: 60,
      keyPrefix: 'ratelimit:device-ai',
    });
  });

  test('uses stricter unbound-device AI limit for unbound devices', async () => {
    consume.mockResolvedValue(false);
    const { checkAiChatRate } = require('../services/deviceAbuseProtection');

    await expect(checkAiChatRate({
      mac: 'AA:BB:CC:DD:EE:FF',
      isBound: false,
    })).resolves.toBe(false);

    expect(consume).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF', {
      limit: 3,
      windowSeconds: 300,
      keyPrefix: 'ratelimit:device-ai',
    });
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npx jest src/tests/deviceAbuseProtection.test.js --runInBand --forceExit
```

Expected: FAIL with `Cannot find module '../services/deviceAbuseProtection'`.

- [ ] **Step 3: Implement service**

Create `src/services/deviceAbuseProtection.js`:

```js
const { consume } = require('./rateLimiter');

const DEFAULTS = {
  otaCheckRateLimit: 10,
  otaCheckRateWindowSeconds: 60,
  deviceAiRateLimit: 20,
  deviceAiRateWindowSeconds: 60,
  unboundDeviceAiRateLimit: 3,
  unboundDeviceAiRateWindowSeconds: 300,
};

function readPositiveInt(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeMac(mac) {
  return typeof mac === 'string' ? mac.trim().toUpperCase() : '';
}

function getAbuseProtectionConfig() {
  return {
    otaCheckRateLimit: readPositiveInt('OTA_CHECK_RATE_LIMIT', DEFAULTS.otaCheckRateLimit),
    otaCheckRateWindowSeconds: readPositiveInt('OTA_CHECK_RATE_WINDOW_SECONDS', DEFAULTS.otaCheckRateWindowSeconds),
    deviceAiRateLimit: readPositiveInt('DEVICE_AI_RATE_LIMIT', DEFAULTS.deviceAiRateLimit),
    deviceAiRateWindowSeconds: readPositiveInt('DEVICE_AI_RATE_WINDOW_SECONDS', DEFAULTS.deviceAiRateWindowSeconds),
    unboundDeviceAiRateLimit: readPositiveInt('UNBOUND_DEVICE_AI_RATE_LIMIT', DEFAULTS.unboundDeviceAiRateLimit),
    unboundDeviceAiRateWindowSeconds: readPositiveInt('UNBOUND_DEVICE_AI_RATE_WINDOW_SECONDS', DEFAULTS.unboundDeviceAiRateWindowSeconds),
  };
}

async function checkOtaRegistrationRate({ ip, mac }) {
  const config = getAbuseProtectionConfig();
  return consume(`${ip || 'unknown'}:${normalizeMac(mac)}`, {
    limit: config.otaCheckRateLimit,
    windowSeconds: config.otaCheckRateWindowSeconds,
    keyPrefix: 'ratelimit:ota-check',
  });
}

async function checkAiChatRate({ mac, isBound }) {
  const config = getAbuseProtectionConfig();
  const limit = isBound ? config.deviceAiRateLimit : config.unboundDeviceAiRateLimit;
  const windowSeconds = isBound
    ? config.deviceAiRateWindowSeconds
    : config.unboundDeviceAiRateWindowSeconds;

  return consume(normalizeMac(mac), {
    limit,
    windowSeconds,
    keyPrefix: 'ratelimit:device-ai',
  });
}

module.exports = {
  checkOtaRegistrationRate,
  checkAiChatRate,
  getAbuseProtectionConfig,
};
```

- [ ] **Step 4: Run service test to verify GREEN**

Run:

```bash
npx jest src/tests/deviceAbuseProtection.test.js --runInBand --forceExit
```

Expected: PASS.

## Task 2: OTA Boot Registration Rate Limit

**Files:**
- Modify: `src/routes/esplink.js`
- Modify: `src/tests/otaCheckRoute.test.js`

- [ ] **Step 1: Write failing route tests**

Update `src/tests/otaCheckRoute.test.js`:

```js
jest.mock('../services/deviceAbuseProtection', () => ({
  checkOtaRegistrationRate: jest.fn(),
}));
```

Require it:

```js
const deviceAbuseProtection = require('../services/deviceAbuseProtection');
```

In `beforeEach`:

```js
deviceAbuseProtection.checkOtaRegistrationRate.mockResolvedValue(true);
```

Add assertions to the existing success test:

```js
expect(deviceAbuseProtection.checkOtaRegistrationRate).toHaveBeenCalledWith({
  ip: expect.any(String),
  mac: 'AA:BB:CC:DD:EE:FF',
});
```

Add a denial test:

```js
test('rate limits boot reports before calling otaCheckService', async () => {
  deviceAbuseProtection.checkOtaRegistrationRate.mockResolvedValue(false);

  const res = await request(app).post('/api/ota/check').send({
    mac: 'AA:BB:CC:DD:EE:FF',
    board_type: 'esp32-s3-box',
    firmware_version: '2.4.1',
  });

  expect(res.status).toBe(429);
  expect(res.body).toEqual({ code: 42900, message: '请求过于频繁，请稍后再试' });
  expect(otaCheckService.checkBootReport).not.toHaveBeenCalled();
});
```

Also assert the missing-MAC test does not call the limiter.

- [ ] **Step 2: Run route test to verify RED**

Run:

```bash
npx jest src/tests/otaCheckRoute.test.js --runInBand --forceExit
```

Expected: FAIL because `deviceAbuseProtection.checkOtaRegistrationRate` is not called and denied requests still reach `otaCheckService`.

- [ ] **Step 3: Implement route integration**

In `src/routes/esplink.js`, require the module:

```js
const deviceAbuseProtection = require('../services/deviceAbuseProtection');
```

After identity verification and before `otaCheckService.checkBootReport`:

```js
const registrationAllowed = await deviceAbuseProtection.checkOtaRegistrationRate({
  ip: req.ip,
  mac,
});
if (!registrationAllowed) {
  return res.status(429).json({ code: 42900, message: '请求过于频繁，请稍后再试' });
}
```

- [ ] **Step 4: Run route and service tests**

Run:

```bash
npx jest src/tests/deviceAbuseProtection.test.js src/tests/otaCheckRoute.test.js --runInBand --forceExit
```

Expected: PASS.

## Task 3: Unbound Device AI Chat Limit

**Files:**
- Modify: `src/ws/deviceWsManager.js`
- Modify: `src/tests/deviceWsRateLimit.test.js`

- [ ] **Step 1: Write failing WebSocket helper tests**

Update `src/tests/deviceWsRateLimit.test.js` to mock `deviceAbuseProtection` instead of `rateLimiter`:

```js
jest.mock('../services/deviceAbuseProtection', () => ({
  checkAiChatRate: jest.fn(),
}));
```

Require:

```js
const deviceAbuseProtection = require('../services/deviceAbuseProtection');
```

Replace expectations with:

```js
test('passes bound state to abuse protection for AI chat', async () => {
  deviceAbuseProtection.checkAiChatRate.mockResolvedValue(true);
  const { checkAiRateLimit } = require('../ws/deviceWsManager');

  await expect(checkAiRateLimit('AA:BB:CC:DD:EE:FF', true)).resolves.toBe(true);

  expect(deviceAbuseProtection.checkAiChatRate).toHaveBeenCalledWith({
    mac: 'AA:BB:CC:DD:EE:FF',
    isBound: true,
  });
});

test('returns false when abuse protection denies unbound device AI chat', async () => {
  deviceAbuseProtection.checkAiChatRate.mockResolvedValue(false);
  const { checkAiRateLimit } = require('../ws/deviceWsManager');

  await expect(checkAiRateLimit('AA:BB:CC:DD:EE:FF', false)).resolves.toBe(false);
});
```

- [ ] **Step 2: Run helper test to verify RED**

Run:

```bash
npx jest src/tests/deviceWsRateLimit.test.js --runInBand --forceExit
```

Expected: FAIL because `checkAiRateLimit` still calls `rateLimiter.consume`.

- [ ] **Step 3: Implement WebSocket integration**

In `src/ws/deviceWsManager.js`, replace:

```js
const { consume } = require('../services/rateLimiter');
```

with:

```js
const deviceAbuseProtection = require('../services/deviceAbuseProtection');
```

Replace `checkAiRateLimit` with:

```js
async function checkAiRateLimit(mac, isBound) {
  return deviceAbuseProtection.checkAiChatRate({ mac, isBound });
}
```

In the `ai_chat` handler, replace:

```js
const allowed = await checkAiRateLimit(mac);
```

with:

```js
const allowed = await checkAiRateLimit(mac, device.wechat_user_id != null);
```

Remove unused `AI_RATE_LIMIT` and `AI_RATE_WINDOW_SECONDS` constants.

- [ ] **Step 4: Run WebSocket helper and full focused tests**

Run:

```bash
npx jest src/tests/deviceAbuseProtection.test.js src/tests/deviceWsRateLimit.test.js src/tests/otaCheckRoute.test.js --runInBand --forceExit
```

Expected: PASS.

## Task 4: Env And Docs

**Files:**
- Modify: `.env.example`
- Modify: `DEPLOY-NOTES.md`
- Modify: `open.md`

- [ ] **Step 1: Add env example values**

Add after `REQUIRE_DEVICE_PSK`:

```env
OTA_CHECK_RATE_LIMIT=10
OTA_CHECK_RATE_WINDOW_SECONDS=60
DEVICE_AI_RATE_LIMIT=20
DEVICE_AI_RATE_WINDOW_SECONDS=60
UNBOUND_DEVICE_AI_RATE_LIMIT=3
UNBOUND_DEVICE_AI_RATE_WINDOW_SECONDS=300
```

- [ ] **Step 2: Update deployment docs**

In `DEPLOY-NOTES.md`, add the same env values to the `.env` block and update the security section to note boot registration and unbound AI limits are implemented.

In `open.md`, add a short note under hardware connection testing that repeated `/api/ota/check` calls may return `429`, tunable through the env vars.

- [ ] **Step 3: Search for stale docs**

Run:

```bash
rg -n "速率限制|OTA_CHECK_RATE|UNBOUND_DEVICE_AI|DEVICE_AI_RATE|请求过于频繁" DEPLOY-NOTES.md open.md .env.example
```

Expected: new settings and descriptions are present.

## Task 5: Verification And Commit

- [ ] **Step 1: Run focused tests**

Run:

```bash
npx jest src/tests/deviceAbuseProtection.test.js src/tests/otaCheckRoute.test.js src/tests/deviceWsRateLimit.test.js --runInBand --forceExit
```

Expected: PASS.

- [ ] **Step 2: Run full tests**

Run:

```bash
npm test
```

Expected: all suites pass.

- [ ] **Step 3: Check diff hygiene**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors. Only abuse-protection files should be staged for commit; do not include `package-lock.json` or `admin-frontend/package-lock.json`.

- [ ] **Step 4: Commit**

Run:

```bash
git add .env.example DEPLOY-NOTES.md open.md src/services/deviceAbuseProtection.js src/tests/deviceAbuseProtection.test.js src/routes/esplink.js src/tests/otaCheckRoute.test.js src/ws/deviceWsManager.js src/tests/deviceWsRateLimit.test.js docs/superpowers/plans/2026-06-15-abuse-protection.md
git commit -m "feat: add device abuse protection limits"
```
