import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import {
  embedQuery,
  getEmbeddingSettings,
  resolveEmbeddingConfig,
} from './embeddings.js';
import { extractTerms } from './lexical.js';
import { nowIso } from './time.js';
import { getVectorStore } from '../vector/index.js';

export interface RetrievedChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  title: string;
  content: string;
  score: number;
  vectorScore: number;
  keywordScore: number;
}

export interface Citation {
  index: number;
  chunkId: string;
  documentId: string;
  kbId: string;
  title: string;
  snippet: string;
  score: number;
  vectorScore: number;
  keywordScore: number;
  chunkIndex: number;
}

export interface RetrievalResult {
  query: string;
  chunks: RetrievedChunk[];
  citations: Citation[];
  mode: 'hybrid' | 'keyword';
  latencyMs: number;
  warning?: string;
}

function snippet(content: string, max = 220): string {
  const clean = content.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function logRetrieval(
  kbId: string,
  query: string,
  result: RetrievalResult,
  model: string,
): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO retrieval_logs
          (id, kb_id, query, mode, candidates, returned, top_score, latency_ms,
           embedding_model, chunks_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        kbId,
        query.slice(0, 2000),
        result.mode,
        result.chunks.length,
        result.citations.length,
        result.chunks[0]?.score ?? 0,
        result.latencyMs,
        model,
        JSON.stringify(result.citations),
        nowIso(),
      );
  } catch (error) {
    console.warn('[astra:rag] failed to write retrieval log', error);
  }
}

export async function retrieveKnowledge(
  kbId: string,
  query: string,
  options: { limit?: number; minScore?: number } = {},
): Promise<RetrievalResult> {
  const started = Date.now();
  const settings = getEmbeddingSettings();
  const limit = options.limit ?? settings.topK;
  const minScore = options.minScore ?? settings.minScore;
  const terms = extractTerms(query);
  let embedding: number[] | null = null;
  let mode: 'hybrid' | 'keyword' = 'hybrid';
  let warning: string | undefined;

  try {
    const config = await resolveEmbeddingConfig();
    embedding = await embedQuery(query, config);
  } catch (error) {
    mode = 'keyword';
    warning = `向量检索不可用，已降级为关键词检索：${
      error instanceof Error ? error.message : '未知错误'
    }`;
    console.warn(`[astra:rag] ${warning}`);
  }

  const store = await getVectorStore();
  const hits = await store.search({
    kbId,
    embedding,
    terms,
    query,
    limit: Math.max(limit * 4, 30),
  });

  const selected: typeof hits = [];
  const perDocument = new Map<string, number>();
  for (const hit of hits) {
    if (hit.score < minScore) continue;
    const count = perDocument.get(hit.documentId) ?? 0;
    if (count >= 2) continue;
    perDocument.set(hit.documentId, count + 1);
    selected.push(hit);
    if (selected.length >= limit) break;
  }

  const chunks: RetrievedChunk[] = selected.map((hit) => ({
    id: hit.id,
    documentId: hit.documentId,
    chunkIndex: hit.chunkIndex,
    title: hit.title,
    content: hit.content,
    score: Math.round(hit.score * 1000) / 1000,
    vectorScore: Math.round(hit.vectorScore * 1000) / 1000,
    keywordScore: Math.round(hit.keywordScore * 1000) / 1000,
  }));
  const citations: Citation[] = chunks.map((chunk, index) => ({
    index: index + 1,
    chunkId: chunk.id,
    documentId: chunk.documentId,
    kbId,
    title: chunk.title,
    snippet: snippet(chunk.content),
    score: chunk.score,
    vectorScore: chunk.vectorScore,
    keywordScore: chunk.keywordScore,
    chunkIndex: chunk.chunkIndex,
  }));

  const result: RetrievalResult = {
    query,
    chunks,
    citations,
    mode,
    latencyMs: Date.now() - started,
    warning,
  };
  logRetrieval(kbId, query, result, settings.model);
  return result;
}

export async function knowledgeContext(
  kbId: string | null,
  query: string,
): Promise<{
  context: string;
  citations: Citation[];
  mode: 'hybrid' | 'keyword';
  warning?: string;
}> {
  if (!kbId) {
    return { context: '', citations: [], mode: 'hybrid' };
  }
  try {
    const result = await retrieveKnowledge(kbId, query);
    if (!result.citations.length) {
      return {
        context: '',
        citations: [],
        mode: result.mode,
        warning: result.warning,
      };
    }
    const context = result.chunks
      .map(
        (chunk, index) =>
          `[资料 ${index + 1} · ${chunk.title} · 相关度 ${Math.round(
            chunk.score * 100,
          )}%]\n${chunk.content}`,
      )
      .join('\n\n');
    return {
      context: `以下是从团队知识库检索到的参考资料。回答时优先使用这些事实，并在相关句末用 [资料 N] 标注来源；资料没有覆盖的内容不要编造。\n\n${context}`,
      citations: result.citations,
      mode: result.mode,
      warning: result.warning,
    };
  } catch (error) {
    const warning = `知识库检索失败：${
      error instanceof Error ? error.message : '未知错误'
    }`;
    console.warn(`[astra:rag] ${warning}`);
    return {
      context: '',
      citations: [],
      mode: 'keyword',
      warning,
    };
  }
}
