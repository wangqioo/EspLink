const BASE_URL = 'https://your-server.com'  // 换成真实服务器地址

function request(method, path, data, needAuth = true) {
  return new Promise((resolve, reject) => {
    const app = getApp()
    const header = { 'Content-Type': 'application/json' }
    if (needAuth && app.globalData.userToken) {
      header['Authorization'] = `Bearer ${app.globalData.userToken}`
    }
    wx.request({
      url: BASE_URL + path,
      method,
      data,
      header,
      success: ({ statusCode, data: res }) => {
        if (statusCode >= 200 && statusCode < 300) {
          resolve(res)
        } else {
          reject(new Error((res && res.detail) || `HTTP ${statusCode}`))
        }
      },
      fail: (err) => reject(new Error(err.errMsg || '网络错误')),
    })
  })
}

module.exports = {
  // 微信登录
  login: (code) =>
    request('POST', '/api/auth/wechat', { code }, false),

  // 设备列表
  getDeviceList: () =>
    request('GET', '/api/device/list'),

  // 配网后按 MAC 后缀查找刚上线的设备
  lookupDevice: (macSuffix) =>
    request('GET', `/api/device/lookup?mac_suffix=${macSuffix}`),

  // 绑定设备到当前账号
  bindDevice: (mac) =>
    request('POST', '/api/device/bind', { mac }),

  // 向设备下发指令
  sendCommand: (deviceId, payload) =>
    request('POST', `/api/device/${deviceId}/command`, { payload }),
}
