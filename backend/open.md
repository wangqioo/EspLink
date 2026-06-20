# 项目启动指南

> 最新更新：2026-06-20。当前正式仓库是 `/Users/wq/EspLink`，后端位于 `/Users/wq/EspLink/backend`。下面先给出当前 Mac/仓库启动方式；原 Windows/Scoop 片段仅作为历史环境参考，不应作为当前开发默认路径。

## 当前 Mac / EspLink 仓库启动方式

### 后端

```bash
cd /Users/wq/EspLink/backend
cp .env.example .env
# 编辑 .env：DATABASE_URL、REDIS_HOST、JWT_SECRET、ADMIN_PASSWORD、WS_BASE_URL、PUBLIC_BASE_URL
npm install
npm run db:generate
npm test -- --runInBand
npm start
```

硬件联调时，`WS_BASE_URL` 和 `PUBLIC_BASE_URL` 必须使用 ESP32 能访问到的局域网地址，例如：

```env
WS_BASE_URL=ws://192.168.1.26:8088/ws/device
PUBLIC_BASE_URL=http://192.168.1.26:8088
```

### 管理后台

```bash
cd /Users/wq/EspLink/backend/admin-frontend
npm install
npm run build
npm run dev
```

### 固件

```bash
cd /Users/wq/EspLink/esplink-firmware
source /Users/wq/esp-idf/export.sh
idf.py build
idf.py -p /dev/cu.usbmodem112301 flash monitor
```

当前固件配置集中在 Kconfig 和 `main/board_config.h`。启动注册 URL、生产传输强制、签名开关和测试 WiFi 注入都不要绑定到 `main.c` 行号。

### 当前验证状态

截至 2026-06-20，普通 OTA、同版本强制 OTA、wrong SHA 拒绝、下载中断恢复、boot-fail 回滚、签名启动注册、签名 OTA result、后端重启/WebSocket 恢复均已通过真机验证。剩余项是 HTTPS/WSS 真域名证书链路、微信开发者工具/iOS 真机复测和长时间稳定性观察。

最新状态以根目录文档为准：

- `../docs/2026-06-16-development-status.md`
- `../docs/2026-06-16-production-readiness-regression.md`
- `../docs/2026-06-19-production-security-design.md`

---

## 历史 Windows 开发环境（2026-05-06 快照）

MySQL 和 Redis 通过 **Scoop** 安装在本机，无需 Docker。每次重启电脑后需手动重启服务：

```powershell
# 刷新 PATH（每次新开终端都需要）
$env:PATH = "$env:USERPROFILE\scoop\shims;$env:PATH"

# 启动 Redis（后台静默运行）
Start-Process -FilePath "redis-server" -WindowStyle Hidden

# 启动 MySQL（后台静默运行）
Start-Process -FilePath "mysqld" -ArgumentList "--standalone" -WindowStyle Hidden

# 等待几秒后启动后端
cd C:\Users\19051\Desktop\ai_deploy\backend
npm run dev

# 新开终端启动前端
cd C:\Users\19051\Desktop\ai_deploy\backend\admin-frontend
npm run dev
```

当前 `.env` 配置：
```
DATABASE_URL="mysql://root:<db-password>@localhost:3306/xiaozhi"
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
WX_APPID=                   # 留空 = dev 模式（code 直接当 openid）
WX_SECRET=
WS_BASE_URL=ws://localhost:8088
DEFAULT_AI_MODEL=deepseek-chat
```

> **注意：** 系统开启了 Clash 代理（port 7897），curl 访问 localhost 会出现 502，属正常现象。浏览器访问不受影响，直接打开 http://localhost:5173 即可。

后端启动成功后应看到：
```
[WS] WebSocket 服务已启动，路径 /ws/device
[Server] 小氧AI后台API 启动，端口 8088
[Jobs] 定时任务已启动
```

---

## 前置要求（服务器 / 新机器）

- Node.js 18+
- MySQL 8.x（复用官方 xiaozhi-esp32-server 的数据库）
- Redis（复用官方 xiaozhi-esp32-server 的 Redis）
- npm

---

## 第一步：配置环境变量

```bash
cp .env.example .env
```

打开 `.env`，填入真实连接信息：

```env
# 数据库（改成你的 MySQL 地址/账号/密码）
DATABASE_URL="mysql://root:你的密码@localhost:3306/xiaozhi"

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=          # 没有密码留空

# 管理员登录账号（自定义）
ADMIN_USERNAME=admin
ADMIN_PASSWORD=xiaozhi123

# JWT 密钥（改成随机字符串）
JWT_SECRET=换一个随机字符串

# 前端地址（开发时默认 5173）
CORS_ORIGIN=http://localhost:5173

# EspLink 微信小程序配网集成
# 留空则启用 dev 模式（wx.login 的 code 直接当 openid，无需真实微信环境）
WX_APPID=your_wx_appid
WX_SECRET=your_wx_secret

# 返回给固件的 WebSocket 基础地址；生产改为 wss://your-domain.com
WS_BASE_URL=ws://localhost:8088

# 租户未分配模型时的全局默认
DEFAULT_AI_MODEL=deepseek-chat
```

---

## 第二步：初始化数据库

在官方 xiaozhi 数据库中创建扩展表：

```bash
# 在 backend/ 目录下执行（执行前确认后端未在运行，否则 Prisma DLL 会被锁定）
npm run db:push
```

> 这会新建 `tenants`、`api_keys`、`devices`、`usage_logs`、`usage_hourly`、`wechat_users`、`llm_providers` 共 **7 张**扩展表，**不影响官方已有的表**。

---

## 第三步：启动后端

```bash
# 开发模式（热重载）
npm run dev

# 生产模式
npm start
```

后端启动后监听 **http://localhost:8088**

看到以下输出说明启动成功：
```
[WS] WebSocket 服务已启动，路径 /ws/device
[Server] 小氧AI后台API 启动，端口 8088
[Jobs] 定时任务已启动
```

---

## 第四步：启动前端

**新开一个终端窗口**，进入前端目录：

```bash
cd admin-frontend
npm run dev
```

前端启动后访问 **http://localhost:5173**

---

## 第五步：登录后台 & 配置大模型

打开浏览器访问 http://localhost:5173，用 `.env` 中配置的账号登录（默认 `admin` / `xiaozhi123`）。

**首次使用必须配置至少一个大模型厂商的 API Key：**

1. 左侧菜单 → **模型配置**
2. 找到你有 API Key 的厂商（如 DeepSeek），点击「配置 Key」
3. 填入 API Key，勾选「启用」，点击确定
4. 状态变为「已启用」后即可使用

然后在**租户管理**中为租户分配模型（套餐）：

1. 左侧菜单 → **租户管理** → 新建或编辑租户
2. 「AI 模型（套餐）」选择刚才配置好的模型（如 `deepseek-chat`）
3. 保存后，该租户下的设备发起 AI 对话时将使用该模型

---

## 硬件连接测试

### 第一阶段：纯接口测试（无需硬件）

在 PowerShell 中模拟固件行为：

```powershell
# 1. 健康检查
Invoke-RestMethod -Uri "http://localhost:8088/api/v1/health/ready"

# 2. 模拟固件注册（默认 REQUIRE_DEVICE_PSK=false 时无需签名）
$body = @{ mac = "AA:BB:CC:DD:EE:01"; board_type = "esp32s3"; firmware_version = "1.0.0" } | ConvertTo-Json
$res = Invoke-RestMethod -Uri "http://localhost:8088/api/ota/check" -Method POST -Body $body -ContentType "application/json"
$res   # 应返回 token + websocket_url

# 保存 device_key
$deviceKey = $res.token
Write-Host "device_key: $deviceKey"
```

若 `.env` 设置了 `REQUIRE_DEVICE_PSK=true`，需先应用 `db/migrations/2026-06-15-create-production-keys.sql` 并写入对应 MAC 的 `production_keys` 记录；模拟请求还必须携带 `sn`、`timestamp`、`nonce`、`signature`。

连续重复调用 `/api/ota/check` 可能返回 `429 请求过于频繁`；默认按 `IP+MAC` 限制为 10 次/60秒，可通过 `OTA_CHECK_RATE_LIMIT` 和 `OTA_CHECK_RATE_WINDOW_SECONDS` 调整。

### 第二阶段：WebSocket 测试

项目根目录提供了 `test_ws.js`，支持三种测试模式：

```powershell
# ping/pong 基础连通性
node test_ws.js <device_key> ping

# hello/hello_ack 握手
node test_ws.js <device_key> hello

# 完整 AI 对话（hello → ai_chat → 流式 ai_chunk → ai_done）
node test_ws.js <device_key> ai
```

AI 对话测试需满足：厂商 API Key 已在后台配置并启用，且设备所属租户已分配 `ai_model`。

预期输出示例（`ai` 模式）：
```
[连接] WebSocket 已建立
[发送] {"type":"hello",...}
[收到] {"type":"hello_ack","is_bound":false}
--- hello_ack 收到，发送 ai_chat ---
[收到] {"type":"ai_chunk","delta":"你好"}
你好，我是...
✅ AI 对话完成: {"input_tokens":11,"output_tokens":15}
```

### 第三阶段：实际硬件连接

固件需要知道后端的实际地址（localhost 对硬件无效）。

**同一局域网开发环境：**
```powershell
# 查本机局域网 IP
ipconfig | Select-String "IPv4"
```
将 `.env` 中 `WS_BASE_URL` 改为局域网 IP：
```
WS_BASE_URL=ws://192.168.1.100:8088
```
重启后端后，固件调用 `/api/ota/check` 拿到的 `websocket_url` 自动变为局域网地址。

**固件侧配置：** 当前固件通过 Kconfig 配置 boot register URL，不再依赖 `main.c` 行号。使用 `idf.py menuconfig` 设置 `EspLink → Boot register URL`，本地开发填 `http://局域网IP:8088/api/ota/check`。

连接成功后，在管理后台**设备管理**页面应看到对应 MAC 地址的设备上线（绿色状态）。

---

## 生产部署（Spark2 服务器，<your-public-host>）

### 后端

```bash
# 安装 PM2
npm install -g pm2

# 启动
pm2 start src/app.js --name xiaozhi-backend

# 开机自启
pm2 save && pm2 startup
```

### 前端

```bash
cd admin-frontend

# 打包
npm run build

# 用 nginx 或 serve 托管 dist/ 目录
npx serve dist -p 8080
```

### nginx 反向代理参考配置

> 注意：WebSocket 连接需要额外的 `Upgrade` 头，否则固件无法建立长连接。

```nginx
server {
    listen 8080;

    # 前端静态文件
    location / {
        root /path/to/admin-frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # 后端 HTTP API 代理
    location /api/ {
        proxy_pass http://127.0.0.1:8088;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket 代理（固件长连接，必须单独配置 Upgrade）
    location /ws/ {
        proxy_pass http://127.0.0.1:8088;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;   # 保持长连接不超时
    }
}
```

生产环境 `.env` 关键配置：
```env
NODE_ENV=production
REQUIRE_DEVICE_PSK=true
PUBLIC_BASE_URL=https://your-domain.com
FIRMWARE_PUBLIC_BASE_URL=https://your-domain.com
WS_BASE_URL=wss://your-domain.com/ws/device
CORS_ORIGIN=https://your-admin-domain.com
```

---

## 常用命令速查

| 命令 | 说明 |
|---|---|
| `npm run dev` | 后端开发模式（热重载） |
| `npm start` | 后端生产模式 |
| `npm test` | 运行测试 |
| `npm run db:push` | 同步数据库表结构（先停后端） |
| `npm run db:studio` | Prisma Studio 可视化数据库 |
| `cd admin-frontend && npm run dev` | 前端开发模式 |
| `cd admin-frontend && npm run build` | 前端打包 |

---

## 常见问题

**Q: `npm run db:push` 报错 "operation not permitted" 或 DLL 锁定**
必须先停止后端（Ctrl+C 结束 `npm run dev`）再执行，nodemon 会锁住 Prisma 生成的 `.dll.node` 文件。

**Q: `npm run db:push` 报错 "Can't reach database server"**
检查 `.env` 里 `DATABASE_URL` 的 host/端口/密码是否正确，以及 MySQL 是否在运行。

**Q: Redis 连接失败但后端仍然启动**
Redis 断线时限流和 Key 缓存会自动降级（放行请求），不影响核心功能。检查 `REDIS_HOST` 配置。

**Q: 前端页面空白 / 接口 404**
确认后端已在 8088 端口运行。开发模式下 Vite 自动把 `/api` 请求代理到 8088，无需额外配置。

**Q: 登录提示"用户名或密码错误"**
检查 `.env` 中 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 与你输入的是否一致，修改后需重启后端。

**Q: AI 对话返回 "未找到可用的厂商配置"**
进入后台**模型配置**页面，为对应厂商配置 API Key 并启用。同时确认租户已在**租户管理**中分配了该厂商支持的模型。

**Q: AI 对话返回 "该厂商未启用"**
进入后台**模型配置**，找到对应厂商，打开右侧开关将其启用。

**Q: 设备发 `ai_chat` 后收不到 `ai_chunk`**
1. 确认后台模型配置已填写有效 API Key
2. 确认租户已分配 `ai_model`（或 `DEFAULT_AI_MODEL` 有值）
3. 检查后端日志，查看调用厂商接口是否返回错误（如余额不足、Key 无效）

**Q: EspLink 小程序调用接口报错**
确认小程序里的 `BASE_URL` 已改为实际后端地址（开发：`http://局域网IP:8088`，生产：`https://your-domain.com`）。微信开发者工具需在「详情 → 本地设置」中勾选「不校验合法域名」。

**Q: 固件调用 `/api/ota/check` 失败**
固件的 boot register URL 需配置为后端实际地址。开发环境无法用 `localhost`，需用电脑局域网 IP（如 `http://192.168.x.x:8088/api/ota/check`），生产用 HTTPS 域名。当前固件通过 Kconfig 管理该 URL。
如果后端开启了 `REQUIRE_DEVICE_PSK=true`，还要确认已执行 `db/migrations/2026-06-15-create-production-keys.sql`，并且该设备在 `production_keys` 中有可用密钥；固件请求需带 `sn`、`timestamp`、`nonce` 和 HMAC `signature`。
如果返回 `429`，说明触发了上电注册限流，检查 `OTA_CHECK_RATE_LIMIT` 和 `OTA_CHECK_RATE_WINDOW_SECONDS`。

**Q: WebSocket 设备无法连接**
1. 检查 `.env` 中 `WS_BASE_URL` 是否与固件能访问的地址一致
2. 生产环境用 nginx 代理时，确认 `/ws/` location 配置了 `Upgrade` 和 `Connection` 头
3. 开发时用 `ws://局域网IP:8088`，生产用 `wss://your-domain.com`

**Q: curl 访问 localhost 返回 502**
本机开启了 Clash 代理（port 7897），curl 流量被代理拦截。属正常现象，改用 `Invoke-RestMethod` 或直接用浏览器访问。
