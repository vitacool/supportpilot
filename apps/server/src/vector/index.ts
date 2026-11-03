import { config } from '../config.js';
import { getEmbeddingSettings } from '../lib/embeddings.js';
import { PgVectorStore } from './pg-store.js';
import { SqliteVectorStore } from './sqlite-store.js';
import type { VectorStore } from './types.js';

let store: VectorStore | null = null;
let initializing: Promise<VectorStore> | null = null;

export async function initVectorStore(): Promise<VectorStore> {
  if (store) return store;
  if (initializing) return initializing;

  initializing = (async () => {
    const settings = getEmbeddingSettings();
    const next = config.vectorDatabaseUrl
      ? new PgVectorStore()
      : new SqliteVectorStore();
    await next.init(settings.dimensions);
    store = next;
    return next;
  })();

  try {
    return await initializing;
  } finally {
    initializing = null;
  }
}

export async function getVectorStore(): Promise<VectorStore> {
  return store ?? initVectorStore();
}

export async function resetVectorStore(dimensions: number): Promise<VectorStore> {
  const current = await getVectorStore();
  await current.reset(dimensions);
  return current;
}

export async function closeVectorStore(): Promise<void> {
  if (!store) return;
  await store.close();
  store = null;
}

export function configuredVectorStore(): 'sqlite' | 'pgvector' {
  return config.vectorDatabaseUrl ? 'pgvector' : 'sqlite';
}
