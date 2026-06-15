# 2026-06-16 开发状态与实机验证记录

本文是 EspLink 当前开发状态的最新入口，覆盖本地后端、管理后台、ESP32-S3 固件、微信小程序和 OTA 验证。

## 当前项目边界

- 主仓库：`/Users/wq/EspLink`
- 后端：`/Users/wq/EspLink/backend`
- 管理后台：`/Users/wq/EspLink/backend/admin-frontend`
- 微信小程序：`/Users/wq/EspLink/esplink-app`
- 固件：`/Users/wq/EspLink/esplink-firmware`
- 旧后端：`/Users/wq/ai_deploy_backend` 只作为历史环境来源，本地验证时临时复用了其中 `.env`，业务代码已合入当前仓库。

本地实测网络：

- Mac 局域网 IP：`192.168.1.26`
- 后端 HTTP：`http://192.168.1.26:8088`
- 设备 WebSocket：`ws://192.168.1.26:8088/ws/device`
- ESP32-S3 串口：`/dev/cu.usbmodem111301`
- 设备 MAC：`10:51:DB:80:E2:E8`
- 设备 IP：`192.168.1.32`

## 已验证主链路

### 1. 自动联网测试链路

固件支持测试阶段跳过 BLE 配网：

- `CONFIG_ESPLINK_TEST_AUTO_WIFI`：默认关闭。
- `esplink-firmware/main/local_wifi_config.h`：本地 WiFi 凭据文件，已被 Git 忽略。
- `CONFIG_ESPLINK_BOOT_REGISTER_URL`：启动注册 URL，当前默认 `http://192.168.1.26:8088/api/ota/check`。

2026-06-16 实测通过：

```text
test auto WiFi enabled, writing local SSID to NVS
saved wifi: "1-306", connecting
app_wifi: got IP: 192.168.1.32
boot register ok, is_bound=1
app_ws: WebSocket connected
server msg: {"type":"hello_ack","is_bound":true}
```

### 2. 后端注册与 WebSocket 在线

设备上电后调用：

```text
POST /api/ota/check
```

后端返回：

- `token`：设备 WebSocket 认证用 `device_key`
- `websocket_url`：`ws://192.168.1.26:8088/ws/device`
- `ota`：有新固件时返回升级包信息

设备随后连接 `/ws/device`，发送 `hello`，后端返回 `hello_ack` 并更新在线状态。

数据库确认：

```text
mac_address        = 10:51:DB:80:E2:E8
board_type         = esplink-v1
firmware           = 1.0.3
is_online          = 1
wechat_user_id     = 2
device_key_prefix  = f9f09373c3df
```

### 3. OTA 真升级闭环

2026-06-16 完成真实 OTA 验证：

- 基线固件：`esplink-v1 / 1.0.2`
- 目标固件：`esplink-v1 / 1.0.3`
- 发布记录 ID：`3`
- 固件 URL：`http://192.168.1.26:8088/firmware/esplink-v1-1.0.3.bin`
- SHA256：`475c032834fb9f92373c848ca999416018a11d10cad395874f75fc5648aae1bb`
- 大小：`1261392` bytes
- 写入分区：`ota_0`

关键串口日志：

```text
main: === device boot: board=esplink-v1 fw=1.0.2 ===
main: OTA available, upgrading...
app_ota: OTA target url=http://192.168.1.26:8088/firmware/esplink-v1-1.0.3.bin
app_ota: OTA target version=1.0.3 force=0 size=1261392
esp_https_ota: Writing to <ota_0> partition at offset 0x1a0000
app_ota: OTA success, restarting
boot: Loaded app from partition at offset 0x1a0000
main: === device boot: board=esplink-v1 fw=1.0.3 ===
main: boot register ok, is_bound=1
app_ws: WebSocket connected
main: hello_ack: is_bound=1
```

后端日志确认：

```text
POST /api/ota/check 200
GET /firmware/esplink-v1-1.0.3.bin 200
POST /api/ota/check 200
WS device connected: 10:51:DB:80:E2:E8
```

## 本地运行方式

### 后端

当前仓库还没有提交真实 `.env`。本地验证临时复用旧后端环境变量：

```bash
cd /Users/wq/EspLink/backend
set -a
source /Users/wq/ai_deploy_backend/.env
set +a
export WS_BASE_URL=ws://192.168.1.26:8088
export PUBLIC_BASE_URL=http://192.168.1.26:8088
npm start
```

验证 ready：

```bash
curl --noproxy '*' -s http://127.0.0.1:8088/api/v1/health/ready
```

期望：

```json
{"code":0,"data":{"db":true,"redis":true},"message":"ready"}
```

### 固件构建和烧录

```bash
cd /Users/wq/EspLink/esplink-firmware
source /Users/wq/esp-idf/export.sh
idf.py build
idf.py -p /dev/cu.usbmodem111301 flash monitor
```

需要测试自动联网时：

```bash
cp main/local_wifi_config.example.h main/local_wifi_config.h
idf.py menuconfig
```

在 menuconfig 中打开：

```text
EspLink -> Enable local test WiFi injection
```

测试结束后，提交前必须确认：

```bash
git status --short
```

`sdkconfig` 中应恢复为：

```text
# CONFIG_ESPLINK_TEST_AUTO_WIFI is not set
```

### 固件发布

管理后台发布路径：

```text
http://127.0.0.1:8088
```

API 路径：

- 上传二进制：`POST /api/v1/firmware/artifacts`
- 创建发布：`POST /api/v1/firmware/releases`
- 设备检查：`POST /api/ota/check`
- 固件下载：`GET /firmware/<filename>.bin`

发布字段：

```json
{
  "board_type": "esplink-v1",
  "version": "1.0.3",
  "artifact_url": "http://192.168.1.26:8088/firmware/esplink-v1-1.0.3.bin",
  "sha256": "475c032834fb9f92373c848ca999416018a11d10cad395874f75fc5648aae1bb",
  "size_bytes": 1261392,
  "channel": "stable",
  "is_active": true,
  "force_update": false
}
```

## 当前剩余工作

### 必做

- 生产设备签名：后端已有 `REQUIRE_DEVICE_PSK=true` 校验入口，但固件启动注册尚未携带 `timestamp`、`nonce`、`signature`。
- HTTPS/WSS：生产环境需要固件证书校验，关闭 HTTP OTA。
- Repo-local `.env` 流程：当前本地验证仍复用旧后端 `.env`，应整理当前仓库自己的 `.env`、`.env.example` 和部署配置。
- OTA 完整性校验：后端返回 SHA256，固件当前只记录日志，生产前需要在设备端严格校验下载产物。

### 建议继续验证

- 强制升级：`force_update=true`。
- 错误 bin：上传非 ESP32-S3 app、空 bin、超大 bin。
- 下载中断：后端中断、WiFi 断开、重启后恢复。
- 回滚策略：OTA boot fail 后的恢复路径。
- 长时间在线：后端重启、路由器断开、WebSocket 重连、业务心跳稳定性。

### 体验优化

- 管理后台固件发布页面增加重复版本提示、旧版本停用快捷操作、发布后 OTA check 预览。
- 小程序设备列表显示在线状态、固件版本、板型和绑定状态。
- 配网页面输入框渲染问题仍需修复，SSID 自动填充暂缓。

## 提交注意

不要提交：

- `backend/.env`
- `backend/uploads/`
- `esplink-firmware/main/local_wifi_config.h`
- 任意包含 WiFi 密码、数据库密码、JWT secret 的文件

可以提交：

- 文档
- `.env.example`
- `local_wifi_config.example.h`
- 固件源码、后端源码、前端源码
