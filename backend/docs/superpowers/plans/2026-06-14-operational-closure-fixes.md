# Operational Closure Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the backend's admin-auth, device-unbind, usage-accounting, quota, alerting, rate-limit, and stats-field gaps.

**Architecture:** Keep the existing Express/Prisma service layout. Add focused tests first, then make minimal changes in the current middleware, service, job, WebSocket, and frontend page files. Usage accounting remains API-Key scoped and is triggered from WebSocket AI chat after each LLM attempt.

**Tech Stack:** Node.js, Express 4, Jest, Prisma, Redis/ioredis, ws, React/Vite/Ant Design.

---

## File Structure

- Modify `src/routes/auth.js`: add `type: "admin"` to admin JWT payload.
- Modify `src/middleware/adminAuth.js`: require admin token type and role.
- Create `src/tests/adminAuth.test.js`: verify admin tokens pass and WeChat tokens fail.
- Modify `src/services/usageService.js`: return `online_count` and preserve `online_devices`.
- Create `src/tests/usageSummary.test.js`: verify both stats field names.
- Modify `src/services/deviceService.js`: clear `wechat_user_id` on admin unbind.
- Extend `src/tests/deviceRegistration.test.js`: cover unbind behavior.
- Modify `src/jobs/usageAggregator.js`: exclude null `api_key_id`.
- Create `src/tests/usageAggregator.test.js`: verify null-key logs do not reach API Key lookup/upsert.
- Modify `src/services/llmService.js`: centralize usage log, key usage increment, and tenant alert after streaming.
- Create `src/tests/llmServiceUsage.test.js`: verify usage accounting after successful stream.
- Modify `src/ws/deviceWsManager.js`: rate-limit `ai_chat` before LLM call.
- Create `src/tests/deviceWsRateLimit.test.js`: verify rate-limited AI chat returns `ai_error`.
- Modify `admin-frontend/src/pages/Usage/index.jsx`: safely render nullable `api_key_id`.

## Task 1: Admin Token Boundary

**Files:**
- Create: `src/tests/adminAuth.test.js`
- Modify: `src/routes/auth.js`
- Modify: `src/middleware/adminAuth.js`

- [ ] **Step 1: Write the failing tests**

Create `src/tests/adminAuth.test.js`:

```js
const jwt = require('jsonwebtoken');

describe('adminAuth', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV, JWT_SECRET: 'test-secret' };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  function runMiddleware(token) {
    const adminAuth = require('../middleware/adminAuth');
    const req = {
      headers: {
        authorization: token ? `Bearer ${token}` : undefined,
      },
    };
    const res = {
      statusCode: 200,
      body: null,
      status: jest.fn(function status(code) {
        this.statusCode = code;
        return this;
      }),
      json: jest.fn(function json(body) {
        this.body = body;
        return this;
      }),
    };
    const next = jest.fn();

    adminAuth(req, res, next);
    return { req, res, next };
  }

  test('accepts admin tokens with admin type and role', () => {
    const token = jwt.sign(
      { username: 'admin', type: 'admin', role: 'admin' },
      'test-secret'
    );

    const { req, res, next } = runMiddleware(token);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.admin.username).toBe('admin');
    expect(res.status).not.toHaveBeenCalled();
  });

  test('rejects WeChat tokens signed with the same secret', () => {
    const token = jwt.sign(
      { type: 'wechat', userId: 1, openid: 'dev_user' },
      'test-secret'
    );

    const { res, next } = runMiddleware(token);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      code: 40101,
      message: '登录令牌无效',
    });
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
npm test -- src/tests/adminAuth.test.js
```

Expected before implementation: WeChat-token test fails because `next` is called.

- [ ] **Step 3: Implement the minimal auth change**

In `src/routes/auth.js`, change the login token payload:

```js
const token = jwt.sign(
  { username, type: 'admin', role: 'admin' },
  process.env.JWT_SECRET || 'xiaozhi-secret',
  { expiresIn: '7d' }
);
```

In `src/middleware/adminAuth.js`, replace the verification block with:

```js
try {
  const payload = jwt.verify(token, process.env.JWT_SECRET || 'xiaozhi-secret');
  if (payload.type !== 'admin' || payload.role !== 'admin') {
    throw new Error('invalid admin token');
  }
  req.admin = payload;
  next();
} catch {
  res.status(401).json({ code: 40101, message: '登录令牌无效' });
}
```

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- src/tests/adminAuth.test.js
```

Expected: both tests pass.

## Task 2: Summary Field Compatibility

**Files:**
- Create: `src/tests/usageSummary.test.js`
- Modify: `src/services/usageService.js`

- [ ] **Step 1: Write the failing test**

Create `src/tests/usageSummary.test.js`:

```js
jest.mock('../config/database', () => ({
  usageLog: {
    count: jest.fn(),
  },
  device: {
    count: jest.fn(),
  },
  tenant: {
    count: jest.fn(),
  },
}));

const prisma = require('../config/database');
const { getSummary } = require('../services/usageService');

describe('getSummary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.usageLog.count
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(9)
      .mockResolvedValueOnce(20);
    prisma.device.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(5);
    prisma.tenant.count.mockResolvedValue(4);
  });

  test('returns both online_count and online_devices for compatibility', async () => {
    const summary = await getSummary();

    expect(summary.online_count).toBe(2);
    expect(summary.online_devices).toBe(2);
    expect(summary.total_devices).toBe(5);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- src/tests/usageSummary.test.js
```

Expected before implementation: `online_count` is undefined.

- [ ] **Step 3: Implement the field alias**

In `src/services/usageService.js`, return both field names:

```js
return {
  today_calls: todayCount,
  month_calls: monthCount,
  total_calls: totalCount,
  online_count: onlineDevices,
  online_devices: onlineDevices,
  total_devices: totalDevices,
  tenant_count: tenantCount,
};
```

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- src/tests/usageSummary.test.js
```

Expected: test passes.

## Task 3: Admin Unbind Clears WeChat Ownership

**Files:**
- Modify: `src/tests/deviceRegistration.test.js`
- Modify: `src/services/deviceService.js`

- [ ] **Step 1: Write the failing test**

Extend the database mock in `src/tests/deviceRegistration.test.js` so it includes `update`:

```js
jest.mock('../config/database', () => ({
  device: {
    upsert: jest.fn(),
    update: jest.fn(),
  },
}));
```

Import `unbindDevice`:

```js
const { registerDevice, unbindDevice } = require('../services/deviceService');
```

Add:

```js
test('admin unbind clears API Key, tenant, pairing, and WeChat owner', async () => {
  prisma.device.update.mockResolvedValue({
    mac_address: 'AA:BB:CC:DD:EE:FF',
    api_key_id: null,
    tenant_id: null,
    wechat_user_id: null,
    is_paired: false,
  });

  await unbindDevice('AA:BB:CC:DD:EE:FF');

  expect(prisma.device.update).toHaveBeenCalledWith({
    where: { mac_address: 'AA:BB:CC:DD:EE:FF' },
    data: {
      api_key_id: null,
      tenant_id: null,
      wechat_user_id: null,
      is_paired: false,
      paired_at: null,
    },
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- src/tests/deviceRegistration.test.js
```

Expected before implementation: expectation fails because `wechat_user_id` is not included.

- [ ] **Step 3: Implement the unbind change**

In `src/services/deviceService.js`, update `unbindDevice`:

```js
async function unbindDevice(mac) {
  return prisma.device.update({
    where: { mac_address: mac },
    data: {
      api_key_id: null,
      tenant_id: null,
      wechat_user_id: null,
      is_paired: false,
      paired_at: null,
    },
  });
}
```

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- src/tests/deviceRegistration.test.js
```

Expected: tests pass.

## Task 4: Nullable Usage Aggregation

**Files:**
- Create: `src/tests/usageAggregator.test.js`
- Modify: `src/jobs/usageAggregator.js`

- [ ] **Step 1: Write the failing test**

Create `src/tests/usageAggregator.test.js`:

```js
jest.mock('node-cron', () => ({
  schedule: jest.fn(),
}));

jest.mock('../config/database', () => ({
  usageLog: {
    groupBy: jest.fn(),
  },
  apiKey: {
    findMany: jest.fn(),
  },
  usageHourly: {
    upsert: jest.fn(),
  },
}));

const prisma = require('../config/database');
const { aggregateHour } = require('../jobs/usageAggregator');

describe('aggregateHour', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('excludes usage logs with null api_key_id from key lookup and hourly upsert', async () => {
    prisma.usageLog.groupBy
      .mockResolvedValueOnce([
        {
          api_key_id: null,
          _count: { id: 2 },
          _sum: { input_tokens: 10, output_tokens: 4 },
        },
        {
          api_key_id: 'sk-real',
          _count: { id: 1 },
          _sum: { input_tokens: 3, output_tokens: 7 },
        },
      ])
      .mockResolvedValueOnce([
        { api_key_id: 'sk-real', success: true, _count: { id: 1 } },
      ]);
    prisma.apiKey.findMany.mockResolvedValue([
      { id: 'sk-real', tenant_id: 123 },
    ]);

    await aggregateHour(new Date('2026-06-14T08:00:00.000Z'));

    expect(prisma.usageLog.groupBy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          api_key_id: { not: null },
        }),
      })
    );
    expect(prisma.apiKey.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['sk-real'] } },
      select: { id: true, tenant_id: true },
    });
    expect(prisma.usageHourly.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.usageHourly.upsert.mock.calls[0][0].create.api_key_id).toBe('sk-real');
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- src/tests/usageAggregator.test.js
```

Expected before implementation: first `groupBy` call does not include `api_key_id: { not: null }`.

- [ ] **Step 3: Implement nullable filtering**

In `src/jobs/usageAggregator.js`, update both `groupBy` `where` blocks:

```js
where: {
  timestamp: { gte: hourStart, lt: hourEnd },
  api_key_id: { not: null },
},
```

Then build key IDs with:

```js
const keyIds = groups.map((g) => g.api_key_id).filter(Boolean);
if (!keyIds.length) return;
```

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- src/tests/usageAggregator.test.js
```

Expected: test passes.

## Task 5: Usage Accounting After WebSocket AI Chat

**Files:**
- Create: `src/tests/llmServiceUsage.test.js`
- Modify: `src/services/llmService.js`

- [ ] **Step 1: Write the failing test**

Create `src/tests/llmServiceUsage.test.js`:

```js
jest.mock('openai', () => ({
  OpenAI: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(async function* create() {
          yield {
            choices: [{ delta: { content: 'hello' } }],
            usage: { prompt_tokens: 2, completion_tokens: 3 },
          };
        }),
      },
    },
  })),
}));

jest.mock('../config/database', () => ({
  llmProvider: {
    findFirst: jest.fn(),
  },
  usageLog: {
    create: jest.fn(),
  },
  apiKey: {
    update: jest.fn(),
    findUnique: jest.fn(),
  },
}));

jest.mock('../config/redis', () => ({
  del: jest.fn(() => Promise.resolve()),
}));

jest.mock('../services/alertService', () => ({
  checkAndAlert: jest.fn(() => Promise.resolve()),
}));

const prisma = require('../config/database');
const redis = require('../config/redis');
const { checkAndAlert } = require('../services/alertService');
const { streamChat } = require('../services/llmService');

describe('streamChat usage accounting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.llmProvider.findFirst.mockResolvedValue({
      provider: 'deepseek',
      api_key: 'provider-key',
      is_active: true,
    });
    prisma.usageLog.create.mockResolvedValue({});
    prisma.apiKey.update.mockResolvedValue({});
    prisma.apiKey.findUnique.mockResolvedValue({
      id: 'sk-test',
      used_today: 20,
      tenant: {
        id: 7,
        name: 'Tenant',
        daily_limit: 100,
        alert_threshold: 0.8,
        usage_alert_webhook: 'https://example.com/hook',
      },
    });
  });

  test('logs usage, increments API Key counters, invalidates cache, and checks alerts', async () => {
    const chunks = [];
    const done = jest.fn();

    await streamChat({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'deepseek-chat',
      mac: 'AA:BB:CC:DD:EE:FF',
      apiKeyId: 'sk-test',
      onChunk: (delta) => chunks.push(delta),
      onDone: done,
      onError: jest.fn(),
    });

    expect(chunks).toEqual(['hello']);
    expect(done).toHaveBeenCalledWith({ inputTokens: 2, outputTokens: 3 });
    expect(prisma.usageLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        api_key_id: 'sk-test',
        device_mac: 'AA:BB:CC:DD:EE:FF',
        model: 'deepseek-chat',
        input_tokens: 2,
        output_tokens: 3,
        success: true,
      }),
    });
    expect(prisma.apiKey.update).toHaveBeenCalledWith({
      where: { id: 'sk-test' },
      data: {
        used_today: { increment: 5 },
        used_month: { increment: 5 },
      },
    });
    expect(redis.del).toHaveBeenCalledWith('apikey:sk-test');
    expect(checkAndAlert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
      25
    );
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- src/tests/llmServiceUsage.test.js
```

Expected before implementation: `apiKey.update`, `redis.del`, or `checkAndAlert` expectations fail.

- [ ] **Step 3: Implement accounting helper**

In `src/services/llmService.js`, import Redis and alert service:

```js
const redis = require('../config/redis');
const { checkAndAlert } = require('./alertService');
```

Add helper:

```js
async function accountUsage({ apiKeyId, mac, model, inputTokens, outputTokens, latencyMs, success, errorMsg }) {
  if (!apiKeyId) return;

  await prisma.usageLog.create({
    data: {
      api_key_id: apiKeyId,
      device_mac: mac || null,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      latency_ms: latencyMs,
      success,
      error_msg: errorMsg,
    },
  });

  const tokenTotal = inputTokens + outputTokens;
  await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: {
      used_today: { increment: tokenTotal },
      used_month: { increment: tokenTotal },
    },
  });
  await redis.del(`apikey:${apiKeyId}`).catch(() => {});

  const key = await prisma.apiKey.findUnique({
    where: { id: apiKeyId },
    select: {
      used_today: true,
      tenant: {
        select: {
          id: true,
          name: true,
          daily_limit: true,
          alert_threshold: true,
          usage_alert_webhook: true,
        },
      },
    },
  });
  if (key?.tenant) {
    await checkAndAlert(key.tenant, key.used_today).catch(() => {});
  }
}
```

Replace the `finally` block usage-log creation with:

```js
await accountUsage({
  apiKeyId,
  mac,
  model,
  inputTokens,
  outputTokens,
  latencyMs: Date.now() - startTime,
  success,
  errorMsg,
}).catch(() => {});
```

Export the helper for focused tests only if needed:

```js
module.exports = { streamChat, getModelForDevice, DEFAULT_MODEL, accountUsage };
```

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- src/tests/llmServiceUsage.test.js
```

Expected: test passes.

## Task 6: WebSocket AI Rate Limit

**Files:**
- Create: `src/tests/deviceWsRateLimit.test.js`
- Modify: `src/ws/deviceWsManager.js`

- [ ] **Step 1: Write the failing test**

Create `src/tests/deviceWsRateLimit.test.js`:

```js
jest.mock('../config/redis', () => ({
  eval: jest.fn(),
}));

jest.mock('../config/database', () => ({
  device: {
    findFirst: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
  },
}));

jest.mock('../utils/dbTime', () => ({
  touchDevice: jest.fn(() => Promise.resolve()),
}));

jest.mock('../services/llmService', () => ({
  getModelForDevice: jest.fn(),
  streamChat: jest.fn(),
}));

const redis = require('../config/redis');

describe('device WS AI rate limit helper', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('returns false when Redis token bucket denies the device', async () => {
    redis.eval.mockResolvedValue(0);
    const { checkAiRateLimit } = require('../ws/deviceWsManager');

    const allowed = await checkAiRateLimit('AA:BB:CC:DD:EE:FF');

    expect(allowed).toBe(false);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'ratelimit:device-ai:AA:BB:CC:DD:EE:FF',
      20,
      60
    );
  });

  test('fails open when Redis is unavailable', async () => {
    redis.eval.mockRejectedValue(new Error('redis down'));
    const { checkAiRateLimit } = require('../ws/deviceWsManager');

    await expect(checkAiRateLimit('AA:BB:CC:DD:EE:FF')).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- src/tests/deviceWsRateLimit.test.js
```

Expected before implementation: `checkAiRateLimit` is not exported.

- [ ] **Step 3: Implement helper and use it**

In `src/ws/deviceWsManager.js`, import Redis and define constants near the top:

```js
const redis = require('../config/redis');

const AI_RATE_LIMIT = 20;
const AI_RATE_WINDOW_SECONDS = 60;
const RATE_LIMIT_SCRIPT = `
  local key = KEYS[1]
  local limit = tonumber(ARGV[1])
  local window = tonumber(ARGV[2])
  local current = tonumber(redis.call('GET', key) or 0)
  if current >= limit then return 0 end
  redis.call('INCR', key)
  if current == 0 then redis.call('EXPIRE', key, window) end
  return 1
`;
```

Add:

```js
async function checkAiRateLimit(mac) {
  try {
    const result = await redis.eval(
      RATE_LIMIT_SCRIPT,
      1,
      `ratelimit:device-ai:${mac}`,
      AI_RATE_LIMIT,
      AI_RATE_WINDOW_SECONDS
    );
    return result !== 0;
  } catch {
    return true;
  }
}
```

In the `ai_chat` branch, before `getModelForDevice`:

```js
const allowed = await checkAiRateLimit(mac);
if (!allowed) {
  ws.send(JSON.stringify({ type: 'ai_error', session_id, error: '请求过于频繁，请稍后再试' }));
  return;
}
```

Export:

```js
module.exports = { setup, sendCommand, isConnected, checkAiRateLimit };
```

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- src/tests/deviceWsRateLimit.test.js
```

Expected: tests pass.

## Task 7: Frontend Nullable API Key Safety

**Files:**
- Modify: `admin-frontend/src/pages/Usage/index.jsx`

- [ ] **Step 1: Implement minimal frontend guard**

Change the API Key column render:

```jsx
{
  title: 'API Key',
  dataIndex: 'api_key_id',
  ellipsis: true,
  width: 180,
  render: (v, r) => r.api_key?.name || (v ? `${v.slice(0, 16)}…` : '—'),
},
```

Change CSV rows:

```js
l.api_key_id || '', l.device_mac || '', l.model || '',
```

- [ ] **Step 2: Verify frontend build**

Run:

```bash
cd admin-frontend && npm run build
```

Expected: build exits 0. Existing Vite chunk-size warning may remain.

## Task 8: Full Verification

**Files:**
- All modified files from prior tasks.

- [ ] **Step 1: Run backend tests**

Run:

```bash
npm test
```

Expected: all Jest suites pass.

- [ ] **Step 2: Run frontend build**

Run:

```bash
cd admin-frontend && npm run build
```

Expected: build exits 0. Chunk-size warning is acceptable unless new errors appear.

- [ ] **Step 3: Inspect Git diff**

Run:

```bash
git diff --stat
git status --short
```

Expected: only intended source/test/frontend changes plus the pre-existing lockfile drift are present.
