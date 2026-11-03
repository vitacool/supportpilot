export type Role = 'OWNER' | 'ADMIN' | 'AGENT' | 'CUSTOMER';

export type TicketStatus =
  | 'new'
  | 'triaged'
  | 'ai_drafted'
  | 'waiting_customer'
  | 'escalated'
  | 'resolved'
  | 'closed';

export type TicketPriority = 'urgent' | 'high' | 'normal' | 'low';

export type TicketCategory =
  | 'billing'
  | 'refund'
  | 'technical'
  | 'account'
  | 'feature'
  | 'other';

export type Sentiment = 'negative' | 'neutral' | 'positive';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  workspaceId: string;
  avatarColor: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
