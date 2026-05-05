const api = require('../../utils/api')
const { getDevicePage } = require('../../utils/device-page-registry')

Page({
  data: {
    device:  null,
    loading: true,
  },

  _deviceId: null,

  onLoad(options) {
    this._deviceId = options.id
    wx.setNavigationBarTitle({ title: options.name || '设备详情' })
    this._loadDevice()
  },

  onShow() {
    if (this.data.device) this._loadDevice()
  },

  async _loadDevice() {
    try {
      const { devices } = await api.getDeviceList()
      const device = devices.find(d => String(d.id) === String(this._deviceId))
      if (!device) {
        wx.showToast({ title: '设备不存在', icon: 'none' })
        return
      }
      this.setData({ device, loading: false })
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' })
      this.setData({ loading: false })
    }
  },

  onOpenFeaturePage() {
    const { device } = this.data
    if (!device) return
    const pagePath = getDevicePage(device.capabilities)
    wx.navigateTo({ url: `${pagePath}?deviceId=${device.id}` })
  },
})
