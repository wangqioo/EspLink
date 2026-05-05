# EspLink 平台架构设计

> 多产品 ESP32 IoT 平台 — 固件框架 · 云平台 · 微信小程序

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
│   ├── application.cc/.h       # 应用单例，事件循环，状态机
│   ├── main.cc                 # 入口
│   ├── device_state.h          # 状态枚举
│   ├── ota.cc/.h               # OTA + 启动引导
│   ├── settings.cc/.h          # NVS 持久化配置
│   ├── system_info.cc/.h       # 设备身份（MAC/UUID）
│   ├── protocols/
│   │   └── protocol.h          # 抽象协议基类
│   │   └── websocket_protocol.cc/.h
│   ├── boards/
│   │   ├── common/
│   │   │   ├── board.h         # Board 抽象基类
│   │   │   ├── blufi.cc/.h     # BLE 配网（共用）
│   │   │   ├── button.cc/.h
│   │   │   └── network/        # WiFi 连接管理
│   │   ├── product_a/          # 产品 A 实现
│   │   │   └── product_a.cc
│   │   └── product_b/          # 产品 B 实现
│   │       └── product_b.cc
│   └── pages/                  # UI 页面注册（有屏设备）
├── CMakeLists.txt
├── partitions.csv
└── sdkconfig.defaults
```

### 2.2 Board 抽象（核心）

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

### 3.1 服务拆分

```
cloud/
├── gateway/        # WebSocket 网关（Python asyncio / Node.js）
│                   # 维护设备长连接，消息路由
├── api/            # 管理 API（Python FastAPI 或 Spring Boot）
│                   # 用户、设备、OTA、消息 CRUD
├── ota-server/     # 固件文件服务（Nginx 静态 or S3）
└── web/            # 管理后台（Vue 3）
```

**为什么拆分 gateway 和 api**：
- Gateway 需要维护大量长连接，适合异步 IO（Python asyncio / Node.js）
- API 是普通 CRUD，可以用任何框架，压力小，可独立扩展

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
-- 用户
CREATE TABLE users (
    id          BIGINT PRIMARY KEY AUTO_INCREMENT,
    openid      VARCHAR(64) UNIQUE,   -- 微信 openid
    nickname    VARCHAR(64),
    created_at  DATETIME
);

-- 设备
CREATE TABLE devices (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    mac             VARCHAR(17) UNIQUE NOT NULL,
    board_type      VARCHAR(64) NOT NULL,
    capabilities    JSON,             -- GetCapabilitiesJson() 快照
    firmware_version VARCHAR(32),
    user_id         BIGINT,           -- NULL 表示未绑定
    alias           VARCHAR(64),
    is_online       BOOLEAN DEFAULT FALSE,
    last_seen_at    DATETIME,
    created_at      DATETIME
);

-- OTA 固件
CREATE TABLE ota_firmware (
    id          BIGINT PRIMARY KEY AUTO_INCREMENT,
    board_type  VARCHAR(64) NOT NULL,
    version     VARCHAR(32) NOT NULL,
    file_path   VARCHAR(256),
    file_size   INT,
    sha256      VARCHAR(64),
    is_enabled  BOOLEAN DEFAULT TRUE,
    force_update BOOLEAN DEFAULT FALSE,
    release_note TEXT,
    created_at  DATETIME
);

-- 设备消息日志（可选）
CREATE TABLE device_messages (
    id          BIGINT PRIMARY KEY AUTO_INCREMENT,
    device_id   BIGINT NOT NULL,
    direction   ENUM('up', 'down'),
    msg_type    VARCHAR(32),
    payload     JSON,
    created_at  DATETIME
);
```

### 3.5 管理 API 主要端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/ota/check` | 设备启动引导（设备调用）|
| POST | `/api/device/bind` | 绑定设备（小程序调用）|
| GET  | `/api/device/list` | 获取我的设备列表 |
| GET  | `/api/device/{id}/status` | 获取设备实时状态 |
| POST | `/api/device/{id}/command` | 下发指令给设备 |
| POST | `/api/device/{id}/unbind` | 解绑 |
| POST | `/api/ota/upload` | 上传固件（管理员）|
| GET  | `/api/ota/download/{filename}` | 固件下载（设备调用）|

---

## 四、微信小程序层

### 4.1 页面结构

```
esplink-app/
├── pages/
│   ├── index/          # 首页：我的设备列表
│   ├── scan/           # BLE 扫描 & 配网（现有 EspLink 流程）
│   ├── bind/           # 输入 bind_code 绑定设备
│   ├── device/         # 设备详情（动态加载功能页）
│   └── settings/       # 设置
├── device-pages/       # 各产品功能页（按 board_type 路由）
│   ├── sensor/         # 温湿度传感器页
│   ├── switch/         # 开关控制页
│   ├── display/        # 显示屏设备页
│   └── default/        # 通用兜底页
├── utils/
│   ├── ble.js          # BLE 封装（现有）
│   ├── blufi.js        # BluFi 协议（现有）
│   ├── api.js          # 云端 API 封装
│   └── device-page-registry.js  # 产品页路由表
└── app.js
```

### 4.2 动态功能页机制（核心）

设备的 `capabilities.ui_page` 字段决定小程序加载哪个功能组件：

```javascript
// utils/device-page-registry.js
const registry = {
    'sensor':   '/device-pages/sensor/index',
    'switch':   '/device-pages/switch/index',
    'display':  '/device-pages/display/index',
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
| 固件 | ESP-IDF 5.x · C/C++ | 现有基础，继续沿用 |
| WebSocket 网关 | Python asyncio + websockets | 轻量，与 xiaozhi-server 同技术栈 |
| 管理 API | Python FastAPI | 与网关同语言，减少技术栈碎片 |
| 数据库 | MySQL 8 + Redis | 主存储 + 设备状态缓存/bind_code |
| OTA 文件 | Nginx 静态服务 / 腾讯云 COS | 早期 Nginx 够用 |
| 管理后台 | Vue 3 + Element Plus | 可选，早期用 FastAPI 自带 swagger |
| 小程序 | 微信原生 · JavaScript | 现有基础，继续沿用 |

---

## 七、现有代码盘点

在推进路线图之前，先记录当前代码实际状态，避免重复造轮子。

### 固件（esplink-firmware）

| 文件 | 状态 | 说明 |
|------|------|------|
| `main.c` | 70% | 状态机完整（Starting→Provisioning→Connecting→Activating→Online）；WebSocket 消息回调是 stub |
| `app_blufi.c` | ✅ | BLE 配网全部实现，可直接复用 |
| `app_wifi.c` | ✅ | WiFi 连接 + 5次重试，完整 |
| `app_nvs.c` | ✅ | WiFi凭证/token/ws_url/SN 持久化，完整；恢复出厂保留 SN |
| `app_ota.c` | ✅ | OTA 版本比较 + HTTPS 下载刷写，完整 |
| `app_ws.c` | 90% | WebSocket 连接、send_hello、帧收发完整；audio 回调是 stub |
| `app_button.c` | ✅ | 长按5秒恢复出厂，完整 |
| `app_device.c` | ✅ | MAC/SN/BLE名称/固件版本，完整 |

**关键已有逻辑**（架构设计时需对齐，不要重复实现）：
- `activate_task()` 已实现：POST 激活端点，请求带 MAC/SN/firmware_version，响应解析 `token` + `ws_url` 写 NVS → 这就是架构里的 `/api/ota/check`，只需改名对齐
- `app_ws.c` 的 `send_hello()` 已发送设备元信息，只需扩充 `capabilities_json` 字段
- `app_ota.c` 已独立实现 OTA check + 下载，Phase 2 需将其合并进激活流程（单次请求）

**固件语言问题（重要决策）**：
- 现有代码是纯 **C**（ESP-IDF 风格），xiaozhi/zectrix 的 Board 抽象是 **C++**
- Phase 2 需决定：迁移到 C++ 以复用 Board 类模式，还是用 C 函数指针结构体实现等价抽象
- **建议**：迁移到 C++，长期收益更大，且 ESP-IDF 5.x 完整支持 C++

### 小程序（esplink-app）

| 页面/模块 | 状态 | 说明 |
|----------|------|------|
| `pages/index` | 70% | 现在是纯 BLE 扫描页，需改造成「设备列表 + 添加设备」双模式 |
| `pages/provision` | ✅ | 配网三步流程完整（连接→填写→发送），iOS input bug 待修 |
| `pages/success` | 50% | 显示成功页，**缺少调用绑定 API** 的逻辑 |
| `utils/ble.js` | ✅ | BLE 封装完整；`getCurrentWifiSSID()` 已实现但未接入 |
| `utils/blufi.js` | ✅ | BluFi 协议完整，可直接复用 |
| `utils/api.js` | ❌ | 不存在，需新建（云端 API 封装） |
| 用户登录/鉴权 | ❌ | 无 wx.login / openid 逻辑，需新建 |
| 设备功能页路由 | ❌ | device-page-registry 不存在，需新建 |

---

## 八、开发路线图

### Phase 1 — 修复配网体验（当前阶段，1-2周）

**固件**（无需改动）

**小程序**：
- [ ] 修复 iOS provision 页面 input 渲染 bug（核心阻塞项）
- [ ] 接入 `getCurrentWifiSSID()` 实现 SSID 自动填充
- [ ] iOS + Android 真机完整流程回归测试

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

- [x] Python FastAPI 项目骨架（`cloud/api/`）
- [x] MySQL 建表：`users` / `devices` / `ota_firmware`（Alembic 迁移）
- [x] `POST /api/ota/check`：设备激活引导端点，自动注册未知设备，返回 `websocket_url` + `token` + `is_bound` + `ota?`
- [x] WebSocket 网关（`/ws/device`）：设备连接认证、hello/ping/status/event 消息处理、在线状态维护
- [x] `POST /api/device/bind`：小程序 BLE 配网后调用，用 MAC 绑定设备到当前用户
- [x] `GET /api/device/list`：返回用户的设备列表（含实时在线状态）
- [x] `POST /api/device/{id}/command`：小程序向设备下发指令
- [x] `POST /api/auth/wechat`：微信小程序登录，支持开发模式（无需真实 AppID）
- [x] Redis：设备在线状态缓存（90s TTL，ping 续期）
- [x] Docker Compose：MySQL + Redis + API 一键启动

**本地启动：**
```bash
cd cloud/api
cp .env.example .env        # 按需修改配置
cd ..
docker compose up -d mysql redis
cd api
pip install -r requirements.txt
alembic upgrade head         # 建表
uvicorn app.main:app --reload
# 访问 http://localhost:8000/docs 查看 API 文档
```

### Phase 4 — 小程序多产品支持（2-3周）

目标：小程序能管理已绑定设备，并按产品类型展示不同功能页。

- [ ] `utils/api.js`：封装所有云端 API 调用（含 wx.login + JWT 鉴权）
- [ ] **改造 `pages/index`**：区分「已绑定设备列表」和「扫描添加新设备」两个入口
- [ ] **`pages/success` 补全**：配网成功后调用 `/api/device/bind`（BLE 连接期间已有 MAC）
- [ ] `utils/device-page-registry.js`：`board_type` → 功能页路径映射
- [ ] `pages/device`：通用设备详情页，根据 `capabilities.ui_page` 跳转对应功能页
- [ ] 第一个产品功能页（`device-pages/default`）

### Phase 5 — 完善与扩展（持续迭代）

- [ ] OTA 固件管理：上传、版本控制、按 `board_type` 推送
- [ ] 设备指令下发：小程序 → 云端 API → WebSocket 网关 → 设备
- [ ] 第二款 ESP32 产品接入，验证多产品框架闭环
- [ ] 管理后台 Web（Vue 3）：设备统计、固件管理、用户管理

---

## 九、关键设计原则

1. **设备不硬编码服务器地址**：通过 OTA 引导端点动态获取 WebSocket URL，云端可以随时迁移
2. **能力描述驱动 UI**：`GetCapabilitiesJson()` 是设备和小程序之间的契约，新产品不需要修改小程序主框架
3. **配网是入口不是全部**：BluFi 配网完成后立即接入云端，配网页是一次性流程
4. **出厂测试是一等公民**：`Board` 接口内置 `IsFactoryTestMode()`，每个产品上线前必须跑完出厂测试流程
5. **渐进式扩展**：Phase 1-2 不依赖云平台，可以独立完成和验证
