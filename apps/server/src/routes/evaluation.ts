import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { requireAgent, requireRole } from '../lib/auth.js';
import { asyncHandler, ApiError } from '../lib/errors.js';
import { classifyTicket } from '../lib/ai-support.js';
import { retrieveKnowledge, type Citation } from '../lib/retrieval.js';
import { retrieveForWorkspace } from '../lib/rag.js';
import { nowIso } from '../lib/time.js';
import { writeAudit } from '../lib/audit.js';

const router = Router();

interface EvalCase {
  id: string;
  question: string;
  expected_category: string;
  expected_keyword: string;
  kb_id: string | null;
}

function runSummary(row: Record<string, unknown>) {
  return {
    id: row.id,
    status: row.status,
    total: row.total,
    intentAccuracy: row.intent_accuracy,
    retrievalRecall: row.retrieval_recall,
    citationCoverage: row.citation_coverage,
    avgLatency: Math.round(Number(row.avg_latency_ms ?? 0)),
    avgConfidence: row.avg_confidence,
    error: row.error,
    createdBy: row.created_by_name ?? '系统',
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

router.get(
  '/',
  requireAgent,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const workspaceId = req.user!.workspaceId;
    const cases = db
      .prepare('SELECT * FROM eval_cases WHERE workspace_id = ? AND active = 1 ORDER BY created_at')
      .all(workspaceId) as unknown as Array<Record<string, unknown>>;
    const runs = db
      .prepare(
        `SELECT r.*, u.name AS created_by_name FROM eval_runs r
         LEFT JOIN users u ON u.id = r.created_by
         WHERE r.workspace_id = ? ORDER BY r.created_at DESC LIMIT 10`,
      )
      .all(workspaceId) as unknown as Array<Record<string, unknown>>;
    const latest = runs[0]
      ? (db
          .prepare(
            'SELECT * FROM eval_results WHERE run_id = ? ORDER BY created_at',
          )
          .all(String(runs[0].id)) as unknown as Array<Record<string, unknown>>)
      : [];

    res.json({
      data: {
        cases: cases.map((row) => ({
          id: row.id,
          question: row.question,
          expectedCategory: row.expected_category,
          expectedKeyword: row.expected_keyword,
          kbId: row.kb_id,
          difficulty: row.difficulty,
        })),
        runs: runs.map(runSummary),
        latestResults: latest.map((row) => ({
          id: row.id,
          question: row.question,
          expectedCategory: row.expected_category,
          predictedCategory: row.predicted_category,
          expectedKeyword: row.expected_keyword,
          hitTitles: JSON.parse(String(row.hit_titles || '[]')),
          intentOk: Boolean(row.intent_ok),
          retrievalOk: Boolean(row.retrieval_ok),
          citationOk: Boolean(row.citation_ok),
          confidence: row.confidence,
          latency: row.latency_ms,
          detail: row.detail,
        })),
      },
    });
  }),
);

router.get(
  '/runs/:id',
  requireAgent,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const run = db
      .prepare(
        `SELECT r.*, u.name AS created_by_name FROM eval_runs r
         LEFT JOIN users u ON u.id = r.created_by
         WHERE r.id = ? AND r.workspace_id = ?`,
      )
      .get(req.params.id, req.user!.workspaceId) as
      | Record<string, unknown>
      | undefined;
    if (!run) throw new ApiError(404, 'NOT_FOUND', '评测运行不存在');
    const results = db
      .prepare('SELECT * FROM eval_results WHERE run_id = ? ORDER BY created_at')
      .all(String(run.id)) as unknown as Array<Record<string, unknown>>;
    res.json({
      data: {
        run: runSummary(run),
        results: results.map((row) => ({
          id: row.id,
          question: row.question,
          expectedCategory: row.expected_category,
          predictedCategory: row.predicted_category,
          expectedKeyword: row.expected_keyword,
          hitTitles: JSON.parse(String(row.hit_titles || '[]')),
          intentOk: Boolean(row.intent_ok),
          retrievalOk: Boolean(row.retrieval_ok),
          citationOk: Boolean(row.citation_ok),
          confidence: row.confidence,
          latency: row.latency_ms,
          detail: row.detail,
        })),
      },
    });
  }),
);

router.post(
  '/run',
  requireAgent,
  requireRole('OWNER', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const workspaceId = req.user!.workspaceId;
    const cases = db
      .prepare('SELECT * FROM eval_cases WHERE workspace_id = ? AND active = 1')
      .all(workspaceId) as unknown as EvalCase[];
    if (cases.length === 0) {
      throw new ApiError(422, 'NO_CASES', '还没有评测用例');
    }

    const runId = randomUUID();
    const startedAt = nowIso();
    db.prepare(
      `INSERT INTO eval_runs
        (id, workspace_id, status, total, created_by, created_at)
       VALUES (?, ?, 'running', ?, ?, ?)`,
    ).run(runId, workspaceId, cases.length, req.user!.id, startedAt);

    const results: Array<{
      caseRow: EvalCase;
      predictedCategory: string;
      hitTitles: string[];
      intentOk: boolean;
      retrievalOk: boolean;
      citationOk: boolean;
      confidence: number;
      latency: number;
      detail: string;
    }> = [];

    try {
      for (const evalCase of cases) {
        const started = Date.now();
        const classification = classifyTicket(evalCase.question, '');
        let citations: Citation[] = [];
        if (evalCase.kb_id) {
          const result = await retrieveKnowledge(evalCase.kb_id, evalCase.question, {
            limit: 5,
          });
          citations = result.citations;
        } else {
          const result = await retrieveForWorkspace(workspaceId, evalCase.question, 5);
          citations = result.citations;
        }
        const hitText = citations
          .map((citation) => `${citation.title} ${citation.snippet}`)
          .join(' ')
          .toLowerCase();
        const keyword = evalCase.expected_keyword.toLowerCase();
        const retrievalOk = hitText.includes(keyword);
        const confidence = citations[0]?.score ?? 0;
        results.push({
          caseRow: evalCase,
          predictedCategory: classification.category,
          hitTitles: citations.map((citation) => citation.title),
          intentOk: classification.category === evalCase.expected_category,
          retrievalOk,
          citationOk: citations.length > 0,
          confidence,
          latency: Date.now() - started,
          detail: retrievalOk
            ? `命中关键词「${evalCase.expected_keyword}」`
            : `未命中关键词「${evalCase.expected_keyword}」`,
        });
      }

      const intentAccuracy =
        results.filter((result) => result.intentOk).length / results.length;
      const retrievalRecall =
        results.filter((result) => result.retrievalOk).length / results.length;
      const citationCoverage =
        results.filter((result) => result.citationOk).length / results.length;
      const avgLatency =
        results.reduce((sum, result) => sum + result.latency, 0) / results.length;
      const avgConfidence =
        results.reduce((sum, result) => sum + result.confidence, 0) / results.length;
      const finishedAt = nowIso();

      const insert = db.prepare(
        `INSERT INTO eval_results
          (id, run_id, case_id, question, expected_category, predicted_category,
           expected_keyword, hit_titles, intent_ok, retrieval_ok, citation_ok,
           confidence, latency_ms, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const result of results) {
        insert.run(
          randomUUID(),
          runId,
          result.caseRow.id,
          result.caseRow.question,
          result.caseRow.expected_category,
          result.predictedCategory,
          result.caseRow.expected_keyword,
          JSON.stringify(result.hitTitles),
          result.intentOk ? 1 : 0,
          result.retrievalOk ? 1 : 0,
          result.citationOk ? 1 : 0,
          result.confidence,
          result.latency,
          result.detail,
          finishedAt,
        );
      }
      db.prepare(
        `UPDATE eval_runs SET status = 'completed', intent_accuracy = ?,
          retrieval_recall = ?, citation_coverage = ?, avg_latency_ms = ?,
          avg_confidence = ?, finished_at = ? WHERE id = ?`,
      ).run(
        Math.round(intentAccuracy * 1000) / 1000,
        Math.round(retrievalRecall * 1000) / 1000,
        Math.round(citationCoverage * 1000) / 1000,
        Math.round(avgLatency),
        Math.round(avgConfidence * 1000) / 1000,
        finishedAt,
        runId,
      );
      writeAudit(req, 'eval.run', 'evaluation', runId, `运行 ${cases.length} 条 RAG 评测`);
      res.status(201).json({
        data: {
          run: {
            id: runId,
            status: 'completed',
            total: results.length,
            intentAccuracy,
            retrievalRecall,
            citationCoverage,
            avgLatency,
            avgConfidence,
          },
          results: results.map((result) => ({
            question: result.caseRow.question,
            expectedCategory: result.caseRow.expected_category,
            predictedCategory: result.predictedCategory,
            expectedKeyword: result.caseRow.expected_keyword,
            hitTitles: result.hitTitles,
            intentOk: result.intentOk,
            retrievalOk: result.retrievalOk,
            citationOk: result.citationOk,
            confidence: result.confidence,
            latency: result.latency,
            detail: result.detail,
          })),
        },
      });
    } catch (error) {
      db.prepare(
        "UPDATE eval_runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?",
      ).run(
        error instanceof Error ? error.message : '评测失败',
        nowIso(),
        runId,
      );
      throw error;
    }
  }),
);

export default router;
