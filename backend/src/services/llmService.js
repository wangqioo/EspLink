const { OpenAI } = require('openai');
const prisma = require('../config/database');
const { PROVIDERS, getProviderForModel } = require('../config/llmProviders');
const { incrementUsage } = require('./keyService');
const { checkAndAlert } = require('./alertService');

const DEFAULT_MODEL = process.env.DEFAULT_AI_MODEL || 'deepseek-chat';

function validateApiKeyForChat(apiKey) {
  if (!apiKey) throw new Error('API Key不存在');
  if (!apiKey.is_active) throw new Error('API Key已禁用');
  if (apiKey.expires_at && new Date() > new Date(apiKey.expires_at)) {
    throw new Error('API Key已过期');
  }
  if (apiKey.daily_limit !== null && apiKey.used_today >= apiKey.daily_limit) {
    throw new Error('今日额度已用完');
  }
  if (apiKey.monthly_limit !== null && apiKey.used_month >= apiKey.monthly_limit) {
    throw new Error('本月额度已用完');
  }
}

async function getActiveProvider(model) {
  const providerKey = getProviderForModel(model);
  if (!providerKey) throw new Error(`不支持的模型: ${model}`);

  const config = await prisma.llmProvider.findFirst({
    where: { provider: providerKey, is_active: true },
  });
  if (!config) throw new Error(`厂商 ${providerKey} 未配置或已禁用`);

  return { config, providerKey };
}

async function accountUsage({ apiKeyId, mac, model, inputTokens, outputTokens, latencyMs, success, errorMsg }) {
  if (!apiKeyId) return;

  await prisma.usageLog.create({
    data: {
      api_key_id: apiKeyId,
      device_mac: mac || null,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      latency_ms: latencyMs,
      success,
      error_msg: errorMsg,
    },
  });

  await incrementUsage(apiKeyId, inputTokens, outputTokens);

  const key = await prisma.apiKey.findUnique({
    where: { id: apiKeyId },
    select: {
      used_today: true,
      tenant: {
        select: {
          id: true,
          name: true,
          daily_limit: true,
          alert_threshold: true,
          usage_alert_webhook: true,
        },
      },
    },
  });
  if (key?.tenant) {
    await checkAndAlert(key.tenant, key.used_today).catch(() => {});
  }
}

// 流式对话，通过回调推送内容
async function streamChat({ messages, model, mac, apiKeyId, onChunk, onDone, onError }) {
  const startTime = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let success = true;
  let errorMsg = null;

  try {
    const { config, providerKey } = await getActiveProvider(model);
    const client = new OpenAI({
      apiKey: config.api_key,
      baseURL: PROVIDERS[providerKey].baseURL,
    });

    const stream = await client.chat.completions.create({
      model,
      messages,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) onChunk(delta);
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens || 0;
        outputTokens = chunk.usage.completion_tokens || 0;
      }
    }

    onDone({ inputTokens, outputTokens });
  } catch (err) {
    success = false;
    errorMsg = err.message;
    onError(err);
  } finally {
    await accountUsage({
      apiKeyId,
      mac,
      model,
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - startTime,
      success,
      errorMsg,
    }).catch(() => {});
  }
}

// 根据设备 MAC 查出应使用的模型和 apiKeyId
async function getModelForDevice(mac) {
  const device = await prisma.device.findUnique({
    where: { mac_address: mac },
    select: {
      api_key_id: true,
      api_key: {
        select: {
          id: true,
          is_active: true,
          expires_at: true,
          daily_limit: true,
          monthly_limit: true,
          used_today: true,
          used_month: true,
        },
      },
      tenant: { select: { ai_model: true } },
    },
  });
  if (device?.api_key_id) {
    validateApiKeyForChat(device.api_key);
  }
  return {
    model: device?.tenant?.ai_model || DEFAULT_MODEL,
    apiKeyId: device?.api_key_id || null,
  };
}

module.exports = { streamChat, getModelForDevice, DEFAULT_MODEL, accountUsage, validateApiKeyForChat };
