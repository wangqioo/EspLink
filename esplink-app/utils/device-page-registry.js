// board_type → 功能页路径映射
// 新增产品时在这里添加一行，其他代码不用动
const registry = {
  'default': '/device-pages/default/index',
}

function getDevicePage(capabilities) {
  const uiPage = (capabilities && capabilities.ui_page) || 'default'
  return registry[uiPage] || registry['default']
}

module.exports = { getDevicePage }
