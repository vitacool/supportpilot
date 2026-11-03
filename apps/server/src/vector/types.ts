export interface VectorRecord {
  id: string;
  kbId: string;
  documentId: string;
  chunkIndex: number;
  title: string;
  content: string;
  tokens: number;
  embedding: number[];
  embeddingModel: string;
  dimensions: number;
  createdAt: string;
}

export interface VectorHit {
  id: string;
  kbId: string;
  documentId: string;
  chunkIndex: number;
  title: string;
  content: string;
  tokens: number;
  vectorScore: number;
  keywordScore: number;
  score: number;
}

export interface VectorSearchInput {
  kbId: string;
  embedding: number[] | null;
  terms: string[];
  query: string;
  limit: number;
}

export interface VectorStore {
  readonly kind: 'sqlite' | 'pgvector';
  init(dimensions: number): Promise<void>;
  replaceDocument(
    documentId: string,
    kbId: string,
    records: VectorRecord[],
  ): Promise<void>;
  deleteDocument(documentId: string): Promise<void>;
  deleteKnowledgeBase(kbId: string): Promise<void>;
  reset(dimensions: number): Promise<void>;
  search(input: VectorSearchInput): Promise<VectorHit[]>;
  count(kbId?: string): Promise<number>;
  close(): Promise<void>;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}
