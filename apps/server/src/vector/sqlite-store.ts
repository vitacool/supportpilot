import { getDb } from '../db/index.js';
import { cosineSimilarity, type VectorHit, type VectorRecord, type VectorSearchInput, type VectorStore } from './types.js';
import { finalizeCandidates, type Candidate } from './score.js';

interface ChunkRow {
  id: string;
  kb_id: string;
  document_id: string;
  chunk_index: number;
  title: string;
  content: string;
  token_count: number;
  embedding: string;
  dimensions: number;
}

export class SqliteVectorStore implements VectorStore {
  readonly kind = 'sqlite' as const;
  private dimensions = 1536;

  async init(dimensions: number): Promise<void> {
    this.dimensions = dimensions;
    // The metadata schema creates document_chunks for new and existing DBs.
    getDb().prepare('SELECT 1 FROM document_chunks LIMIT 1').all();
  }

  async replaceDocument(
    documentId: string,
    kbId: string,
    records: VectorRecord[],
  ): Promise<void> {
    const db = getDb();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM document_chunks WHERE document_id = ?').run(
        documentId,
      );
      const insert = db.prepare(
        `INSERT INTO document_chunks
          (id, kb_id, document_id, chunk_index, title, content, token_count,
           embedding, embedding_model, dimensions, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const record of records) {
        insert.run(
          record.id,
          kbId,
          documentId,
          record.chunkIndex,
          record.title,
          record.content,
          record.tokens,
          JSON.stringify(record.embedding),
          record.embeddingModel,
          record.dimensions,
          record.createdAt,
        );
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  async deleteDocument(documentId: string): Promise<void> {
    getDb()
      .prepare('DELETE FROM document_chunks WHERE document_id = ?')
      .run(documentId);
  }

  async deleteKnowledgeBase(kbId: string): Promise<void> {
    getDb().prepare('DELETE FROM document_chunks WHERE kb_id = ?').run(kbId);
  }

  async reset(dimensions: number): Promise<void> {
    this.dimensions = dimensions;
    getDb().prepare('DELETE FROM document_chunks').run();
  }

  async search(input: VectorSearchInput): Promise<VectorHit[]> {
    const rows = getDb()
      .prepare('SELECT * FROM document_chunks WHERE kb_id = ? LIMIT 20000')
      .all(input.kbId) as unknown as ChunkRow[];

    const candidates: Candidate[] = [];
    for (const row of rows) {
      let vectorScore = 0;
      if (input.embedding && row.dimensions === input.embedding.length) {
        try {
          const embedding = JSON.parse(row.embedding) as number[];
          vectorScore = Math.max(
            0,
            cosineSimilarity(input.embedding, embedding),
          );
        } catch {
          vectorScore = 0;
        }
      }
      candidates.push({
        id: row.id,
        kbId: row.kb_id,
        documentId: row.document_id,
        chunkIndex: row.chunk_index,
        title: row.title,
        content: row.content,
        tokens: row.token_count,
        vectorScore,
      });
    }

    return finalizeCandidates(
      candidates,
      input.terms,
      input.query,
      input.limit,
    );
  }

  async count(kbId?: string): Promise<number> {
    const row = kbId
      ? (getDb()
          .prepare('SELECT COUNT(*) AS count FROM document_chunks WHERE kb_id = ?')
          .get(kbId) as { count: number })
      : (getDb()
          .prepare('SELECT COUNT(*) AS count FROM document_chunks')
          .get() as { count: number });
    return row.count;
  }

  async close(): Promise<void> {
    // The SQLite metadata connection is owned by db/index.ts.
  }
}

export function sqliteVectorDimensions(): number {
  return 1536;
}
