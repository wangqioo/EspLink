# 小氧AI 后台管理系统

基于 ESP32 的 AI 硬件设备运营管控平台。已与 EspLink BLE 配网系统打通：用户通过微信小程序蓝牙配网后，设备自动注册上线并与账号绑定；设备通过 WebSocket 长连接与后端保持实时通信，后端代理多家大模型厂商 API 并以流式方式推送 AI 回答。管理员通过后台掌握所有设备、租户和用量数据，并统一管理各厂商 API Key 与租户套餐。

最新开发状态、OTA 实机验证和剩余工作见：[../docs/2026-06-16 开发状态与实机验证记录](../docs/2026-06-16-development-status.md)。

历史本地联调记录见：[2026-06-13 EspLink 本地联调记录与后续计划](./docs/2026-06-13-esplink-local-integration.md)。

---

## 功能特性

- **BLE 蓝牙配网** — 微信小程序通过 EspLink BLE 协议为 ESP32 配网，配网成功后设备自动注册并绑定到微信账号
- **WebSocket 长连接** — 固件通过 `/ws/device` 与后端保持长连接，支持实时 AI 对话、指令下发、在线状态和 OTA 推送
- **多厂商 LLM 代理** — 后端统一代理 DeepSeek、GLM、MiniMax、Moonshot、通义千问、火山引擎、OpenAI，设备无需持有任何厂商密钥
- **流式 AI 回答** — 大模型回答通过 WebSocket 逐 chunk 推送给设备，实现实时打字机效果
- **套餐模型管理** — 按租户分配 AI 模型（即套餐），用户订购后直接使用，无需自行配置
- **多租户管理** — 支持按客户/团队隔离，每个租户独立的 API Key 池和用量配额
- **API Key 管控** — 生成、启停、限额、过期时间，支持 Redis 缓存加速验证（命中率 >95%）
- **设备管理** — 实时在线状态、心跳检测、强制下线、设备解绑、手动分配 Key
- **固件发布与 OTA** — 管理后台上传 `.bin`，后端保存版本、SHA256、大小和 OTA 结果统计，固件上报 `started/success/failed`
- **用量统计** — 今日/本月调用量、趋势图、模型占比、调用明细（支持导出 CSV）
- **用量告警** — 达到阈值时向租户配置的 Webhook 推送告警（支持钉钉/企微/飞书）
- **分布式限流** — 基于 Redis 令牌桶，多进程部署下共享限流计数
- **数据分层** — 明细日志按月分区，每小时预聚合，统计查询永远不扫全表

---

## 系统架构

```
微信小程序 (EspLink)               ESP32 设备 (EspLink 固件)
    │  BLE 配网 → WiFi 连接          │  POST /api/ota/check  → 注册+获取 token
    │  POST /api/auth/wechat         │  WS  /ws/device       → 长连接
    │  GET  /api/device/lookup       │    → ai_chat 消息 → 流式 AI 回答
    │  POST /api/device/bind         │    → ping/command/hello
    └──────────────┬─────────────────┘
                   ▼
        ┌─────────────────────┐
        │   后端 API (8088)   │  Express 4.x + Prisma + Redis + ws + openai
        │   /api/v1/...  管理 │
        │   /api/...  EspLink │
        │   /ws/device   WS   │
        └──────┬──────────────┘
               │  流式调用
    ┌──────────▼──────────────────────────────┐
    │  大模型厂商（全部 OpenAI 兼容接口）       │
    │  DeepSeek / GLM / MiniMax / Moonshot    │
    │  通义千问 / 火山引擎 / OpenAI            │
    └─────────────────────────────────────────┘
               │
        ┌──────▼──────────────┐
        │  管理后台 (5173)    │  React 18 + Ant Design 5
        │  仪表盘/租户/Key/   │
        │  设备/用量/模型配置 │
        └─────────────────────┘
               │
        ┌──────▼──────────────┐
        │  xiaozhi 扩展 DB    │  MySQL 8 + Redis
        │  + 扩展业务表       │
        └─────────────────────┘
```

---

## 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| 后端框架 | Express.js | ^4.22.1（锁定，禁止升级至 v5） |
| ORM | Prisma | ^5.x |
| 缓存 / 限流 | Redis (ioredis) | ^5.x |
| 数据库 | MySQL | 8.x |
| LLM 客户端 | openai | ^4.x（驱动所有 OpenAI 兼容厂商） |
| 前端框架 | React + Vite | 18.x / ^5.x |
| UI 组件库 | Ant Design | ^5.x |
| 图表 | Recharts | ^2.x |
| 状态管理 | Zustand | ^4.x |
| HTTP 客户端 | Axios | ^1.x |

---

## 数据库表结构

| 表名 | 说明 |
|---|---|
| `tenants` | 租户，含每日/月限额、告警 Webhook、`ai_model`（分配给该租户的模型，即套餐） |
| `api_keys` | API Key，含用量计数和过期时间 |
| `devices` | 设备，以 MAC 地址为主键；含 `device_key`（WebSocket 认证）、`board_type`、`capabilities`、`wechat_user_id` |
| `firmware_releases` | 固件发布记录；按 `board_type/channel/version` 唯一，含 artifact URL、SHA256、大小、强制升级开关 |
| `firmware_ota_attempts` | 设备 OTA 结果流水；记录 `started/success/download_failed/sha_mismatch` 等状态 |
| `production_keys` | 量产设备预共享密钥；`REQUIRE_DEVICE_PSK=true` 时用于校验 `/api/ota/check` 和 `/api/ota/result` HMAC 签名 |
| `wechat_users` | 微信用户，通过 EspLink 小程序登录自动创建，与设备关联 |
| `usage_logs` | 调用明细，按月分区，保留 7 天；`api_key_id` 可为空（AI WebSocket 调用无需 Key） |
| `usage_hourly` | 每小时预聚合，统计查询的主要数据源 |
| `llm_providers` | 大模型厂商配置，管理员在后台填写各厂商 API Key；`provider` 字段唯一 |

---

## API 概览

### 管理接口（`/api/v1/` 前缀，需 Bearer 管理员 token）

| 模块 | 路径 | 说明 |
|---|---|---|
| 认证 | `POST /api/v1/auth/login` | 管理员登录 |
| 租户 | `GET/POST/PATCH/DELETE /api/v1/tenants` | 租户 CRUD（含 ai_model 字段） |
| API Key | `GET/POST/PATCH/DELETE /api/v1/keys` | Key 管理 |
| 设备 | `GET /api/v1/devices` | 设备列表 |
| 设备 | `POST /api/v1/devices/register` | 固件自注册（无需认证） |
| 设备 | `POST /api/v1/devices/:mac/kick` | 强制下线 |
| 设备 | `POST /api/v1/devices/:mac/unbind` | 解绑 |
| 固件 | `POST /api/v1/firmware/artifacts` | 上传 `.bin`，返回 URL、SHA256 和大小 |
| 固件 | `GET /api/v1/firmware/releases` | 固件发布列表 |
| 固件 | `POST /api/v1/firmware/releases` | 创建固件发布 |
| 固件 | `PATCH /api/v1/firmware/releases/:id/active` | 启用 / 停用发布 |
| 固件 | `GET /api/v1/firmware/ota-preview` | 只读 OTA 决策预览，不注册或更新设备 |
| 用量 | `GET /api/v1/usage/summary` | 汇总统计 |
| 用量 | `GET /api/v1/usage/daily` | 按天趋势 |
| 用量 | `GET /api/v1/usage/logs` | 调用明细（7天内） |
| 模型配置 | `GET /api/v1/llm/models` | 所有支持模型列表 |
| 模型配置 | `GET /api/v1/llm/providers` | 所有厂商配置状态（Key 脱敏） |
| 模型配置 | `PUT /api/v1/llm/providers/:provider` | 新增或更新厂商 API Key |
| 模型配置 | `PATCH /api/v1/llm/providers/:provider/toggle` | 启用 / 禁用厂商 |
| 运营 | `GET /api/v1/operation/overview` | 运营大盘 |
| 健康 | `GET /api/v1/health/ready` | 就绪检查（含 DB + Redis） |

### EspLink 接口（`/api/` 前缀，固件和小程序使用）

| 模块 | 路径 | 认证 | 说明 |
|---|---|---|---|
| 微信登录 | `POST /api/auth/wechat` | 无 | 小程序 code 换 JWT token |
| 固件注册 | `POST /api/ota/check` | 默认无；生产可启用 PSK HMAC | 设备上电注册，返回 device_key + ws 地址 |
| OTA 结果 | `POST /api/ota/result` | 默认无；生产可启用 PSK HMAC | 固件上报 OTA started/success/failure |
| 设备列表 | `GET /api/device/list` | 微信 JWT | 当前用户的绑定设备 |
| 设备查找 | `GET /api/device/lookup?mac_suffix=AABBCC` | 微信 JWT | 按 MAC 后三字节查找刚上线设备 |
| 设备绑定 | `POST /api/device/bind` | 微信 JWT | 绑定设备到微信账号 |
| 下发指令 | `POST /api/device/:mac/command` | 微信 JWT | 通过 WebSocket 向设备推送指令 |
| WebSocket | `WS /ws/device` | device_key | 固件长连接（hello/ping/ai_chat/command） |

---

## AI 对话流程（WebSocket）

```
1. 固件已通过 WS /ws/device 建立长连接（Authorization: Bearer <device_key>）
2. 用户说话 → 固件 ASR 识别为文本
3. 固件发送：
   { "type": "ai_chat", "session_id": "abc123", "messages": [{"role": "user", "content": "今天天气怎么样"}] }
4. 后端：查设备 → 找租户 → 取 ai_model → 查 llm_providers 获取 API Key → 流式调用厂商
5. 后端逐 chunk 推送：
   { "type": "ai_chunk", "session_id": "abc123", "delta": "今天" }
   { "type": "ai_chunk", "session_id": "abc123", "delta": "北京" }
   ...
6. 结束：{ "type": "ai_done", "session_id": "abc123", "usage": { "input_tokens": 10, "output_tokens": 50 } }
7. 固件收到 chunks → TTS 合成 → 播放给用户
```

---

## 设备配网与绑定流程

### EspLink BLE 配网流程

```
1. 设备上电，无 WiFi 凭证 → 启动 BLE 广播 "Device-AABBCC"
2. 用户打开微信小程序 → BLE 扫描发现设备
3. 小程序通过 BluFi 协议发送 WiFi SSID/密码 → 设备连接 WiFi
4. 设备 WiFi 上线 → 调用 POST /api/ota/check
   → 后端自动注册设备（首次），返回 device_key + websocket_url
5. 固件建立 WebSocket 长连接 /ws/device，发送 hello 握手
6. 小程序轮询 GET /api/device/lookup?mac_suffix=AABBCC 等待设备上线
7. 发现设备 → 调用 POST /api/device/bind → 设备绑定到微信账号
```

---

## 硬件联调快速测试

> 后端、固件编译、小程序调试全部在 Mac 上进行。BLE 连接需用微信开发者工具**真机调试**扫码到真实手机，模拟器不支持。
>
> 2026-06-16 本地实测 Mac IP 为 `192.168.1.26`。如果 IP 变化，需要同步更新后端 `WS_BASE_URL/PUBLIC_BASE_URL`、小程序 `BASE_URL` 和固件 `CONFIG_ESPLINK_BOOT_REGISTER_URL`。

### 1. 启动 Mac 后端

```bash
export PATH="/opt/homebrew/bin:$PATH"
brew services start mysql
brew services start redis
cd /Users/wq/EspLink/backend
cp .env.example .env

# 编辑 .env：
# DATABASE_URL="mysql://root:<db-password>@localhost:3306/xiaozhi"
# REDIS_HOST=localhost
# WS_BASE_URL=ws://192.168.1.26:8088
# PUBLIC_BASE_URL=http://192.168.1.26:8088
# REQUIRE_DEVICE_PSK=false

npm install
npm run db:generate
npm start
```

验证 ready：

```bash
curl --noproxy '*' -s http://127.0.0.1:8088/api/v1/health/ready
```

期望 `db=true`、`redis=true`。

### 2. 微信开发者工具配置

- 导入 `/Users/wq/EspLink/esplink-app/`
- **「···」→「项目设置」→「本地设置」** 勾选「不校验合法域名」
- **设置 → 代理 → 不使用代理**
- `utils/api.js` 使用局域网 IP，例如：`BASE_URL = 'http://192.168.1.26:8088'`

### 3. 配网流程

1. ESP32 上电（BLE 广播已启动，可通过串口日志确认）
2. 点开发者工具顶部**「真机调试」**，用手机微信扫码
3. 小程序点「+」→ 找到 `Device-927D70` → 连接 → 手动输入 WiFi 名和密码
4. 点「开始配网」→ 等待设备注册上线
5. 小程序弹出绑定确认 → 确认绑定
6. 管理后台 http://localhost:5173 → 设备管理 → 可见设备在线 ✅

详细排障见 [CLAUDE.md](./CLAUDE.md) 的「硬件联调测试流程」章节。

## OTA 实机验证

截至 2026-06-20 已完成以下真实硬件 OTA/连接回归：

- 设备：`10:51:DB:80:E2:E8`
- 当前固件：`esplink-v1 / 1.0.5`
- 普通 OTA：`1.0.4 -> 1.0.5`，数据库写入 `status=success`
- 同版本强制 OTA：已通过，OTA app 启动后先标记 valid，再允许下一次 OTA
- wrong SHA：设备拒绝不可信 artifact，上报 `sha_mismatch`，并恢复当前运行分区
- interrupted download：设备上报 `download_failed`，重启后回到上一有效固件
- signed boot/result：`REQUIRE_DEVICE_PSK=true` 下启动注册和 OTA 结果签名均通过本地硬件验证
- boot-fail rollback：临时 `1.0.8` 崩溃镜像通过下载和 SHA 校验后启动失败，bootloader 回滚到 `1.0.5`
- backend restart/WebSocket recovery：后端重启后固件进入 5 秒重连循环，并在服务恢复后重新连接

关键日志：

```text
main: OTA available, upgrading...
app_ota: OTA result reported: started
app_ota: OTA artifact SHA256 verified
app_ota: OTA success, restarting
app_ota: OTA result reported: success
main: === device boot: board=esplink-v1 fw=1.0.5 ===
app_ws: WebSocket connected
main: hello_ack: is_bound=1
```

完整状态见：[开发状态与实机验证记录](../docs/2026-06-16-development-status.md) 和 [Production Readiness Regression Runbook](../docs/2026-06-16-production-readiness-regression.md)。

仍需部署环境验证：

- HTTPS/WSS 真域名证书链路。

---

## 定时任务

| 任务 | 频率 | 说明 |
|---|---|---|
| 心跳检测 | 每分钟 | 超过 2 分钟无心跳的设备标记为离线 |
| 用量聚合 | 每小时第5分钟 | 将上一小时明细聚合到 `usage_hourly` |
| 明细清理 | 每天凌晨2点 | 删除 7 天前的 `usage_logs` 明细 |

---

## 项目结构

```
backend/
├── src/
│   ├── app.js              # 入口
│   ├── config/             # Prisma + Redis 客户端 + llmProviders 静态注册表
│   ├── middleware/         # requestId / adminAuth / wechatAuth / keyValidator / rateLimiter
│   ├── routes/             # auth / tenants / keys / devices / usage / pair / operation / llm / esplink
│   ├── services/           # 业务逻辑层（含 llmService 流式代理）
│   ├── ws/                 # deviceWsManager（处理 ai_chat 流式消息）
│   └── jobs/               # 定时任务
├── prisma/
│   └── schema.prisma       # 9 张表
├── test_ws.js              # WebSocket 端到端测试脚本（ping / hello / ai 三档）
├── admin-frontend/         # React 管理后台
│   └── src/
│       ├── pages/          # Dashboard / Tenants / ApiKeys / Devices / Usage / Login / LlmConfig
│       ├── api/            # Axios 封装
│       └── store/          # Zustand 全局状态
└── .env.example
```

---

## 部署

- **服务器**：Spark2（`<your-public-host>`），通过 FRP 隧道访问
- **后端**：port 8088，PM2 守护
- **前端**：port 8080，`npm run build` 后由 nginx / serve 托管 `admin-frontend/dist/`

详见 [open.md](./open.md) 的生产部署章节。

## License

MIT
