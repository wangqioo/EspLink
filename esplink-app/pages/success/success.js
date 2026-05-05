Page({
  data: {
    deviceName: '',
    deviceId:   '',
  },

  onLoad() {
    const app    = getApp()
    const device = app.globalData.provisioningDevice || {}
    this.setData({
      deviceName: device.deviceName || '未知设备',
      deviceId:   device.deviceId  || '',
    })
  },

  onGoHome() {
    wx.reLaunch({ url: '/pages/index/index' })
  },

  onAddMore() {
    wx.navigateTo({ url: '/pages/index/index' })
  },
})
