# EspLink

**ESP32-S3 设备上云平台 — Node 后端 + 管理后台 + 微信小程序 + 固件**

通过微信小程序扫描附近蓝牙设备，用 BluFi 协议把 WiFi 凭证推送给 ESP32-S3；设备联网后接入本地/云端后端，完成设备注册、微信账号绑定、WebSocket 在线状态、固件发布、OTA 升级和 OTA 结果上报。

最新开发状态、OTA 实机验证和剩余工作见：[2026-06-16 开发状态与实机验证记录](./docs/2026-06-16-development-status.md)。

生产安全策略见：[2026-06-19 Production Security Design](./docs/2026-06-19-production-security-design.md)。

历史本地联调记录见：[2026-06-13 本地联调记录与后续计划](./docs/2026-06-13-local-integration.md)。

```
管理后台 Web  ──→  Node 后端/API/WebSocket/OTA
                         ▲
                         │ WiFi + HTTP/WebSocket
手机微信小程序 ──BLE──→ ESP32-S3 固件
```

---

## 仓库结构

```
EspLink/
├── backend/              # 正式后端：Node/Express API + WebSocket + React 管理后台
│   ├── src/              # API、设备 WebSocket、OTA、业务服务
│   ├── prisma/           # 数据库 schema
│   ├── db/               # 数据库脚本和迁移记录
│   └── admin-frontend/   # React + Ant Design 管理后台
│
├── esplink-app/          # 微信小程序（配网客户端）
│   ├── pages/
│   │   ├── index/        # 我的设备列表（在线、固件、板型、绑定状态）
│   │   ├── scan/         # 蓝牙扫描
│   │   ├── provision/    # 配网流程（连接 → 填写 WiFi → 发送）
│   │   └── success/      # 配网成功页
│   ├── utils/
│   │   ├── api.js        # 后端 API 封装
│   │   ├── ble.js        # 微信 BLE API 封装
│   │   ├── blufi.js      # BluFi 协议帧构造 & 解析
│   │   └── device-page-registry.js # 产品页路由
│   ├── app.js
│   └── project.config.json
│
└── esplink-firmware/     # ESP32-S3 固件（IDF 5.x）
    ├── main/
    │   ├── main.c        # 入口，状态机（未配网 / 配网中 / 已联网）
    │   ├── app_blufi.c   # BluFi 事件处理，发送 WiFi 结果通知
    │   ├── app_wifi.c    # WiFi 连接管理
    │   ├── app_button.c  # BOOT 键：长按 5 秒恢复出厂
    │   ├── app_nvs.c     # NVS 持久化（WiFi 凭证）
    │   ├── app_ota.c     # OTA 升级
    │   ├── app_ws.c      # WebSocket 设备连接
    │   └── app_cube_demo.c # 3D cube OTA 示例产品模块
    ├── CMakeLists.txt
    ├── partitions.csv
    └── sdkconfig.defaults
```

---

## 快速开始

### 后端与管理后台（backend）

**环境要求**
- Node.js 18+
- npm
- 可用数据库配置（见 `backend/.env.example`）

**安装与启动**

```bash
cd backend
cp .env.example .env
# 编辑 .env：DATABASE_URL、REDIS_HOST、JWT_SECRET、ADMIN_PASSWORD、WS_BASE_URL、PUBLIC_BASE_URL
npm install
npm run db:generate
npm test
npm run dev
```

硬件联调时，`WS_BASE_URL` 和 `PUBLIC_BASE_URL` 必须使用 ESP32 能访问到的 Mac 局域网地址，例如
`ws://192.168.1.26:8088` 和 `http://192.168.1.26:8088`。

管理后台：

```bash
cd backend/admin-frontend
npm install
npm run build
npm run dev
```

主要能力：

- 设备启动注册：`POST /api/ota/check`
- 设备 WebSocket：`/ws/device`
- 固件上传：`POST /api/v1/firmware/artifacts`
- 固件发布：`POST /api/v1/firmware/releases`
- 管理后台固件发布页面：上传 `.bin` 后自动填入 URL、SHA256 和大小
- OTA 真机升级闭环：已实测普通 OTA、同版本强制 OTA、wrong SHA 拒绝、下载中断恢复和 OTA 结果上报；当前固件版本为 `esplink-v1 / 1.0.5`
- 生产签名：启动注册和 OTA 结果上报均支持 `timestamp/nonce/signature` HMAC-SHA256，`REQUIRE_DEVICE_PSK=true` 已做本地硬件验证

### 固件（esplink-firmware）

**环境要求**
- ESP-IDF 5.1+（推荐 5.3）
- 芯片：ESP32-S3
- 烧录接口：USB-JTAG 或 UART

**编译 & 烧录**

```bash
cd esplink-firmware

# 首次需配置目标芯片
idf.py set-target esp32s3

# 编译
idf.py build

# 烧录（将 /dev/ttyUSB0 替换为实际串口）
idf.py -p /dev/ttyUSB0 flash monitor
```

**验证运行**

串口输出应出现：
```
I (xxx) BLUFI: BLE started, advertising as "Device-XXXX"
```

此时设备进入待配网状态，蓝牙广播名称格式为 `Device-` + MAC 后 4 位。

**恢复出厂设置**

长按 BOOT 键（GPIO 0）**5 秒**，NVS 中的 WiFi 凭证被清除，设备重启重新进入待配网状态。

**测试阶段自动联网**

默认固件仍走正常 BLE 配网。需要跳过配网做本地硬件 demo 时，创建本地 WiFi 配置文件并打开 Kconfig 开关：

```bash
cd esplink-firmware
cp main/local_wifi_config.example.h main/local_wifi_config.h

# 编辑 main/local_wifi_config.h，填入本地 SSID/密码
idf.py menuconfig
# EspLink → Enable local test WiFi injection
# EspLink → Boot register URL
idf.py build flash monitor
```

`main/local_wifi_config.h` 已被 Git 忽略，WiFi 密码不得提交。开关关闭时，固件行为恢复为“有 NVS WiFi 就自动连接，没有就 BLE 配网”。

---

### 小程序（esplink-app）

**环境要求**
- [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html) 1.06+
- 微信开发者账号（AppID 请自行填写，或向项目管理员获取）

**导入项目**

1. 打开微信开发者工具 → 导入项目
2. 项目目录选择 `esplink-app/`
3. AppID 填入你的小程序 AppID（或使用测试号）
4. 真机调试需开启**蓝牙权限**和**位置权限**（WiFi SSID 读取依赖 `scope.userLocation`）

**调试建议**

- BLE 功能必须在真机上测试，模拟器不支持蓝牙
- 真机预览：开发者工具 → 真机调试 / 预览
- Console 日志可在开发者工具调试面板查看

---

## BluFi 协议说明

EspLink 使用乐鑫官方 [BluFi 协议](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-guides/blufi.html) 通过 BLE 传输 WiFi 凭证。

**帧格式**

```
[ type:1 ][ frame_ctrl:1 ][ seq:1 ][ data_len:1 ][ data:N ]

type = (subtype << 2) | frameType
```

**关键 subtype 值**（与 `blufi_int.h` 对应）

| 用途 | subtype | 类型 |
|------|---------|------|
| 发送 STA SSID | `0x02` | Data Frame |
| 发送 STA 密码 | `0x03` | Data Frame |
| 指令：连接 AP | `0x03` | Ctrl Frame |
| Notify：WiFi 结果 | `0x0f` | Data Frame（设备 → 手机）|

> **注意**：上述值已与 ESP-IDF `blufi_int.h` 核对，是导致配网超时最常见的错误来源。如需移植到其他协议栈，务必重新核对。

**配网流程时序**

```
手机                              ESP32-S3
 │── BLE Connect ─────────────────→ │
 │── Get Services ─────────────────→ │
 │── Get Characteristics ──────────→ │
 │── Subscribe Notify ──────────────→ │
 │                                    │
 │── Write: STA SSID (0x02) ─────────→ │
 │── Write: STA Password (0x03) ─────→ │
 │── Write: Connect AP (Ctrl 0x03) ──→ │
 │                                    │ WiFi 连接中...
 │←── Notify: WiFi Result (0x0f) ────  │
 │    success=true / false             │
```

---

## 已知问题

| 问题 | 状态 | 说明 |
|------|------|------|
| provision 页面 WiFi 名称 / 密码输入框不显示内容 | 已修复，待微信开发者工具和 iOS 真机复测 | 已为原生 `<input>` 固定高度、行高、背景和块级布局，并增加静态回归测试 |
| SSID 自动填充 | 已接入，待微信开发者工具和 iOS 真机复测 | 进入配网填写页后自动读取当前 WiFi SSID；读取失败或未授权时静默保留手动输入 |
| 生产设备签名 | 已接入并完成本地硬件验证 | 固件 `/api/ota/check` 和 `/api/ota/result` 均支持 `timestamp/nonce/signature` HMAC-SHA256 |
| OTA SHA256 严格校验 | 已接入并完成 wrong SHA 真机验证 | 固件按后端 artifact 原始 bytes SHA256 校验，不匹配则拒绝重启并恢复当前运行分区 |
| Boot-fail OTA 自动回滚 | 已完成真机验证 | 2026-06-20 使用临时 `1.0.8` 崩溃镜像验证 bootloader 回滚到 `1.0.5` |
| HTTPS/WSS 真域名链路 | 待部署环境 | 需要真实域名、证书和反向代理；本地 HTTP 环境不能验证 |

---

## 开发路线图

### 当前（底子阶段）

- [x] BLE 扫描 & 设备发现
- [x] BluFi 协议帧构造 & 解析（已修复全部 subtype 错误）
- [x] WiFi 凭证推送 & 固件端连接
- [x] 配网成功 / 失败通知（Notify 回调）
- [x] NVS 持久化 WiFi 凭证
- [x] 恢复出厂设置（长按 5 秒）
- [x] 测试阶段自动联网配置（本地 ignored WiFi 文件 + Kconfig 开关）
- [x] 后端固件上传与发布 API
- [x] 管理后台固件发布页面
- [x] OTA 真机升级闭环验证（当前已验证到 `1.0.5`）
- [x] 3D cube demo 接入 EspLink 固件启动链路
- [x] provision 页面输入框渲染 bug 修复（待微信开发者工具和 iOS 真机复测）
- [x] 小程序已绑定设备列表（在线状态、固件版本、板型、绑定状态）
- [x] 配网页面失败态与重试入口

### 近期目标

- [x] 生产设备 PSK 签名接入固件启动注册
- [x] OTA 结果上报签名接入
- [x] 当前仓库 `.env`、数据库、Redis、前端和后端部署配置收口
- [x] OTA 下载 SHA256 严格校验
- [x] 强制 OTA、错误 SHA、下载中断恢复回归测试
- [x] provision 页面输入框渲染 bug 修复（待微信开发者工具和 iOS 真机复测）
- [x] SSID 自动填充（待微信开发者工具和 iOS 真机复测）
- [x] 多设备管理（小程序端支持已绑定设备列表）
- [x] Boot-fail OTA 自动回滚硬件验证
- [x] 后端重启 / WebSocket 恢复硬件验证
- [ ] HTTPS/WSS 真域名证书环境验证
- [ ] 配网二维码快速模式（无需蓝牙扫描）

### 中期目标

- [x] 小程序端展示设备状态（在线 / 离线 / 固件版本 / 板型 / 绑定状态）
- [ ] 手机端推送通知（设备离线告警、OTA 完成提醒）
- [ ] 支持 ESP32-S3 以外的其他乐鑫芯片型号

---

## 技术栈

| 层 | 技术 |
|----|------|
| 固件 | ESP-IDF 5.x · C · FreeRTOS · NimBLE · BluFi |
| 小程序 | 微信原生小程序 · JavaScript · WXML · WXSS |
| 通信协议 | BLE GATT · BluFi（乐鑫） · WiFi · HTTP(S) · WebSocket/WSS |
| 设备长连接 | WebSocket `/ws/device`，设备上线后用于 hello/ping/status/event/command |

---

## 贡献指南

1. Fork 本仓库，在 `feature/xxx` 分支开发
2. 固件改动请在真实 ESP32-S3 设备上验证
3. 小程序改动请在真机（iOS / Android）上验证，模拟器不支持 BLE
4. 提交 PR 时说明改动点及测试结果

---

## License

MIT
