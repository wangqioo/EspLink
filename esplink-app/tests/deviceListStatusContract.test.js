const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const pageDir = path.join(__dirname, '..', 'pages', 'index')
const wxml = fs.readFileSync(path.join(pageDir, 'index.wxml'), 'utf8')
const wxss = fs.readFileSync(path.join(pageDir, 'index.wxss'), 'utf8')
const js = fs.readFileSync(path.join(pageDir, 'index.js'), 'utf8')

function cssBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = wxss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  return match ? match[1] : ''
}

test('device list maps backend device state into stable display fields', () => {
  assert.match(js, /displayName:\s*device\.alias\s*\|\|\s*device\.board_type/)
  assert.match(js, /firmwareText:\s*device\.firmware\s*\|\|\s*device\.firmware_version\s*\|\|\s*'未知版本'/)
  assert.match(js, /boardText:\s*device\.board_type\s*\|\|\s*'未知板型'/)
  assert.match(js, /bindingText:\s*isBound\s*\?\s*'已绑定'\s*:\s*'未绑定'/)
  assert.match(js, /onlineText:\s*device\.is_online\s*\?\s*'在线'\s*:\s*'离线'/)
})

test('device list renders firmware, board, binding, and online state', () => {
  assert.match(wxml, /\{\{item\.displayName\}\}/)
  assert.match(wxml, /\{\{item\.boardText\}\}/)
  assert.match(wxml, /固件 \{\{item\.firmwareText\}\}/)
  assert.match(wxml, /\{\{item\.bindingText\}\}/)
  assert.match(wxml, /\{\{item\.onlineText\}\}/)

  assert.match(cssBlock('.device-card'), /gap:\s*20rpx/)
  assert.match(cssBlock('.meta-pill'), /max-width:\s*220rpx/)
})
