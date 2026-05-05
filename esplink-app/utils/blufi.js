/**
 * BluFi 协议实现
 *
 * GATT Service:  0000FFFF-0000-1000-8000-00805F9B34FB
 * Write char:    0000FF01-0000-1000-8000-00805F9B34FB  (Phone → ESP32)
 * Notify char:   0000FF02-0000-1000-8000-00805F9B34FB  (ESP32 → Phone)
 *
 * 帧格式: [type:1][frame_ctrl:1][seq:1][data_len:1][data:N]
 * 本实现不加密、不分片（SSID/密码均 < 20 字节时无需分片）
 */

const SERVICE_UUID   = '0000FFFF-0000-1000-8000-00805F9B34FB'
const WRITE_UUID     = '0000FF01-0000-1000-8000-00805F9B34FB'
const NOTIFY_UUID    = '0000FF02-0000-1000-8000-00805F9B34FB'

// type 字节 = (subtype << 2) | frame_type
const TYPE_CTRL = 0x00
const TYPE_DATA = 0x01

const SUBTYPE_CTRL_CONNECT_AP = 0x03  // 通知 ESP32 连接 AP  (BLUFI_TYPE_CTRL_SUBTYPE_CONN_TO_AP)
const SUBTYPE_DATA_STA_SSID   = 0x02  // STA SSID           (BLUFI_TYPE_DATA_SUBTYPE_STA_SSID)
const SUBTYPE_DATA_STA_PASSWD = 0x03  // STA Password       (BLUFI_TYPE_DATA_SUBTYPE_STA_PASSWD)

function makeType(frameType, subtype) {
  return (subtype << 2) | frameType
}

function makeFrame(type, seq, dataBytes) {
  const len = dataBytes.length
  const buf = new Uint8Array(4 + len)
  buf[0] = type
  buf[1] = 0x00          // frame_ctrl: no encrypt, no checksum, no frag
  buf[2] = seq & 0xFF
  buf[3] = len & 0xFF
  buf.set(dataBytes, 4)
  return buf.buffer
}

function strToBytes(str) {
  const bytes = []
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i)
    // handle surrogate pairs (emoji etc.)
    if (code >= 0xD800 && code <= 0xDBFF && i + 1 < str.length) {
      const lo = str.charCodeAt(i + 1)
      if (lo >= 0xDC00 && lo <= 0xDFFF) {
        code = 0x10000 + ((code - 0xD800) << 10) + (lo - 0xDC00)
        i++
      }
    }
    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F))
    } else if (code < 0x10000) {
      bytes.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F))
    } else {
      bytes.push(
        0xF0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3F),
        0x80 | ((code >> 6) & 0x3F),
        0x80 | (code & 0x3F)
      )
    }
  }
  return new Uint8Array(bytes)
}

class BluFi {
  constructor(deviceId) {
    this.deviceId  = deviceId
    this.seq       = 0
    this.writeUUID = WRITE_UUID
  }

  _nextSeq() {
    return this.seq++
  }

  _write(buffer) {
    return new Promise((resolve, reject) => {
      wx.writeBLECharacteristicValue({
        deviceId:         this.deviceId,
        serviceId:        SERVICE_UUID,
        characteristicId: this.writeUUID,
        value:            buffer,
        success: resolve,
        fail:    reject,
      })
    })
  }

  /**
   * 订阅 ESP32 通知（配网结果回调）
   * onNotify(result): result = { success: bool, message: string }
   */
  subscribeNotify(onNotify) {
    wx.notifyBLECharacteristicValueChange({
      deviceId:         this.deviceId,
      serviceId:        SERVICE_UUID,
      characteristicId: NOTIFY_UUID,
      state:            true,
      success: () => {
        wx.onBLECharacteristicValueChange((res) => {
          const normalize = s => s.toUpperCase().replace(/-/g, '')
    if (normalize(res.characteristicId) !== normalize(NOTIFY_UUID)) return
          this._handleNotify(res.value, onNotify)
        })
      },
    })
  }

  _handleNotify(buffer, onNotify) {
    const bytes = new Uint8Array(buffer)
    if (bytes.length < 4) return
    const type      = bytes[0]
    const frameType = type & 0x03
    const subtype   = (type >> 2) & 0x3F
    // subtype 0x0f = WiFi connection state report (BLUFI_TYPE_DATA_SUBTYPE_WIFI_REP)
    if (frameType === TYPE_DATA && subtype === 0x0f) {
      const opmode   = bytes[4]
      const staState = bytes[5]
      const success  = (staState === 0)   // 0 = connected
      onNotify({ success, message: success ? '配网成功' : '连接失败，请检查密码' })
    }
  }

  /** 发送 STA SSID */
  async sendSSID(ssid) {
    const frame = makeFrame(
      makeType(TYPE_DATA, SUBTYPE_DATA_STA_SSID),
      this._nextSeq(),
      strToBytes(ssid)
    )
    await this._write(frame)
  }

  /** 发送 STA 密码 */
  async sendPassword(password) {
    const frame = makeFrame(
      makeType(TYPE_DATA, SUBTYPE_DATA_STA_PASSWD),
      this._nextSeq(),
      strToBytes(password)
    )
    await this._write(frame)
  }

  /** 通知 ESP32 开始连接 AP */
  async sendConnectAP() {
    const frame = makeFrame(
      makeType(TYPE_CTRL, SUBTYPE_CTRL_CONNECT_AP),
      this._nextSeq(),
      new Uint8Array(0)
    )
    await this._write(frame)
  }

  /** 完整配网流程：发 SSID → 发密码 → 发连接指令 */
  async provision(ssid, password) {
    await this.sendSSID(ssid)
    await this.sendPassword(password)
    await this.sendConnectAP()
  }
}

module.exports = { BluFi, SERVICE_UUID, WRITE_UUID, NOTIFY_UUID }
