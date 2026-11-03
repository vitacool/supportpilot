import type { TicketStatus } from '../types.js';
import { ApiError } from './errors.js';

const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  new: ['triaged', 'escalated', 'closed'],
  triaged: ['ai_drafted', 'waiting_customer', 'escalated', 'resolved'],
  ai_drafted: ['triaged', 'waiting_customer', 'escalated', 'resolved'],
  waiting_customer: ['triaged', 'escalated', 'resolved', 'closed'],
  escalated: ['triaged', 'waiting_customer', 'resolved'],
  resolved: ['closed', 'triaged'],
  closed: ['triaged'],
};

export const STATUS_LABELS: Record<TicketStatus, string> = {
  new: '待分诊',
  triaged: '已分诊',
  ai_drafted: 'AI 草稿待审',
  waiting_customer: '等待客户',
  escalated: '已升级',
  resolved: '已解决',
  closed: '已关闭',
};

export const STATUS_TONES: Record<TicketStatus, string> = {
  new: 'blue',
  triaged: 'violet',
  ai_drafted: 'amber',
  waiting_customer: 'mint',
  escalated: 'rose',
  resolved: 'green',
  closed: 'neutral',
};

export function canTransition(
  from: TicketStatus,
  to: TicketStatus,
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(
  from: TicketStatus,
  to: TicketStatus,
): void {
  if (!canTransition(from, to)) {
    throw new ApiError(
      409,
      'INVALID_TRANSITION',
      `工单不能从「${STATUS_LABELS[from]}」直接变更为「${STATUS_LABELS[to]}」`,
    );
  }
}

export function isTerminal(status: TicketStatus): boolean {
  return status === 'resolved' || status === 'closed';
}

export function statusAfterCustomerMessage(
  current: TicketStatus,
): TicketStatus {
  if (current === 'resolved' || current === 'closed') return 'triaged';
  if (current === 'waiting_customer') return 'triaged';
  return current;
}
