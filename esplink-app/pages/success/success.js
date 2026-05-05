const api = require('../../utils/api')

const POLL_INTERVAL_MS = 2500   // 每 2.5s 查一次
const POLL_MAX_TIMES   = 16     // 最多 40s

Page({
  data: {
    deviceName:  '',
    bindStatus:  'waiting',   // waiting | binding | bound | failed
    boundDevice: null,
  },

  _pollTimer:  null,
  _pollCount:  0,
  _macSuffix:  '',

  onLoad() {
    const { deviceName, macSuffix } = getApp().globalData.provisioningDevice || {}
    this._macSuffix = macSuffix || ''
    this.setData({ deviceName: deviceName || '未知设备' })

    if (this._macSuffix) {
      this._startPolling()
    } else {
      this.setData({ bindStatus: 'failed' })
    }
  },

  onUnload() {
    this._stopPolling()
  },

  _startPolling() {
    this.setData({ bindStatus: 'waiting' })
    this._pollCount = 0
    this._poll()
  },

  _poll() {
    this._pollCount++
    if (this._pollCount > POLL_MAX_TIMES) {
      this.setData({ bindStatus: 'failed' })
      return
    }

    api.lookupDevice(this._macSuffix)
      .then(device => {
        this._stopPolling()
        this.setData({ bindStatus: 'binding' })
        return api.bindDevice(device.mac).then(() => device)
      })
      .then(device => {
        this.setData({ bindStatus: 'bound', boundDevice: device })
      })
      .catch(() => {
        // 设备还没上线，继续轮询
        this._pollTimer = setTimeout(() => this._poll(), POLL_INTERVAL_MS)
      })
  },

  _stopPolling() {
    if (this._pollTimer) {
      clearTimeout(this._pollTimer)
      this._pollTimer = null
    }
  },

  onViewDevice() {
    const d = this.data.boundDevice
    if (!d) return
    wx.reLaunch({
      url: `/pages/device/device?id=${d.id}&name=${this.data.deviceName}`,
    })
  },

  onGoHome() {
    wx.reLaunch({ url: '/pages/index/index' })
  },

  onAddMore() {
    wx.reLaunch({ url: '/pages/scan/scan' })
  },
})
