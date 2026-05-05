const ble = require('../../utils/ble')
const { BluFi, SERVICE_UUID } = require('../../utils/blufi')

const PROVISION_TIMEOUT_MS = 30000

Page({
  data: {
    deviceId:    '',
    deviceName:  '',
    step:        0,      // 0=连接中 1=填写信息 2=配网中
    showPassword: true,
    canSubmit:   false,
    sending:     false,
    statusText:  '',
    errorMsg:    '',
  },

  // 输入值不走 setData，避免原生 input 组件被框架重置
  _ssid:           '',
  _password:       '',
  _blufi:          null,
  _provisionTimer: null,

  onLoad(options) {
    this.setData({
      deviceId:   options.deviceId || '',
      deviceName: options.name     || '未知设备',
    })
    this._connect()
  },

  onUnload() {
    this._cleanup()
  },

  _connect() {
    this.setData({ step: 0, errorMsg: '' })
    ble.connect(this.data.deviceId)
      .then(() => new Promise(r => setTimeout(r, 800)))
      .then(() => ble.getServices(this.data.deviceId))
      .then(() => ble.getCharacteristics(this.data.deviceId, SERVICE_UUID))
      .then(() => {
        this._blufi = new BluFi(this.data.deviceId)
        this.setData({ step: 1 })
        this._blufi.subscribeNotify(result => this._onProvisionResult(result))
      })
      .catch(e => {
        this.setData({ errorMsg: e.message || '连接设备失败' })
      })
  },

  onSSIDInput(e) {
    this._ssid = e.detail.value
    this.setData({ canSubmit: !!this._ssid && !!this._password })
  },

  onPasswordInput(e) {
    this._password = e.detail.value
    this.setData({ canSubmit: !!this._ssid && !!this._password })
  },

  togglePassword() {
    this.setData({ showPassword: !this.data.showPassword })
  },

  onStartProvision() {
    if (!this._ssid || !this._password) return
    this.setData({ step: 2, sending: true, errorMsg: '', statusText: '正在发送配网信息...' })

    this._blufi.provision(this._ssid, this._password)
      .then(() => {
        this.setData({ statusText: '等待设备连接 WiFi...' })
        this._provisionTimer = setTimeout(() => {
          this.setData({
            step:     1,
            sending:  false,
            errorMsg: '配网超时，请检查 WiFi 密码是否正确后重试',
          })
        }, PROVISION_TIMEOUT_MS)
      })
      .catch(e => {
        this.setData({ step: 1, sending: false, errorMsg: '发送失败：' + e.message })
      })
  },

  _onProvisionResult(result) {
    if (this._provisionTimer) {
      clearTimeout(this._provisionTimer)
      this._provisionTimer = null
    }
    if (result.success) {
      getApp().globalData.provisioningDevice = {
        deviceId:   this.data.deviceId,
        deviceName: this.data.deviceName,
      }
      this._cleanup()
      wx.redirectTo({ url: '/pages/success/success' })
    } else {
      this.setData({ step: 1, sending: false, errorMsg: result.message })
    }
  },

  _cleanup() {
    if (this._provisionTimer) clearTimeout(this._provisionTimer)
    ble.disconnect(this.data.deviceId)
  },

  onRetry() {
    this.setData({ errorMsg: '' })
    this._connect()
  },
})
