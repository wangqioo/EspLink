const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const pageDir = path.join(__dirname, '..', 'pages', 'provision')
const wxml = fs.readFileSync(path.join(pageDir, 'provision.wxml'), 'utf8')
const wxss = fs.readFileSync(path.join(pageDir, 'provision.wxss'), 'utf8')

function cssBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = wxss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  return match ? match[1] : ''
}

test('provision inputs keep a stable native layout for iOS rendering', () => {
  assert.match(wxml, /class="form-input"[\s\S]*bindinput="onSSIDInput"/)
  assert.match(wxml, /class="form-input"[\s\S]*bindinput="onPasswordInput"/)

  const inputCss = cssBlock('.form-input')
  assert.match(inputCss, /display:\s*block/)
  assert.match(inputCss, /height:\s*88rpx/)
  assert.match(inputCss, /min-height:\s*88rpx/)
  assert.match(inputCss, /line-height:\s*88rpx/)
  assert.match(inputCss, /padding:\s*0\s+24rpx/)
  assert.match(inputCss, /background:\s*#fff/)
})
