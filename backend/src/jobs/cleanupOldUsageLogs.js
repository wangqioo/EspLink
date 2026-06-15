const cron = require('node-cron');
const prisma = require('../config/database');

function start() {
  // 每天凌晨2点：删除7天前的明细日志（保留聚合表数据）
  cron.schedule('0 2 * * *', async () => {
    try {
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const { count } = await prisma.usageLog.deleteMany({
        where: { timestamp: { lt: cutoff } },
      });
      console.log(`[Cleanup] 删除了 ${count} 条7天前的用量明细`);
    } catch (err) {
      console.error('[Cleanup] 错误:', err.message);
    }
  });
}

module.exports = { start };
