import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { requireAgent, requireRole, requireAuth } from '../lib/auth.js';
import { asyncHandler, ApiError, parse } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';
import { maskSecret, decryptSecret, encryptSecret } from '../lib/crypto.js';
import {
  getAiSettings,
  testAiConnection,
} from '../lib/ai-config.js';
import {
  getEmbeddingSettings,
  resolveEmbeddingConfig,
  testEmbeddingConfig,
  clearEmbeddingCache,
} from '../lib/embeddings.js';
import { resetVectorStore, configuredVectorStore } from '../vector/index.js';
import { reindexAllDocuments } from '../lib/indexer.js';
import { nowIso } from '../lib/time.js';

const router = Router();

function setting(key: string): string {
  return (
    getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
  )?.value ?? '';
}

function upsert(key: string, value: string) {
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
    .run(key, value);
}

function aiView() {
  const settings = getAiSettings();
  return {
    ...settings,
    maskedKey: settings.hasKey
      ? maskSecret(decryptSecret(setting('ai_api_key')))
      : '',
  };
}

function embeddingView() {
  const settings = getEmbeddingSettings();
  return {
    ...settings,
    maskedKey: settings.hasKey
      ? maskSecret(decryptSecret(setting('embedding_api_key')))
      : '',
    vectorStore: configuredVectorStore(),
  };
}

function slaPolicies() {
  return getDb()
    .prepare('SELECT * FROM sla_policies WHERE workspace_id = ? ORDER BY first_response_minutes')
    .all(
      (getDb().prepare('SELECT id FROM workspaces LIMIT 1').get() as { id: string }).id,
    );
}

router.get(
  '/',
  requireAgent,
  asyncHandler(async (req, res) => {
    const workspace = getDb()
      .prepare('SELECT * FROM workspaces WHERE id = ?')
      .get(req.user!.workspaceId) as
      | { id: string; name: string; plan: string }
      | undefined;
    const counts = getDb()
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM users WHERE workspace_id = ?) AS users,
          (SELECT COUNT(*) FROM tickets WHERE workspace_id = ?) AS tickets,
          (SELECT COUNT(*) FROM documents) AS documents,
          (SELECT COALESCE(SUM(chunk_count), 0) FROM documents) AS chunks,
          (SELECT COUNT(*) FROM ai_runs WHERE workspace_id = ?) AS ai_runs`,
      )
      .get(req.user!.workspaceId, req.user!.workspaceId, req.user!.workspaceId) as Record<
      string,
      number
    >;
    res.json({
      data: {
        workspace: {
          id: workspace?.id,
          name: workspace?.name ?? '北岸云科技',
          plan: workspace?.plan ?? 'Enterprise',
          csatTarget: Number(setting('csat_target') || 4.5),
        },
        ai: aiView(),
        embedding: embeddingView(),
        slaPolicies: slaPolicies(),
        counts,
      },
    });
  }),
);

router.get(
  '/embedding',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ data: embeddingView() });
  }),
);

router.post(
  '/ai/test',
  requireAgent,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (_req, res) => {
    const result = await testAiConnection();
    res.json({ data: result });
  }),
);

router.patch(
  '/ai',
  requireAgent,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        backend: z.enum(['mock', 'openai']),
        baseUrl: z.string().trim().max(300).optional().default(''),
        apiKey: z.string().max(500).optional(),
        clearKey: z.boolean().optional(),
        model: z.string().trim().max(120).optional().default(''),
        autoSend: z.boolean(),
        confidenceThreshold: z.number().min(0.3).max(0.99),
      }),
      req.body,
    );
    upsert('ai_backend', body.backend);
    upsert('ai_base_url', body.baseUrl.replace(/\/+$/, ''));
    upsert('ai_model', body.model || (body.backend === 'mock' ? 'supportpilot-mock-1' : ''));
    if (body.clearKey) upsert('ai_api_key', '');
    else if (body.apiKey) upsert('ai_api_key', encryptSecret(body.apiKey));
    upsert('ai_auto_send', String(body.autoSend));
    upsert('ai_confidence_threshold', String(body.confidenceThreshold));
    writeAudit(req, 'settings.ai', 'settings', null, '更新 AI 引擎配置');
    res.json({ data: aiView() });
  }),
);

router.post(
  '/embedding/test',
  requireAgent,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        backend: z.enum(['local', 'openai']),
        baseUrl: z.string().trim().max(300).optional().default(''),
        apiKey: z.string().max(500).optional(),
        model: z.string().trim().max(120).optional().default(''),
        dimensions: z.coerce.number().int().min(128).max(3072),
      }),
      req.body,
    );
    const result = await testEmbeddingConfig({
      backend: body.backend,
      baseUrl: body.baseUrl,
      ...(body.apiKey ? { apiKey: body.apiKey } : {}),
      model: body.model,
      dimensions: body.dimensions,
    });
    res.json({ data: result });
  }),
);

router.patch(
  '/embedding',
  requireAgent,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        backend: z.enum(['local', 'openai']),
        baseUrl: z.string().trim().max(300).optional().default(''),
        apiKey: z.string().max(500).optional(),
        clearKey: z.boolean().optional(),
        model: z.string().trim().max(120).optional().default(''),
        dimensions: z.coerce.number().int().min(128).max(3072),
        topK: z.coerce.number().int().min(1).max(12),
        minScore: z.number().min(0).max(0.9),
      }),
      req.body,
    );

    const resolved = await resolveEmbeddingConfig({
      backend: body.backend,
      baseUrl: body.baseUrl,
      ...(body.apiKey ? { apiKey: body.apiKey } : {}),
      model: body.model,
      dimensions: body.dimensions,
    });
    await testEmbeddingConfig(resolved);
    await resetVectorStore(resolved.dimensions);
    clearEmbeddingCache();

    upsert('embedding_backend', resolved.backend);
    upsert('embedding_base_url', resolved.baseUrl);
    upsert('embedding_model', resolved.model);
    upsert('embedding_dimensions', String(resolved.dimensions));
    upsert('rag_top_k', String(body.topK));
    upsert('rag_min_score', String(body.minScore));
    if (body.clearKey) upsert('embedding_api_key', '');
    else if (body.apiKey) upsert('embedding_api_key', encryptSecret(body.apiKey));
    await reindexAllDocuments();
    writeAudit(req, 'settings.embedding', 'settings', null, '更新向量检索配置并重建索引');
    res.json({ data: embeddingView() });
  }),
);

router.patch(
  '/sla/:id',
  requireAgent,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        firstResponseMinutes: z.number().int().min(1).max(10080),
        resolutionMinutes: z.number().int().min(5).max(43200),
      }),
      req.body,
    );
    const policy = getDb()
      .prepare('SELECT * FROM sla_policies WHERE id = ? AND workspace_id = ?')
      .get(req.params.id, req.user!.workspaceId);
    if (!policy) throw new ApiError(404, 'NOT_FOUND', 'SLA 策略不存在');
    getDb()
      .prepare(
        'UPDATE sla_policies SET first_response_minutes = ?, resolution_minutes = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        body.firstResponseMinutes,
        body.resolutionMinutes,
        nowIso(),
        req.params.id,
      );
    writeAudit(req, 'settings.sla', 'sla_policy', req.params.id, '更新 SLA 策略');
    res.json({ data: { ok: true } });
  }),
);

export default router;
