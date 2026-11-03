import { getDb } from '../db/index.js';
import { retrieveKnowledge, type Citation } from './retrieval.js';

export interface WorkspaceRagResult {
  context: string;
  citations: Citation[];
  mode: 'hybrid' | 'keyword';
  warning?: string;
}

export async function retrieveForWorkspace(
  workspaceId: string,
  query: string,
  limit = 5,
): Promise<WorkspaceRagResult> {
  const kbs = getDb()
    .prepare('SELECT id FROM knowledge_bases WHERE workspace_id = ?')
    .all(workspaceId) as unknown as Array<{ id: string }>;

  const merged = new Map<string, Citation & { content: string }>();
  let mode: 'hybrid' | 'keyword' = 'hybrid';
  const warnings: string[] = [];

  for (const kb of kbs) {
    try {
      const result = await retrieveKnowledge(kb.id, query, { limit });
      if (result.mode === 'keyword') mode = 'keyword';
      if (result.warning) warnings.push(result.warning);
      result.chunks.forEach((chunk, index) => {
        const citation = result.citations[index];
        if (!citation) return;
        const existing = merged.get(citation.chunkId);
        if (!existing || existing.score < citation.score) {
          merged.set(citation.chunkId, { ...citation, content: chunk.content });
        }
      });
    } catch (error) {
      warnings.push(
        `知识库 ${kb.id} 检索失败：${
          error instanceof Error ? error.message : '未知错误'
        }`,
      );
    }
  }

  const selected = [...merged.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  const context = selected
    .map(
      (citation, index) =>
        `[资料 ${index + 1} · ${citation.title} · 相关度 ${Math.round(
          citation.score * 100,
        )}%]\n${citation.content}`,
    )
    .join('\n\n');

  return {
    context,
    citations: selected.map((citation, index) => ({
      ...citation,
      index: index + 1,
    })),
    mode,
    warning: warnings[0],
  };
}
