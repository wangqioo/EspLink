# EspLink — ESP32 开发环境搭建 & 编译烧录完全手册

> 适用芯片：**ESP32-S3** | 固件框架：**ESP-IDF 5.4+** | 项目：**EspLink**

---

## 目录

1. [硬件准备](#1-硬件准备)
2. [ESP-IDF 环境安装](#2-esp-idf-环境安装)
3. [项目编译](#3-项目编译)
4. [烧录固件](#4-烧录固件)
5. [验证运行](#5-验证运行)
6. [常见问题排查](#6-常见问题排查)
7. [附录：命令速查](#7-附录命令速查)

---

## 1. 硬件准备

### 你需要的东西

| 物品 | 说明 |
|------|------|
| ESP32-S3 开发板 | 任意 ESP32-S3 板子（如 ESP32-S3-DevKitC） |
| USB 数据线 | **必须支持数据传输**，不要用仅充电线 |
| 电脑 | Windows / macOS / Linux 均可 |

### 确认你的串口

- **Windows**：设备管理器 → 端口（COM 和 LPT）→ 找 `COMx`
- **macOS**：`ls /dev/cu.*` → 通常是 `/dev/cu.usbmodem*`
- **Linux**：`ls /dev/ttyUSB*` 或 `ls /dev/ttyACM*` → 通常是 `/dev/ttyUSB0`

> ⚠️ **常见坑**：ESP32-S3 有两个 USB 口，**烧录用 USB 口（标着 UART 的那个）**，另一个 USB 口是芯片内置的 JTAG/USB（也可以烧录，但需要额外配置）。

---

## 2. ESP-IDF 环境安装

ESP-IDF 安装是最容易出问题的环节，请严格按照下面步骤操作。

### 2.1 Windows 用户（推荐方式：离线安装器）

1. 下载 ESP-IDF 离线安装器：
   - 国内加速：[乐鑫官网下载页](https://www.espressif.com/zh-hans/support/download/overview)
   - 或直接下载 [ESP-IDF 5.4 Offline Installer](https://dl.espressif.com/dl/esp-idf/)
2. 运行安装器，一路下一步，**勾选安装 ESP32-S3 支持**
3. 安装完成后，桌面会出现 `ESP-IDF 5.4 CMD` / `ESP-IDF 5.4 PowerShell` 快捷方式
4. **后续所有命令都在这个终端里执行**

### 2.2 macOS 用户

```bash
# 1. 安装依赖
brew install cmake ninja dfu-util

# 2. 克隆 ESP-IDF（选一个源，国内推荐 gitee）
# 方式 A：GitHub（海外）
git clone --recursive -b v5.4 https://github.com/espressif/esp-idf.git ~/esp-idf-v5.4

# 方式 B：Gitee（国内，更快）
git clone --recursive -b v5.4 https://gitee.com/EspressifSystems/esp-idf.git ~/esp-idf-v5.4

# 3. 安装工具链
cd ~/esp-idf-v5.4
./install.sh esp32s3

# 4. 激活环境（每次打开新终端都要执行）
source ~/esp-idf-v5.4/export.sh
```

> 可以把 `source ~/esp-idf-v5.4/export.sh` 加到 `~/.zshrc` 或 `~/.bashrc` 里。

### 2.3 Linux 用户（Ubuntu/Debian）

```bash
# 1. 安装依赖
sudo apt update
sudo apt install -y git wget flex bison gperf python3 python3-pip \
    python3-venv cmake ninja-build ccache libffi-dev libssl-dev \
    dfu-util libusb-1.0-0

# 2. 设置 Python 虚拟环境（推荐，避免污染系统 Python）
python3 -m venv ~/esp-idf-venv
source ~/esp-idf-venv/bin/activate

# 3. 克隆 ESP-IDF
git clone --recursive -b v5.4 https://github.com/espressif/esp-idf.git ~/esp-idf-v5.4

# 4. 安装工具链
cd ~/esp-idf-v5.4
./install.sh esp32s3

# 5. 激活环境
source ~/esp-idf-v5.4/export.sh

# 6. 设置串口权限（Linux 特有）
sudo usermod -a -G dialout $USER
# 退出重新登录后生效
```

### 2.4 验证安装

```bash
idf.py --version
# 应该输出类似：ESP-IDF v5.4.x

python3 -c "import serial; print('pyserial OK')"
# 应该输出：pyserial OK
```

---

## 3. 项目编译

### 3.1 获取 EspLink 代码

```bash
git clone https://github.com/wangqioo/EspLink.git
cd EspLink/esplink-firmware
```

### 3.2 安装 Python 依赖

```bash
pip install pyserial
```

### 3.3 首次配置（只需做一次）

```bash
# 设置目标芯片为 ESP32-S3
idf.py set-target esp32s3

# 这一条命令会：
#  - 生成 sdkconfig（从 sdkconfig.defaults 读取默认配置）
#  - 配置所有 IDF 组件
```

> ⚠️ **不要跳过这一步**，否则会编译成默认芯片（可能是 ESP32 而非 ESP32-S3）。

### 3.4 打开菜单配置（可选，通常不需要）

```bash
idf.py menuconfig
```

需要修改的常见项：

| 菜单路径 | 说明 |
|---------|------|
| `Serial flasher config → Flash size` | 确认是 8MB |
| `Partition Table → Partition Table` | 选 `Custom partition table CSV` |
| `Component config → Bluetooth → NimBLE → Enable BLE` | 确认已启用 |
| `Component config → Bluetooth → NimBLE → Enable BluFi` | 确认已启用 |

> **本项目 `sdkconfig.defaults` 已经预设了所有必要配置，一般情况下不需要手动改 menuconfig。**

### 3.5 编译

```bash
idf.py build
```

编译成功标志：
```
Project build complete. To flash, run:
 idf.py -p (PORT) flash
```

如果第一次编译，下载依赖组件可能需要几分钟。后续增量编译很快。

### 3.6 编译产物位置

```
build/
├── esp32s3_device.bin       ← 完整固件
├── bootloader/bootloader.bin
├── partition_table/partition-table.bin
└── ...其他中间文件...
```

---

## 4. 烧录固件

### 4.1 连接开发板

1. USB 线连接电脑和 ESP32-S3 开发板 **（用标着 UART 的那个口）**
2. 确认串口出现

### 4.2 烧录命令

```bash
# 把 /dev/ttyUSB0 换成你实际的串口
idf.py -p /dev/ttyUSB0 flash
```

| 系统 | 串口示例 |
|------|---------|
| Linux | `/dev/ttyUSB0` 或 `/dev/ttyACM0` |
| macOS | `/dev/cu.usbmodem123456` |
| Windows | `COM3` 或 `COM4` |

### 4.3 烧录 + 串口监控（推荐）

```bash
idf.py -p /dev/ttyUSB0 flash monitor
```

`monitor` 会在烧录完成后自动打开串口监视器，你可以看到设备日志输出。

退出 monitor：按 `Ctrl + ]`

### 4.4 如果烧录失败 — 手动进入下载模式

有些板子不会自动进入下载模式，需要手动操作：

1. **按住 BOOT 键（GPIO 0）不松手**
2. **按一下 EN（复位）键然后松开**
3. **松开 BOOT 键**
4. 此时芯片进入下载模式，重新执行烧录命令

> 下载模式下的板子 LED 通常不会亮或快速闪烁，这是正常的。

### 4.5 擦除整片 Flash（疑难杂症时用）

```bash
idf.py -p /dev/ttyUSB0 erase-flash
```

擦除后需要重新烧录。

---

## 5. 验证运行

### 5.1 打开串口监控

```bash
idf.py -p /dev/ttyUSB0 monitor
```

### 5.2 期望输出

设备启动后，串口应输出类似：

```
I (xxx) main: === device boot: board=esplink-v1 fw=1.0.0 ===
I (xxx) main: no wifi credentials, starting BLE provisioning
I (xxx) BLUFI: BLE started, advertising as "Device-XXXX"
```

### 5.3 用微信小程序配网

1. 手机打开微信开发者工具或真机预览
2. 蓝牙扫描 → 应该能看到 `Device-XXXX`
3. 连接 → 输入 WiFi 密码 → 配网

### 5.4 恢复出厂设置

长按开发板上的 **BOOT 键（GPIO 0）5 秒**，设备会清除 WiFi 凭证并重启，重新进入待配网状态（蓝牙广播 `Device-XXXX`）。

---

## 6. 常见问题排查

### Q1：`idf.py: command not found`

**原因**：没有激活 ESP-IDF 环境。

**解决**：
```bash
# Windows：打开 ESP-IDF CMD 快捷方式（不要用普通 CMD）
# macOS / Linux：
source ~/esp-idf-v5.4/export.sh
```

### Q2：`A fatal error occurred: Could not open /dev/ttyUSB0`

**原因**：串口不存在或权限不足。

**解决**：
```bash
# Linux：检查串口
ls /dev/tty*
# 如果权限不足
sudo usermod -a -G dialout $USER
# 然后退出重新登录

# macOS：检查串口
ls /dev/cu.*

# Windows：在设备管理器中查看端口号
```

### Q3：烧录卡在 `Connecting...` 然后超时

```
A fatal error occurred: Failed to connect to ESP32-S3: No serial data received.
```

**解决**：
1. 确认 USB 线是数据线（不是仅充电线）
2. 确认插的是 **UART 口**（不是 JTAG/USB 口）
3. 手动进入下载模式：按住 BOOT → 按一下 EN → 松开 BOOT → 再烧录
4. 换一根 USB 线试试

### Q4：`CMake Error: Could not find a package configuration file`

**原因**：组件依赖没有下载。

**解决**：
```bash
# 清理并重新配置
idf.py fullclean
idf.py set-target esp32s3
idf.py build
```

### Q5：编译报 `fatal error: cJSON.h: No such file or directory`

**原因**：ESP-IDF 内置的 cJSON 组件没正确配置。

**解决**：
- 确认 `main/CMakeLists.txt` 里的 `REQUIRES` 列表包含 `json`
- 确认 ESP-IDF 版本 ≥ 5.4

### Q6：编译报 `idf_component.yml: requires idf >= 5.4.0`

**原因**：你的 ESP-IDF 版本太低。

**解决**：
```bash
# 查看当前版本
idf.py --version

# 如果版本低于 5.4，需要升级 ESP-IDF
git -C ~/esp-idf-v5.4 checkout v5.4
git -C ~/esp-idf-v5.4 submodule update --init --recursive
~/esp-idf-v5.4/install.sh esp32s3
```

### Q7：Windows 下 Python 找不到

**解决**：用 ESP-IDF 自带的 Python，它在安装目录下（如 `C:\Espressif\python_env\`），不要另外装一个 Python。

### Q8：macOS M1/M2/M3 芯片编译很慢

**正常现象**。ARM Mac 上的 xtensa 交叉编译是模拟的，速度较慢。可以用以下方式加速：
```bash
idf.py -j$(sysctl -n hw.ncpu) build  # 利用所有核心
```

### Q9：烧录后设备无限重启

串口循环输出 `rst:0x1 (POWERON_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)`。

**解决**：
1. 确认 Flash 大小匹配（`sdkconfig.defaults` 里设了 8MB）
2. 擦除 Flash 后重新烧录：
   ```bash
   idf.py -p /dev/ttyUSB0 erase-flash
   idf.py -p /dev/ttyUSB0 flash
   ```

### Q10：蓝牙广播看不到设备

**解决**：
1. 检查编译配置中 NimBLE 和 BluFi 是否启用
2. 确认 `CONFIG_BT_NIMBLE_ENABLED=y` 和 `CONFIG_BT_NIMBLE_BLUFI_ENABLE=y`
3. 查看串口日志，看是否有 `BLUFI: BLE started` 字样
4. 如果日志中有 `BLUFI: init failed`，检查是否有其他组件占用了蓝牙

### Q11：配网后 WiFi 连接失败

**解决**：
1. 确认 WiFi 是 2.4GHz（ESP32-S3 不支持 5GHz）
2. 确认 SSID/密码在串口日志中正确显示
3. 信号太弱 → 把设备靠近路由器

---

## 7. 附录：命令速查

```bash
# ── 环境 ──
source ~/esp-idf-v5.4/export.sh       # 激活 ESP-IDF（每次新终端都要执行）
idf.py --version                        # 查看 ESP-IDF 版本
python3 -c "import serial"              # 验证 pyserial

# ── 项目配置 ──
idf.py set-target esp32s3              # 设置目标芯片（首次必须执行）
idf.py menuconfig                       # 打开图形化配置界面
idf.py reconfigure                      # 重新生成配置

# ── 编译 ──
idf.py build                            # 编译项目
idf.py fullclean                        # 清理所有编译产物（重置）
idf.py clean                            # 清理编译产物（保留配置）

# ── 烧录 ──
idf.py -p /dev/ttyUSB0 flash            # 烧录
idf.py -p /dev/ttyUSB0 flash monitor    # 烧录 + 打开串口监控
idf.py -p /dev/ttyUSB0 erase-flash      # 擦除整片 Flash

# ── 串口监控 ──
idf.py -p /dev/ttyUSB0 monitor          # 打开串口监控
# 退出监控：按 Ctrl + ]

# ── 查看设备信息 ──
esptool.py -p /dev/ttyUSB0 flash_id     # 查看 Flash 信息
esptool.py -p /dev/ttyUSB0 chip_id      # 查看芯片型号
```

---

## 项目具体信息（EspLink）

| 项目 | 值 |
|------|-----|
| 目标芯片 | ESP32-S3 |
| IDF 最低版本 | 5.4.0 |
| 实际编译的 IDF 版本 | 5.5.4（根目录 `sdkconfig` 记录） |
| Flash 大小 | 8 MB |
| PSRAM | Octal, 80MHz |
| BLE 协议栈 | NimBLE（不是 Bluedroid） |
| 配网协议 | BluFi |
| 蓝牙广播名 | `Device-` + MAC 后 4 位 |
| 分区表 | `partitions.csv`（含 2 个 OTA 分区 + 工厂分区） |
| 依赖组件 | `esp_websocket_client` (>= 1.0.0)、cJSON |
| 恢复出厂 | 长按 BOOT 键 (GPIO 0) 5 秒 |

---

> 遇到本文档未覆盖的问题，请把**完整的终端输出/错误日志**发给开发者排查。
> 串口日志是调试最有效的手段——任何问题先看串口输出！
