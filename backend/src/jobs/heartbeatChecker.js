const cron = require('node-cron');
const devicePresence = require('../services/devicePresence');

function start() {
  // 每60秒：把超过2分钟未心跳的设备标记为离线
  cron.schedule('* * * * *', async () => {
    try {
      const count = await devicePresence.expireStale({ staleMinutes: 2 });
      if (count > 0) console.log(`[HeartbeatChecker] 标记 ${count} 台设备为离线`);
    } catch (err) {
      console.error('[HeartbeatChecker] 错误:', err.message);
    }
  });
}

module.exports = { start };
