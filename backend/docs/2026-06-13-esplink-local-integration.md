# 2026-06-13 EspLink 本地联调记录与后续计划

本文记录 2026-06-13 在 Mac 本地完成的 EspLink 设备、微信小程序、后端服务联调状态，供后续开发接手使用。

## 当前结论

- 后端仓库：`/Users/wq/ai_deploy_backend`
- EspLink 仓库：`/Users/wq/EspLink`
- Mac 局域网 IP：`192.168.1.26`
- 后端 API：`http://192.168.1.26:8088`
- 后端 WebSocket：`ws://192.168.1.26:8088/ws/device`
- 管理后台开发服务：`http://localhost:5173`
- 设备 MAC：`10:51:DB:80:E2:E8`
- 设备串口：`/dev/cu.usbmodem112301`
- 本次短时验证状态：已配网、已绑定、可注册上线、可通过 WebSocket 心跳刷新在线时间。

短时验证结果：

```text
GET /api/v1/health/ready
{"code":0,"data":{"db":true,"redis":true},"message":"ready"}

devices:
mac_address        = 10:51:DB:80:E2:E8
is_online          = 1
is_paired          = 1
last_seen          = 持续由设备 ping 刷新
seconds_since_seen = 8
```

长时间复查结果：

```text
2026-06-13 17:20 复查时设备已离线：
is_online          = 0
last_seen          = 2026-06-13 16:19:09
seconds_since_seen = 3673
```

因此，本次已完成“配网 -> 注册 -> WebSocket -> 业务 ping/pong -> 短时在线”的闭环；“长时间在线稳定性”仍列入下一轮排查。

## 本次完成的开发

### 1. 本地联调地址打通

后端 `.env` 使用：

```env
PORT=8088
WS_BASE_URL=ws://192.168.1.26:8088
```

小程序 `esplink-app/utils/api.js` 使用：

```js
const BASE_URL = 'http://192.168.1.26:8088'
```

固件 `main/main.c` 使用：

```c
#define BOOT_REGISTER_URL "http://192.168.1.26:8088/api/ota/check"
```

固件 HTTP 传输从 `HTTP_TRANSPORT_OVER_SSL` 改为 `HTTP_TRANSPORT_OVER_TCP`，用于本地 HTTP 调试。

### 2. 修复 WiFi 事件回调栈溢出

现象：

```text
***ERROR*** A stack overflow in task sys_evt has been detected.
```

原因：设备拿到 IP 后，在 ESP-IDF 系统事件任务 `sys_evt` 中直接执行注册、WebSocket、BLE 通知等较重逻辑，超过系统事件任务栈。

处理：

- `app_wifi.c` 在 `IP_EVENT_STA_GOT_IP` 后创建 `wifi_conn_cb` 独立任务。
- WiFi 失败回调也通过 `wifi_disc_cb` 独立任务执行。
- 避免把注册和 WebSocket 建连压在系统事件栈上。

### 3. 修复 WebSocket 鉴权头

现象：

```text
Error read response for Upgrade header
```

原因：固件传给 `esp_websocket_client` 的自定义 header 缺少结尾 CRLF。

处理：

```c
snprintf(auth_header, sizeof(auth_header), "Authorization: Bearer %s\r\n", token);
```

### 4. 强制每次 WiFi 上线重新 boot register

原行为：设备 NVS 中已有 token 时，WiFi 上线后可能跳过 `/api/ota/check`，继续使用旧 WebSocket URL 或旧 token。

处理：

- `on_wifi_connected()` 每次都进入 `STATE_ACTIVATING`。
- 每次 WiFi 上线都调用 `/api/ota/check`。
- 后端返回最新 `device_key` 和 `websocket_url` 后再建立 WebSocket。

这样可以避免本地 IP、后端地址、token 变化后设备继续使用旧配置。

### 5. 修复后端设备时间写入方式

现象：设备 WebSocket 已连接，但心跳任务很快把设备标记离线。

原因：MySQL `NOW()` 使用数据库本地时区，Prisma 写入 JS `Date` 时形成 8 小时时间偏移，导致 `last_seen` 看起来早于当前时间。

处理：

- 新增 `src/utils/dbTime.js`。
- `touchDevice(mac, data)` 使用 SQL `last_seen = NOW()`。
- WebSocket connect、hello、ping 和 boot register 都走该 helper。
- `heartbeatChecker` 使用 MySQL 侧时间比较：

```sql
last_seen < (NOW() - INTERVAL 2 MINUTE)
```

### 6. 增加设备业务心跳

后端业务心跳协议：

```json
{"type":"ping"}
```

后端回复：

```json
{"type":"pong"}
```

固件 `app_ws.c` 新增 `ws_app_ping` FreeRTOS 任务：

- WebSocket 连接成功后启动。
- 每 30 秒发送一次 `{"type":"ping"}`。
- 后端收到后更新 `last_seen` 和 `is_online=true`。

后端 `deviceWsManager.js` 收到 `hello` 或 `ping` 时都会调用：

```js
await touchDevice(mac, { is_online: true })
```

### 7. 处理 pong 日志

固件 `main.c` 将 `pong` 作为正常业务心跳回复处理，避免每 30 秒打印一次 `unknown msg type: pong`。

## 当前运行方式

### 启动后端

```bash
cd /Users/wq/ai_deploy_backend
npm run dev
```

后端端口：`8088`

就绪检查：

```bash
curl -s http://127.0.0.1:8088/api/v1/health/ready
```

### 启动管理前端

```bash
cd /Users/wq/ai_deploy_backend/admin-frontend
npm run dev
```

前端端口：`5173`

### 查询设备状态

```bash
mysql -uroot -h127.0.0.1 -P3306 xiaozhi -e "
SELECT NOW() AS db_now;
SELECT mac_address,is_online,is_paired,wechat_user_id,last_seen,
TIMESTAMPDIFF(SECOND,last_seen,NOW()) AS seconds_since_seen
FROM devices
WHERE mac_address='10:51:DB:80:E2:E8'\G"
```

## 未来计划

### 近期

- 把本地调试地址从源码常量抽到构建配置或环境配置，避免提交机器 IP。
- 小程序增加更清晰的设备上线等待状态：已配网、已注册、已绑定、已在线。
- 管理后台设备页展示 `capabilities`、`board_type`、`last_seen` 和 WebSocket 在线状态。
- 增加后端 WebSocket 心跳单元测试，覆盖 `hello`、`ping`、断线、重连。
- 给 `/api/ota/check` 增加更明确的日志，便于现场排查设备注册失败。
- 排查长时间在线稳定性：确认设备端是否继续运行、WiFi 是否掉线、WebSocket 是否被服务端或路由器关闭、重连后是否重新发送业务心跳。

### 中期

- 生产环境改为 HTTPS/WSS，固件恢复 TLS 校验和证书策略。
- 建立固件 release 流程：版本号、构建产物、OTA 包、升级回滚策略。
- 小程序支持多设备列表、解绑、设备重命名和在线状态刷新。
- 后端把设备连接态从单机内存 Map 升级为可横向扩展的连接管理方案。
- AI 对话链路端到端打通：设备 `ai_chat` -> 后端 LLM 流式响应 -> 设备端播放或显示。

### 长期

- 多租户设备分组、套餐绑定、用量统计和告警闭环。
- 设备能力模型标准化，按 `capabilities` 下发不同小程序页面和后台控制面板。
- 建立硬件联调自动化验收清单，覆盖配网、注册、绑定、心跳、OTA、AI 对话。

## 注意事项

- 当前 `192.168.1.26` 是本地联调 IP，只适用于当前局域网。
- `.env` 不应提交；生产配置应通过部署环境注入。
- 设备 WebSocket token 来自 `/api/ota/check` 返回的 `device_key`，不要在文档或日志中泄露真实 token。
- 真实 GitHub remote 不应带访问 token；本地如果发现 remote URL 带个人访问令牌，应改为普通 HTTPS 或 SSH URL。
