const ble = require('../../utils/ble')

Page({
  data: {
    scanning: false,
    devices:  [],
  },

  _stopScan: null,

  onLoad() {
    this._startScan()
  },

  onUnload() {
    if (this._stopScan) this._stopScan()
    ble.closeAdapter()
  },

  async _startScan() {
    this.setData({ scanning: true, devices: [] })
    try {
      await ble.openAdapter()
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' })
      this.setData({ scanning: false })
      return
    }

    this._stopScan = ble.startScan((device) => {
      const list = this.data.devices
      if (list.find(d => d.deviceId === device.deviceId)) return
      this.setData({ devices: [...list, device] })
    })

    // 15 秒后自动停止
    setTimeout(() => {
      this.setData({ scanning: false })
    }, 15000)
  },

  onRescan() {
    if (this._stopScan) this._stopScan()
    this._startScan()
  },

  onSelectDevice(e) {
    const device = e.currentTarget.dataset.device
    if (this._stopScan) this._stopScan()
    this.setData({ scanning: false })

    wx.navigateTo({
      url: `/pages/provision/provision?deviceId=${device.deviceId}&name=${device.name}`,
    })
  },
})
