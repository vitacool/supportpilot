import { lexicalScore } from '../lib/lexical.js';
import type { VectorHit } from './types.js';

export interface Candidate {
  id: string;
  kbId: string;
  documentId: string;
  chunkIndex: number;
  title: string;
  content: string;
  tokens: number;
  vectorScore: number;
}

export function clip01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

/**
 * Hybrid score: dense retrieval is primary, lexical matching adds precision for
 * names, policy numbers and short Chinese queries where embeddings are fuzzy.
 */
export function finalizeCandidates(
  candidates: Candidate[],
  terms: string[],
  query: string,
  limit: number,
): VectorHit[] {
  const deduped = new Map<string, VectorHit>();
  for (const candidate of candidates) {
    const keyword = lexicalScore(candidate.content, terms, query);
    const titleBoost = lexicalScore(candidate.title, terms) * 0.06;
    const vector = clip01(candidate.vectorScore);
    const score = Math.min(
      1,
      vector > 0 ? 0.7 * vector + 0.3 * keyword : keyword,
    ) + titleBoost;
    const hit: VectorHit = {
      id: candidate.id,
      kbId: candidate.kbId,
      documentId: candidate.documentId,
      chunkIndex: candidate.chunkIndex,
      title: candidate.title,
      content: candidate.content,
      tokens: candidate.tokens,
      vectorScore: vector,
      keywordScore: clip01(keyword),
      score: clip01(score),
    };
    const previous = deduped.get(hit.id);
    if (!previous || previous.score < hit.score) deduped.set(hit.id, hit);
  }
  return [...deduped.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
