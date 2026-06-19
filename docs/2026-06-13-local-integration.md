# 2026-06-13 本地联调记录与后续计划

本文记录 EspLink 微信小程序、ESP32-S3 固件与小氧 AI 后端在 Mac 本地的联调状态。

> 更新：本文是 2026-06-13 的历史联调记录。最新开发状态、OTA 实机验证和剩余硬件/部署验证项见 [2026-06-16 开发状态与实机验证记录](./2026-06-16-development-status.md) 和 [Production Readiness Regression Runbook](./2026-06-16-production-readiness-regression.md)。

## 当前结论

- EspLink 仓库：`/Users/wq/EspLink`
- 后端仓库：`/Users/wq/ai_deploy_backend`
- Mac 局域网 IP：`192.168.1.26`
- 小程序 API：`http://192.168.1.26:8088`
- 固件注册接口：`http://192.168.1.26:8088/api/ota/check`
- 固件 WebSocket：由注册接口返回，当前为 `ws://192.168.1.26:8088/ws/device`
- 设备 MAC：`10:51:DB:80:E2:E8`
- 设备串口：`/dev/cu.usbmodem112301`
- 本次短时验证状态：已配网、已绑定、可注册上线、可通过 WebSocket 心跳刷新在线时间。

短时现场验证：

```text
WiFi connected: 192.168.1.32
boot register ok
WebSocket connected
hello_ack: is_bound=1
server msg: {"type":"pong"} 每 30 秒持续收到
```

后端数据库验证：

```text
mac_address        = 10:51:DB:80:E2:E8
is_online          = 1
is_paired          = 1
seconds_since_seen = 8
```

长时间复查结果：

```text
2026-06-13 17:20 复查时设备已离线：
is_online          = 0
last_seen          = 2026-06-13 16:19:09
seconds_since_seen = 3673
```

因此，本次已经跑通“配网 -> 注册 -> WebSocket -> 业务 ping/pong -> 短时在线”；长时间在线稳定性仍需要下一轮继续排查。

## 本次完成的开发

### 1. 小程序接入本地后端

`esplink-app/utils/api.js`：

```js
const BASE_URL = 'http://192.168.1.26:8088'
```

真机调试时手机必须和 Mac 在同一局域网，不能使用 `localhost`。

### 2. 固件 boot register 接入本地后端

`esplink-firmware/main/main.c`：

```c
#define BOOT_REGISTER_URL "http://192.168.1.26:8088/api/ota/check"
```

本地联调使用 HTTP，因此注册和 OTA HTTP transport 使用：

```c
HTTP_TRANSPORT_OVER_TCP
```

生产环境应切回 HTTPS/WSS，并补齐证书校验策略。

### 3. WiFi 获取 IP 后的栈溢出修复

问题日志：

```text
***ERROR*** A stack overflow in task sys_evt has been detected.
```

原因：ESP-IDF 的系统事件任务栈较小，旧代码在 `IP_EVENT_STA_GOT_IP` 回调里直接启动较重的注册和 WebSocket 流程。

修复：

- `app_wifi.c` 中新增 `wifi_conn_cb` 任务，栈 6144。
- `app_wifi.c` 中新增 `wifi_disc_cb` 任务，栈 4096。
- WiFi 事件回调只负责派发任务，不直接跑业务链路。

### 4. 每次 WiFi 上线都重新注册

旧行为：NVS 里已有 token 时，设备可能跳过 `/api/ota/check`，继续使用旧后端地址或旧 WebSocket URL。

修复：

- `on_wifi_connected()` 每次都将 `s_act_started=false`。
- 状态切到 `STATE_ACTIVATING`。
- 重新调用 `/api/ota/check`，刷新 `device_key` 和 `websocket_url`。

### 5. WebSocket 鉴权头修复

问题日志：

```text
Error read response for Upgrade header
```

原因：`Authorization` header 缺少 CRLF。

修复：

```c
snprintf(auth_header, sizeof(auth_header), "Authorization: Bearer %s\r\n", token);
```

### 6. 业务心跳修复

后端心跳任务每分钟检查一次，超过 2 分钟未更新 `last_seen` 会标记离线。固件原来只依赖 WebSocket 协议层 ping，后端业务逻辑不会据此更新设备表。

修复：

- `app_ws.c` 新增 `ws_app_ping` 任务。
- WebSocket 连接成功后启动。
- 每 30 秒发送：

```json
{"type":"ping"}
```

- 后端回复：

```json
{"type":"pong"}
```

`main.c` 已把 `pong` 作为正常消息处理，避免误报 unknown message。

## 当前刷机命令

```bash
cd /Users/wq/EspLink/esplink-firmware

/bin/zsh -lc "/bin/zsh -lc \"\
source /Users/wq/esp-idf/export.sh >/tmp/idf-export.log && \
export PATH=/Users/wq/.espressif/python_env/idf5.5_py3.13_env/bin:/Users/wq/.espressif/tools/xtensa-esp-elf/esp-14.2.0_20260121/xtensa-esp-elf/bin:\$PATH && \
python /Users/wq/esp-idf/tools/idf.py -p /dev/cu.usbmodem112301 build flash\""
```

## 当前配网和上线流程

1. 后端启动在 `192.168.1.26:8088`。
2. 小程序真机调试，API 指向 `http://192.168.1.26:8088`。
3. 设备上电。
4. 如果 NVS 中已有 WiFi 凭证，设备自动连接 WiFi。
5. 如果没有 WiFi 凭证，设备进入 BLE 配网，小程序发送 SSID 和密码。
6. 设备拿到 IP 后调用 `/api/ota/check`。
7. 后端返回 `device_key` 和 `websocket_url`。
8. 设备连接 `/ws/device`，发送 `hello`。
9. 后端返回 `hello_ack`，并将设备标记在线。
10. 设备每 30 秒发送业务 `ping`，后端回复 `pong` 并刷新在线时间。

## 2026-06-15 Cube 3D OTA Demo 验证

`/Users/wq/Workshop/MCU/claude-demos/cube_3d_v1.0` 已改造成 EspLink 的 OTA 示例固件，而不是直接发布原 demo 的 `cube_3d.bin`。

集成方式：

- `app_cube_demo.c/.h`：3D cube 渲染任务，联网注册成功后启动。
- `esp32_s3_szp.c/.h`：原 demo 的 LCD + QMI8658 BSP。
- `main.c`：保留 EspLink 唯一 `app_main`，先走 WiFi、`/api/ota/check`、WebSocket，再启动产品 demo。
- `board_config.h`：当前测试版本为 `BOARD_TYPE=esplink-v1`、`BOARD_FIRMWARE_VERSION=1.0.2`。

构建验证：

```bash
cd /Users/wq/EspLink/esplink-firmware

/bin/zsh -lc "source /Users/wq/esp-idf/export.sh >/tmp/idf-export-cube-build.log && \
export PATH=/Users/wq/.espressif/python_env/idf5.5_py3.13_env/bin:/Users/wq/.espressif/tools/xtensa-esp-elf/esp-14.2.0_20260121/xtensa-esp-elf/bin:\$PATH && \
python /Users/wq/esp-idf/tools/idf.py build"
```

结果：

- app binary size: `0x133f30`
- OTA app partition: `0x180000`
- free: `0x4c0d0`（约 20%）

本地 OTA 发布产物：

```text
/Users/wq/EspLink/esplink-firmware/build/esplink-v1-1.0.2.bin
```

发布字段：

- `board_type`: `esplink-v1`
- `version`: `1.0.2`
- `size_bytes`: `1261360`
- `sha256`: `981577fe209b70f10e8c5c127cd24906ba961fba791d0f2bc472574b5cc465b4`

已通过 USB 直接烧录验证启动：

```bash
cd /Users/wq/EspLink/esplink-firmware

/bin/zsh -lc "source /Users/wq/esp-idf/export.sh >/tmp/idf-export-cube-flash.log && \
export PATH=/Users/wq/.espressif/python_env/idf5.5_py3.13_env/bin:/Users/wq/.espressif/tools/xtensa-esp-elf/esp-14.2.0_20260121/xtensa-esp-elf/bin:\$PATH && \
python /Users/wq/esp-idf/tools/idf.py -p /dev/cu.usbmodem111301 flash"
```

串口确认：

```text
main: === device boot: board=esplink-v1 fw=1.0.2 ===
```

当前硬件状态：

- 设备 MAC: `10:51:db:80:e2:e8`
- 设备未保存 WiFi 凭据时会进入 BLE 配网。
- cube demo 当前设计为 online 后启动，所以没有 WiFi 凭据时不会显示 cube。

测试阶段自动联网：

- 已支持本地测试 WiFi 注入方式，跳过 BLE 配网。
- `BOOT_REGISTER_URL` 已改为 Kconfig 配置项：`CONFIG_ESPLINK_BOOT_REGISTER_URL`。
- 自动联网开关为 `CONFIG_ESPLINK_TEST_AUTO_WIFI`，默认关闭。
- WiFi SSID/密码放在 `esplink-firmware/main/local_wifi_config.h`，该文件已被 Git 忽略；模板为 `local_wifi_config.example.h`。
- 下一轮硬件验证：启动 → 自动联网 → `/api/ota/check` → WebSocket hello → cube demo 启动。

## 后续计划

### 近期

- 测试阶段自动联网完整链路已验证通过：无需 BLE 配网即可启动 cube demo。
- OTA 真机升级闭环已验证通过：`esplink-v1` 从 `1.0.2` 升级到 `1.0.3`。
- 生产设备 PSK 签名接入固件启动注册。
- 当前仓库 `.env`、数据库、Redis、前端和后端部署配置收口。
- 小程序增加设备上线等待页，明确显示配网成功、注册中、绑定中、在线。
- 小程序设备列表展示在线状态、固件版本、设备名称。
- 增加固件串口日志级别开关，避免 release 版本输出过多调试日志。
- 给 WebSocket 心跳增加失败计数和更清晰的重连状态。
- 排查长时间在线稳定性：确认设备端是否继续运行、WiFi 是否掉线、WebSocket 是否被服务端或路由器关闭、重连后是否重新发送业务心跳。

### 中期

- OTA 失败回滚和下载中断恢复测试。
- 生产环境切换到 HTTPS/WSS，固件补证书和域名校验。
- 支持多设备绑定、解绑、重命名。
- 固件能力上报标准化：`board_type`、`firmware_version`、`capabilities`。
- 端到端打通 AI 对话消息：设备发送 `ai_chat`，接收 `ai_chunk` 和 `ai_done`。

### 长期

- 支持更多 ESP32-S3 板型和产品页面路由。
- 增加硬件产测模式：BLE、WiFi、WebSocket、OTA、按键、屏幕/音频等项目。
- 建立固件 release 流程：版本号、变更记录、二进制产物、OTA manifest。

## 注意事项

- `192.168.1.26` 只适用于本地局域网联调。
- 设备串口 `/dev/cu.usbmodem112301` 可能随拔插变化，刷机前先确认。
- 微信小程序 BLE 必须真机调试，模拟器不可用。
- Git remote 不应保存个人访问令牌；使用普通 HTTPS 或 SSH URL。
