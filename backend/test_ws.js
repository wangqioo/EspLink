const WebSocket = require('ws');

const DEVICE_KEY = process.argv[2];
const STEP = process.argv[3] || 'ping'; // ping | hello | ai
if (!DEVICE_KEY) { console.error('用法: node test_ws.js <device_key> [ping|hello|ai]'); process.exit(1); }

const ws = new WebSocket('ws://localhost:8088/ws/device', {
  headers: { Authorization: `Bearer ${DEVICE_KEY}` },
});

ws.on('open', () => {
  console.log('[连接] WebSocket 已建立，测试步骤:', STEP);

  if (STEP === 'ping') {
    const msg = { type: 'ping' };
    console.log('[发送]', JSON.stringify(msg));
    ws.send(JSON.stringify(msg));
  } else if (STEP === 'hello') {
    const msg = { type: 'hello', capabilities: ['tts', 'asr'], firmware_version: '1.0.0', session_id: 'test001' };
    console.log('[发送]', JSON.stringify(msg));
    ws.send(JSON.stringify(msg));
  } else if (STEP === 'ai') {
    const hello = { type: 'hello', capabilities: ['tts', 'asr'], firmware_version: '1.0.0', session_id: 'test001' };
    console.log('[发送]', JSON.stringify(hello));
    ws.send(JSON.stringify(hello));
  }
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('[收到]', JSON.stringify(msg));

  if (msg.type === 'pong') {
    console.log('\n✅ ping/pong 正常，关闭连接');
    ws.close();
  }

  if (msg.type === 'hello_ack' && STEP === 'hello') {
    console.log('\n✅ hello_ack 正常，关闭连接');
    ws.close();
  }

  if (msg.type === 'hello_ack' && STEP === 'ai') {
    console.log('\n--- hello_ack 收到，发送 ai_chat ---\n');
    const aiChat = {
      type: 'ai_chat',
      session_id: 'test001',
      messages: [{ role: 'user', content: '你好，用一句话介绍你自己' }],
    };
    console.log('[发送]', JSON.stringify(aiChat));
    ws.send(JSON.stringify(aiChat));
  }

  if (msg.type === 'ai_chunk') {
    process.stdout.write(msg.delta || '');
  }

  if (msg.type === 'ai_done') {
    console.log('\n\n✅ AI 对话完成:', JSON.stringify(msg.usage));
    ws.close();
  }

  if (msg.type === 'ai_error') {
    console.log('\n❌ AI 错误:', msg.error);
    ws.close();
  }
});

ws.on('error', (err) => console.error('[错误]', err.message));
ws.on('close', () => { console.log('[关闭] 连接断开'); process.exit(0); });

setTimeout(() => { console.log('[超时] 15 秒无响应，强制退出'); process.exit(1); }, 15000);
