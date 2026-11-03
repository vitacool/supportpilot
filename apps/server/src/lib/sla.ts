import { getDb } from '../db/index.js';
import type { TicketPriority, TicketStatus } from '../types.js';
import { addMinutes, nowIso } from './time.js';

export interface SlaPolicy {
  id: string;
  priority: TicketPriority;
  first_response_minutes: number;
  resolution_minutes: number;
}

export function getSlaPolicy(
  workspaceId: string,
  priority: TicketPriority,
): SlaPolicy | undefined {
  return getDb()
    .prepare(
      'SELECT id, priority, first_response_minutes, resolution_minutes FROM sla_policies WHERE workspace_id = ? AND priority = ? AND active = 1',
    )
    .get(workspaceId, priority) as SlaPolicy | undefined;
}

export function dueDates(
  workspaceId: string,
  priority: TicketPriority,
  createdAt: string,
): { policyId: string | null; firstDue: string | null; resolutionDue: string | null } {
  const policy = getSlaPolicy(workspaceId, priority);
  if (!policy) return { policyId: null, firstDue: null, resolutionDue: null };
  return {
    policyId: policy.id,
    firstDue: addMinutes(createdAt, policy.first_response_minutes),
    resolutionDue: addMinutes(createdAt, policy.resolution_minutes),
  };
}

export interface SlaView {
  status: 'met' | 'on_track' | 'at_risk' | 'breached' | 'paused';
  firstResponse: {
    dueAt: string | null;
    respondedAt: string | null;
    remainingMinutes: number | null;
    state: 'met' | 'on_track' | 'at_risk' | 'breached' | 'not_started';
  };
  resolution: {
    dueAt: string | null;
    resolvedAt: string | null;
    remainingMinutes: number | null;
    state: 'met' | 'on_track' | 'at_risk' | 'breached' | 'not_started';
  };
}

function stateFor(
  dueAt: string | null,
  completedAt: string | null,
  now: number,
): {
  state: 'met' | 'on_track' | 'at_risk' | 'breached' | 'not_started';
  remainingMinutes: number | null;
} {
  if (!dueAt) return { state: 'not_started', remainingMinutes: null };
  const due = new Date(dueAt).getTime();
  if (completedAt) {
    return {
      state: new Date(completedAt).getTime() <= due ? 'met' : 'breached',
      remainingMinutes: Math.round((due - new Date(completedAt).getTime()) / 60000),
    };
  }
  const total = Math.max(1, due - now);
  return {
    state: now > due ? 'breached' : total <= 30 * 60000 ? 'at_risk' : 'on_track',
    remainingMinutes: Math.round(total / 60000),
  };
}

export function slaView(ticket: {
  status: TicketStatus;
  first_response_due_at: string | null;
  resolution_due_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
}): SlaView {
  const now = Date.now();
  const first = stateFor(
    ticket.first_response_due_at,
    ticket.first_response_at,
    now,
  );
  const resolution = stateFor(
    ticket.resolution_due_at,
    ticket.status === 'resolved' || ticket.status === 'closed'
      ? ticket.resolved_at || nowIso()
      : null,
    now,
  );
  const status =
    first.state === 'breached' || resolution.state === 'breached'
      ? 'breached'
      : first.state === 'at_risk' || resolution.state === 'at_risk'
        ? 'at_risk'
        : first.state === 'met' && resolution.state === 'met'
          ? 'met'
          : 'on_track';
  return {
    status,
    firstResponse: {
      dueAt: ticket.first_response_due_at,
      respondedAt: ticket.first_response_at,
      remainingMinutes: first.remainingMinutes,
      state: first.state,
    },
    resolution: {
      dueAt: ticket.resolution_due_at,
      resolvedAt:
        ticket.status === 'resolved' || ticket.status === 'closed'
          ? ticket.resolved_at
          : null,
      remainingMinutes: resolution.remainingMinutes,
      state: resolution.state,
    },
  };
}
