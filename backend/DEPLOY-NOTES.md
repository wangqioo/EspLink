# 小氧AI后台部署与鉴权记录

> 编写日期：2026-05-10
> 编写人：Hermes Agent (王齐口述)
> 用途：后续产品化和安全性改造参考文档
> 最新更新：2026-06-20，已同步 EspLink OTA、生产签名和真机验证收尾状态

---

## 当前状态快照

截至 2026-06-20，开发计划内的后端、管理后台、小程序静态能力和 ESP32-S3 固件核心链路已经完成。真机验证已覆盖：

- ESP32-S3 启动注册、WebSocket hello/ping、微信绑定后的在线状态；
- 普通 OTA、同版本强制 OTA、OTA app valid；
- wrong SHA 拒绝、下载中断恢复、boot-fail 自动回滚；
- `REQUIRE_DEVICE_PSK=true` 下的签名启动注册和签名 OTA result；
- 后端重启后的固件 WebSocket 自动重连。

生产上线前仍需完成：

- 真实域名 HTTPS/WSS、证书和反向代理验证；
- 制造阶段 per-device PSK 注入流程，不能使用本地临时 PSK 发货；
- 微信开发者工具和 iOS 真机复测 BLE/配网页面；
- 长时间在线、路由器断开、弱网恢复观察。

---

## 一、部署概况

### 1.1 服务架构

```
┌─────────────────────────────────┐
│  xiaozhi-backend (Docker 容器)    │
│  ├─ Express (port 8088)          │
│  │  ├─ /api/v1/*  (管理后台 API)  │
│  │  ├─ /api/*     (设备/微信 API) │
│  │  └─ /ws/device (设备 WebSocket)│
│  └─ React SPA (Vite 构建)         │
│     served via express.static     │
└──────────┬──────────────────────┘
           │ 172.17.0.1:3307
           ▼
┌──────────────────────────────┐
│  docker_mysql_1  (已有 MySQL)  │  数据库: xiaozhi
└──────────────────────────────┘
           │ 172.17.0.1:6379
           ▼
┌──────────────────────────────┐
│  docker_redis_1  (已有 Redis)  │
└──────────────────────────────┘
```

### 1.2 访问入口

| 入口 | 地址 | 说明 |
|------|------|------|
| **公网（FRP）** | `http://<your-public-host>:6050` | 外网设备/用户访问 |
| **内网** | `http://localhost:8090` | 服务器本地访问 |
| **管理后台** | `http://<your-public-host>:6050/admin` | 管理员 admin/xiaozhi123 |

### 1.3 端口映射链

```
FRP 公网 6050 → 宿主机 8090 → 容器内 8088
```

### 1.4 关键技术决策

| 决策 | 原因 |
|------|------|
| 单容器部署（后端+前端静态文件） | 避免多容器网络复杂化，前端由 Express 统一 serve |
| 复用已有 MySQL 和 Redis | 减少资源占用，同一台服务器已有 docker_mysql_1 和 docker_redis_1 |
| Docker bridge IP 172.17.0.1 | 容器通过宿主机访问外部服务，不依赖 Docker 网络别名 |
| docker-compose v1（连字符） | 服务器上安装的是 docker-compose v1 |

### 1.5 环境变量 (.env)

```env
DATABASE_URL=mysql://root:<db-password>@172.17.0.1:3307/xiaozhi
REDIS_HOST=172.17.0.1
REDIS_PORT=6379
JWT_SECRET=<strong-jwt-secret>
PORT=8088
NODE_ENV=production
WX_APPID=                # 空 = dev 模式，code 直接当 openid
WX_SECRET=
WS_BASE_URL=ws://<your-public-host>:6050
REQUIRE_DEVICE_PSK=false       # 验证阶段默认关闭；量产开启前需先写入 production_keys
OTA_CHECK_RATE_LIMIT=10
OTA_CHECK_RATE_WINDOW_SECONDS=60
DEVICE_AI_RATE_LIMIT=20
DEVICE_AI_RATE_WINDOW_SECONDS=60
UNBOUND_DEVICE_AI_RATE_LIMIT=3
UNBOUND_DEVICE_AI_RATE_WINDOW_SECONDS=300
DEFAULT_AI_MODEL=deepseek-chat
```

---

## 二、完整用户链路（已全部验证通过）

### 2.1 链路总览

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ ESP32     │ ①  │ 后端服务器 │ ②  │ 微信小程序 │    │ DeepSeek  │
│ (设备)    │──→│          │←──│ (用户)    │    │ API       │
│          │ ①  │          │ ②  │          │    │           │
│          │←──│ /api     │──→│          │    │           │
│          │    │ /ota/   │ ③④ │          │    │           │
│          │ ⑤  │ check   │    │          │    │           │
│          │──→│  /ws/    │    │          │    │           │
│          │←──│ device   │    │          │    │           │
│          │ AI 流式回复  │    │          │──→│           │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
```

### 2.2 步骤详情

#### Step ① ESP32 上电注册（HTTP）

**接口**: `POST /api/ota/check`
**鉴权**: 验证阶段默认无；`REQUIRE_DEVICE_PSK=true` 时必须携带 HMAC 签名
**请求**:
```json
{
  "mac": "AA:BB:CC:DD:EE:01",
  "sn": "SN001",
  "board_type": "esplink-v1",
  "firmware_version": "1.0.0"
}
```
**响应**:
```json
{
  "token": "8491af55b98afa212fadafc194c9e3978df00413f7b5dc660a22659225716769",
  "websocket_url": "ws://<your-public-host>:6050/ws/device",
  "is_bound": false
}
```
**关键逻辑**: 设备不存在则自动创建，存在则刷新 last_seen 和 token。

#### Step ② 用户微信登录

**接口**: `POST /api/auth/wechat`
**请求**:
```json
{
  "code": "wx_login_code"
}
```
**鉴权**: 无。code 由微信小程序 wx.login() 获取。
**dev 模式**: WX_APPID 为空时，code 直接当作 openid 使用（前缀 dev_）。
**响应**: JWT token（30天有效），用于小程序后续 API 调用。

#### Step ③ 小程序搜索设备

**接口**: `GET /api/device/lookup?mac_suffix=DDEE01`
**鉴权**: Bearer JWT（wechatAuth 中间件）
**逻辑**: 按 MAC 地址后 3 字节（6 位 hex）模糊匹配，仅返回最近 5 分钟上线且未被绑定的设备。

#### Step ④ 用户绑定设备

**接口**: `POST /api/device/bind`
**请求**:
```json
{
  "mac": "AA:BB:CC:DD:EE:01"
}
```
**鉴权**: Bearer JWT
**逻辑**: 设备只能被一个用户绑定。已绑定到其他用户时返回 409。

#### Step ⑤ WebSocket 连接 + AI 对话

**地址**: `ws://<your-public-host>:6050/ws/device`
**鉴权**: Bearer device_key（上一步注册获取）
**协议**:

| 消息类型 | 方向 | 说明 |
|---------|------|------|
| `hello` | 设备→服务端 | 握手，携带 capabilities, firmware_version |
| `hello_ack` | 服务端→设备 | 返回 is_bound 状态 |
| `ping` | 设备→服务端 | 心跳 |
| `pong` | 服务端→设备 | 心跳回复 |
| `ai_chat` | 设备→服务端 | 发起 AI 对话，携带 session_id + messages[] |
| `ai_chunk` | 服务端→设备 | 流式回复片段（delta） |
| `ai_done` | 服务端→设备 | 回复完成，附带 token 用量 |
| `ai_error` | 服务端→设备 | 错误信息 |
| `command` | 服务端→设备 | 下发控制指令 |
| `config` | 服务端→设备 | 下发配置更新 |

### 2.3 验证结果

| 步骤 | 操作 | 结果 | 耗时 |
|------|------|------|------|
| 注册 | POST /api/ota/check | ✅ token + ws_url | 即时 |
| 微信登录 | POST /api/auth/wechat | ✅ JWT token | 即时 |
| 搜索设备 | GET /api/device/lookup | ✅ 找到未绑定设备 | 即时 |
| 绑定设备 | POST /api/device/bind | ✅ ok | 即时 |
| WebSocket 握手 | hello → hello_ack | ✅ is_bound=true | 即时 |
| AI 对话 | ai_chat → 流式回复 → done | ✅ 10 input / 36 output tokens | ~3s |

---

## 三、真实硬件设备配置点

### 3.1 ESP32 固件

当前固件配置已集中管理：启动注册 URL、生产传输强制、签名开关和测试 WiFi 注入都通过 Kconfig/配置文件管理。

本地硬件联调：

```bash
cd esplink-firmware
idf.py menuconfig
# EspLink → Boot register URL = http://<lan-ip>:8088/api/ota/check
# EspLink → WebSocket/OTA 由后端响应和 release artifact_url 决定
idf.py build flash monitor
```

生产候选固件：

- `CONFIG_ESPLINK_BOOT_SIGNATURE_REQUIRED=y`
- `CONFIG_ESPLINK_PRODUCTION_TRANSPORT=y`
- `CONFIG_ESPLINK_TEST_AUTO_WIFI` 保持关闭
- `CONFIG_ESPLINK_BOOT_PSK` 不作为发货密钥来源；发货前改为制造阶段注入 per-device PSK

生产传输要求：

- boot register 和 OTA result 使用 HTTPS；
- firmware artifact URL 使用 HTTPS；
- WebSocket 使用 WSS；
- ESP-IDF crt bundle 只在 HTTPS/WSS URL 上挂载，本地 HTTP 验证仍可用。

### 3.2 微信小程序 (`esplink-app/utils/api.js`)

| 行号 | 当前值 | 改为 |
|------|--------|-----|
| L1 | `const BASE_URL = 'https://your-server.com'` | `const BASE_URL = 'http://<your-public-host>:6050'` |

**注意**: 微信开发者工具需勾选"不校验合法域名"。生产发布需在微信公众平台配置合法域名白名单。

### 3.3 后端 .env（已配好，无需改动）

```env
WS_BASE_URL=ws://<your-public-host>:6050
DEFAULT_AI_MODEL=deepseek-chat
```

生产环境需要改为：

```env
NODE_ENV=production
REQUIRE_DEVICE_PSK=true
PUBLIC_BASE_URL=https://<your-domain>
FIRMWARE_PUBLIC_BASE_URL=https://<your-domain>
WS_BASE_URL=wss://<your-domain>/ws/device
```

---

## 四、核心安全顾虑（⚠️ 量产后必须解决）

### 4.1 问题本质

默认配置下 `/api/ota/check` 仍保持开放，方便硬件联调。生产环境应在完成 `production_keys` 预置后设置 `REQUIRE_DEVICE_PSK=true`，否则任何知道该 URL 的人（或设备）都可以注册任意 MAC 地址获得 token，进而连接 WebSocket 消耗 AI 额度。

### 4.2 攻击场景

```
攻击者：
1. 调用 POST /api/ota/check 随便填一个 MAC → 拿到 token
2. 用 token 连接 /ws/device → 建立 WebSocket
3. 发送 ai_chat → 服务器用我们的 DeepSeek API Key 回复
4. 消耗的是我们的计费额度
```

### 4.3 当前实现状态

- 已添加 `production_keys` 表、`REQUIRE_DEVICE_PSK` 开关和 `/api/ota/check` HMAC 校验路径
- 默认 `REQUIRE_DEVICE_PSK=false` 保持旧设备和本地硬件调试兼容
- 生产开启前必须先应用 `db/migrations/2026-06-15-create-production-keys.sql`，并为每台设备写入密钥记录

### 4.4 量产方案：PSK 设备身份认证

#### 方案概述

每个设备在烧录时注入唯一的预共享密钥（PSK），注册时用 PSK 对 MAC + SN + timestamp + nonce 做 HMAC 签名，服务器验证签名并拒绝时间戳过期或 nonce 重放。

#### 烧录阶段

```python
# 烧录脚本（示例伪代码）
for mac, sn in production_list:
    psk = os.urandom(16).hex()
    # 写入 ESP32 NVS
    esptool.write_nvs("device_psk", psk)
    # 写入服务器生产密钥库
    db.insert("production_keys", mac_address=mac, sn=sn, psk_encrypted=psk, psk_hash=sha256(psk))
```

#### 注册阶段

```
ESP32 → POST /api/ota/check
        {
          mac: "AA:BB:CC:DD:EE:01",
          sn: "SN001",
          board_type: "esplink-v1",
          firmware_version: "1.0.0",
          timestamp: 1781490000,
          nonce: "random-boot-nonce",
          signature: HMAC-SHA256("MAC\\nSN\\ntimestamp\\nnonce", PSK)
        }

服务器:
  1. 按 mac 在 production_keys 表查到 PSK
  2. 检查 timestamp 是否在 5 分钟窗口内、nonce 是否未重复
  3. 自己计算 HMAC-SHA256("MAC\\nSN\\ntimestamp\\nnonce", psk)
  4. 比对 → 匹配则允许注册，否则 403 Forbidden
```

#### 启用顺序

```bash
mysql -h127.0.0.1 -P3306 -uroot -p xiaozhi < db/migrations/2026-06-15-create-production-keys.sql
npm run db:generate
```

然后写入每台设备的 `production_keys` 记录，最后在 `.env` 中设置：

```env
REQUIRE_DEVICE_PSK=true
```

#### 优势

- 固件被反编译不会泄露所有设备的 PSK（每个设备独立）
- 换芯片烧同样的固件 → MAC 变了 → 签名不匹配 → 无法通过
- 服务器端可随时吊销单个设备的 PSK

### 4.5 可选补充加固

| 措施 | 作用 | 复杂度 |
|------|------|--------|
| HTTPS/WSS | 防中间人窃取 token | 低（给域名配证书 + frp 配置） |
| Token 轮换 | 每次 WebSocket 断开后 device_key 失效 | 中（需处理重连机制） |
| 速率限制 | 已对 `/api/ota/check` 按 IP+MAC 限制，默认 10 次/60秒 | 已实现 |
| 未绑定设备限流 | 已对未绑定设备限制 ai_chat，默认 3 次/300秒 | 已实现 |

#### 当前限流默认值

| 场景 | Env | 默认 |
|------|-----|------|
| 上电注册 `/api/ota/check` | `OTA_CHECK_RATE_LIMIT` / `OTA_CHECK_RATE_WINDOW_SECONDS` | 10 次 / 60 秒 |
| 已绑定设备 AI 对话 | `DEVICE_AI_RATE_LIMIT` / `DEVICE_AI_RATE_WINDOW_SECONDS` | 20 次 / 60 秒 |
| 未绑定设备 AI 对话 | `UNBOUND_DEVICE_AI_RATE_LIMIT` / `UNBOUND_DEVICE_AI_RATE_WINDOW_SECONDS` | 3 次 / 300 秒 |

Redis 异常时限流按当前实现 fail-open，不阻断硬件联调。

### 4.6 当前与量产鉴权对比

| 维度 | 当前（验证阶段） | 量产方案 |
|------|-----------------|---------|
| 注册端点 | 默认开放 | `REQUIRE_DEVICE_PSK=true` 后 PSK 签名验证 |
| Token 生成 | 32 字节随机 hex，静态 | 32 字节随机 hex，可轮换 |
| MAC 校验 | 不校验 | 通过 PSK 间接验证 |
| WebSocket 鉴权 | Bearer device_key | Bearer device_key（不变） |
| 防冒充 | 无 | 有（PSK 绑定 MAC） |
| 防中间人 | 无（HTTP） | HTTPS 可选 |

---

## 五、数据库结构（当前）

### 5.1 核心表

| 表名 | 说明 | 关键字段 |
|------|------|---------|
| `devices` | 设备 | mac_address, device_key, board_type, firmware, wechat_user_id, is_online, is_paired, api_key_id, tenant_id, last_seen |
| `wechat_users` | 微信用户 | openid, nickname, avatar_url |
| `tenants` | 租户 | name, ai_model, is_active |
| `llm_providers` | LLM 厂商 | provider, api_key, base_url, is_active |
| `usage_logs` | 使用日志 | api_key_id, device_mac, model, input_tokens, output_tokens, latency_ms |
| `api_keys` | API 密钥 | key, name, tenant_id, is_active |

### 5.2 当前设备示例

```sql
mac_address: AA:BB:CC:DD:EE:01
device_key: 8491af55b98afa212fadafc194c9e3978df00413f7b5dc660a22659225716769
wechat_user_id: 1           -- 已绑定 dev_customer_001
is_paired: 1
is_online: 0
board_type: esplink-v1
firmware: 1.0.0
last_seen: 2026-05-10 16:03:34
```

---

## 六、FRP 隧道配置

### 6.1 当前隧道 (`/opt/frp/frpc.toml`)

```toml
[[proxies]]
name = "4060ti-xiaozhi"
type = "tcp"
localIP = "127.0.0.1"
localPort = 8090
remotePort = 6050
```

### 6.2 端口使用情况

| 端口 | 用途 |
|------|------|
| 6004 | SSH（主入口） |
| 6041-6049 | 其他服务 |
| 6102, 6128 | 其他服务 |
| **6050** | **小氧AI后台** |
| 7001-7999 | FRP 面板可用范围 |
| 10000-20000 | 额外可用范围 |

---

## 七、后续工作建议

### 7.1 短期内（验证阶段）

- [x] 拿真实 ESP32 硬件联调，验证固件注册和 WebSocket 连接
- [ ] 小程序开发者工具联调微信登录和配网流程
- [ ] 配置 LLM 厂商（当前只有 DeepSeek），在管理后台添加更多模型
- [ ] 给 frp 配 HTTPS 证书，让外网走安全连接

### 7.2 中期（量产前）

- [ ] 设计 PSK 烧录流程和密钥管理方案
- [x] 添加 production_keys 表和注册鉴权中间件
- [ ] Token 轮换机制
- [x] 速率限制和滥用防护
- [ ] 管理后台增加设备管理和日志查看功能

### 7.3 长期

- [x] OTA 固件升级流程验证（已覆盖正常升级、强制升级、错误 SHA、下载中断和 boot-fail 回滚）
- [ ] 多租户隔离和计费系统
- [ ] 设备远程诊断和日志上传

---

## 八、常用运维命令

```bash
# SSH 连接
ssh -p <port> <user>@<your-public-host>

# 查看容器状态
docker ps --filter name=xiaozhi

# 查看容器日志
docker logs xiaozhi-backend

# 重启容器
docker restart xiaozhi-backend

# 进入容器
docker exec -it xiaozhi-backend /bin/bash

# 重建容器（更新代码后）
docker build -t xiaozhi-backend /home/wq/xiaozhi-esp32-server/
docker rm -f xiaozhi-backend
docker run -d --name xiaozhi-backend --restart unless-stopped \
  -p 8090:8088 \
  --env-file /home/wq/xiaozhi-esp32-server/.env \
  xiaozhi-backend

# 查看 WebSocket 连接状态
docker logs xiaozhi-backend | grep "\[WS\]"

# 查看 FRP 配置
cat /opt/frp/frpc.toml

# 重启 FRP
sudo systemctl restart frpc
```
