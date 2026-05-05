const api = require('./utils/api')

App({
  globalData: {
    userToken: null,
    userId: null,
    provisioningDevice: null,  // provision 页写入，success 页读取
  },

  onLaunch() {
    // 尝试读取缓存的 token
    const token = wx.getStorageSync('userToken')
    if (token) {
      this.globalData.userToken = token
      this.globalData.userId = wx.getStorageSync('userId')
    } else {
      this._doLogin()
    }
  },

  _doLogin() {
    wx.login({
      success: ({ code }) => {
        api.login(code)
          .then(({ token, user_id }) => {
            this.globalData.userToken = token
            this.globalData.userId = user_id
            wx.setStorageSync('userToken', token)
            wx.setStorageSync('userId', user_id)
          })
          .catch(err => console.error('登录失败', err))
      },
    })
  },

  // 供页面调用：确保已登录，返回 Promise<token>
  ensureLogin() {
    if (this.globalData.userToken) {
      return Promise.resolve(this.globalData.userToken)
    }
    return new Promise((resolve, reject) => {
      wx.login({
        success: ({ code }) => {
          api.login(code)
            .then(({ token, user_id }) => {
              this.globalData.userToken = token
              this.globalData.userId = user_id
              wx.setStorageSync('userToken', token)
              wx.setStorageSync('userId', user_id)
              resolve(token)
            })
            .catch(reject)
        },
        fail: reject,
      })
    })
  },
})
