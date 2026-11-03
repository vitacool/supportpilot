import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { requireAgent } from '../lib/auth.js';
import { asyncHandler, ApiError, parse } from '../lib/errors.js';
import { generateSupportDraft } from '../lib/ai-support.js';
import {
  getTicket,
  getTicketRuns,
  ticketDetail,
  writeTicketEvent,
} from '../lib/tickets.js';
import { dueDates } from '../lib/sla.js';
import { assertTransition } from '../lib/ticket-state.js';
import { nowIso } from '../lib/time.js';
import { writeAudit } from '../lib/audit.js';

const router = Router();

function priorityRank(priority: string): number {
  return { urgent: 4, high: 3, normal: 2, low: 1 }[priority] ?? 0;
}

router.post(
  '/:id/ai/run',
  requireAgent,
  asyncHandler(async (req, res) => {
    const ticket = getTicket(req.params.id, req.user!.workspaceId);
    if (!ticket) throw new ApiError(404, 'NOT_FOUND', '工单不存在');
    if (['resolved', 'closed'].includes(ticket.status)) {
      throw new ApiError(409, 'TICKET_CLOSED', '已解决或关闭的工单不能生成 AI 草稿');
    }
    const customerMessages = getDb()
      .prepare(
        `SELECT content FROM ticket_messages
         WHERE ticket_id = ? AND role = 'customer' AND visibility = 'public'
         ORDER BY created_at DESC LIMIT 4`,
      )
      .all(ticket.id) as unknown as Array<{ content: string }>;
    const query =
      customerMessages.map((message) => message.content).reverse().join('\n') ||
      ticket.subject;
    const result = await generateSupportDraft({
      workspaceId: req.user!.workspaceId,
      customerName: ticket.customer_name ?? '客户',
      subject: ticket.subject,
      query,
    });

    const runId = randomUUID();
    const now = nowIso();
    let status = ticket.status;
    let aiState = 'drafted';
    let autoSent = false;

    if (ticket.status === 'new') {
      assertTransition(ticket.status, 'triaged');
      getDb()
        .prepare("UPDATE tickets SET status = 'triaged', updated_at = ? WHERE id = ?")
        .run(now, ticket.id);
      writeTicketEvent(ticket.id, req.user!.id, 'ticket.status', 'new', 'triaged', 'AI 自动分诊');
      status = 'triaged';
    }

    if (result.recommendedAction === 'auto_send') {
      assertTransition(status, 'waiting_customer');
      aiState = 'auto_sent';
      autoSent = true;
      status = 'waiting_customer';
    } else if (result.recommendedAction === 'escalate') {
      if (!['closed', 'resolved'].includes(status)) {
        status = 'escalated';
        aiState = 'escalated';
      }
    } else {
      status = 'ai_drafted';
      aiState = 'drafted';
    }

    const priority =
      priorityRank(result.classification.priority) > priorityRank(ticket.priority)
        ? result.classification.priority
        : ticket.priority;
    let firstDue = ticket.first_response_due_at;
    let resolutionDue = ticket.resolution_due_at;
    let policyId = ticket.sla_policy_id;
    if (priority !== ticket.priority) {
      const due = dueDates(req.user!.workspaceId, priority, ticket.created_at);
      firstDue = due.firstDue;
      resolutionDue = due.resolutionDue;
      policyId = due.policyId;
    }

    getDb()
      .prepare(
        `UPDATE tickets SET
          status = ?, priority = ?, category = ?, sentiment = ?, ai_state = ?,
          ai_confidence = ?, ai_summary = ?, risk_flags = ?, sla_policy_id = ?,
          first_response_due_at = ?, resolution_due_at = ?,
          first_response_at = CASE WHEN ? = 1 THEN ? ELSE first_response_at END,
          updated_at = ?
         WHERE id = ?`,
      )
      .run(
        status,
        priority,
        result.classification.category,
        result.classification.sentiment,
        aiState,
        result.confidence,
        result.classification.summary,
        JSON.stringify(result.classification.riskFlags),
        policyId,
        firstDue,
        resolutionDue,
        autoSent ? 1 : 0,
        now,
        now,
        ticket.id,
      );

    if (autoSent) {
      getDb()
        .prepare(
          `INSERT INTO ticket_messages
            (id, ticket_id, author_id, role, visibility, content, citations, is_ai, ai_run_id, created_at)
           VALUES (?, ?, NULL, 'ai', 'public', ?, ?, 1, ?, ?)`,
        )
        .run(
          randomUUID(),
          ticket.id,
          result.draft,
          JSON.stringify(result.citations),
          runId,
          now,
        );
    }

    getDb()
      .prepare(
        `INSERT INTO ai_runs
          (id, ticket_id, workspace_id, created_by, status, category, priority, sentiment,
           summary, confidence, risk_flags, recommended_action, draft, citations, model,
           prompt_tokens, completion_tokens, latency_ms, error, created_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`,
      )
      .run(
        runId,
        ticket.id,
        req.user!.workspaceId,
        req.user!.id,
        autoSent ? 'accepted' : 'completed',
        result.classification.category,
        result.classification.priority,
        result.classification.sentiment,
        result.classification.summary,
        result.confidence,
        JSON.stringify(result.classification.riskFlags),
        result.recommendedAction,
        result.draft,
        JSON.stringify(result.citations),
        result.model,
        result.promptTokens,
        result.completionTokens,
        result.latencyMs,
        now,
        autoSent ? now : null,
      );

    writeTicketEvent(
      ticket.id,
      req.user!.id,
      'ai.run',
      ticket.status,
      status,
      autoSent
        ? 'AI 自动回复已发送'
        : result.recommendedAction === 'escalate'
          ? 'AI 建议升级人工'
          : 'AI 草稿等待人工审核',
    );
    writeAudit(req, 'ai.run', 'ticket', ticket.id, '运行 AI 分诊与草稿');

    res.status(201).json({
      data: {
        run: getTicketRuns(ticket.id)[0],
        ticket: ticketDetail(getTicket(ticket.id, req.user!.workspaceId)!, req.user!),
        warning: result.warning,
        ragMode: result.ragMode,
      },
    });
  }),
);

router.post(
  '/:id/ai/runs/:runId/accept',
  requireAgent,
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        content: z.string().trim().min(1).max(8000).optional(),
        send: z.boolean().optional().default(true),
      }),
      req.body,
    );
    const ticket = getTicket(req.params.id, req.user!.workspaceId);
    if (!ticket) throw new ApiError(404, 'NOT_FOUND', '工单不存在');
    const run = getDb()
      .prepare('SELECT * FROM ai_runs WHERE id = ? AND ticket_id = ?')
      .get(req.params.runId, ticket.id) as
      | { id: string; status: string; draft: string; citations: string }
      | undefined;
    if (!run) throw new ApiError(404, 'NOT_FOUND', 'AI 运行记录不存在');
    if (run.status !== 'completed') {
      throw new ApiError(409, 'RUN_ALREADY_RESOLVED', '该 AI 草稿已处理');
    }
    const content = body.content || run.draft;
    const now = nowIso();
    if (body.send) {
      if (ticket.status === 'new') {
        getDb()
          .prepare("UPDATE tickets SET status = 'triaged', updated_at = ? WHERE id = ?")
          .run(now, ticket.id);
      }
      const currentStatus = getTicket(ticket.id, req.user!.workspaceId)!.status;
      assertTransition(currentStatus, 'waiting_customer');
      getDb()
        .prepare(
          `INSERT INTO ticket_messages
            (id, ticket_id, author_id, role, visibility, content, citations, is_ai, ai_run_id, created_at)
           VALUES (?, ?, ?, 'agent', 'public', ?, ?, 0, ?, ?)`,
        )
        .run(
          randomUUID(),
          ticket.id,
          req.user!.id,
          content,
          run.citations,
          run.id,
          now,
        );
      getDb()
        .prepare(
          `UPDATE tickets SET status = 'waiting_customer', ai_state = 'accepted',
             first_response_at = COALESCE(first_response_at, ?), updated_at = ?
           WHERE id = ?`,
        )
        .run(now, now, ticket.id);
    } else {
      getDb()
        .prepare(
          `INSERT INTO ticket_messages
            (id, ticket_id, author_id, role, visibility, content, citations, is_ai, ai_run_id, created_at)
           VALUES (?, ?, ?, 'agent', 'internal', ?, ?, 0, ?, ?)`,
        )
        .run(randomUUID(), ticket.id, req.user!.id, content, run.citations, run.id, now);
      getDb()
        .prepare("UPDATE tickets SET ai_state = 'accepted', updated_at = ? WHERE id = ?")
        .run(now, ticket.id);
    }
    getDb()
      .prepare("UPDATE ai_runs SET status = 'accepted', resolved_at = ? WHERE id = ?")
      .run(now, run.id);
    writeTicketEvent(
      ticket.id,
      req.user!.id,
      'ai.accept',
      'ai_drafted',
      body.send ? 'waiting_customer' : ticket.status,
      body.send ? '人工审核后发送 AI 草稿' : 'AI 草稿保存为内部备注',
    );
    writeAudit(req, 'ai.accept', 'ticket', ticket.id, '采纳 AI 草稿');
    res.json({
      data: ticketDetail(getTicket(ticket.id, req.user!.workspaceId)!, req.user!),
    });
  }),
);

router.post(
  '/:id/ai/runs/:runId/reject',
  requireAgent,
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ reason: z.string().max(300).optional() }), req.body);
    const ticket = getTicket(req.params.id, req.user!.workspaceId);
    if (!ticket) throw new ApiError(404, 'NOT_FOUND', '工单不存在');
    const run = getDb()
      .prepare('SELECT * FROM ai_runs WHERE id = ? AND ticket_id = ?')
      .get(req.params.runId, ticket.id) as { id: string; status: string } | undefined;
    if (!run) throw new ApiError(404, 'NOT_FOUND', 'AI 运行记录不存在');
    if (run.status !== 'completed') {
      throw new ApiError(409, 'RUN_ALREADY_RESOLVED', '该 AI 草稿已处理');
    }
    const now = nowIso();
    getDb()
      .prepare("UPDATE ai_runs SET status = 'rejected', resolved_at = ? WHERE id = ?")
      .run(now, run.id);
    getDb()
      .prepare(
        "UPDATE tickets SET ai_state = 'rejected', status = CASE WHEN status = 'ai_drafted' THEN 'triaged' ELSE status END, updated_at = ? WHERE id = ?",
      )
      .run(now, ticket.id);
    writeTicketEvent(ticket.id, req.user!.id, 'ai.reject', 'ai_drafted', 'triaged', body.reason || '拒绝 AI 草稿');
    writeAudit(req, 'ai.reject', 'ticket', ticket.id, '拒绝 AI 草稿');
    res.json({
      data: ticketDetail(getTicket(ticket.id, req.user!.workspaceId)!, req.user!),
    });
  }),
);

export default router;
