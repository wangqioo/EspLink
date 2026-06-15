const express = require('express');
const prisma = require('../config/database');
const adminAuth = require('../middleware/adminAuth');
const { getAllModels, PROVIDERS } = require('../config/llmProviders');
const { success, error } = require('../utils/response');
const router = express.Router();

router.use(adminAuth);

// GET /api/v1/llm/models — 所有支持的模型列表（含厂商分组）
router.get('/models', (req, res) => {
  res.json(success(getAllModels()));
});

// GET /api/v1/llm/providers — 所有厂商配置状态（API Key 脱敏）
router.get('/providers', async (req, res, next) => {
  try {
    const rows = await prisma.llmProvider.findMany({ orderBy: { provider: 'asc' } });
    const result = Object.entries(PROVIDERS).map(([key, meta]) => {
      const row = rows.find((r) => r.provider === key);
      return {
        provider: key,
        name: meta.name,
        models: meta.models,
        is_configured: !!row,
        is_active: row?.is_active ?? false,
        id: row?.id ?? null,
        api_key_masked: row
          ? `${row.api_key.slice(0, 6)}...${row.api_key.slice(-4)}`
          : null,
        updated_at: row?.updated_at ?? null,
      };
    });
    res.json(success(result));
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/llm/providers/:provider — 新增或更新 API Key
router.put('/providers/:provider', async (req, res, next) => {
  try {
    const { provider } = req.params;
    if (!PROVIDERS[provider]) {
      return res.status(400).json(error(40000, '不支持的厂商'));
    }
    const { api_key, is_active } = req.body || {};
    if (!api_key) return res.status(400).json(error(40000, 'api_key 不能为空'));

    const existing = await prisma.llmProvider.findFirst({ where: { provider } });
    const data = { api_key, is_active: is_active ?? true };

    const row = existing
      ? await prisma.llmProvider.update({ where: { id: existing.id }, data })
      : await prisma.llmProvider.create({ data: { provider, ...data } });

    res.json(success(row));
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/llm/providers/:provider/toggle — 启用 / 禁用
router.patch('/providers/:provider/toggle', async (req, res, next) => {
  try {
    const existing = await prisma.llmProvider.findFirst({
      where: { provider: req.params.provider },
    });
    if (!existing) return res.status(404).json(error(40401, '尚未配置该厂商'));

    const updated = await prisma.llmProvider.update({
      where: { id: existing.id },
      data: { is_active: !existing.is_active },
    });
    res.json(success(updated));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
