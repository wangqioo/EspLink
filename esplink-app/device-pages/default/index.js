const api = require('../../utils/api')

Page({
  data: {
    device:   null,
    sending:  false,
  },

  _deviceId: null,

  onLoad(options) {
    this._deviceId = options.deviceId
    this._loadDevice()
  },

  onShow() {
    if (this.data.device) this._loadDevice()
  },

  async _loadDevice() {
    try {
      const { devices } = await api.getDeviceList()
      const device = devices.find(d => String(d.id) === String(this._deviceId))
      if (device) this.setData({ device })
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' })
    }
  },

  async onSendPing() {
    if (this.data.sending) return
    this.setData({ sending: true })
    try {
      await api.sendCommand(this._deviceId, { action: 'ping' })
      wx.showToast({ title: '指令已发送', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' })
    } finally {
      this.setData({ sending: false })
    }
  },
})
