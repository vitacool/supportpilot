import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import type { AuthUser, TicketStatus } from '../types.js';
import { nowIso } from './time.js';
import { slaView } from './sla.js';
import { STATUS_LABELS } from './ticket-state.js';

export interface TicketRow {
  id: string;
  number: string;
  workspace_id: string;
  customer_id: string;
  assignee_id: string | null;
  subject: string;
  status: TicketStatus;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  category: string;
  sentiment: string;
  channel: string;
  ai_state: string;
  ai_confidence: number;
  ai_summary: string;
  risk_flags: string;
  tags: string;
  sla_policy_id: string | null;
  first_response_due_at: string | null;
  resolution_due_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  csat: number | null;
  last_customer_message_at: string | null;
  created_at: string;
  updated_at: string;
  customer_name?: string;
  customer_email?: string;
  customer_color?: string;
  assignee_name?: string | null;
  assignee_color?: string | null;
  preview?: string | null;
  message_count?: number;
}

export function ticketSelect(): string {
  return `
    SELECT t.*,
      c.name AS customer_name, c.email AS customer_email, c.avatar_color AS customer_color,
      a.name AS assignee_name, a.avatar_color AS assignee_color,
      (SELECT m.content FROM ticket_messages m
        WHERE m.ticket_id = t.id AND m.visibility = 'public'
        ORDER BY m.created_at DESC LIMIT 1) AS preview,
      (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS message_count
    FROM tickets t
    JOIN users c ON c.id = t.customer_id
    LEFT JOIN users a ON a.id = t.assignee_id
  `;
}

export function getTicket(
  id: string,
  workspaceId: string,
): TicketRow | undefined {
  return getDb()
    .prepare(`${ticketSelect()} WHERE t.id = ? AND t.workspace_id = ?`)
    .get(id, workspaceId) as unknown as TicketRow | undefined;
}

export function serializeTicket(row: TicketRow) {
  const riskFlags = safeJson<string[]>(row.risk_flags, []);
  const tags = safeJson<string[]>(row.tags, []);
  return {
    id: row.id,
    number: row.number,
    subject: row.subject,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status],
    priority: row.priority,
    category: row.category,
    sentiment: row.sentiment,
    channel: row.channel,
    aiState: row.ai_state,
    aiConfidence: row.ai_confidence,
    aiSummary: row.ai_summary,
    riskFlags,
    tags,
    customer: {
      id: row.customer_id,
      name: row.customer_name ?? '客户',
      email: row.customer_email ?? '',
      avatarColor: row.customer_color ?? '#8B5CF6',
    },
    assignee: row.assignee_id
      ? {
          id: row.assignee_id,
          name: row.assignee_name ?? '客服',
          avatarColor: row.assignee_color ?? '#22C55E',
        }
      : null,
    sla: slaView(row),
    firstResponseAt: row.first_response_at,
    resolvedAt: row.resolved_at,
    closedAt: row.closed_at,
    csat: row.csat,
    preview: (row.preview ?? '').replace(/\s+/g, ' ').slice(0, 90),
    messageCount: row.message_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function getTicketMessages(
  ticketId: string,
  publicOnly = false,
) {
  const rows = getDb()
    .prepare(
      `SELECT m.*, u.name AS author_name, u.avatar_color AS author_color, u.role AS author_role
       FROM ticket_messages m
       LEFT JOIN users u ON u.id = m.author_id
       WHERE m.ticket_id = ?
       ${publicOnly ? "AND m.visibility = 'public'" : ''}
       ORDER BY m.created_at ASC, m.rowid ASC`,
    )
    .all(ticketId) as unknown as Array<{
    id: string;
    ticket_id: string;
    author_id: string | null;
    author_name: string | null;
    author_color: string | null;
    author_role: string | null;
    role: string;
    visibility: string;
    content: string;
    citations: string;
    is_ai: number;
    ai_run_id: string | null;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    visibility: row.visibility,
    content: row.content,
    citations: safeJson<unknown[]>(row.citations, []),
    isAi: Boolean(row.is_ai),
    aiRunId: row.ai_run_id,
    createdAt: row.created_at,
    author: row.author_id
      ? {
          id: row.author_id,
          name: row.author_name ?? '用户',
          color: row.author_color ?? '#64748B',
          role: row.author_role ?? 'AGENT',
        }
      : null,
  }));
}

export function getTicketRuns(ticketId: string) {
  const rows = getDb()
    .prepare(
      `SELECT r.*, u.name AS created_by_name
       FROM ai_runs r LEFT JOIN users u ON u.id = r.created_by
       WHERE r.ticket_id = ? ORDER BY r.created_at DESC`,
    )
    .all(ticketId) as unknown as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    category: row.category,
    priority: row.priority,
    sentiment: row.sentiment,
    summary: row.summary,
    confidence: row.confidence,
    riskFlags: safeJson<string[]>(row.risk_flags as string, []),
    recommendedAction: row.recommended_action,
    draft: row.draft,
    citations: safeJson<unknown[]>(row.citations as string, []),
    model: row.model,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    latency: row.latency_ms,
    error: row.error,
    createdBy: row.created_by_name ?? '系统',
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  }));
}

export function getTicketEvents(ticketId: string) {
  return getDb()
    .prepare(
      `SELECT e.*, u.name AS actor_name
       FROM ticket_events e LEFT JOIN users u ON u.id = e.actor_id
       WHERE e.ticket_id = ? ORDER BY e.created_at ASC`,
    )
    .all(ticketId) as unknown as Array<Record<string, unknown>>;
}

export function writeTicketEvent(
  ticketId: string,
  actorId: string | null,
  type: string,
  fromValue: string | null,
  toValue: string | null,
  detail = '',
): void {
  getDb()
    .prepare(
      `INSERT INTO ticket_events (id, ticket_id, actor_id, type, from_value, to_value, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      ticketId,
      actorId,
      type,
      fromValue,
      toValue,
      detail,
      nowIso(),
    );
}

export function canAccessTicket(user: AuthUser, ticket: TicketRow): boolean {
  if (user.role === 'CUSTOMER') return ticket.customer_id === user.id;
  return ticket.workspace_id === user.workspaceId;
}

export function ticketDetail(ticket: TicketRow, user: AuthUser) {
  const isCustomer = user.role === 'CUSTOMER';
  return {
    ...serializeTicket(ticket),
    messages: getTicketMessages(ticket.id, isCustomer),
    aiRuns: isCustomer ? [] : getTicketRuns(ticket.id),
    events: isCustomer ? [] : getTicketEvents(ticket.id),
  };
}
