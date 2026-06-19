const api = require('../../utils/api')

Page({
  data: {
    devices:    [],
    loading:    true,
    refreshing: false,
  },

  onLoad() {
    getApp().ensureLogin().then(() => this._loadDevices())
  },

  onShow() {
    // 每次回到首页刷新列表（配网完成返回后也会触发）
    if (!this.data.loading) this._loadDevices()
  },

  async _loadDevices() {
    try {
      const { devices } = await api.getDeviceList()
      this.setData({
        devices: devices.map(device => {
          const isBound = Boolean(device.wechat_user_id || device.is_bound)
          return {
            ...device,
            displayName: device.alias || device.board_type || device.mac_address || '未命名设备',
            firmwareText: device.firmware || device.firmware_version || '未知版本',
            boardText: device.board_type || '未知板型',
            bindingText: isBound ? '已绑定' : '未绑定',
            onlineText: device.is_online ? '在线' : '离线',
          }
        }),
        loading: false,
        refreshing: false,
      })
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' })
      this.setData({ loading: false, refreshing: false })
    }
  },

  onRefresh() {
    this.setData({ refreshing: true })
    this._loadDevices()
  },

  onAddDevice() {
    wx.navigateTo({ url: '/pages/scan/scan' })
  },

  onTapDevice(e) {
    const device = e.currentTarget.dataset.device
    wx.navigateTo({
      url: `/pages/device/device?id=${device.id}&name=${device.alias || device.board_type}`,
    })
  },
})
