# 2026-06-15 ESP32 OTA 实机验证手册

本文记录 `ai_deploy_backend` + `EspLink` 的本地 OTA 实机验证流程。目标是验证 ESP32 设备可以从后端获取固件发布信息，下载 OTA 包，写入 OTA 分区，重启后切换到新版本并重新上线。

## 本次实测结论

- 后端仓库：`/Users/wq/ai_deploy_backend`
- 固件仓库：`/Users/wq/EspLink`
- 后端地址：`http://192.168.1.26:8088`
- WebSocket 地址：`ws://192.168.1.26:8088/ws/device`
- 设备串口：`/dev/cu.usbmodem111301`
- 设备 MAC：`10:51:DB:80:E2:E8`
- 设备 IP：`192.168.1.32`
- 起始固件版本：`1.0.0`
- OTA 目标版本：`1.0.1`
- OTA 写入分区：`ota_0`
- OTA 结果：成功，重启后从 `0x1a0000` 启动并上报 `fw=1.0.1`

实测关键日志：

```text
main: OTA available, upgrading...
app_ota: OTA target version=1.0.1 force=0 size=1190880
esp_https_ota: Writing to <ota_0> partition at offset 0x1a0000
app_ota: OTA success, restarting
boot: Loaded app from partition at offset 0x1a0000
main: === device boot: board=esplink-v1 fw=1.0.1 ===
main: boot register ok, is_bound=1
app_ws: WebSocket connected
main: hello_ack: is_bound=1
```

## 前置条件

后端 `.env` 需要使用局域网可访问地址：

```env
PORT=8088
WS_BASE_URL=ws://192.168.1.26:8088
```

固件启动注册地址需要指向同一台后端机器：

```c
#define BOOT_REGISTER_URL "http://192.168.1.26:8088/api/ota/check"
```

设备分区表必须包含 OTA 分区：

```csv
otadata,  data, ota,     0xf000,   0x2000,
ota_0,    app,  ota_0,   0x1a0000, 0x180000,
ota_1,    app,  ota_1,   0x320000, 0x180000,
```

本地数据库需要与 Prisma schema 同步：

```bash
cd /Users/wq/ai_deploy_backend
npx prisma db push
```

## 1. 启动并验证后端

```bash
cd /Users/wq/ai_deploy_backend
npm start
```

验证 ready：

```bash
curl --noproxy '*' -s http://192.168.1.26:8088/api/v1/health/ready
```

期望结果：

```json
{"code":0,"data":{"db":true,"redis":true},"message":"ready"}
```

## 2. 构建 OTA 目标固件

在 `EspLink` 中把目标版本改高，例如从 `1.0.0` 改到 `1.0.1`：

```c
#define BOARD_FIRMWARE_VERSION "1.0.1"
```

构建固件：

```bash
cd /Users/wq/EspLink/esplink-firmware
source /Users/wq/esp-idf/export.sh
idf.py build
```

确认生成的 app 小于 OTA 分区。本次实测：

```text
esp32s3_device.bin binary size 0x122be0 bytes.
Smallest app partition is 0x180000 bytes. 0x5d420 bytes (24%) free.
```

## 3. 发布 OTA 包

推荐使用管理后台发布：

1. 打开 `http://127.0.0.1:5173`。
2. 使用 `admin / xiaozhi123` 登录。
3. 进入 `固件发布`。
4. 点击 `新建发布`。
5. 点击 `选择并上传 .bin`，选择构建出的固件包，例如：

```text
/Users/wq/EspLink/esplink-firmware/build/esp32s3_device.bin
```

上传后，页面会自动填入：

- 固件地址
- SHA256
- 文件大小（字节）

如果文件名符合 `板型-版本号.bin`，例如 `esplink-v1-1.0.2.bin`，页面还会自动填入目标板型和版本号。否则手动填写：

```text
目标板型：esplink-v1
版本号：1.0.1
渠道：stable
启用：打开
强制升级：按测试需要选择，默认关闭
发布说明：Local OTA validation build
```

点击 `确定` 后，后台会创建 firmware release。上传的固件会保存在：

```text
/Users/wq/ai_deploy_backend/uploads/firmware/
```

并通过后端静态地址提供下载：

```text
http://192.168.1.26:8088/firmware/<filename>.bin
```

命令行备选：手动计算元数据：

```bash
shasum -a 256 /Users/wq/EspLink/esplink-firmware/build/esp32s3_device.bin
wc -c /Users/wq/EspLink/esplink-firmware/build/esp32s3_device.bin
```

本次实测：

```text
sha256     = 0c37779f93b3d44940ab9f0325d962396d0629c31613f5bb663edf154d5098e3
size_bytes = 1190880
```

验证后端可下载。把 `<filename>` 替换成页面返回的文件名：

```bash
curl --noproxy '*' -I \
  http://192.168.1.26:8088/firmware/<filename>.bin
```

期望：

```text
HTTP/1.1 200 OK
Content-Type: application/octet-stream
Content-Length: 1190880
```

## 4. 创建 Firmware Release

网页发布成功后，可以直接跳到 OTA check 验证。

命令行备选：如果不使用网页，可以先登录获取 admin token：

```bash
ADMIN_TOKEN=$(curl --noproxy '*' -s \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"xiaozhi123"}' \
  http://192.168.1.26:8088/api/v1/auth/login \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).data.token))')
```

上传固件包并获取 URL、SHA256、文件大小：

```bash
curl --noproxy '*' -s \
  -H 'Content-Type: application/octet-stream' \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H 'X-Firmware-Filename: esplink-v1-1.0.1.bin' \
  --data-binary @/Users/wq/EspLink/esplink-firmware/build/esp32s3_device.bin \
  http://192.168.1.26:8088/api/v1/firmware/artifacts
```

再创建发布：

```bash
curl --noproxy '*' -s \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -d '{
    "board_type":"esplink-v1",
    "version":"1.0.1",
    "artifact_url":"http://192.168.1.26:8088/firmware/esplink-v1-1.0.1.bin",
    "sha256":"0c37779f93b3d44940ab9f0325d962396d0629c31613f5bb663edf154d5098e3",
    "size_bytes":1190880,
    "channel":"stable",
    "is_active":true,
    "force_update":false,
    "release_notes":"Local OTA validation build"
  }' \
  http://192.168.1.26:8088/api/v1/firmware/releases
```

验证 `/api/ota/check` 对旧版本返回更新：

```bash
curl --noproxy '*' -s \
  -H 'Content-Type: application/json' \
  -d '{
    "mac":"10:51:DB:80:E2:E8",
    "sn":"MAC-1051DB80E2E8",
    "board_type":"esplink-v1",
    "firmware_version":"1.0.0"
  }' \
  http://192.168.1.26:8088/api/ota/check
```

期望关键字段：

```json
{
  "update_available": true,
  "ota": {
    "version": "1.0.1",
    "url": "http://192.168.1.26:8088/firmware/esplink-v1-1.0.1.bin",
    "size_bytes": 1190880,
    "force": false
  }
}
```

## 5. 触发设备 OTA

打开串口监控。`idf.py monitor` 会通过 USB reset 触发设备重新启动：

```bash
cd /Users/wq/EspLink/esplink-firmware
source /Users/wq/esp-idf/export.sh
idf.py -p /dev/cu.usbmodem111301 monitor
```

观察以下阶段：

1. 设备以旧版本启动并上报：

```text
main: === device boot: board=esplink-v1 fw=1.0.0 ===
main: boot register: mac=10:51:DB:80:E2:E8 ... fw=1.0.0
```

2. 后端下发 OTA：

```text
main: OTA available, upgrading...
app_ota: OTA target url=http://192.168.1.26:8088/firmware/esplink-v1-1.0.1.bin
app_ota: OTA target version=1.0.1 force=0 size=1190880
```

3. ESP-IDF 写入 OTA 分区：

```text
esp_https_ota: Starting OTA...
esp_https_ota: Writing to <ota_0> partition at offset 0x1a0000
app_ota: OTA success, restarting
```

4. 重启后从 OTA 分区启动：

```text
boot: Loaded app from partition at offset 0x1a0000
main: === device boot: board=esplink-v1 fw=1.0.1 ===
```

5. 设备重新上线：

```text
main: boot register ok, is_bound=1
app_ws: connecting to ws://192.168.1.26:8088/ws/device
app_ws: WebSocket connected
main: hello_ack: is_bound=1
```

退出 monitor：

```text
Ctrl+]
```

## 6. 验证升级后状态

升级后再次调用 OTA check：

```bash
curl --noproxy '*' -s \
  -H 'Content-Type: application/json' \
  -d '{
    "mac":"10:51:DB:80:E2:E8",
    "sn":"MAC-1051DB80E2E8",
    "board_type":"esplink-v1",
    "firmware_version":"1.0.1"
  }' \
  http://192.168.1.26:8088/api/ota/check
```

期望：

```json
{
  "update_available": false,
  "ota": null
}
```

查询数据库设备记录：

```bash
cd /Users/wq/ai_deploy_backend
node -e 'require("dotenv").config(); const {PrismaClient}=require("@prisma/client"); const p=new PrismaClient(); p.device.findFirst({where:{mac_address:"10:51:DB:80:E2:E8"}, select:{mac_address:true, board_type:true, firmware:true, is_online:true, last_seen:true}}).then(d=>console.log(JSON.stringify(d,null,2))).finally(()=>p.$disconnect())'
```

本次实测结果：

```json
{
  "mac_address": "10:51:DB:80:E2:E8",
  "board_type": "esplink-v1",
  "firmware": "1.0.1",
  "is_online": true
}
```

## 常见问题

### 后端没有监听 8088

现象：

```text
boot register failed: ESP_ERR_HTTP_CONNECT
```

检查：

```bash
lsof -nP -iTCP:8088 -sTCP:LISTEN
curl --noproxy '*' -s http://192.168.1.26:8088/api/v1/health/ready
```

处理：启动后端，并确认 `.env` 的 `WS_BASE_URL` 使用局域网 IP。

### 数据库缺少 firmware_releases 表

现象：

```text
The table `firmware_releases` does not exist in the current database.
```

处理：

```bash
cd /Users/wq/ai_deploy_backend
npx prisma db push
```

同步后重启后端。

### 下载 URL 不可访问

现象：设备拿到 OTA 后下载失败。

检查：

```bash
curl --noproxy '*' -I http://192.168.1.26:8088/firmware/esplink-v1-1.0.1.bin
```

期望返回 `200 OK` 且 `Content-Length` 等于 release 的 `size_bytes`。

### 版本号没有变

现象：后端返回 `update_available:false`。

检查：

- 设备上报的 `firmware_version` 是否低于 release 版本。
- release 的 `board_type` 是否等于设备上报的 `esplink-v1`。
- release 是否 `is_active=true`。
- channel 是否为 `stable`。

### Monitor 显示 checksum mismatch

现象：

```text
Warning: Checksum mismatch between flashed and built applications.
```

原因：本地刚构建了 `1.0.1`，但设备启动时仍运行串口烧录过的 `1.0.0` factory 镜像。只要后续 OTA 写入成功并从 OTA 分区启动即可。

## 收尾建议

- 每次实机 OTA 验证后，把固件版本号提交到 `EspLink`。
- 本地测试用 bin 由后台上传到 `uploads/firmware/`，该目录不应提交到 git。
- 生产环境应使用 HTTPS/WSS，并关闭 `CONFIG_ESP_HTTPS_OTA_ALLOW_HTTP`。
- 当前固件只记录后端下发的 sha256，尚未做下载后严格 sha256 比对；生产前应补齐固件端完整性校验策略。
