import { createHash } from 'node:crypto';
import { getDb } from '../db/index.js';
import { decryptSecret } from './crypto.js';
import { ApiError } from './errors.js';
import { extractTerms, normalizeText } from './lexical.js';

export type EmbeddingBackend = 'local' | 'openai';

export interface EmbeddingSettings {
  backend: EmbeddingBackend;
  baseUrl: string;
  hasKey: boolean;
  model: string;
  dimensions: number;
  topK: number;
  minScore: number;
}

export interface ResolvedEmbeddingConfig extends EmbeddingSettings {
  apiKey?: string;
}

export interface EmbeddingConfigInput {
  backend?: EmbeddingBackend;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  dimensions?: number;
  topK?: number;
  minScore?: number;
}

const LOCAL_MODEL = 'supportpilot-hash-1536';
const DEFAULT_DIMENSIONS = 1536;
const BATCH_SIZE = 32;
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 200;

const queryCache = new Map<
  string,
  { vector: number[]; expiresAt: number }
>();

function readSetting(key: string, fallback: string): string {
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value || fallback;
}

function dimensions(value: number | string): number {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return DEFAULT_DIMENSIONS;
  return Math.max(128, Math.min(3072, parsed));
}

export function getEmbeddingSettings(): EmbeddingSettings {
  const backend =
    readSetting('embedding_backend', 'local') === 'openai'
      ? 'openai'
      : 'local';
  const encryptedKey = readSetting('embedding_api_key', '');
  return {
    backend,
    baseUrl: readSetting('embedding_base_url', ''),
    hasKey: Boolean(decryptSecret(encryptedKey)),
    model:
      backend === 'local'
        ? LOCAL_MODEL
        : readSetting('embedding_model', 'text-embedding-3-small'),
    dimensions: dimensions(
      readSetting('embedding_dimensions', String(DEFAULT_DIMENSIONS)),
    ),
    topK: Math.max(1, Math.min(12, Number(readSetting('rag_top_k', '5')) || 5)),
    minScore: Math.max(
      0,
      Math.min(0.9, Number(readSetting('rag_min_score', '0.1')) || 0.1),
    ),
  };
}

export async function resolveEmbeddingConfig(
  overrides: EmbeddingConfigInput = {},
): Promise<ResolvedEmbeddingConfig> {
  const stored = getEmbeddingSettings();
  const backend = overrides.backend ?? stored.backend;
  const baseUrl = (
    overrides.baseUrl ??
    stored.baseUrl ??
    ''
  ).replace(/\/+$/, '');
  const encryptedKey = readSetting('embedding_api_key', '');
  const apiKey =
    overrides.apiKey !== undefined
      ? overrides.apiKey
      : decryptSecret(encryptedKey);
  const model = (
    overrides.model ??
    (backend === 'local' ? LOCAL_MODEL : stored.model)
  ).trim();
  const merged: ResolvedEmbeddingConfig = {
    backend,
    baseUrl,
    hasKey: Boolean(apiKey),
    model: backend === 'local' ? LOCAL_MODEL : model,
    dimensions: dimensions(overrides.dimensions ?? stored.dimensions),
    topK: Math.max(1, Math.min(12, overrides.topK ?? stored.topK)),
    minScore: Math.max(
      0,
      Math.min(0.9, overrides.minScore ?? stored.minScore),
    ),
    apiKey,
  };

  if (merged.backend === 'local') {
    return { ...merged, baseUrl: '', apiKey: '' };
  }
  if (!merged.baseUrl) {
    throw new ApiError(
      422,
      'EMBEDDING_BASE_URL_MISSING',
      '请填写 Embedding 服务的 Base URL',
    );
  }
  if (!merged.apiKey) {
    throw new ApiError(
      422,
      'EMBEDDING_KEY_MISSING',
      'Embedding 服务尚未配置 API Key',
    );
  }
  if (!merged.model) {
    throw new ApiError(422, 'EMBEDDING_MODEL_REQUIRED', '请填写 Embedding 模型名称');
  }
  return merged;
}

function hashFeature(
  feature: string,
  dims: number,
): { index: number; sign: number } {
  let hash = 2166136261;
  for (let i = 0; i < feature.length; i += 1) {
    hash ^= feature.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const unsigned = hash >>> 0;
  return {
    index: unsigned % dims,
    sign: unsigned & 0x80000000 ? -1 : 1,
  };
}

/**
 * Deterministic local fallback used when no embedding provider is configured.
 * It is a lexical feature-hash vector, not a semantic model. It keeps the demo
 * and offline development functional while pgvector + an embedding API are
 * recommended for production.
 */
export function localHashEmbedding(text: string, dims = 1536): number[] {
  const normalized = normalizeText(text);
  const features: string[] = [];
  const latin = normalized.match(/[a-z0-9][a-z0-9_.-]*/g) || [];
  features.push(...latin.filter((word) => word.length > 1));

  const cjk = normalized.replace(/[^\u3400-\u9fff]/g, '');
  for (let i = 0; i < cjk.length - 1; i += 1) {
    features.push(cjk.slice(i, i + 2));
  }
  for (let i = 0; i < cjk.length - 2; i += 1) {
    features.push(cjk.slice(i, i + 3));
  }
  for (const term of extractTerms(text, 12)) {
    features.push(term);
  }
  if (features.length === 0 && normalized) features.push(normalized.slice(0, 12));

  const vector = new Float64Array(dims);
  for (const feature of features) {
    const { index, sign } = hashFeature(feature, dims);
    const weight = feature.length >= 3 ? 1.2 : 1;
    vector[index] += sign * weight;
  }

  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  if (!norm) return Array.from(vector);
  return Array.from(vector, (value) => value / norm);
}

async function openAiEmbeddings(
  texts: string[],
  config: ResolvedEmbeddingConfig,
): Promise<number[][]> {
  if (!config.baseUrl || !config.apiKey) {
    throw new ApiError(503, 'EMBEDDING_NOT_CONFIGURED', 'Embedding 服务未配置');
  }
  const url = `${config.baseUrl}/embeddings`;
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const body: Record<string, unknown> = {
        model: config.model,
        input: texts,
      };
      if (/text-embedding-3/i.test(config.model)) {
        body.dimensions = config.dimensions;
      }
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < 2) {
          await new Promise((resolve) =>
            setTimeout(resolve, 450 * 2 ** attempt),
          );
          continue;
        }
        throw new ApiError(
          502,
          'EMBEDDING_PROVIDER_ERROR',
          `Embedding 服务返回 ${response.status} ${response.statusText}`,
          detail.slice(0, 500),
        );
      }
      const payload = (await response.json()) as {
        data?: Array<{ embedding?: number[]; index?: number }>;
      };
      const rows = [...(payload.data ?? [])].sort(
        (a, b) => (a.index ?? 0) - (b.index ?? 0),
      );
      if (rows.length !== texts.length) {
        throw new ApiError(
          502,
          'EMBEDDING_COUNT_MISMATCH',
          'Embedding 服务返回的向量数量与请求不一致',
        );
      }
      return rows.map((row, index) => {
        const vector = row.embedding;
        if (!Array.isArray(vector) || vector.length !== config.dimensions) {
          throw new ApiError(
            502,
            'EMBEDDING_DIMENSION_MISMATCH',
            `第 ${index + 1} 条向量维度为 ${vector?.length ?? 0}，配置要求 ${config.dimensions}。请检查模型与维度设置。`,
          );
        }
        if (vector.some((value) => !Number.isFinite(value))) {
          throw new ApiError(502, 'EMBEDDING_INVALID', 'Embedding 返回了非法数值');
        }
        return vector;
      });
    } catch (error) {
      lastError = error;
      if (error instanceof ApiError) throw error;
      if (attempt < 2) {
        await new Promise((resolve) =>
          setTimeout(resolve, 450 * 2 ** attempt),
        );
        continue;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new ApiError(
    502,
    'EMBEDDING_UNREACHABLE',
    `无法连接 Embedding 服务：${lastError instanceof Error ? lastError.message : '未知错误'}`,
  );
}

export async function embedTexts(
  texts: string[],
  config?: ResolvedEmbeddingConfig,
): Promise<number[][]> {
  if (!texts.length) return [];
  const resolved = config ?? (await resolveEmbeddingConfig());
  if (resolved.backend === 'local') {
    return texts.map((text) => localHashEmbedding(text, resolved.dimensions));
  }
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE);
    vectors.push(...(await openAiEmbeddings(batch, resolved)));
  }
  return vectors;
}

export async function embedQuery(
  text: string,
  config?: ResolvedEmbeddingConfig,
): Promise<number[]> {
  const resolved = config ?? (await resolveEmbeddingConfig());
  const cacheKey = createHash('sha256')
    .update(
      `${resolved.backend}:${resolved.model}:${resolved.dimensions}:${text}`,
    )
    .digest('hex');
  const cached = queryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.vector;

  const [vector] = await embedTexts([text], resolved);
  queryCache.set(cacheKey, {
    vector,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  if (queryCache.size > CACHE_MAX) {
    const oldest = queryCache.keys().next().value;
    if (oldest) queryCache.delete(oldest);
  }
  return vector;
}

export function clearEmbeddingCache(): void {
  queryCache.clear();
}

export async function testEmbeddingConfig(
  overrides: Partial<EmbeddingSettings> = {},
): Promise<{
  backend: EmbeddingBackend;
  model: string;
  dimensions: number;
  latencyMs: number;
  sample: string;
}> {
  const config = await resolveEmbeddingConfig(overrides);
  const started = Date.now();
  const [vector] = await embedTexts(
    ['ASTRA 向量检索连通性测试：企业知识库与数据安全。'],
    config,
  );
  return {
    backend: config.backend,
    model: config.model,
    dimensions: vector.length,
    latencyMs: Date.now() - started,
    sample: `维度 ${vector.length} · 前 3 项 ${vector
      .slice(0, 3)
      .map((value) => value.toFixed(3))
      .join(', ')}`,
  };
}
