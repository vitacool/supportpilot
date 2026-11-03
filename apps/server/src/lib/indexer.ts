import { createHash, randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { chunkDocument } from './chunking.js';
import {
  clearEmbeddingCache,
  embedTexts,
  resolveEmbeddingConfig,
} from './embeddings.js';
import { nowIso } from './time.js';
import { getVectorStore, resetVectorStore } from '../vector/index.js';
import type { VectorRecord } from '../vector/types.js';

interface DocumentRow {
  id: string;
  kb_id: string;
  title: string;
  content: string;
  status: string;
}

let workerStarted = false;
let workerActive = false;
let workerTimer: NodeJS.Timeout | null = null;
let currentRun: Promise<void> | null = null;
let stoppedResolve: (() => void) | null = null;

function checksum(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function setDocumentState(
  documentId: string,
  status: 'ready' | 'processing' | 'error',
  values: { chunkCount?: number; error?: string; checksum?: string } = {},
): void {
  const now = nowIso();
  getDb()
    .prepare(
      `UPDATE documents SET
        status = ?,
        chunk_count = COALESCE(?, chunk_count),
        index_error = COALESCE(?, index_error),
        checksum = COALESCE(?, checksum),
        updated_at = ?
       WHERE id = ?`,
    )
    .run(
      status,
      values.chunkCount ?? null,
      values.error ?? null,
      values.checksum ?? null,
      now,
      documentId,
    );
}

export async function indexDocument(documentId: string): Promise<number> {
  const doc = getDb()
    .prepare('SELECT id, kb_id, title, content, status FROM documents WHERE id = ?')
    .get(documentId) as DocumentRow | undefined;
  if (!doc) return 0;

  setDocumentState(doc.id, 'processing', { error: '' });
  try {
    const drafts = chunkDocument(doc.title, doc.content);
    const embeddingConfig = await resolveEmbeddingConfig();
    const records: VectorRecord[] = [];
    const createdAt = nowIso();

    for (let start = 0; start < drafts.length; start += 24) {
      const batch = drafts.slice(start, start + 24);
      const vectors = await embedTexts(
        batch.map((chunk) => `${chunk.title}\n${chunk.content}`),
        embeddingConfig,
      );
      batch.forEach((chunk, index) => {
        const vector = vectors[index];
        if (!vector || vector.length !== embeddingConfig.dimensions) {
          throw new Error(
            `向量维度不一致：期望 ${embeddingConfig.dimensions}，实际 ${vector?.length ?? 0}`,
          );
        }
        records.push({
          id: randomUUID(),
          kbId: doc.kb_id,
          documentId: doc.id,
          chunkIndex: chunk.index,
          title: chunk.title,
          content: chunk.content,
          tokens: chunk.tokens,
          embedding: vector,
          embeddingModel: embeddingConfig.model,
          dimensions: embeddingConfig.dimensions,
          createdAt,
        });
      });
    }

    const store = await getVectorStore();
    await store.replaceDocument(doc.id, doc.kb_id, records);
    setDocumentState(doc.id, 'ready', {
      chunkCount: records.length,
      error: '',
      checksum: checksum(doc.content),
    });
    return records.length;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '建立向量索引时发生未知错误';
    setDocumentState(doc.id, 'error', { error: message.slice(0, 900) });
    throw error;
  }
}

function claimJob(): string | null {
  const db = getDb();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = db
      .prepare(
        "SELECT document_id FROM index_jobs WHERE status = 'pending' ORDER BY created_at LIMIT 1",
      )
      .get() as { document_id: string } | undefined;
    if (!row) return null;
    const result = db
      .prepare(
        "UPDATE index_jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE document_id = ? AND status = 'pending'",
      )
      .run(nowIso(), row.document_id);
    if (Number(result.changes) === 1) return row.document_id;
  }
  return null;
}

async function processQueue(): Promise<void> {
  const db = getDb();
  while (workerStarted) {
    const documentId = claimJob();
    if (!documentId) break;
    try {
      await indexDocument(documentId);
      db.prepare('DELETE FROM index_jobs WHERE document_id = ?').run(documentId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '索引任务执行失败';
      db.prepare(
        "UPDATE index_jobs SET status = 'failed', last_error = ?, updated_at = ? WHERE document_id = ?",
      ).run(message.slice(0, 900), nowIso(), documentId);
      console.error(`[astra:index] ${documentId}: ${message}`);
    }
  }
}

async function tick(): Promise<void> {
  if (!workerStarted || workerActive) return;
  workerActive = true;
  currentRun = processQueue();
  try {
    await currentRun;
  } finally {
    workerActive = false;
    currentRun = null;
    stoppedResolve?.();
    stoppedResolve = null;
    if (workerStarted) {
      workerTimer = setTimeout(() => void tick(), 2_000);
      workerTimer.unref();
    }
  }
}

export function enqueueIndex(documentId: string): void {
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO index_jobs (document_id, status, attempts, last_error, created_at, updated_at)
       VALUES (?, 'pending', 0, '', ?, ?)
       ON CONFLICT(document_id) DO UPDATE SET
         status = 'pending', last_error = '', updated_at = excluded.updated_at`,
    )
    .run(documentId, now, now);
  if (!workerStarted) startIndexWorker();
  void tick();
}

export function startIndexWorker(): void {
  if (workerStarted) return;
  workerStarted = true;
  const db = getDb();
  db.prepare(
    "UPDATE index_jobs SET status = 'pending' WHERE status = 'running'",
  ).run();
  db.prepare(
    `UPDATE documents SET status = 'ready'
     WHERE status = 'processing'
       AND id NOT IN (
         SELECT document_id FROM index_jobs WHERE status IN ('pending','running')
       )`,
  ).run();

  const missing = db
    .prepare(
      "SELECT id FROM documents WHERE chunk_count = 0 AND status = 'ready'",
    )
    .all() as unknown as Array<{ id: string }>;
  for (const doc of missing) {
    const now = nowIso();
    db.prepare(
      `INSERT INTO index_jobs (document_id, status, attempts, last_error, created_at, updated_at)
       VALUES (?, 'pending', 0, '', ?, ?)
       ON CONFLICT(document_id) DO NOTHING`,
    ).run(doc.id, now, now);
  }
  void tick();
}

export async function stopIndexWorker(): Promise<void> {
  workerStarted = false;
  if (workerTimer) {
    clearTimeout(workerTimer);
    workerTimer = null;
  }
  if (workerActive && currentRun) {
    await new Promise<void>((resolve) => {
      stoppedResolve = resolve;
      void currentRun?.finally(() => {
        stoppedResolve?.();
        stoppedResolve = null;
        resolve();
      });
    });
  }
}

export async function reindexDocuments(documentIds: string[]): Promise<void> {
  for (const id of documentIds) enqueueIndex(id);
}

export async function reindexKnowledgeBase(kbId: string): Promise<number> {
  const rows = getDb()
    .prepare('SELECT id FROM documents WHERE kb_id = ?')
    .all(kbId) as unknown as Array<{ id: string }>;
  await reindexDocuments(rows.map((row) => row.id));
  return rows.length;
}

export async function reindexAllDocuments(): Promise<number> {
  getDb()
    .prepare(
      "UPDATE documents SET chunk_count = 0, status = 'ready', index_error = '', updated_at = ?",
    )
    .run(nowIso());
  const rows = getDb()
    .prepare('SELECT id FROM documents')
    .all() as unknown as Array<{ id: string }>;
  await reindexDocuments(rows.map((row) => row.id));
  return rows.length;
}

export async function rebuildVectorCollection(dimensions: number): Promise<void> {
  clearEmbeddingCache();
  await resetVectorStore(dimensions);
  await reindexAllDocuments();
}

export async function removeDocumentFromIndex(documentId: string): Promise<void> {
  getDb().prepare('DELETE FROM index_jobs WHERE document_id = ?').run(documentId);
  const store = await getVectorStore();
  await store.deleteDocument(documentId);
}

export async function removeKnowledgeBaseFromIndex(kbId: string): Promise<void> {
  const docs = getDb()
    .prepare('SELECT id FROM documents WHERE kb_id = ?')
    .all(kbId) as unknown as Array<{ id: string }>;
  for (const doc of docs) {
    getDb().prepare('DELETE FROM index_jobs WHERE document_id = ?').run(doc.id);
  }
  const store = await getVectorStore();
  await store.deleteKnowledgeBase(kbId);
}

export function indexQueueStats(): {
  pending: number;
  running: number;
  failed: number;
} {
  const rows = getDb()
    .prepare('SELECT status, COUNT(*) AS count FROM index_jobs GROUP BY status')
    .all() as unknown as Array<{ status: string; count: number }>;
  const map = Object.fromEntries(rows.map((row) => [row.status, row.count]));
  return {
    pending: map.pending ?? 0,
    running: map.running ?? 0,
    failed: map.failed ?? 0,
  };
}
