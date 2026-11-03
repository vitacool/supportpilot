import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { requireAgent, requireAuth } from '../lib/auth.js';
import { asyncHandler, ApiError, parse } from '../lib/errors.js';
import {
  canAccessTicket,
  getTicket,
  serializeTicket,
  ticketDetail,
  ticketSelect,
  writeTicketEvent,
} from '../lib/tickets.js';
import { dueDates } from '../lib/sla.js';
import {
  assertTransition,
  statusAfterCustomerMessage,
  STATUS_LABELS,
} from '../lib/ticket-state.js';
import { writeAudit } from '../lib/audit.js';
import { nowIso } from '../lib/time.js';
import type { TicketStatus } from '../types.js';

const router = Router();

const ticketSchema = z.object({
  subject: z.string().trim().min(4, '主题至少 4 个字符').max(120),
  content: z.string().trim().min(10, '问题描述至少 10 个字符').max(8000),
  priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
  customerId: z.string().optional(),
  category: z
    .enum(['billing', 'refund', 'technical', 'account', 'feature', 'other'])
    .optional(),
  tags: z.array(z.string().max(24)).max(8).optional(),
});

router.get(
  '/',
  requireAgent,
  asyncHandler(async (req, res) => {
    const workspaceId = req.user!.workspaceId;
    const query = parse(
      z.object({
        status: z.string().optional(),
        priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
        assignee: z.string().optional(),
        search: z.string().max(80).optional(),
        sla: z.enum(['breached', 'at_risk']).optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(5).max(100).default(20),
      }),
      req.query,
    );

    const where = ['t.workspace_id = ?'];
    const params: Array<string | number> = [workspaceId];
    if (query.status) {
      const statuses = query.status.split(',').filter(Boolean);
      if (statuses.length) {
        where.push(`t.status IN (${statuses.map(() => '?').join(',')})`);
        params.push(...statuses);
      }
    }
    if (query.priority) {
      where.push('t.priority = ?');
      params.push(query.priority);
    }
    if (query.assignee === 'me') {
      where.push('t.assignee_id = ?');
      params.push(req.user!.id);
    } else if (query.assignee === 'unassigned') {
      where.push('t.assignee_id IS NULL');
    } else if (query.assignee) {
      where.push('t.assignee_id = ?');
      params.push(query.assignee);
    }
    if (query.search) {
      where.push(
        '(t.subject LIKE ? OR t.number LIKE ? OR c.name LIKE ? OR c.email LIKE ?)',
      );
      const term = `%${query.search}%`;
      params.push(term, term, term, term);
    }

    const rows = getDb()
      .prepare(
        `${ticketSelect()} WHERE ${where.join(' AND ')} ORDER BY
          CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
          t.updated_at DESC
         LIMIT 500`,
      )
      .all(...params) as unknown as Array<Parameters<typeof serializeTicket>[0]>;

    const serialized = rows
      .map(serializeTicket)
      .filter((ticket) => !query.sla || ticket.sla.status === query.sla);
    const start = (query.page - 1) * query.pageSize;
    const pageItems = serialized.slice(start, start + query.pageSize);
    const all = getDb()
      .prepare(`${ticketSelect()} WHERE t.workspace_id = ?`)
      .all(workspaceId)
      .map((row) => serializeTicket(row as never));

    res.json({
      data: {
        tickets: pageItems,
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total: serialized.length,
          pages: Math.max(1, Math.ceil(serialized.length / query.pageSize)),
        },
        stats: {
          open: all.filter(
            (ticket) => !['resolved', 'closed'].includes(ticket.status),
          ).length,
          mine: all.filter((ticket) => ticket.assignee?.id === req.user!.id).length,
          unassigned: all.filter((ticket) => !ticket.assignee).length,
          breached: all.filter(
            (ticket) =>
              ticket.sla.status === 'breached' &&
              !['resolved', 'closed'].includes(ticket.status),
          ).length,
          waiting: all.filter((ticket) => ticket.status === 'waiting_customer')
            .length,
          aiDrafted: all.filter((ticket) => ticket.status === 'ai_drafted').length,
        },
      },
    });
  }),
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ticket = getTicket(req.params.id, req.user!.workspaceId);
    if (!ticket) throw new ApiError(404, 'NOT_FOUND', '工单不存在');
    if (!canAccessTicket(req.user!, ticket)) {
      throw new ApiError(403, 'FORBIDDEN', '无权访问该工单');
    }
    res.json({ data: ticketDetail(ticket, req.user!) });
  }),
);

router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parse(ticketSchema, req.body);
    const isCustomer = req.user!.role === 'CUSTOMER';
    const customerId = isCustomer ? req.user!.id : body.customerId;
    if (!customerId) {
      throw new ApiError(422, 'CUSTOMER_REQUIRED', '请选择客户');
    }
    const customer = getDb()
      .prepare(
        "SELECT id, name FROM users WHERE id = ? AND workspace_id = ? AND role = 'CUSTOMER'",
      )
      .get(customerId, req.user!.workspaceId) as
      | { id: string; name: string }
      | undefined;
    if (!customer) throw new ApiError(422, 'CUSTOMER_NOT_FOUND', '客户不存在');

    const priority = isCustomer ? 'normal' : body.priority || 'normal';
    const category = isCustomer ? 'other' : body.category || 'other';
    const createdAt = nowIso();
    const due = dueDates(req.user!.workspaceId, priority, createdAt);
    const max = getDb()
      .prepare(
        "SELECT MAX(CAST(substr(number, 4) AS INTEGER)) AS value FROM tickets WHERE workspace_id = ?",
      )
      .get(req.user!.workspaceId) as { value: number | null };
    const number = `SP-${Math.max(1000, Number(max.value || 1000)) + 1}`;
    const ticketId = randomUUID();

    getDb()
      .prepare(
        `INSERT INTO tickets
          (id, number, workspace_id, customer_id, assignee_id, subject, status, priority,
           category, sentiment, channel, ai_state, ai_confidence, ai_summary, risk_flags, tags,
           sla_policy_id, first_response_due_at, resolution_due_at, first_response_at,
           resolved_at, closed_at, csat, last_customer_message_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, 'new', ?, 'other', 'neutral', 'portal', 'none', 0, '', '[]', ?,
                 ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?)`,
      )
      .run(
        ticketId,
        number,
        req.user!.workspaceId,
        customer.id,
        body.subject,
        priority,
        JSON.stringify(body.tags ?? []),
        due.policyId,
        due.firstDue,
        due.resolutionDue,
        createdAt,
        createdAt,
        createdAt,
      );

    getDb()
      .prepare(
        `INSERT INTO ticket_messages
          (id, ticket_id, author_id, role, visibility, content, citations, is_ai, ai_run_id, created_at)
         VALUES (?, ?, ?, 'customer', 'public', ?, '[]', 0, NULL, ?)`,
      )
      .run(randomUUID(), ticketId, req.user!.id, body.content, createdAt);
    writeTicketEvent(
      ticketId,
      req.user!.id,
      'ticket.created',
      null,
      'new',
      `创建工单 ${number}`,
    );
    writeAudit(req, 'ticket.create', 'ticket', ticketId, `创建工单 ${number}`);
    const ticket = getTicket(ticketId, req.user!.workspaceId)!;
    res.status(201).json({ data: ticketDetail(ticket, req.user!) });
  }),
);

router.patch(
  '/:id',
  requireAgent,
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
        assigneeId: z.string().nullable().optional(),
        category: z
          .enum(['billing', 'refund', 'technical', 'account', 'feature', 'other'])
          .optional(),
        tags: z.array(z.string().max(24)).max(8).optional(),
      }),
      req.body,
    );
    const ticket = getTicket(req.params.id, req.user!.workspaceId);
    if (!ticket) throw new ApiError(404, 'NOT_FOUND', '工单不存在');

    let assigneeId = ticket.assignee_id;
    if (body.assigneeId !== undefined) {
      if (body.assigneeId) {
        const assignee = getDb()
          .prepare(
            "SELECT id FROM users WHERE id = ? AND workspace_id = ? AND role IN ('OWNER','ADMIN','AGENT') AND status = 'active'",
          )
          .get(body.assigneeId, req.user!.workspaceId);
        if (!assignee) throw new ApiError(422, 'ASSIGNEE_NOT_FOUND', '客服不存在');
      }
      assigneeId = body.assigneeId;
    }

    const priority = body.priority ?? ticket.priority;
    let { first_response_due_at, resolution_due_at, sla_policy_id } = ticket;
    if (priority !== ticket.priority) {
      const due = dueDates(req.user!.workspaceId, priority, ticket.created_at);
      first_response_due_at = due.firstDue;
      resolution_due_at = due.resolutionDue;
      sla_policy_id = due.policyId;
    }

    getDb()
      .prepare(
        `UPDATE tickets SET priority = ?, assignee_id = ?, category = ?, tags = ?,
          first_response_due_at = ?, resolution_due_at = ?, sla_policy_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        priority,
        assigneeId,
        body.category ?? ticket.category,
        JSON.stringify(body.tags ?? JSON.parse(ticket.tags || '[]')),
        first_response_due_at,
        resolution_due_at,
        sla_policy_id,
        nowIso(),
        ticket.id,
      );
    writeTicketEvent(
      ticket.id,
      req.user!.id,
      'ticket.update',
      ticket.priority,
      priority,
      body.assigneeId !== undefined
        ? `重新分配给 ${assigneeId ?? '未分配'}`
        : '更新工单属性',
    );
    writeAudit(req, 'ticket.update', 'ticket', ticket.id, '更新工单属性');
    res.json({
      data: ticketDetail(getTicket(ticket.id, req.user!.workspaceId)!, req.user!),
    });
  }),
);

router.post(
  '/:id/status',
  requireAgent,
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        status: z.enum([
          'new',
          'triaged',
          'ai_drafted',
          'waiting_customer',
          'escalated',
          'resolved',
          'closed',
        ]),
        note: z.string().max(500).optional(),
      }),
      req.body,
    );
    const ticket = getTicket(req.params.id, req.user!.workspaceId);
    if (!ticket) throw new ApiError(404, 'NOT_FOUND', '工单不存在');
    if (ticket.status === body.status) {
      res.json({ data: ticketDetail(ticket, req.user!) });
      return;
    }
    assertTransition(ticket.status, body.status as TicketStatus);
    const now = nowIso();
    const resolvedAt =
      body.status === 'resolved' ? now : body.status === 'triaged' ? null : ticket.resolved_at;
    const closedAt =
      body.status === 'closed' ? now : body.status === 'triaged' ? null : ticket.closed_at;
    getDb()
      .prepare(
        'UPDATE tickets SET status = ?, resolved_at = ?, closed_at = ?, updated_at = ? WHERE id = ?',
      )
      .run(body.status, resolvedAt, closedAt, now, ticket.id);
    writeTicketEvent(
      ticket.id,
      req.user!.id,
      'ticket.status',
      ticket.status,
      body.status,
      body.note || `状态变更为「${STATUS_LABELS[body.status as TicketStatus]}」`,
    );
    writeAudit(
      req,
      'ticket.status',
      'ticket',
      ticket.id,
      `${ticket.status} → ${body.status}`,
    );
    res.json({
      data: ticketDetail(getTicket(ticket.id, req.user!.workspaceId)!, req.user!),
    });
  }),
);

router.post(
  '/:id/messages',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        content: z.string().trim().min(1).max(8000),
        visibility: z.enum(['public', 'internal']).optional().default('public'),
      }),
      req.body,
    );
    const ticket = getTicket(req.params.id, req.user!.workspaceId);
    if (!ticket) throw new ApiError(404, 'NOT_FOUND', '工单不存在');
    if (!canAccessTicket(req.user!, ticket)) {
      throw new ApiError(403, 'FORBIDDEN', '无权访问该工单');
    }
    const isCustomer = req.user!.role === 'CUSTOMER';
    if (isCustomer && body.visibility === 'internal') {
      throw new ApiError(403, 'FORBIDDEN', '客户不能添加内部备注');
    }
    const visibility = isCustomer ? 'public' : body.visibility;
    const now = nowIso();
    let status = ticket.status;

    if (isCustomer) {
      status = statusAfterCustomerMessage(ticket.status);
    } else if (visibility === 'public' && !ticket.first_response_at) {
      if (['new', 'triaged', 'ai_drafted', 'escalated'].includes(ticket.status)) {
        status = 'waiting_customer';
      }
    }

    getDb()
      .prepare(
        `INSERT INTO ticket_messages
          (id, ticket_id, author_id, role, visibility, content, citations, is_ai, ai_run_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, '[]', 0, NULL, ?)`,
      )
      .run(
        randomUUID(),
        ticket.id,
        req.user!.id,
        isCustomer ? 'customer' : 'agent',
        visibility,
        body.content,
        now,
      );
    getDb()
      .prepare(
        `UPDATE tickets SET
          status = ?,
          last_customer_message_at = CASE WHEN ? = 'customer' THEN ? ELSE last_customer_message_at END,
          updated_at = ?
         WHERE id = ?`,
      )
      .run(
        status,
        isCustomer ? 'customer' : 'agent',
        now,
        now,
        ticket.id,
      );
    // Set the first response timestamp only for a public agent message.
    if (!isCustomer && visibility === 'public' && !ticket.first_response_at) {
      getDb()
        .prepare('UPDATE tickets SET first_response_at = ? WHERE id = ?')
        .run(now, ticket.id);
    }
    writeTicketEvent(
      ticket.id,
      req.user!.id,
      isCustomer ? 'message.customer' : 'message.agent',
      ticket.status,
      status,
      isCustomer ? '客户回复工单' : '客服添加回复',
    );
    res.status(201).json({
      data: ticketDetail(getTicket(ticket.id, req.user!.workspaceId)!, req.user!),
    });
  }),
);

router.post(
  '/:id/csat',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parse(z.object({ score: z.number().int().min(1).max(5) }), req.body);
    const ticket = getTicket(req.params.id, req.user!.workspaceId);
    if (!ticket) throw new ApiError(404, 'NOT_FOUND', '工单不存在');
    if (ticket.customer_id !== req.user!.id) {
      throw new ApiError(403, 'FORBIDDEN', '只能评价自己的工单');
    }
    if (!['resolved', 'closed'].includes(ticket.status)) {
      throw new ApiError(409, 'NOT_RESOLVED', '工单解决后才能评价');
    }
    getDb()
      .prepare('UPDATE tickets SET csat = ?, updated_at = ? WHERE id = ?')
      .run(body.score, nowIso(), ticket.id);
    writeTicketEvent(ticket.id, req.user!.id, 'csat.submit', null, String(body.score), '客户提交满意度评价');
    res.json({
      data: ticketDetail(getTicket(ticket.id, req.user!.workspaceId)!, req.user!),
    });
  }),
);

export default router;
