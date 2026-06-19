# 2026-06-16 开发状态与实机验证记录

本文是 EspLink 当前开发状态的最新入口，覆盖本地后端、管理后台、ESP32-S3 固件、微信小程序和 OTA 验证。

## 当前项目边界

- 主仓库：`/Users/wq/EspLink`
- 后端：`/Users/wq/EspLink/backend`
- 管理后台：`/Users/wq/EspLink/backend/admin-frontend`
- 微信小程序：`/Users/wq/EspLink/esplink-app`
- 固件：`/Users/wq/EspLink/esplink-firmware`
- 旧后端：`/Users/wq/ai_deploy_backend` 只作为历史环境来源，业务代码已合入当前仓库；本地验证应使用当前仓库的 `backend/.env.example` 创建 `.env`。

本地实测网络：

- Mac 局域网 IP：`192.168.1.26`
- 后端 HTTP：`http://192.168.1.26:8088`
- 设备 WebSocket：`ws://192.168.1.26:8088/ws/device`
- ESP32-S3 串口：`/dev/cu.usbmodem112301`
- 设备 MAC：`10:51:DB:80:E2:E8`
- 设备 IP：`192.168.1.32`

## 2026-06-17 交接记录

今天继续做生产化回归和真机 OTA 验证，后端、上传校验、小程序配网页面回归已经推进完成，真机强制 OTA 暴露了两个固件侧问题，明天优先修复。

已完成：

- 云端和本地已同步：`main` 与 `origin/main` 同步，最近提交已推送到 GitHub。
- 后端 OTA 决策已补回归：`force_update=true` 时，即使目标版本等于当前版本也会返回 OTA envelope。
- 后端固件上传已补防护和测试：拒绝非 `.bin`、空文件、首字节不是 ESP image magic `0xE9`、超过 `FIRMWARE_UPLOAD_MAX_BYTES` 的上传。
- 微信小程序配网页面已补静态回归：输入框渲染稳定，SSID 自动填充重新接入配网流程。
- 真机基础链路仍可跑通：ESP32-S3 能连接本地后端、完成启动注册、拿到 WebSocket token 并上线。

真机强制 OTA 发现的问题：

- OTA app 未确认有效：设备从 OTA 分区启动后没有调用 `esp_ota_mark_app_valid_cancel_rollback()`，再次 OTA 时会触发 `ESP_ERR_OTA_ROLLBACK_INVALID_STATE`。
- SHA256 校验口径不一致：后端发布记录保存的是上传 `.bin` 文件 SHA256，固件当前使用 `esp_partition_get_sha256()` 得到的是 ESP image digest，两者不相等，导致正确 OTA 包被误判为 `OTA SHA256 mismatch`。

明天继续：

- 在固件中新增 OTA app valid 标记逻辑，建议在启动注册成功、设备确认可上线后调用。
- 将固件 OTA SHA256 校验改为按 `size_bytes` 从目标启动分区读取原始 artifact bytes，并计算 raw SHA256，与后端发布记录保持同一口径。
- 为上述两个约束补固件静态回归测试，随后重新构建固件。
- 发布新的 `esplink-v1` OTA 测试版本，执行一次普通 OTA 和一次同版本 `force_update=true` OTA。
- 测试结束后确认发布记录 `force_update=false`，避免设备反复升级。

## 2026-06-17 继续开发记录

已完成：

- 固件 OTA app valid 确认已实现：新增 `app_ota_mark_running_valid()`，当前 OTA app 处于 `ESP_OTA_IMG_PENDING_VERIFY` 时调用 `esp_ota_mark_app_valid_cancel_rollback()`。
- 启动注册流程已调整：启动注册 HTTP 成功且响应 JSON 可解析后，先确认当前 OTA app valid，再处理服务端返回的 OTA envelope，避免同版本强制 OTA 在 pending verify 状态下被 IDF 拒绝。
- 固件 OTA SHA256 校验已改为后端 artifact 口径：按 `size_bytes` 从目标启动分区读取原始 bytes，用 mbedTLS SHA256 计算 digest，再与后端发布记录的上传 `.bin` SHA256 对比。
- 固件版本已升到 `1.0.4`，用于下一轮 OTA 回归。
- 新增固件源码契约测试：覆盖 OTA valid 标记、valid-before-OTA 顺序、raw artifact SHA256 校验口径。
- 本地后端已准备 `esplink-v1 / 1.0.4` 发布记录：
  - URL：`http://192.168.1.26:8088/firmware/esplink-v1-1.0.4.bin`
  - SHA256：`d4cf96af27893672d138e640b51c238dab62110453f4df26cce0e90400ec20bb`
  - 大小：`1265440` bytes
  - `force_update=false`

已验证：

```bash
node --test esplink-firmware/tests/otaContract.test.js
```

结果：4 个测试全部通过。

```bash
cd esplink-firmware
source /Users/wq/esp-idf/export.sh
idf.py build
```

结果：构建通过，`esp32s3_device.bin` 大小 `0x134f20`，OTA 分区剩余 `0x4b0e0` bytes。

```bash
cd backend
npm test -- otaCheckService.test.js firmwareRoutes.test.js --runInBand
```

结果：2 个 suite、23 个测试全部通过。沙箱内会因 supertest 监听本地端口报 `EPERM`，需要在非沙箱环境运行。

真机回归结果：

- 正确 ESP32-S3 串口为 `/dev/cu.usbmodem112301`；`/dev/cu.usbmodem11301` 是非目标 CDC ACM 端口。
- 普通 OTA 已通过：临时刷入 `fw=1.0.3` 后，设备从后端获取 `1.0.4` OTA envelope，下载新 artifact，校验 raw SHA256 `d4cf96af27893672...`，写入 `ota_0` 并重启到 `fw=1.0.4`。
- 同版本强制 OTA 已通过：短暂设置发布记录 `force_update=true` 后，运行中的 `fw=1.0.4` 设备仍获取 OTA envelope，写入另一 OTA 分区，校验同一 raw SHA256 并重启成功。
- OTA app valid 已验证：新 OTA app 启动后输出 `app_ota: OTA app marked valid`，随后启动注册成功并连接 WebSocket。
- 测试结束后发布记录已恢复 `force_update=false`，设备最终停在正常在线状态。

关键串口日志：

```text
main: OTA available, upgrading...
app_ota: OTA target version=1.0.4 force=1 size=1265440
app_ota: OTA target sha256 d4cf96af27893672...
esp_https_ota: Writing to <ota_1> partition at offset 0x320000
app_ota: OTA artifact SHA256 verified d4cf96af27893672...
app_ota: OTA success, restarting
boot: Loaded app from partition at offset 0x320000
main: === device boot: board=esplink-v1 fw=1.0.4 ===
app_ota: OTA app marked valid
main: boot register ok, is_bound=1
app_ws: WebSocket connected
main: hello_ack: is_bound=1
```

## 2026-06-18 交接与明日开发计划

当前状态：

- 云端和本地已同步：`main` 与 `origin/main` 同步，最新提交包含固件 OTA valid、raw SHA256 校验、注册响应缓冲区扩容、OTA 回归文档更新。
- 真机 OTA 主链路已闭环：普通 OTA 和同版本 `force_update=true` OTA 都已通过，设备最终运行 `fw=1.0.4` 并正常 WebSocket 上线。
- 本地 OTA 发布记录 `esplink-v1 / 1.0.4` 已恢复 `force_update=false`，避免设备反复升级。
- 本地后端验证结束后已停止，`8088` 端口不应被继续占用。

明日优先级：

1. OTA 结果上报闭环。
   - 固件在 OTA 开始、下载失败、SHA mismatch、写入成功、重启前上报事件。
   - 后端新增 OTA attempt/result 记录，至少能按设备、版本、release id 查询最近一次 OTA 状态。
   - 管理端固件发布详情页展示成功/失败次数和最近失败原因。

2. 管理后台设备视图完善。
   - 设备列表展示 `firmware`、`board_type`、在线状态、最近心跳、绑定用户。
   - 设备详情页展示 capability、最近 WebSocket 连接、最近 OTA 记录。
   - 为强制升级增加明显确认，避免误开 `force_update=true` 后造成循环升级。

3. 微信小程序设备状态页。
   - 展示设备在线/离线、固件版本、板型、最近上线时间。
   - 配网页面继续保持当前稳定输入框回归，新增配网失败提示和重试入口。
   - 不在小程序暴露 OTA 管理权限，只展示只读状态。

4. 生产签名模式回归。
   - 使用 `REQUIRE_DEVICE_PSK=true` 和固件 `CONFIG_ESPLINK_BOOT_SIGNATURE_REQUIRED=y` 做一次真机 signed boot。
   - 覆盖错误 PSK、过期 timestamp、nonce replay 三类失败路径。
   - 将签名模式的本地准备步骤补进 runbook，避免依赖口头记忆。

5. 负向 OTA 硬件用例。
   - wrong SHA256：确认设备拒绝错误 artifact，且不切换到不可信镜像。
   - interrupted download：下载中断后设备能回到当前有效固件。
   - wrong board / older version：后端不返回 OTA envelope，设备保持正常上线。

明日启动建议：

```bash
cd /Users/wq/EspLink
git pull --ff-only
cd backend
npm start
```

真机串口使用：

```bash
cd /Users/wq/EspLink/esplink-firmware
source /Users/wq/esp-idf/export.sh
idf.py -p /dev/cu.usbmodem112301 monitor
```

## 2026-06-18 继续开发记录

已完成 OTA 结果上报闭环的首个垂直切片：

- 后端新增 `firmware_ota_attempts` 数据模型和 SQL migration，用于记录设备 OTA attempt/result。
- 新增 `/api/ota/result` 设备上报入口，沿用启动注册身份校验；设备可上报 `started`、`success`、`download_failed`、`sha_mismatch` 等状态。
- OTA envelope 新增 `release_id` 和 `result_url`，固件可把结果关联回具体固件发布。
- 固件 OTA 流程已在开始下载、下载失败、SHA mismatch、成功重启前上报结果；上报失败只记录 warning，不阻塞 OTA 主流程。
- 管理后台固件发布列表新增 `OTA 结果` 列，展示成功数、失败数、进行中数和最近失败原因。

已验证：

```bash
cd backend
npm test -- otaResultService.test.js otaCheckRoute.test.js firmwareReleaseService.test.js otaCheckService.test.js firmwareRoutes.test.js --runInBand
```

结果：5 个 suite、42 个测试全部通过。

```bash
node --test esplink-firmware/tests/otaContract.test.js
```

结果：5 个固件契约测试全部通过。

```bash
cd esplink-firmware
source /Users/wq/esp-idf/export.sh
idf.py build
```

结果：构建通过，`esp32s3_device.bin` 大小 `0x135360`，OTA 分区剩余 `0x4aca0` bytes。

```bash
cd backend/admin-frontend
npm run build
```

结果：构建通过；Vite 仍提示主 chunk 超过 500 KB，这是当前后台已有体积问题，不影响本次功能。

下一步：

- 对本地数据库执行 `backend/db/migrations/2026-06-18-create-firmware-ota-attempts.sql` 或 `npx prisma db push`。
- 发布包含 OTA 上报的新固件版本，执行一次真机 OTA，确认 `firmware_ota_attempts` 写入 `started` 和 `success`。
- 继续完善管理后台设备详情页，把最近 OTA attempt 挂到设备维度。
- 增加 wrong SHA256 真机负向测试，确认上报 `sha_mismatch` 且设备不切换不可信镜像。

## 2026-06-19 继续开发记录

已完成 OTA 结果上报的真机正向验证：

- 本地数据库已执行 Prisma schema sync，`firmware_ota_attempts` 表可写入。
- 发布本地 `esplink-v1 / 1.0.5` OTA 记录：
  - URL：`http://192.168.1.26:8088/firmware/esplink-v1-1.0.5.bin`
  - SHA256：`56b60bf1bf5b1e391e2476416b40a14565a6b19b38c5c9a537bf3222fbe1f1ed`
  - 大小：`1266528` bytes
  - `force_update=false`
- 真机已从 `1.0.4` 升级到 `1.0.5`，数据库记录 `release_id=5`、`from_version=1.0.4`、`target_version=1.0.5`、`status=success`、`bytes_written=1266528`。
- 板子当前运行 `fw=1.0.5`，已完成启动注册、WebSocket `hello_ack`，3D cube demo 正常启动。
- 由于当前设备此前已选中 OTA 分区，重新刷 factory app 后仍会优先从 OTA 分区启动；需要强制重跑完整升级路径时，应先清理 `otadata` 或设置一次更高版本发布。
- `idf.py flash` 在 `/dev/cu.usbmodem112301` 上偶发串口读取失败，本次使用低速 no-stub `esptool.py write_flash` 完成刷写，Hash verified。

关键数据库记录：

```json
{
  "mac_address": "10:51:DB:80:E2:E8",
  "from_version": "1.0.4",
  "target_version": "1.0.5",
  "status": "success",
  "bytes_written": 1266528,
  "started_at": "2026-06-19T04:03:35.000Z",
  "finished_at": "2026-06-19T04:03:45.000Z"
}
```

下一步：

- 管理后台设备详情页展示最近 OTA attempt 和 WebSocket 在线状态。
- 增加 wrong SHA256 真机负向测试，确认固件上报 `sha_mismatch` 且不切换不可信镜像。
- 增加 interrupted download 真机负向测试，确认固件保持当前有效版本并记录失败原因。
- 生产签名模式真机回归：`REQUIRE_DEVICE_PSK=true` + `CONFIG_ESPLINK_BOOT_SIGNATURE_REQUIRED=y`。
- 准备下一版验证固件时，建议使用 `1.0.6`，避免与已验证的 `1.0.5` 发布记录混淆。

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

```bash
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

期望：

```json
{"code":0,"data":{"db":true,"redis":true},"message":"ready"}
```

### 固件构建和烧录

```bash
cd /Users/wq/EspLink/esplink-firmware
source /Users/wq/esp-idf/export.sh
idf.py build
idf.py -p /dev/cu.usbmodem112301 flash monitor
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

- 生产设备签名：后端已有 `REQUIRE_DEVICE_PSK=true` 校验入口，固件已支持携带 `timestamp`、`nonce`、`signature`；仍需实机验证生产 PSK 配置。
- HTTPS/WSS：生产环境需要固件证书校验，关闭 HTTP OTA。
- Repo-local `.env` 流程：已补 `backend/.env.example`，本地验证应从当前仓库复制 `.env` 并填写数据库、Redis、`WS_BASE_URL` 和 `PUBLIC_BASE_URL`。
- OTA 完整性校验：正确 SHA256 接受路径已完成真机验证；错误 SHA256 拒绝路径仍需负向验证。
- OTA 回滚确认：OTA app valid 和 forced OTA 正向路径已完成真机验证；boot fail 后的自动回滚路径仍需负向验证。

### 建议继续验证

- 生产化回归：按 [Production Readiness Regression Runbook](./2026-06-16-production-readiness-regression.md) 验证签名注册、SHA256 OTA、断线恢复。
- 强制升级：`force_update=true` 服务端决策已补自动化测试；真机执行已暴露固件回滚确认问题，需先修复再复测。
- 错误 bin：空 bin、非 ESP image、超大 bin 已补上传接口自动化测试；非 ESP32-S3 app 和 boot fail 仍需真机验证。
- 下载中断：后端中断、WiFi 断开、重启后恢复，按 runbook 真机执行。
- 回滚策略：OTA boot fail 后的恢复路径，按 runbook 真机执行。
- 长时间在线：后端重启、路由器断开、WebSocket 重连、业务心跳稳定性。

### 体验优化

- 管理后台固件发布页面增加重复版本提示、旧版本停用快捷操作、发布后 OTA check 预览。
- 小程序设备列表显示在线状态、固件版本、板型和绑定状态。
- 配网页面输入框渲染已做稳定布局修复并增加静态回归测试；SSID 自动填充已重新接入配网流程。两项仍需微信开发者工具和 iOS 真机复测。

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
