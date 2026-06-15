require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const requestId = require('./middleware/requestId');
const errorHandler = require('./middleware/errorHandler');
const routes = require('./routes');
const eslinkRoutes = require('./routes/esplink');
const wsManager = require('./ws/deviceWsManager');
const { getUploadDir } = require('./services/firmwareArtifactService');

const app = express();

app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
  credentials: true,
}));

app.use(morgan('[:date[iso]] :method :url :status :response-time ms'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(requestId);

app.use('/api/v1', routes);
app.use('/api', eslinkRoutes);   // EspLink 兼容路由（无 v1 前缀）
app.use('/firmware', express.static(getUploadDir()));

// Serve frontend static files (built by Vite)
const frontendDist = path.join(__dirname, '../admin-frontend/dist');
app.use(express.static(frontendDist));

// SPA fallback: unmatched routes serve index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(frontendDist, 'index.html'));
});

app.use(errorHandler);

const PORT = parseInt(process.env.PORT) || 8088;

if (require.main === module) {
  const server = http.createServer(app);
  wsManager.setup(server);

  server.listen(PORT, () => {
    console.log(`[Server] 小氧AI后台API 启动，端口 ${PORT}`);
    console.log(`[Server] 环境: ${process.env.NODE_ENV || 'development'}`);

    // 启动定时任务
    require('./jobs/heartbeatChecker').start();
    require('./jobs/usageAggregator').start();
    require('./jobs/cleanupOldUsageLogs').start();
    console.log('[Jobs] 定时任务已启动');
  });
}

module.exports = app;
