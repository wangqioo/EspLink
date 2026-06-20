# EspLink 平台架构设计

> 多产品 ESP32 IoT 平台 — 固件框架 · 云平台 · 微信小程序
>
> 最新更新：2026-06-20。本文已按当前仓库实现收口：固件当前是 ESP-IDF C 代码基座，后端是 `backend/` 下的 Node/Express，管理后台是 React/Vite，微信小程序是原生小程序。历史 C++ Board 抽象仍可作为后续多产品扩展方向，但不是当前已落地代码结构。

---

## 一、平台定位

EspLink 是一套面向多款 ESP32 产品的通用 IoT 平台，解决三个核心问题：

1. **设备入网**：任意 ESP32 产品通过统一的 BLE + BluFi 流程完成首次配网
2. **设备管理**：云端统一管理设备注册、绑定、状态、OTA 固件升级
3. **功能交互**：微信小程序作为通用客户端，按设备类型动态加载对应功能页

```
┌─────────────────────────────────────────────────────────┐
│                   微信小程序（统一客户端）                  │
│  BLE配网  │  设备列表  │  [产品A页]  │  [产品B页]  │  设置  │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTPS / WebSocket
┌──────────────────────────▼──────────────────────────────┐
│                      云平台                               │
│  OTA/引导服务  │  WebSocket网关  │  管理API  │  消息中心   │
└──────────────────────────┬──────────────────────────────┘
                           │ WiFi · WebSocket
┌──────────────────────────▼──────────────────────────────┐
│              ESP32 设备层（多产品）                        │
│  产品A(Board)  │  产品B(Board)  │  产品C(Board)  │  ...   │
│        共用：固件基座 · 配网 · OTA · 状态机               │
└─────────────────────────────────────────────────────────┘
```

---

## 二、固件层

### 2.1 整体结构

```
esplink-firmware/
├── main/
│   ├── main.c                  # 入口和主状态机
│   ├── board_config.h          # board_type、ui_page、firmware_version、capabilities
│   ├── app_blufi.c/.h          # BLE BluFi 配网
│   ├── app_wifi.c/.h           # WiFi 连接和重试
│   ├── app_nvs.c/.h            # WiFi/token/ws_url/SN 持久化
│   ├── app_device.c/.h         # MAC/SN/BLE 名称/固件版本
│   ├── app_boot_signing.c/.h   # 启动注册和 OTA result HMAC 签名
│   ├── app_ota.c/.h            # OTA 下载、SHA256 校验、结果上报、回滚协作
│   ├── app_ws.c/.h             # WebSocket hello/ping/command/config/ota_push
│   ├── app_button.c/.h         # BOOT 长按 5 秒恢复出厂
│   ├── app_cube_demo.c/.h      # 当前示例产品模块
│   ├── esp32_s3_szp.c/.h       # LCD/QMI8658 BSP
│   └── local_wifi_config.example.h
├── CMakeLists.txt
├── partitions.csv
└── sdkconfig.defaults
```

### 2.2 Board 抽象（核心）

当前已落地的多产品契约先由 `board_config.h` 承载：`BOARD_TYPE`、`BOARD_UI_PAGE`、`BOARD_FIRMWARE_VERSION` 和 `BOARD_CAPABILITIES_JSON` 会在启动注册、WebSocket hello 和 OTA 决策中贯穿。这样第一款产品不需要引入 C++ Board 层也能完成上云、绑定和 OTA。

后续接入第二款以上产品时，可以在两条路线里二选一：

- 继续 C 基座：用 `board_config.h` + C 函数表抽象产品能力，改动小，适合快速接入相近硬件。
- 迁移 C++ Board：参考下面的 Board 类草案，适合多款硬件差异较大、需要显示/电源/传感器统一接口的阶段。

以下 C++ Board 抽象是后续扩展方向，不是当前代码现状。

每款产品是一个 `Board` 子类，框架层完全不感知具体硬件。

```cpp
// boards/common/board.h
class Board {
public:
    static Board& GetInstance();

    virtual std::string GetBoardType() = 0;         // "esplink-switch-v1"
    virtual std::string GetCapabilitiesJson() = 0;  // 设备能力描述，上报给云端
    virtual std::string GetStatusJson() = 0;        // 当前状态快照
    virtual NetworkInterface* GetNetwork() = 0;
    virtual Display* GetDisplay() { return nullptr; }
    virtual void SetPowerSaveLevel(PowerSaveLevel level) = 0;
    virtual bool GetBatteryLevel(int& level, bool& charging);
    virtual bool IsFactoryTestMode() const { return false; }
    virtual void EnterFactoryTestFlow() {}
};

#define DECLARE_BOARD(ClassName) \
    void* create_board() { return new ClassName(); }
```

**产品 A 示例**：

```cpp
// boards/product_a/product_a.cc
class ProductABoard : public Board {
public:
    std::string GetBoardType() override {
        return "esplink-sensor-v1";
    }

    std::string GetCapabilitiesJson() override {
        // 这个 JSON 会上报给云端和小程序
        // 小程序据此决定加载哪个功能页
        return R"({
            "type": "esplink-sensor-v1",
            "version": "1.0.0",
            "features": ["temperature", "humidity", "ota"],
            "ui_page": "sensor"
        })";
    }
    // ...
};

DECLARE_BOARD(ProductABoard);
```

### 2.3 设备启动流程

```
上电
 │
 ├─→ 初始化 NVS、Board、状态机
 │
 ├─→ 读取 NVS WiFi 凭证
 │     ├─ 无凭证 → 进入 BLE 配网模式（BluFi）
 │     │           小程序扫描到设备 → 输入 WiFi → 写入 NVS → 重启
 │     └─ 有凭证 → 连接 WiFi
 │
 ├─→ 连接 WiFi 成功
 │
 ├─→ POST /api/ota/check（OTA 引导请求）
 │     请求头: Device-Id(MAC), Board-Type, Firmware-Version
 │     响应:   WebSocket URL, Auth Token, 固件更新信息（如有）
 │
 ├─→ 如有固件更新 → OTA 下载 → 重启
 │
 └─→ 建立 WebSocket 长连接
       发送 hello 帧（含设备能力 JSON）
       进入业务逻辑循环
```

### 2.4 设备状态机

```
Unknown → Starting → [WifiProvisioning] → WifiConnecting
                                                 │
                                          BootRegistering（OTA check）
                                                 │
                              ┌──────────── Idle（就绪）─────────────┐
                              │                  │                   │
                           Working           Upgrading           Sleeping
```

### 2.5 WebSocket 协议消息

**设备 → 云端**

| 消息类型 | 说明 |
|---------|------|
| `hello` | 握手，携带 `capabilities_json`、`firmware_version`、`session_id` |
| `status` | 定期上报状态（电量、温湿度等业务数据） |
| `event` | 触发性事件（按键、告警等） |
| `ota_result` | OTA 升级结果 |
| `ping` | 心跳保活 |

**云端 → 设备**

| 消息类型 | 说明 |
|---------|------|
| `hello_ack` | 握手确认，下发 `device_id`、`bind_code`（如未绑定）|
| `command` | 控制指令（格式由 `ui_page` 类型定义）|
| `ota_push` | 推送 OTA 固件 URL |
| `config` | 下发配置更新 |

**帧格式（文本 JSON）**

```json
{
    "type": "status",
    "session_id": "xxxx",
    "timestamp": 1746000000,
    "payload": { ... }
}
```

---

## 三、云平台层

### 3.1 当前服务结构

```
backend/
├── src/              # Node/Express API、设备 WebSocket、OTA、业务服务
├── prisma/           # 数据库 schema
├── db/               # 数据库脚本和迁移记录
├── admin-frontend/   # React + Ant Design 管理后台
└── uploads/          # 本地固件文件目录，运行时生成，不提交 Git
```

`backend/` 是当前正式后端。它统一承载管理 API、设备 WebSocket 网关、固件上传、固件发布、OTA check、OTA result 和生产设备 PSK 校验。

旧 FastAPI 云端草案已从工作树删除；如需追溯历史实现，以 Git 历史记录为准。

### 3.2 设备注册与绑定流程

绑定通过 BLE 完成：配网时小程序与设备已有 BLE 连接，配网成功后小程序持有设备 MAC，直接用 MAC 调云端 API 绑定。**能物理接触设备完成 BLE 配对的人即为设备所有者**，无需额外验证码。

```
小程序 BLE 扫描 → 连接设备 → 读取设备 MAC（BLE 特征值）
       │
       ├─→ BluFi 发送 WiFi 凭证 → 设备连接 WiFi
       │
       ├─→ 设备上线 → POST /api/ota/check
       │              服务端自动注册设备（如未注册）
       │
       ├─→ 小程序等待设备上线（BLE Notify 或轮询）
       │
       └─→ 小程序调用 POST /api/device/bind { mac, user_token }
             → 绑定成功，设备归属该用户
```

已绑定设备再次上线时，OTA check 直接返回 WebSocket URL + token，跳过绑定流程。

### 3.3 OTA 引导端点

```
POST /api/ota/check
请求体：{
    "mac": "AA:BB:CC:DD:EE:FF",
    "board_type": "esplink-sensor-v1",
    "firmware_version": "1.2.0"
}

响应体：{
    "websocket_url": "wss://ws.esplink.com/device/v1",
    "token": "eyJ...",
    "is_bound": false,            // 小程序据此判断是否需要走绑定流程
    "ota": {                      // 如有更新
        "version": "1.3.0",
        "url": "https://ota.esplink.com/firmware/sensor-v1-1.3.0.bin",
        "force": false
    },
    "timestamp": 1746000000       // 对时
}
```

### 3.4 数据库核心表

```sql
devices                 -- MAC 主键；含 device_key、board_type、capabilities、firmware、wechat_user_id、在线状态
wechat_users            -- 微信 openid 登录用户
firmware_releases       -- 固件发布；board_type/channel/version 唯一，含 artifact_url、sha256、size_bytes、force_update
firmware_ota_attempts   -- OTA started/success/download_failed/sha_mismatch 等结果流水
production_keys         -- 量产设备 PSK；REQUIRE_DEVICE_PSK=true 时校验 boot/result HMAC
tenants / api_keys      -- 多租户和 Key 管理
usage_logs / usage_hourly
llm_providers
```

### 3.5 管理 API 主要端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/ota/check` | 设备启动引导（设备调用）|
| POST | `/api/ota/result` | OTA 结果上报（设备调用）|
| POST | `/api/device/bind` | 绑定设备（小程序调用）|
| GET  | `/api/device/list` | 获取我的设备列表 |
| GET  | `/api/device/lookup?mac_suffix=AABBCC` | 配网成功后按 MAC 后缀查找设备 |
| POST | `/api/device/:mac/command` | 下发指令给设备 |
| POST | `/api/v1/devices/:mac/unbind` | 管理端解绑 |
| POST | `/api/v1/firmware/artifacts` | 上传固件（管理员）|
| GET  | `/api/v1/firmware/releases` | 固件发布列表 |
| POST | `/api/v1/firmware/releases` | 创建固件发布 |
| PATCH | `/api/v1/firmware/releases/:id/active` | 启用/停用发布 |
| GET  | `/api/v1/firmware/ota-preview` | 管理端只读 OTA 决策预览 |
| GET  | `/firmware/<filename>.bin` | 固件下载（设备调用）|

---

## 四、微信小程序层

### 4.1 页面结构

```
esplink-app/
├── pages/
│   ├── index/          # 首页：我的设备列表
│   ├── scan/           # BLE 扫描 & 配网（现有 EspLink 流程）
│   ├── provision/      # BluFi 配网
│   ├── success/        # 配网成功后查找并绑定设备
│   └── device/         # 设备详情（动态加载功能页）
├── device-pages/       # 各产品功能页（按 board_type 路由）
│   └── default/        # 通用兜底页
├── utils/
│   ├── ble.js          # BLE 封装（现有）
│   ├── blufi.js        # BluFi 协议（现有）
│   ├── api.js          # 云端 API 封装
│   └── device-page-registry.js  # 产品页路由表
└── app.js
```

### 4.2 动态功能页机制（核心）

设备的 `capabilities.ui_page` 字段决定小程序加载哪个功能组件。当前仓库只有 `default` 兜底页；接入第二款产品时再向 registry 增加对应页面。

```javascript
// utils/device-page-registry.js
const registry = {
    'default':  '/device-pages/default/index',
};

export function getDevicePage(capabilities) {
    const uiPage = capabilities?.ui_page || 'default';
    return registry[uiPage] || registry['default'];
}
```

```javascript
// pages/device/index.js
onLoad({ deviceId }) {
    const device = await api.getDevice(deviceId);
    const pagePath = getDevicePage(device.capabilities);
    // 跳转到对应产品页，传入 deviceId
    wx.navigateTo({ url: `${pagePath}?deviceId=${deviceId}` });
}
```

### 4.3 完整用户旅程

```
首次使用
 │
 ├─→ 打开小程序 → 授权登录（微信 openid）
 │
 ├─→ 点击「添加设备」→ BLE 扫描 → 发现设备（Device-XXXX）
 │
 ├─→ 配网：输入 WiFi 账密 → BluFi 发送给设备 → 设备上网
 │
 ├─→ 设备上网后自动请求 OTA 引导，is_bound=false 通知小程序
 │
 ├─→ 小程序用 BLE 连接期间读取的 MAC，调用 /api/device/bind
 │
 └─→ 绑定成功 → 跳转设备功能页（由 ui_page 决定）

日常使用
 │
 ├─→ 首页显示设备列表（在线/离线状态）
 │
 └─→ 点击设备 → 直接进入对应产品功能页（已绑定，无需重新配网）
```

---

## 五、认证机制

### 设备认证
- 设备首次 OTA check 时，服务端以 MAC 作为硬件标识自动注册
- 服务端为每台设备生成一个 `device_key`（64 位随机串），写入 OTA 响应
- 设备存入 NVS，后续 WebSocket 连接用 `device_key` 做 Bearer Token
- 恢复出厂时清空 NVS，下次上线重新走注册流程

### 用户认证
- 小程序通过微信 `wx.login()` 获取 `code`
- 后端用 code 换取微信 `openid`，签发 JWT
- 所有 API 请求携带 JWT

---

## 六、技术栈选型

| 层 | 推荐 | 说明 |
|----|------|------|
| 固件 | ESP-IDF 5.x · C | 当前正式固件为 C；C++ Board 抽象留作多产品扩展方向 |
| 后端 API | Node.js + Express | 当前正式后端，位于 `backend/` |
| WebSocket 网关 | Node.js + ws | 与设备长连接、hello/ping/OTA push 同进程管理 |
| 数据库 | Prisma + MySQL | 当前 schema datasource 为 MySQL，Redis 用于在线状态、限流和缓存 |
| OTA 文件 | Express 静态文件服务 | 管理后台上传 `.bin` 到 `uploads/firmware`，通过 `/firmware/*` 提供下载 |
| 管理后台 | React + Vite + Ant Design | 位于 `backend/admin-frontend/` |
| 小程序 | 微信原生 · JavaScript | 现有基础，继续沿用 |

---

## 七、现有代码盘点

在推进路线图之前，先记录当前代码实际状态，避免重复造轮子。

### 固件（esplink-firmware）

| 文件 | 状态 | 说明 |
|------|------|------|
| `main.c` | ✅ | 状态机完整（Starting→Provisioning→Connecting→BootRegistering→Online），启动注册、OTA、WebSocket 串联 |
| `app_blufi.c` | ✅ | BLE 配网全部实现，可直接复用 |
| `app_wifi.c` | ✅ | WiFi 连接 + 5次重试，完整 |
| `app_nvs.c` | ✅ | WiFi凭证/token/ws_url/SN 持久化，完整；恢复出厂保留 SN |
| `app_ota.c` | ✅ | OTA 版本比较、artifact SHA256 校验、结果上报、失败恢复 |
| `app_ws.c` | ✅ | WebSocket 连接、send_hello、hello_ack、ota_push、command/config 基础处理 |
| `app_button.c` | ✅ | 长按5秒恢复出厂，完整 |
| `app_device.c` | ✅ | MAC/SN/BLE名称/固件版本，完整 |
| `app_cube_demo.c` | ✅ | 3D cube 示例产品模块，联网注册成功后启动 LCD + QMI8658 渲染任务 |
| `esp32_s3_szp.c` | ✅ | cube demo 使用的 ESP32-S3 LCD/QMI8658 BSP |

**关键已有逻辑**（架构设计时需对齐，不要重复实现）：
- `boot_register_task()` 已实现：POST `/api/ota/check`，请求带 MAC/SN/board/firmware，响应解析 `token`、`websocket_url`、`is_bound` 和 `ota`
- `app_ws.c` 的 `send_hello()` 已发送 board、firmware、capabilities 等设备元信息
- `app_ota.c` 已接入启动注册响应中的 OTA envelope，并向 `/api/ota/result` 上报结果

**固件语言决策（当前）**：
- 现有代码是纯 **C**（ESP-IDF 风格），已经完成配网、上云、OTA、签名和回滚验证。
- 当前不为第一款产品做 C++ 迁移，避免在已验证链路上引入结构性风险。
- 第二款产品接入时再评估：若硬件差异小，优先用 C 函数表扩展；若显示、电源、传感器抽象明显变复杂，再迁移到 C++ Board 模式。

### 小程序（esplink-app）

| 页面/模块 | 状态 | 说明 |
|----------|------|------|
| `pages/index` | ✅ | 已绑定设备列表，展示在线状态、固件版本、板型和绑定状态；添加入口跳转扫描 |
| `pages/scan` | ✅ | BLE 扫描待配网设备 |
| `pages/provision` | ✅ | 配网三步流程完整，输入框布局稳定，失败态支持重试和返回扫描 |
| `pages/success` | ✅ | 配网成功后按 MAC 后缀 lookup 并绑定设备 |
| `utils/ble.js` | ✅ | BLE 封装完整；`getCurrentWifiSSID()` 已接入配网页自动填充 |
| `utils/blufi.js` | ✅ | BluFi 协议完整，可直接复用 |
| `utils/api.js` | ✅ | 云端 API 封装，含微信登录、设备列表、lookup、bind、command |
| 用户登录/鉴权 | ✅ | `app.js` 通过 `wx.login()` 获取后端 JWT |
| 设备功能页路由 | ✅ | `device-page-registry.js` 已存在，当前有 default 产品页 |

---

## 八、开发路线图

### Phase 1 — 修复配网体验 ✅

**固件**（无需改动）

**小程序**：
- [x] 修复 provision 页面 input 渲染 bug，并补静态回归测试
- [x] 接入 `getCurrentWifiSSID()` 实现 SSID 自动填充
- [x] 增加配网失败重试和返回扫描入口
- [ ] 微信开发者工具和 iOS 真机完整流程复测

### Phase 2 — 固件框架升级 ✅

目标：固件具备上云能力，能完成激活 + WebSocket 握手。

- [x] **`board_config.h`**：新建产品身份常量文件（`BOARD_TYPE` / `BOARD_UI_PAGE` / `BOARD_FIRMWARE_VERSION` / `BOARD_CAPABILITIES_JSON`），换产品只改这一个文件
- [x] **合并激活与 OTA check**：`activate_task()` 重构为 `boot_register_task()`，单次 POST `/api/ota/check`，响应中内嵌 OTA 信息，服务端决策是否升级
- [x] **新增 `app_ota_upgrade_from_url()`**：支持由启动注册响应或云端推送直接触发 OTA
- [x] **扩充 `send_hello()`**：加入 `board_type` + `capabilities`（含 `ui_page` + `features`）
- [x] **实现 `on_ws_json()`**：解析 `type` 字段，处理 `hello_ack` / `ota_push`（起独立 task）/ `command` / `config`
- [ ] **C → C++ 迁移**（延后）：当第二款产品接入时再做，现阶段 `board_config.h` 已满足多产品需求

### Phase 3 — 云平台 MVP ✅

目标：设备能上云、能绑定、能被小程序看到。

- [x] Node/Express 正式后端已并入 `backend/`
- [x] Prisma 数据模型和数据库脚本已并入 `backend/prisma`、`backend/db`
- [x] `POST /api/ota/check`：设备激活引导端点，自动注册未知设备，返回 `websocket_url` + `token` + `is_bound` + `ota?`
- [x] WebSocket 网关（`/ws/device`）：设备连接认证、hello/ping/status/event 消息处理、在线状态维护
- [x] `POST /api/device/bind`：小程序 BLE 配网后调用，用 MAC 绑定设备到当前用户
- [x] `GET /api/device/list`：返回用户的设备列表（含实时在线状态）
- [x] `POST /api/device/{id}/command`：小程序向设备下发指令
- [x] `POST /api/auth/wechat`：微信小程序登录，支持开发模式（无需真实 AppID）
- [x] Redis：设备在线状态缓存（90s TTL，ping 续期）
- [x] 管理后台固件发布：上传 `.bin` 后自动生成 URL、SHA256 和文件大小
- [x] Dockerfile / docker-compose 本地部署配置已并入 `backend/`

**本地启动：**
```bash
cd backend
cp .env.example .env
npm install
npm run db:generate
npm test
npm run dev

cd admin-frontend
npm install
npm run build
npm run dev
```

### Phase 4 — 小程序多产品支持 ✅

目标：小程序能管理已绑定设备，并按产品类型展示不同功能页。

- [x] `utils/api.js`：封装所有云端 API 调用（含 wx.login + JWT 鉴权）
- [x] **改造 `pages/index`**：已绑定设备列表 + 添加设备入口
- [x] **`pages/success` 补全**：配网成功后 lookup 并调用 `/api/device/bind`
- [x] `utils/device-page-registry.js`：`board_type` → 功能页路径映射
- [x] `pages/device`：通用设备详情页，根据能力路由产品页
- [x] 第一个产品功能页（`device-pages/default`）

### Phase 5 — 完善与扩展（持续迭代）

- [x] OTA 固件管理：后端管理台支持 `.bin` 上传，自动生成 URL/SHA256/文件大小，按 `board_type` 发布
- [x] 第一个 OTA 示例固件：`cube_3d_v1.0` 已集成到 EspLink OTA 壳，版本 `esplink-v1 / 1.0.2`
- [x] 设备指令下发：小程序 → 云端 API → WebSocket 网关 → 设备
- [ ] 第二款 ESP32 产品接入，验证多产品框架闭环
- [x] 管理后台 Web 增强：设备管理、固件发布、OTA 结果统计、租户/Key/用量/模型配置
- [x] 测试阶段自动联网：提供非提交入库的本地 WiFi 注入方式，跳过 BLE 配网验证硬件 demo

---

## 九、关键设计原则

1. **设备不硬编码服务器地址**：通过 OTA 引导端点动态获取 WebSocket URL，云端可以随时迁移
2. **能力描述驱动 UI**：`GetCapabilitiesJson()` 是设备和小程序之间的契约，新产品不需要修改小程序主框架
3. **配网是入口不是全部**：BluFi 配网完成后立即接入云端，配网页是一次性流程
4. **出厂测试是一等公民**：`Board` 接口内置 `IsFactoryTestMode()`，每个产品上线前必须跑完出厂测试流程
5. **渐进式扩展**：Phase 1-2 不依赖云平台，可以独立完成和验证
