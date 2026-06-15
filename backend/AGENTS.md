# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

小氧AI (XiaoZhi AI) backend management system — a SaaS operations platform for ESP32 AI device fleets. This repo owns the **backend API** (`src/`, Express.js on port 8088) and the **admin frontend** (`admin-frontend/`, React + Ant Design on port 5173 dev / 8080 prod). ESP32 firmware and WeChat mini-program are owned by other teams.

The system extends the official `xiaozhi-esp32-server` database (MySQL + Redis) with custom tables — it does **not** run its own database server.

**EspLink 集成（2026-05-05 完成）**：已与团队的 EspLink BLE 配网系统打通。ESP32 固件通过 `/api/ota/check` 注册并获取 WebSocket 地址；微信小程序通过 `/api/auth/wechat`、`/api/device/*` 完成登录、设备发现和绑定；后端提供 `/ws/device` WebSocket 长连接供固件使用。EspLink 路由挂载在 `/api/`（无 v1 前缀），与管理路由 `/api/v1/` 并存。

**LLM 代理（2026-05-06 完成）**：后端现在是多厂商大模型代理。管理员在 `llm_providers` 表中配置各厂商 API Key，每个租户分配一个 `ai_model`（即套餐）。设备通过 WebSocket 发送 `ai_chat` 消息，后端流式调用对应厂商 API，逐 chunk 推回设备。支持 DeepSeek、GLM、MiniMax、Moonshot、通义千问、火山引擎、OpenAI，均通过 `openai` npm 包 + 自定义 `baseURL` 驱动。

**WebSocket 竞态修复（2026-05-06）**：`deviceWsManager.js` 的 `connection` 回调是 async 的，认证期间（`prisma.device.findFirst`）若固件已发来消息会被丢弃。修复方案：连接建立时立即注册临时缓冲监听器，认证完成后切换为正式处理器并重放缓冲消息。

**EspLink 固件编译与烧录（2026-05-06）**：固件源码位于 `C:\Users\19051\Desktop\ai_deploy\EspLink\esplink-firmware\`。ESP-IDF v5.5 已安装（`C:\Users\19051\esp\esp-idf`），目标芯片 ESP32-S3，设备串口 COM3。编译时需设 `NINJA_JOBS=1` 绕过 GCC 14.2.0 在 `esp_lcd_panel_rgb.c` 上的 internal compiler error（并行编译时触发）。

**嘉立创 ESP32-S3 显示屏移植（2026-05-06）**：EspLink 固件新增 `main/app_display.c`，为嘉立创开发板（lichuang-dev）适配 ST7789 LCD 驱动。核心实现：通过 I2C（SDA=GPIO1，SCL=GPIO2）初始化 PCA9557 IO 扩展芯片（addr=0x19）释放 LCD 硬件复位，再通过 SPI3（MOSI=GPIO40，SCLK=GPIO41，DC=GPIO39）初始化 ST7789 面板，GPIO42 低电平开启背光。`app_display_fill(color)` 根据设备状态更新屏幕颜色（`set_state()` 中调用）：白=启动，蓝=BLE 配网，黄=WiFi 连接中，橙=注册中，绿=在线，红=错误。**颜色字节序修复**：ESP32 小端序 + SPI DMA 按内存顺序发送字节，ST7789 期望大端序，导致颜色显示错误（如蓝变粉）。`esp_lcd_panel_io_spi_config_t` 在本 IDF 版本无 `swap_color_bytes` 字段，改用 `__builtin_bswap16(display_color ^ 0xFFFF)` 手动修正，已修复。出厂重置方法：长按 BOOT 键（GPIO0）5 秒；若来不及长按，用 `python -m esptool --port COM3 --chip esp32s3 erase_region 0x9000 0x6000` 只擦 NVS（分区表：nvs@0x9000 size=0x6000），之后需**物理拔插 USB** 让设备重启（esptool RTS 复位不可靠）。设备 MAC=E4:B0:63:92:7D:70，BLE 广播名=Device-927D70。

**固件 WiFi 断连状态机修复（2026-05-06，已移植到 Mac 版）**：`on_wifi_disconnected` 原来只处理两种情况（配网后等待 WiFi / 在线时断开），当设备用已存凭据连 WiFi 失败（`STATE_WIFI_CONNECTING`）时什么都不做，导致设备**永远卡住**。修复：5 次重试失败后，在 `else if (s_state == STATE_WIFI_CONNECTING)` 分支调用 `app_nvs_factory_reset()` 清除错误凭据，再调 `app_blufi_start()` 重新进入 BLE 配网模式。**重要**：配网时若小程序还开着且记住了旧密码，会在设备重新进入 BLE 后立即自动重新配网写入错误凭据——需先关闭小程序再擦 NVS。

**assign-key 接口修复（2026-05-10）**：`POST /api/v1/devices/:mac/assign-key` 原来只写 `api_key_id`，但 `getModelForDevice()` 通过 `tenant`（即 `tenant_id`）关联拿模型，导致从管理后台分配 Key 后设备 AI 对话仍报「未找到厂商配置」。修复：分配前先查 API Key 的 `tenant_id`，一并写入设备。

**Mac 本地开发环境（2026-05-10 完成）**：后端已在 Mac（`172.20.10.3`）本地跑通。MySQL 9.6 + Redis 8.6 通过 Homebrew 安装；ESP32 固件通过 Mac 上的 ESP-IDF v5.4.1 编译烧录；小程序真机调试时 `BASE_URL` 须为 Mac 局域网 IP（`http://172.20.10.3:8088`），不能用 `localhost`。`curl` 访问 localhost 会被 Clash 代理拦截报 502，属正常现象，加 `--noproxy localhost` 绕过。

**iOS 小程序 WiFi 扫描限制（2026-05-10）**：`wx.startWifi()` 在 iOS 上强制跳微信权限管理页，无法绕过。配网页面已改为纯手动输入，不做 WiFi 扫描。BLE 连接（`createBLEConnection`）在模拟器里不支持，必须用微信开发者工具的**真机调试**扫码在真实手机上测试。

## 硬件联调测试流程（Mac + ESP32）

> **当前配置**：后端、固件编译、小程序调试全部在 **Mac**（`172.20.10.3`）上进行。BLE 调试需用微信开发者工具**真机调试**功能扫码到真实手机，模拟器不支持 `createBLEConnection`。

### 前置条件

| 项目 | 说明 |
|---|---|
| 后端 IP | `172.20.10.3:8088`（Mac 的局域网 IP） |
| 小程序项目 | `/Users/hushaohong/vibe-coding/EspLink/esplink-app/`，`utils/api.js` 第 1 行 `BASE_URL = 'http://172.20.10.3:8088'` |
| 固件烧录 | `BOOT_REGISTER_URL = http://172.20.10.3:8088/api/ota/check`，串口 `/dev/cu.usbmodem212301` |
| 设备 MAC | `E4:B0:63:92:7D:70`，BLE 广播名 `Device-927D70` |

### 第一步：启动 Mac 后端

```bash
# 确认 MySQL 和 Redis 在运行（开机后需手动启动）
export PATH="/opt/homebrew/bin:$PATH"
brew services start mysql
brew services start redis

# 启动后端
cd /Users/hushaohong/vibe-coding/ai_deploy_backend
npm run dev

# 另开终端启动前端
cd admin-frontend && npm run dev
```

看到 `[Server] 小氧AI后台API 启动，端口 8088` 即为成功。`curl` 测试用 `--noproxy localhost` 绕过 Clash。

### 第二步：配置微信开发者工具

1. 导入项目：`/Users/hushaohong/vibe-coding/EspLink/esplink-app/`，AppID = `wxa4fae319f609fdce`
2. **「···」→「项目设置」→「本地设置」** 勾选「不校验合法域名」
3. **设置 → 代理 → 不使用代理**
4. BLE 真机测试：点顶部**「真机调试」**，用真实手机微信扫码（模拟器不支持 BLE 连接）

### 第三步：硬件配网测试

**步骤**：

1. ESP32 上电（屏幕黑，无显示驱动；串口日志显示 BLE 广播已启动）
2. 手机微信扫真机调试二维码打开小程序
3. 点「+」→ 找到 `Device-927D70` → 连接
4. 手动输入 WiFi 名称和密码（iOS 不支持 WiFi 扫描，只能手动输入）
5. 点「开始配网」
6. 小程序轮询 `GET /api/device/lookup?mac_suffix=927D70`，发现设备后弹出绑定确认
7. 确认绑定 → 管理后台 http://localhost:5173 → 设备管理 → 能看到设备在线 ✅

### 常见问题

| 现象 | 原因 | 解决 |
|---|---|---|
| 小程序登录报 ERR_CONNECTION_REFUSED | `BASE_URL` 用了 `localhost`，真机无法访问 | 改为 `http://172.20.10.3:8088` |
| BLE 连接失败（模拟器） | 模拟器不支持 `createBLEConnection` | 用「真机调试」扫码到真实手机 |
| WiFi 扫描跳权限页 | iOS `wx.startWifi()` 强制触发位置权限 | 已移除 WiFi 扫描，手动输入 |
| 设备搜索不到（之前配过网） | NVS 有旧 WiFi 凭证，设备在重连而非 BLE 广播 | Mac 擦 NVS：见下方命令；等 5 次重试后设备自动回 BLE |
| 配网成功但后台看不到设备 | `WS_BASE_URL` 配置错误 | 检查 `.env` 中 `WS_BASE_URL=ws://172.20.10.3:8088` |
| curl 访问 localhost 502 | Clash 代理拦截 | 加 `--noproxy localhost` 参数 |

**Mac NVS 出厂重置**（清除旧 WiFi 凭证）：

```bash
~/.espressif/python_env/idf5.4_py3.12_env/bin/python -m esptool \
  --port /dev/cu.usbmodem212301 --chip esp32s3 \
  erase_region 0x9000 0x6000
# 之后物理拔插 USB 让设备重启（RTS 复位不可靠）
```

---

## 当前环境状态（2026-05-10）✅ 全部完成

> **Mac 本地环境已全部配置完成，前后端均已验证可运行，固件已编译烧录。**

| 服务 | 状态 | 说明 |
|---|---|---|
| MySQL 9.6.0 | ✅ 已安装 | Homebrew，port 3306，root/<db-password> |
| Redis 8.6.3 | ✅ 已安装 | Homebrew，port 6379，无密码 |
| 数据库表 | ✅ 完成 | `npm run db:push` 已建 8 张扩展表 |
| 后端 API | ✅ 可运行 | `npm run dev`，port 8088 |
| 管理前端 | ✅ 可运行 | `npm run dev`，port 5173 |
| ESP-IDF | ✅ 已安装 | v5.4.1，路径 `~/esp/esp-idf`，Python venv `~/.espressif/python_env/idf5.4_py3.12_env` |
| 固件 | ✅ 已烧录 | BOOT_REGISTER_URL → `http://172.20.10.3:8088`，串口 `/dev/cu.usbmodem212301` |

**管理后台登录：** http://localhost:5173 — 用户名 `admin` / 密码 `xiaozhi123`

> **注意：** Clash 代理（port 7897）不影响浏览器访问，但会导致 curl 出现 502。用 `curl --noproxy localhost` 绕过。

## EspLink 固件开发（ESP32-S3）

固件项目：`/Users/hushaohong/vibe-coding/EspLink/esplink-firmware/`

关键配置文件：`main/main.c` 第 27 行 `BOOT_REGISTER_URL`（后端注册地址）。

### Mac 编译烧录（当前环境）

ESP-IDF v5.4.1，需在单条 bash 命令里 source + 运行（环境变量不跨 shell 持久）：

```bash
export IDFY="$HOME/.espressif/python_env/idf5.4_py3.12_env/bin/python $HOME/esp/esp-idf/tools/idf.py"

cd /Users/hushaohong/vibe-coding/EspLink/esplink-firmware
bash -c '
  export PATH="/opt/homebrew/bin:$PATH"
  export IDF_PYTHON_ENV_PATH=$HOME/.espressif/python_env/idf5.4_py3.12_env
  . $HOME/esp/esp-idf/export.sh > /dev/null 2>&1
  $HOME/.espressif/python_env/idf5.4_py3.12_env/bin/python \
    $HOME/esp/esp-idf/tools/idf.py -p /dev/cu.usbmodem212301 build flash
'
```

**串口监视** （idf.py monitor 需要 TTY，用 Python 替代）：

```python
# /tmp/read_serial.py
import serial, sys, time
port = serial.Serial('/dev/cu.usbmodem212301', 115200, timeout=0.1)
port.setDTR(False); port.setRTS(True); time.sleep(0.1); port.setRTS(False)
start = time.time()
while time.time() - start < 30:
    d = port.read(256)
    if d: sys.stdout.buffer.write(d); sys.stdout.flush()
port.close()
```

```bash
~/.espressif/python_env/idf5.4_py3.12_env/bin/python /tmp/read_serial.py
```

### API 兼容性注意（v5.4.1 vs v5.5）

`esp_blufi_adv_start_with_name()` 在 v5.4.1 不存在，已替换为：

```c
ble_svc_gap_device_name_set(app_device_get_ble_name());
esp_blufi_adv_start();
```
```

> **NINJA_JOBS=1 是必须的**：GCC 14.2.0 在并行编译 `esp_lcd_panel_rgb.c` 时触发 internal compiler error（Segmentation fault），单线程可绕过。

当前烧录的固件配置（局域网调试）：
```
BOOT_REGISTER_URL = http://172.20.10.5:8088/api/ota/check
transport_type    = HTTP_TRANSPORT_OVER_TCP
```

## EspLink 小程序配置

小程序项目：`C:\Users\19051\Desktop\ai_deploy\EspLink\esplink-app\`

API 地址配置：`utils/api.js` 第 1 行 `BASE_URL`。

| 环境 | BASE_URL |
|---|---|
| 局域网调试 | `http://172.20.10.5:8088` |
| 生产 | `https://your-domain.com` |

微信开发者工具调试时须勾选「详情 → 本地设置 → 不校验合法域名」。

---

## 下次开机重启服务

MySQL 和 Redis 不是系统服务，重启电脑后需手动重启：

```powershell
# 刷新 PATH（每次新开终端都需要）
$env:PATH = "$env:USERPROFILE\scoop\shims;$env:PATH"

# 启动 Redis（后台）
Start-Process -FilePath "redis-server" -WindowStyle Hidden

# 启动 MySQL（后台）
Start-Process -FilePath "mysqld" -ArgumentList "--standalone" -WindowStyle Hidden

# 等几秒，然后启动后端
cd C:\Users\19051\Desktop\ai_deploy\backend
npm run dev

# 另开终端启动前端
cd C:\Users\19051\Desktop\ai_deploy\backend\admin-frontend
npm run dev
```

## 当前 .env 配置
```
DATABASE_URL="mysql://root:<db-password>@localhost:3306/xiaozhi"
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
DEFAULT_AI_MODEL=deepseek-chat
```

---

## Critical Constraints

- **Express must stay at `^4.22.1`** — never upgrade to Express 5. Breaking changes burned us in `account-manager`. Already pinned in `package.json`.
- Management API routes use the `/api/v1/` prefix. **EspLink-compatible routes use `/api/` (no v1)** — this is intentional for firmware/mini-program compatibility.
- Rate limiting **must** use Redis — multi-process deploys share no in-memory state.
- **Prisma `groupBy` does not support relation filters in `where`** — always resolve related IDs first (e.g. fetch `api_key_id` list for a tenant), then filter with `{ api_key_id: { in: [...] } }`. Affected functions: `getStatsByModel`, `getDailyStats` fallback.
- **WebSocket requires `http.createServer`** — `app.listen()` was replaced with `http.createServer(app)` + `wsManager.setup(server)`. Do not revert to `app.listen()` or WebSocket will break.
- **Device MAC in URLs** — EspLink routes encode MAC as `AA-BB-CC-DD-EE-FF` (dashes, not colons) to avoid Express route-param conflicts. Always `replace(/-/g, ':')` when querying the DB.
- **LLM provider registry is static** — `src/config/llmProviders.js` is the source of truth for supported providers and models. Adding a new vendor requires editing this file; the DB only stores the API key, not the baseURL.
- **`usage_logs.api_key_id` is nullable** — AI chat via WebSocket doesn't go through keyValidator, so devices may have no api_key_id. Usage logging is skipped when api_key_id is null.
- **Stopping backend required before `db:push`** — Prisma regenerates the DLL client which is locked by the running process. Always stop `npm run dev` before running `npx prisma db push`.

## Development Commands

```bash
# Backend (run in repo root)
npm run dev          # nodemon, port 8088
npm start            # node, production
npm test             # jest --runInBand
npm run db:push      # sync schema to DB (no migration history) — stop backend first
npm run db:migrate   # prisma migrate dev
npm run db:studio    # Prisma Studio GUI

# Frontend (run in admin-frontend/)
npm run dev          # vite dev server, port 5173
npm run build        # output → admin-frontend/dist/
npm run preview      # preview built output
```

## Actual Project Structure

```
backend/
├── src/
│   ├── app.js                   # Express entry; http.createServer + WS setup; mounts /api/v1 and /api routers
│   ├── config/
│   │   ├── database.js          # Singleton PrismaClient (global.__prisma in dev)
│   │   ├── redis.js             # ioredis client, lazyConnect, graceful error handling
│   │   └── llmProviders.js      # Static registry: provider → baseURL + model list; MODEL_TO_PROVIDER index
│   ├── middleware/
│   │   ├── requestId.js         # Injects req.requestId; overrides res.json with spread to add requestId
│   │   ├── adminAuth.js         # JWT Bearer token verification for management routes
│   │   ├── wechatAuth.js        # JWT Bearer token verification for EspLink mini-program routes
│   │   ├── keyValidator.js      # API Key check with Redis TTL=60s cache
│   │   ├── rateLimiter.js       # Redis Lua token-bucket factory → returns middleware
│   │   └── errorHandler.js      # Maps Prisma P2025→404, P2002→409; hides stack in prod
│   ├── routes/
│   │   ├── index.js             # Mounts all sub-routers under /api/v1
│   │   ├── auth.js              # POST /auth/login, GET /auth/me (no adminAuth)
│   │   ├── health.js            # GET /health, GET /health/ready (DB + Redis ping)
│   │   ├── tenants.js           # CRUD; all behind adminAuth; includes ai_model field
│   │   ├── keys.js              # CRUD + reset-usage; all behind adminAuth
│   │   ├── devices.js           # POST /register (public); rest behind adminAuth
│   │   ├── usage.js             # summary/daily/by-key/by-model/logs; behind adminAuth
│   │   ├── operation.js         # overview/top-tenants/active-devices; behind adminAuth
│   │   ├── llm.js               # GET /models; GET/PUT /providers/:p; PATCH /providers/:p/toggle
│   │   └── esplink.js           # EspLink 兼容路由（/api/ 前缀）：ota/check, auth/wechat, device/*
│   ├── services/
│   │   ├── keyService.js        # Key CRUD; invalidates Redis cache on write
│   │   ├── deviceService.js     # Device CRUD and management registration
│   │   ├── usageService.js      # Stats queries; groupBy uses direct field filters only
│   │   ├── alertService.js      # Webhook POST when tenant usage ≥ alert_threshold
│   │   ├── operationService.js  # Overview + top-tenant + active-device aggregations
│   │   ├── wechatService.js     # WeChat code2session, bootRegister, lookupDevice, bindDevice
│   │   └── llmService.js        # streamChat() — OpenAI-SDK proxy with streaming; getModelForDevice()
│   ├── ws/
│   │   └── deviceWsManager.js   # WebSocket server on /ws/device; handles hello/ping/ai_chat/command
│   ├── jobs/
│   │   ├── heartbeatChecker.js  # Cron every minute; marks is_online=false after 2 min silence
│   │   ├── usageAggregator.js   # Cron 5 * * * *; rolls usage_logs → usage_hourly
│   │   └── cleanupOldUsageLogs.js # Cron 0 2 * * *; deletes logs older than 7 days
│   └── utils/
│       ├── uuid.js              # generateApiKey / generateUUID / generateRequestId
│       └── response.js          # success(data) / paginated(list,page,pageSize,total) / error(code,msg)
├── test_ws.js                   # WebSocket smoke test: node test_ws.js <device_key> [ping|hello|ai]
├── prisma/schema.prisma         # 7 models: Tenant ApiKey Device UsageLog UsageHourly WechatUser LlmProvider
├── admin-frontend/
│   ├── vite.config.js           # Proxies /api → http://localhost:8088
│   └── src/
│       ├── api/index.js         # Axios instance; auto-injects Bearer token; redirects on 401
│       ├── store/index.js       # Zustand persist: { token, username }
│       ├── components/Layout/   # Ant Design Sider + Header with user dropdown
│       └── pages/
│           ├── Login/           # POST /auth/login → stores token
│           ├── Dashboard/       # Summary cards + 7-day line chart + model pie + top-5 tenants
│           ├── Tenants/         # CRUD table; modal includes ai_model selector (grouped by provider)
│           ├── ApiKeys/         # CRUD table; toggle is_active via Switch; copy key button
│           ├── Devices/         # Table with online badge; 30s auto-refresh toggle; assign-key modal
│           ├── Usage/           # Stats cards + line chart + pie + paginated log table + CSV export
│           └── LlmConfig/       # Provider table; configure API Key modal; enable/disable toggle
└── .env.example
```

## API Response Format

`requestId` is injected automatically by `requestId.js` middleware into every `res.json()` call — routes do not need to add it manually.

```json
{ "code": 0, "data": { ... }, "message": "success", "requestId": "req_abc123" }
{ "code": 40001, "message": "API Key已禁用", "requestId": "req_abc123" }
{ "code": 0, "data": { "list": [...], "pagination": { "page": 1, "pageSize": 20, "total": 100 } }, "message": "success" }
```

## Device Association Flow

```
1. Mini-program provisions WiFi over EspLink BLE
2. Device calls POST /api/ota/check and receives device_key + websocket_url
3. Device connects to /ws/device and becomes discoverable
4. Mini-program calls GET /api/device/lookup?mac_suffix=AABBCC
5. User confirms → mini-program calls POST /api/device/bind
   → sets wechat_user_id, is_paired, and paired_at
```

## EspLink 集成接口

EspLink 路由挂载在 `/api/`（无 v1 前缀），与管理路由并存。

| 方法 | 路径 | 认证 | 调用方 | 说明 |
|---|---|---|---|---|
| POST | `/api/auth/wechat` | 无 | 小程序 | 微信 code 换 JWT |
| POST | `/api/ota/check` | 无 | 固件 | 设备启动注册，返回 `token` + `websocket_url` |
| GET | `/api/device/list` | wechatAuth | 小程序 | 用户已绑定设备列表 |
| GET | `/api/device/lookup?mac_suffix=AABBCC` | wechatAuth | 小程序 | 按 MAC 后三字节查找刚上线设备 |
| POST | `/api/device/bind` | wechatAuth | 小程序 | 绑定设备到当前微信用户 |
| POST | `/api/device/:mac/command` | wechatAuth | 小程序 | 通过 WebSocket 下发指令（`:mac` 用 `-` 代替 `:`） |
| WS | `/ws/device` | device_key | 固件 | 设备长连接，支持 hello/ping/ai_chat/command |

## LLM 代理接口

管理接口挂载在 `/api/v1/llm/`，均需 adminAuth。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/llm/models` | 所有支持模型列表（含厂商分组） |
| GET | `/api/v1/llm/providers` | 所有厂商配置状态（API Key 脱敏） |
| PUT | `/api/v1/llm/providers/:provider` | 新增或覆盖厂商 API Key |
| PATCH | `/api/v1/llm/providers/:provider/toggle` | 启用 / 禁用厂商 |

## WebSocket 消息格式（完整）

```
固件 → 服务器: { type: "hello", capabilities, firmware_version, session_id }
服务器 → 固件: { type: "hello_ack", is_bound: bool }

固件 → 服务器: { type: "ping" }
服务器 → 固件: { type: "pong" }

固件 → 服务器: { type: "ai_chat", session_id: "abc", messages: [{role, content}, ...] }
服务器 → 固件: { type: "ai_chunk", session_id: "abc", delta: "你好" }   ← 流式，多条
服务器 → 固件: { type: "ai_done",  session_id: "abc", usage: { input_tokens, output_tokens } }
服务器 → 固件: { type: "ai_error", session_id: "abc", error: "..." }

服务器 → 固件: { type: "command", payload: {...} }
```

**device_key 生命周期**：首次 `POST /api/ota/check` 时生成 64 位随机 hex，存入 `devices.device_key`，后续同一 MAC 复用同一 key。固件将其存入 NVS，WebSocket 连接时放入 `Authorization: Bearer` 头。

## LLM 支持厂商

| 厂商 | provider key | baseURL | 示例模型 |
|---|---|---|---|
| DeepSeek | `deepseek` | api.deepseek.com | deepseek-chat, deepseek-reasoner |
| 智谱 GLM | `glm` | open.bigmodel.cn/api/paas/v4/ | glm-4-flash, glm-4-plus |
| MiniMax | `minimax` | api.minimax.chat/v1 | MiniMax-Text-01 |
| Moonshot/Kimi | `moonshot` | api.moonshot.cn/v1 | moonshot-v1-8k |
| 通义千问 | `qwen` | dashscope.aliyuncs.com/compatible-mode/v1 | qwen-turbo, qwen-max |
| 火山引擎 | `volcano` | ark.cn-beijing.volces.com/api/v3 | doubao-pro-4k |
| OpenAI | `openai` | api.openai.com/v1 | gpt-4o-mini, gpt-4o |

所有厂商均通过 `openai` npm 包驱动（OpenAI 兼容接口），无需额外 SDK。新增厂商只需在 `src/config/llmProviders.js` 中添加条目。

## Key Architectural Decisions

| Decision | Choice | Reason |
|---|---|---|
| Express version | Lock `^4.22.1` | Prior incident with Express 5 breaking changes |
| HTTP server | `http.createServer(app)` | Required for WebSocket (`ws` lib) to attach to same port |
| Stats queries | `usage_hourly` first, fallback to `usage_logs` | Aggregation table empty on fresh deploy; fallback prevents blank charts |
| `groupBy` tenant filter | Pre-fetch key IDs, use `api_key_id: { in }` | Prisma `groupBy` rejects relation filters at runtime |
| Rate limiting | Redis Lua token-bucket | Shared state across processes |
| Key cache | Redis TTL=60s | Reduces DB I/O; invalidated on every write |
| Device signature | HMAC-SHA256 `device_id:mac`, optional | MAC is spoofable; signature optional so unpatched firmware still works |
| Alert delivery | Webhook POST to per-tenant URL | Decoupled from notification channel |
| `requestId` injection | Middleware overrides `res.json` with spread | Routes stay clean; no manual threading of requestId |
| WeChat JWT | Same `JWT_SECRET`, `type: 'wechat'` claim | Reuse secret; `wechatAuth` middleware rejects `type: 'admin'` tokens |
| MAC in URL | Dashes `AA-BB-CC-DD-EE-FF` | Colons break Express `:param` parsing |
| LLM driver | `openai` npm + custom `baseURL` | All 7 supported vendors are OpenAI-compatible; one package covers all |
| LLM provider config | DB table `llm_providers`, static registry in code | Keys in DB (sensitive); URL/model list in code (versioned) |
| LLM model per tenant | `tenants.ai_model` field | Model selection = package differentiation; no extra tables needed |
| LLM streaming | WebSocket `ai_chunk` messages | Device already has persistent WS; avoids second HTTP connection |
| `usage_logs.api_key_id` nullable | Changed to `String?` | AI chat bypasses keyValidator; devices may have no api_key assigned |
| WS connection race condition | Buffer msgs before auth, replay after | `connection` callback is async; messages arriving during DB lookup were silently dropped without the buffer |

## Database Tables

| Table | Key detail |
|---|---|
| `tenants` | PK: `id` (int). Has `usage_alert_webhook` + `alert_threshold` + `ai_model` (which LLM model this tenant uses) |
| `api_keys` | PK: `id` (varchar 64, `sk-` prefix UUID). FK → tenants |
| `devices` | PK: `mac_address`. `device_id` = optional external device identifier. `device_key` = 64-hex WebSocket auth token. `board_type`/`capabilities` = EspLink 设备元数据. `wechat_user_id` = FK → wechat_users |
| `usage_logs` | Kept 7 days only. `api_key_id` is nullable (AI chat via WS has no key). Relation filters work in `findMany`/`count` but NOT in `groupBy` |
| `usage_hourly` | Unique on `(api_key_id, hour_timestamp)`. Primary stats source |
| `wechat_users` | PK: `id` (int). `openid` UNIQUE. 微信用户，通过 EspLink 小程序登录创建 |
| `llm_providers` | PK: `id` (int). `provider` UNIQUE (e.g. "deepseek"). Stores API Key per vendor. Admin-managed. |

## Background Jobs

| Job | Schedule | Purpose |
|---|---|---|
| `heartbeatChecker` | `* * * * *` | `is_online=false` if `last_seen` > 2 min ago |
| `usageAggregator` | `5 * * * *` | Rolls last hour of `usage_logs` → `usage_hourly` |
| `cleanupOldUsageLogs` | `0 2 * * *` | Deletes `usage_logs` older than 7 days |

## Environment Variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | MySQL connection string |
| `REDIS_HOST` / `REDIS_PORT` | Yes | Redis connection |
| `JWT_SECRET` | Yes | Shared by admin JWT and WeChat JWT (different `type` claim) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Yes | Management console login |
| `CORS_ORIGIN` | No | Comma-separated allowed origins; defaults to `*` |
| `PORT` | No | Defaults to 8088 |
| `WX_APPID` | No | 微信小程序 AppID；留空则启用 dev 模式（code 直接当 openid） |
| `WX_SECRET` | No | 微信小程序 AppSecret；生产必填 |
| `WS_BASE_URL` | No | 返回给固件的 WebSocket 基础地址，默认 `ws://localhost:8088`；生产改为 `wss://your-domain` |
| `DEFAULT_AI_MODEL` | No | 租户未分配模型时的全局默认，默认 `deepseek-chat` |

## Deployment Target

- **Spark2 server**: `<your-public-host>` via FRP tunnel
- Backend: port 8088 | Admin frontend: port 8080 (prod build served by nginx/serve)
- Shares MySQL (:3306) and Redis (:6379) with official xiaozhi-esp32-server
