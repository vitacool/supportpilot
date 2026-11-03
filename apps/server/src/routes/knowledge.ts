import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { requireAgent, requireAuth, requireRole } from '../lib/auth.js';
import { asyncHandler, ApiError, parse } from '../lib/errors.js';
import { estimateTokens } from '../lib/tokens.js';
import { nowIso } from '../lib/time.js';
import { writeAudit } from '../lib/audit.js';
import { retrieveKnowledge } from '../lib/retrieval.js';
import {
  enqueueIndex,
  reindexKnowledgeBase,
  removeDocumentFromIndex,
  removeKnowledgeBaseFromIndex,
} from '../lib/indexer.js';

const router = Router();

const SELECT_KB = `
  SELECT k.*,
    (SELECT COUNT(*) FROM documents d WHERE d.kb_id = k.id) AS document_count,
    (SELECT COALESCE(SUM(d.tokens), 0) FROM documents d WHERE d.kb_id = k.id) AS total_tokens,
    (SELECT COALESCE(SUM(d.chunk_count), 0) FROM documents d WHERE d.kb_id = k.id) AS chunk_count
  FROM knowledge_bases k
`;

function serialiseKb(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    documents: row.document_count,
    tokens: row.total_tokens,
    chunks: row.chunk_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serialiseDoc(row: Record<string, unknown>) {
  return {
    id: row.id,
    kbId: row.kb_id,
    title: row.title,
    content: row.content,
    tokens: row.tokens,
    status: row.status,
    chunkCount: row.chunk_count,
    indexError: row.index_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

const kbSchema = z.object({
  name: z.string().trim().min(2).max(40),
  description: z.string().trim().max(160).optional().default(''),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().default('#6D8BFF'),
});

const docSchema = z.object({
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(10).max(200_000),
});

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = getDb()
      .prepare(`${SELECT_KB} WHERE k.workspace_id = ? ORDER BY k.updated_at DESC`)
      .all(req.user!.workspaceId) as unknown as Array<Record<string, unknown>>;
    res.json({ data: rows.map(serialiseKb) });
  }),
);

router.post(
  '/',
  requireAgent,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const body = parse(kbSchema, req.body);
    const id = randomUUID();
    const now = nowIso();
    getDb()
      .prepare(
        `INSERT INTO knowledge_bases (id, workspace_id, name, description, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, req.user!.workspaceId, body.name, body.description, body.color, now, now);
    const row = getDb()
      .prepare(`${SELECT_KB} WHERE k.id = ?`)
      .get(id) as unknown as Record<string, unknown>;
    writeAudit(req, 'knowledge.create', 'knowledge_base', id, `创建知识库「${body.name}」`);
    res.status(201).json({ data: serialiseKb(row) });
  }),
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const kb = getDb()
      .prepare(`${SELECT_KB} WHERE k.id = ? AND k.workspace_id = ?`)
      .get(req.params.id, req.user!.workspaceId) as
      | Record<string, unknown>
      | undefined;
    if (!kb) throw new ApiError(404, 'NOT_FOUND', '知识库不存在');
    const docs = getDb()
      .prepare('SELECT * FROM documents WHERE kb_id = ? ORDER BY created_at DESC')
      .all(req.params.id) as unknown as Array<Record<string, unknown>>;
    res.json({ data: { ...serialiseKb(kb), documents: docs.map(serialiseDoc) } });
  }),
);

router.patch(
  '/:id',
  requireAgent,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const body = parse(kbSchema.partial(), req.body);
    const existing = getDb()
      .prepare('SELECT * FROM knowledge_bases WHERE id = ? AND workspace_id = ?')
      .get(req.params.id, req.user!.workspaceId) as
      | { id: string; name: string; description: string; color: string }
      | undefined;
    if (!existing) throw new ApiError(404, 'NOT_FOUND', '知识库不存在');
    getDb()
      .prepare(
        'UPDATE knowledge_bases SET name = ?, description = ?, color = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        body.name ?? existing.name,
        body.description ?? existing.description,
        body.color ?? existing.color,
        nowIso(),
        existing.id,
      );
    const row = getDb()
      .prepare(`${SELECT_KB} WHERE k.id = ?`)
      .get(existing.id) as unknown as Record<string, unknown>;
    writeAudit(req, 'knowledge.update', 'knowledge_base', existing.id, '更新知识库');
    res.json({ data: serialiseKb(row) });
  }),
);

router.delete(
  '/:id',
  requireAgent,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const existing = getDb()
      .prepare('SELECT id, name FROM knowledge_bases WHERE id = ? AND workspace_id = ?')
      .get(req.params.id, req.user!.workspaceId) as
      | { id: string; name: string }
      | undefined;
    if (!existing) throw new ApiError(404, 'NOT_FOUND', '知识库不存在');
    await removeKnowledgeBaseFromIndex(existing.id);
    getDb().prepare('DELETE FROM knowledge_bases WHERE id = ?').run(existing.id);
    writeAudit(req, 'knowledge.delete', 'knowledge_base', existing.id, `删除知识库「${existing.name}」`);
    res.json({ data: { ok: true } });
  }),
);

router.post(
  '/:id/documents',
  requireAgent,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const kb = getDb()
      .prepare('SELECT id, name FROM knowledge_bases WHERE id = ? AND workspace_id = ?')
      .get(req.params.id, req.user!.workspaceId) as
      | { id: string; name: string }
      | undefined;
    if (!kb) throw new ApiError(404, 'NOT_FOUND', '知识库不存在');
    const body = parse(docSchema, req.body);
    const id = randomUUID();
    const now = nowIso();
    getDb()
      .prepare(
        `INSERT INTO documents
          (id, kb_id, title, content, tokens, status, chunk_count, index_error, checksum, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'processing', 0, '', '', ?, ?)`,
      )
      .run(id, kb.id, body.title, body.content, estimateTokens(body.content), now, now);
    getDb()
      .prepare('UPDATE knowledge_bases SET updated_at = ? WHERE id = ?')
      .run(now, kb.id);
    enqueueIndex(id);
    const row = getDb()
      .prepare('SELECT * FROM documents WHERE id = ?')
      .get(id) as unknown as Record<string, unknown>;
    writeAudit(req, 'document.create', 'document', id, `添加文档「${body.title}」并提交索引`);
    res.status(201).json({ data: serialiseDoc(row) });
  }),
);

router.patch(
  '/:id/documents/:docId',
  requireAgent,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const body = parse(docSchema.partial(), req.body);
    const existing = getDb()
      .prepare('SELECT * FROM documents WHERE id = ? AND kb_id = ?')
      .get(req.params.docId, req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) throw new ApiError(404, 'NOT_FOUND', '文档不存在');
    await removeDocumentFromIndex(String(existing.id));
    const content = body.content ?? String(existing.content);
    const now = nowIso();
    getDb()
      .prepare(
        `UPDATE documents SET title = ?, content = ?, tokens = ?, status = 'processing',
          chunk_count = 0, index_error = '', updated_at = ? WHERE id = ?`,
      )
      .run(
        body.title ?? String(existing.title),
        content,
        estimateTokens(content),
        now,
        String(existing.id),
      );
    enqueueIndex(String(existing.id));
    const row = getDb()
      .prepare('SELECT * FROM documents WHERE id = ?')
      .get(String(existing.id)) as unknown as Record<string, unknown>;
    writeAudit(req, 'document.update', 'document', String(existing.id), '更新文档并重建索引');
    res.json({ data: serialiseDoc(row) });
  }),
);

router.delete(
  '/:id/documents/:docId',
  requireAgent,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const existing = getDb()
      .prepare('SELECT * FROM documents WHERE id = ? AND kb_id = ?')
      .get(req.params.docId, req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) throw new ApiError(404, 'NOT_FOUND', '文档不存在');
    await removeDocumentFromIndex(String(existing.id));
    getDb().prepare('DELETE FROM documents WHERE id = ?').run(String(existing.id));
    writeAudit(req, 'document.delete', 'document', String(existing.id), '删除文档与向量');
    res.json({ data: { ok: true } });
  }),
);

router.get(
  '/:id/search',
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    if (!query.trim()) throw new ApiError(422, 'VALIDATION_ERROR', '请输入检索关键词');
    const kb = getDb()
      .prepare('SELECT id FROM knowledge_bases WHERE id = ? AND workspace_id = ?')
      .get(req.params.id, req.user!.workspaceId);
    if (!kb) throw new ApiError(404, 'NOT_FOUND', '知识库不存在');
    const result = await retrieveKnowledge(req.params.id, query, { limit: 8 });
    res.json({ data: result });
  }),
);

router.post(
  '/:id/reindex',
  requireAgent,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const kb = getDb()
      .prepare('SELECT id, name FROM knowledge_bases WHERE id = ? AND workspace_id = ?')
      .get(req.params.id, req.user!.workspaceId) as
      | { id: string; name: string }
      | undefined;
    if (!kb) throw new ApiError(404, 'NOT_FOUND', '知识库不存在');
    const queued = await reindexKnowledgeBase(kb.id);
    writeAudit(req, 'knowledge.reindex', 'knowledge_base', kb.id, `重建知识库「${kb.name}」索引`);
    res.json({ data: { queued } });
  }),
);

export default router;
