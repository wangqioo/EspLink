/**
 * BLE 工具封装
 * 过滤设备名以 "Device-" 开头的设备（固件广播名格式）
 */

const DEVICE_NAME_PREFIX = 'Device-'
const SCAN_TIMEOUT_MS    = 15000

function openAdapter() {
  return new Promise((resolve, reject) => {
    wx.openBluetoothAdapter({
      mode:    'central',
      success: resolve,
      fail(e) {
        if (e.errCode === 10001) reject(new Error('请开启手机蓝牙'))
        else reject(new Error('蓝牙初始化失败：' + e.errMsg))
      },
    })
  })
}

function closeAdapter() {
  wx.closeBluetoothAdapter()
}

/**
 * 扫描附近待配网设备
 * onFound(device): { deviceId, name, rssi }
 * 返回 stop 函数
 */
function startScan(onFound) {
  const found = new Set()

  wx.startBluetoothDevicesDiscovery({
    allowDuplicatesKey: false,
    interval: 0,
  })

  wx.onBluetoothDeviceFound((res) => {
    res.devices.forEach((d) => {
      const name = d.name || d.localName || ''
      if (!name.startsWith(DEVICE_NAME_PREFIX)) return
      if (found.has(d.deviceId)) return
      found.add(d.deviceId)
      onFound({ deviceId: d.deviceId, name, rssi: d.RSSI })
    })
  })

  // 超时自动停止
  const timer = setTimeout(() => {
    wx.stopBluetoothDevicesDiscovery()
  }, SCAN_TIMEOUT_MS)

  return () => {
    clearTimeout(timer)
    wx.stopBluetoothDevicesDiscovery()
  }
}

function connect(deviceId) {
  return new Promise((resolve, reject) => {
    wx.createBLEConnection({
      deviceId,
      timeout: 10000,
      success: resolve,
      fail:    (e) => reject(new Error('连接失败：' + e.errMsg)),
    })
  })
}

function disconnect(deviceId) {
  wx.closeBLEConnection({ deviceId })
}

function getServices(deviceId) {
  return new Promise((resolve, reject) => {
    wx.getBLEDeviceServices({
      deviceId,
      success: (res) => resolve(res.services),
      fail:    reject,
    })
  })
}

function getCharacteristics(deviceId, serviceId) {
  return new Promise((resolve, reject) => {
    wx.getBLEDeviceCharacteristics({
      deviceId,
      serviceId,
      success: (res) => resolve(res.characteristics),
      fail:    reject,
    })
  })
}

/**
 * 获取手机当前连接的 WiFi SSID
 * 返回 ssid 字符串，失败返回空字符串
 */
function getCurrentWifiSSID() {
  return new Promise((resolve) => {
    wx.getSetting({
      success(settingRes) {
        const authorized = settingRes.authSetting['scope.userLocation']
        if (authorized) {
          _doGetWifiSSID(resolve)
        } else {
          wx.authorize({
            scope: 'scope.userLocation',
            success: () => _doGetWifiSSID(resolve),
            fail:    () => resolve(''),
          })
        }
      },
      fail: () => resolve(''),
    })
  })
}

function _doGetWifiSSID(resolve) {
  wx.startWifi({
    success: () => {
      wx.getConnectedWifi({
        partialInfo: false,
        success: (res) => resolve(res.wifi ? res.wifi.SSID : ''),
        fail:    () => resolve(''),
      })
    },
    fail: () => resolve(''),
  })
}

module.exports = {
  openAdapter,
  closeAdapter,
  startScan,
  connect,
  disconnect,
  getServices,
  getCharacteristics,
  getCurrentWifiSSID,
}
