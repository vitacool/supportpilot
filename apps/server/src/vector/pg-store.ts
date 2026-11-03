import pg from 'pg';
import { config } from '../config.js';
import { ApiError } from '../lib/errors.js';
import { likePatterns } from '../lib/lexical.js';
import type {
  VectorHit,
  VectorRecord,
  VectorSearchInput,
  VectorStore,
} from './types.js';
import { finalizeCandidates, type Candidate } from './score.js';

const { Pool } = pg;

interface PgChunkRow {
  id: string;
  kb_id: string;
  document_id: string;
  chunk_index: number;
  title: string;
  content: string;
  token_count: number;
  vector_score: number | string;
}

export class PgVectorStore implements VectorStore {
  readonly kind = 'pgvector' as const;
  private pool: pg.Pool;
  private dimensions = 1536;

  constructor() {
    if (!config.vectorDatabaseUrl) {
      throw new ApiError(503, 'VECTOR_DB_NOT_CONFIGURED', '未配置向量数据库');
    }
    this.pool = new Pool({
      connectionString: config.vectorDatabaseUrl,
      max: 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      ssl: /sslmode=require/i.test(config.vectorDatabaseUrl)
        ? { rejectUnauthorized: false }
        : undefined,
    });
  }

  async init(dimensions: number): Promise<void> {
    this.dimensions = dimensions;
    const client = await this.pool.connect();
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
      await client.query(`
        CREATE TABLE IF NOT EXISTS astra_vector_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
      const meta = await client.query(
        "SELECT value FROM astra_vector_meta WHERE key = 'dimensions'",
      );
      if (meta.rows[0] && Number(meta.rows[0].value) !== dimensions) {
        throw new ApiError(
          503,
          'VECTOR_DIMENSION_MISMATCH',
          `向量库维度为 ${meta.rows[0].value}，当前配置为 ${dimensions}。请在知识库中保存新的检索配置以重建向量索引。`,
        );
      }

      await client.query(`
        CREATE TABLE IF NOT EXISTS astra_chunks (
          id TEXT PRIMARY KEY,
          kb_id TEXT NOT NULL,
          document_id TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          token_count INTEGER NOT NULL DEFAULT 0,
          embedding vector(${dimensions}) NOT NULL,
          embedding_model TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE(document_id, chunk_index)
        )
      `);
      await client.query(
        'CREATE INDEX IF NOT EXISTS astra_chunks_kb_idx ON astra_chunks(kb_id)',
      );
      await client.query(
        'CREATE INDEX IF NOT EXISTS astra_chunks_document_idx ON astra_chunks(document_id)',
      );
      await client.query(
        'CREATE INDEX IF NOT EXISTS astra_chunks_embedding_idx ON astra_chunks USING hnsw (embedding vector_cosine_ops)',
      );
      await client.query(
        'CREATE INDEX IF NOT EXISTS astra_chunks_content_trgm_idx ON astra_chunks USING gin (content gin_trgm_ops)',
      );
      await client.query(
        `INSERT INTO astra_vector_meta (key, value) VALUES ('dimensions', $1)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
        [String(dimensions)],
      );
    } finally {
      client.release();
    }
  }

  async replaceDocument(
    documentId: string,
    kbId: string,
    records: VectorRecord[],
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM astra_chunks WHERE document_id = $1', [
        documentId,
      ]);
      for (const record of records) {
        await client.query(
          `INSERT INTO astra_chunks
            (id, kb_id, document_id, chunk_index, title, content, token_count,
             embedding, embedding_model, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, $9, $10)`,
          [
            record.id,
            kbId,
            documentId,
            record.chunkIndex,
            record.title,
            record.content,
            record.tokens,
            JSON.stringify(record.embedding),
            record.embeddingModel,
            record.createdAt,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteDocument(documentId: string): Promise<void> {
    await this.pool.query('DELETE FROM astra_chunks WHERE document_id = $1', [
      documentId,
    ]);
  }

  async deleteKnowledgeBase(kbId: string): Promise<void> {
    await this.pool.query('DELETE FROM astra_chunks WHERE kb_id = $1', [kbId]);
  }

  async reset(dimensions: number): Promise<void> {
    this.dimensions = dimensions;
    const client = await this.pool.connect();
    try {
      await client.query('DROP TABLE IF EXISTS astra_chunks');
      await client.query('DELETE FROM astra_vector_meta');
    } finally {
      client.release();
    }
    await this.init(dimensions);
  }

  async search(input: VectorSearchInput): Promise<VectorHit[]> {
    const candidates = new Map<string, Candidate>();
    const candidateLimit = Math.max(40, input.limit * 8);

    if (input.embedding) {
      const vectorResult = await this.pool.query<PgChunkRow>(
        `SELECT id, kb_id, document_id, chunk_index, title, content, token_count,
                1 - (embedding <=> $1::vector) AS vector_score
         FROM astra_chunks
         WHERE kb_id = $2
         ORDER BY embedding <=> $1::vector
         LIMIT $3`,
        [JSON.stringify(input.embedding), input.kbId, candidateLimit],
      );
      for (const row of vectorResult.rows) {
        candidates.set(row.id, {
          id: row.id,
          kbId: row.kb_id,
          documentId: row.document_id,
          chunkIndex: row.chunk_index,
          title: row.title,
          content: row.content,
          tokens: row.token_count,
          vectorScore: Number(row.vector_score) || 0,
        });
      }
    }

    const patterns = likePatterns(input.terms);
    if (patterns.length > 0) {
      const keywordResult = await this.pool.query<PgChunkRow>(
        `SELECT id, kb_id, document_id, chunk_index, title, content, token_count,
                0 AS vector_score
         FROM astra_chunks
         WHERE kb_id = $1 AND content ILIKE ANY($2::text[])
         ORDER BY similarity(content, $3) DESC
         LIMIT $4`,
        [input.kbId, patterns, input.query, candidateLimit],
      );
      for (const row of keywordResult.rows) {
        if (candidates.has(row.id)) continue;
        candidates.set(row.id, {
          id: row.id,
          kbId: row.kb_id,
          documentId: row.document_id,
          chunkIndex: row.chunk_index,
          title: row.title,
          content: row.content,
          tokens: row.token_count,
          vectorScore: 0,
        });
      }
    }

    return finalizeCandidates(
      [...candidates.values()],
      input.terms,
      input.query,
      input.limit,
    );
  }

  async count(kbId?: string): Promise<number> {
    const result = kbId
      ? await this.pool.query<{ count: string }>(
          'SELECT COUNT(*)::text AS count FROM astra_chunks WHERE kb_id = $1',
          [kbId],
        )
      : await this.pool.query<{ count: string }>(
          'SELECT COUNT(*)::text AS count FROM astra_chunks',
        );
    return Number(result.rows[0]?.count ?? 0);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
