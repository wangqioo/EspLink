# EspLink

**ESP32-S3 设备配网工具 — 微信小程序 + 固件**

EspLink 是 [AI Workflow Terminal](https://github.com/wangqioo) 项目的设备入网模块。用户拿到硬件终端后，通过微信小程序扫描附近蓝牙设备，用 BluFi 协议把 WiFi 凭证安全地推送给 ESP32-S3，完成首次入网激活。

```
手机微信小程序
      │
      │  BLE + BluFi 协议
      ▼
ESP32-S3 固件  ──→  连接家庭/办公 WiFi  ──→  激活 AI 终端
```

---

## 仓库结构

```
EspLink/
├── esplink-app/          # 微信小程序（配网客户端）
│   ├── pages/
│   │   ├── index/        # 蓝牙扫描 & 设备列表
│   │   ├── provision/    # 配网流程（连接 → 填写 WiFi → 发送）
│   │   └── success/      # 配网成功页
│   ├── utils/
│   │   ├── ble.js        # 微信 BLE API 封装
│   │   └── blufi.js      # BluFi 协议帧构造 & 解析
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
    │   ├── app_ota.c     # OTA 升级（预留）
    │   └── app_ws.c      # WebSocket（预留，上线后与终端服务通信）
    ├── CMakeLists.txt
    ├── partitions.csv
    └── sdkconfig.defaults
```

---

## 快速开始

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
| provision 页面 WiFi 名称 / 密码输入框不显示内容 | **未解决** | 已切换 `wx:if`（非 `wx:show`）、去除 `value` 绑定，iOS 上原生 `<input>` 渲染行为异常，仍在排查 |
| SSID 自动填充 | 暂停 | `getCurrentWifiSSID()` 已实现但从配网流程移除，等上面 bug 修好后再加回 |

---

## 开发路线图

EspLink 是 AI Workflow Terminal 项目的设备入网模块，完成后将对接更大的系统。以下是整体规划中与本仓库相关的阶段目标：

### 当前（底子阶段）

- [x] BLE 扫描 & 设备发现
- [x] BluFi 协议帧构造 & 解析（已修复全部 subtype 错误）
- [x] WiFi 凭证推送 & 固件端连接
- [x] 配网成功 / 失败通知（Notify 回调）
- [x] NVS 持久化 WiFi 凭证
- [x] 恢复出厂设置（长按 5 秒）
- [ ] provision 页面输入框渲染 bug 修复

### 近期目标

- [ ] 配网成功后设备自动注册到 AI 终端后端服务（WebSocket 握手）
- [ ] 设备 OTA 升级流程（`app_ota.c` 已预留框架）
- [ ] 多设备管理（小程序端支持已配网设备列表）
- [ ] 配网二维码快速模式（无需蓝牙扫描）

### 中期目标（v0.2 配合 AI Workflow Terminal）

- [ ] 设备激活后与终端 WebSocket 服务建立长连接
- [ ] 小程序端展示设备状态（在线 / 离线 / 固件版本）
- [ ] 手机端推送通知（终端离线告警、OTA 完成提醒）
- [ ] 支持 ESP32-S3 以外的其他芯片型号

---

## 技术栈

| 层 | 技术 |
|----|------|
| 固件 | ESP-IDF 5.x · C · FreeRTOS · NimBLE · BluFi |
| 小程序 | 微信原生小程序 · JavaScript · WXML · WXSS |
| 通信协议 | BLE GATT · BluFi（乐鑫） · WiFi |
| 后续通信 | WebSocket（设备激活后对接终端服务）|

---

## 贡献指南

1. Fork 本仓库，在 `feature/xxx` 分支开发
2. 固件改动请在真实 ESP32-S3 设备上验证
3. 小程序改动请在真机（iOS / Android）上验证，模拟器不支持 BLE
4. 提交 PR 时说明改动点及测试结果

---

## 相关项目

- [AI Workflow Terminal](https://github.com/wangqioo) — 本项目所服务的主系统，ESP32-S3 联网后将作为终端硬件节点接入

---

## License

MIT
