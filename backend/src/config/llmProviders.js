const PROVIDERS = {
  deepseek: {
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek V3（对话）' },
      { id: 'deepseek-reasoner', name: 'DeepSeek R1（推理）' },
    ],
  },
  glm: {
    name: '智谱 GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4/',
    models: [
      { id: 'glm-4-flash', name: 'GLM-4 Flash（免费）' },
      { id: 'glm-4-air', name: 'GLM-4 Air' },
      { id: 'glm-4-plus', name: 'GLM-4 Plus' },
      { id: 'glm-4', name: 'GLM-4' },
    ],
  },
  minimax: {
    name: 'MiniMax',
    baseURL: 'https://api.minimax.chat/v1',
    models: [
      { id: 'MiniMax-Text-01', name: 'MiniMax Text-01' },
      { id: 'abab6.5s-chat', name: 'ABAB 6.5S' },
    ],
  },
  moonshot: {
    name: 'Moonshot / Kimi',
    baseURL: 'https://api.moonshot.cn/v1',
    models: [
      { id: 'moonshot-v1-8k', name: 'Moonshot 8K' },
      { id: 'moonshot-v1-32k', name: 'Moonshot 32K' },
      { id: 'moonshot-v1-128k', name: 'Moonshot 128K' },
    ],
  },
  qwen: {
    name: '通义千问',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      { id: 'qwen-turbo', name: 'Qwen Turbo' },
      { id: 'qwen-plus', name: 'Qwen Plus' },
      { id: 'qwen-max', name: 'Qwen Max' },
    ],
  },
  volcano: {
    name: '火山引擎',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    models: [
      { id: 'doubao-pro-4k', name: '豆包 Pro 4K' },
      { id: 'doubao-pro-32k', name: '豆包 Pro 32K' },
      { id: 'doubao-lite-4k', name: '豆包 Lite 4K' },
    ],
  },
  openai: {
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'gpt-4o', name: 'GPT-4o' },
    ],
  },
};

// 预建 model → provider 索引
const MODEL_TO_PROVIDER = {};
for (const [key, config] of Object.entries(PROVIDERS)) {
  for (const model of config.models) {
    MODEL_TO_PROVIDER[model.id] = key;
  }
}

function getProviderForModel(modelId) {
  return MODEL_TO_PROVIDER[modelId] || null;
}

function getAllModels() {
  return Object.entries(PROVIDERS).flatMap(([key, config]) =>
    config.models.map((m) => ({ ...m, provider: key, providerName: config.name }))
  );
}

module.exports = { PROVIDERS, getProviderForModel, getAllModels };
