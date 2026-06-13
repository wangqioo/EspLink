# 2026-06-13 本地联调记录与后续计划

本文记录 EspLink 微信小程序、ESP32-S3 固件与小氧 AI 后端在 Mac 本地的联调状态。

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

## 后续计划

### 近期

- 将 `BOOT_REGISTER_URL` 从源码常量改为构建配置，区分 local、staging、production。
- 小程序增加设备上线等待页，明确显示配网成功、注册中、绑定中、在线。
- 小程序设备列表展示在线状态、固件版本、设备名称。
- 增加固件串口日志级别开关，避免 release 版本输出过多调试日志。
- 给 WebSocket 心跳增加失败计数和更清晰的重连状态。
- 排查长时间在线稳定性：确认设备端是否继续运行、WiFi 是否掉线、WebSocket 是否被服务端或路由器关闭、重连后是否重新发送业务心跳。

### 中期

- 接入 OTA 版本检查、下载、升级和失败回滚。
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
