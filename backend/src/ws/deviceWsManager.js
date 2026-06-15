const { WebSocketServer } = require('ws');
const prisma = require('../config/database');
const llmService = require('../services/llmService');
const devicePresence = require('../services/devicePresence');
const devicePresenceProjection = require('../services/devicePresenceProjection');
const deviceCommandBroker = require('../services/deviceCommandBroker');
const deviceAbuseProtection = require('../services/deviceAbuseProtection');
const { normalizeVersion } = require('../services/firmwareVersionPolicy');

// mac_address → WebSocket 实例
const connections = new Map();
const INSTANCE_ID = process.env.INSTANCE_ID || `${process.pid}`;
let connectionSeq = 0;

function nextOwnerId() {
  connectionSeq += 1;
  return `${INSTANCE_ID}:${Date.now()}:${connectionSeq}`;
}

async function checkAiRateLimit(mac, isBound) {
  return deviceAbuseProtection.checkAiChatRate({ mac, isBound });
}

function setup(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/device' });

  deviceCommandBroker.subscribe(INSTANCE_ID, ({ mac, payload }) => {
    sendCommand(mac, payload);
  });

  wss.on('connection', async (ws, req) => {
    // 在 async 认证完成前先缓冲所有消息，防止竞态丢消息
    const msgBuffer = [];
    const bufferMsg = (raw) => msgBuffer.push(raw);
    ws.on('message', bufferMsg);

    const auth = (req.headers['authorization'] || '').trim();
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    let device;
    try {
      device = await prisma.device.findFirst({ where: { device_key: token } });
    } catch {
      ws.close(4001, 'DB error');
      return;
    }
    if (!device) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    const mac = device.mac_address;
    const ownerId = nextOwnerId();
    // 踢掉同一设备的旧连接
    const old = connections.get(mac);
    if (old && old.readyState === 1) old.close(4000, 'replaced');
    connections.set(mac, ws);

    try {
      await devicePresence.markConnected(mac);
    } catch {}
    try {
      await devicePresenceProjection.register(mac, { ownerId, instanceId: INSTANCE_ID });
    } catch {}

    // 切换为正式消息处理器，并重放缓冲中的消息
    ws.off('message', bufferMsg);

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.type === 'hello') {
        try {
          const firmwareVersion = normalizeVersion(msg.firmware_version);
          const data = {
            ...(firmwareVersion && { firmware: firmwareVersion }),
            ...(msg.capabilities && { capabilities: JSON.stringify(msg.capabilities) }),
          };
          if (Object.keys(data).length > 0) {
            await prisma.device.update({
              where: { mac_address: mac },
              data,
            });
          }
          await devicePresence.markHeartbeat(mac);
          await devicePresenceProjection.heartbeat(mac, { ownerId });
        } catch {}
        const latest = await prisma.device.findUnique({ where: { mac_address: mac } });
        ws.send(JSON.stringify({ type: 'hello_ack', is_bound: latest?.wechat_user_id != null }));

      } else if (msg.type === 'ping') {
        try {
          await devicePresence.markHeartbeat(mac);
          await devicePresenceProjection.heartbeat(mac, { ownerId });
        } catch {}
        ws.send(JSON.stringify({ type: 'pong' }));

      } else if (msg.type === 'ai_chat') {
        const { session_id, messages } = msg;
        if (!Array.isArray(messages) || messages.length === 0) {
          ws.send(JSON.stringify({ type: 'ai_error', session_id, error: 'messages 不能为空' }));
          return;
        }
        const allowed = await checkAiRateLimit(mac, device.wechat_user_id != null);
        if (!allowed) {
          ws.send(JSON.stringify({ type: 'ai_error', session_id, error: '请求过于频繁，请稍后再试' }));
          return;
        }
        const { model, apiKeyId } = await llmService.getModelForDevice(mac);
        await llmService.streamChat({
          messages,
          model,
          mac,
          apiKeyId,
          onChunk: (delta) => {
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: 'ai_chunk', session_id, delta }));
            }
          },
          onDone: ({ inputTokens, outputTokens }) => {
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: 'ai_done', session_id, usage: { input_tokens: inputTokens, output_tokens: outputTokens } }));
            }
          },
          onError: (err) => {
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: 'ai_error', session_id, error: err.message }));
            }
          },
        });

      } else if (msg.type === 'status' || msg.type === 'event') {
        console.log(`[WS] ${mac} ${msg.type}:`, JSON.stringify(msg.payload));
      }
    });

    ws.on('close', async () => {
      if (connections.get(mac) !== ws) return;
      connections.delete(mac);
      try {
        await devicePresence.markDisconnected(mac);
        await devicePresenceProjection.disconnect(mac, { ownerId });
      } catch {}
    });

    ws.on('error', (err) => {
      console.error(`[WS] ${mac} error:`, err.message);
    });

    console.log(`[WS] device connected: ${mac}`);

    // 重放认证期间缓冲的消息
    for (const raw of msgBuffer) ws.emit('message', raw);
  });

  console.log('[WS] WebSocket 服务已启动，路径 /ws/device');
  return wss;
}

// 向设备推送指令，返回是否成功
function sendCommand(mac, payload) {
  const ws = connections.get(mac);
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify({ type: 'command', payload }));
  return true;
}

function isConnected(mac) {
  const ws = connections.get(mac);
  return !!(ws && ws.readyState === 1);
}

module.exports = { setup, sendCommand, isConnected, checkAiRateLimit };
