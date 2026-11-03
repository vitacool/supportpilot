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

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  workspaceId: string;
  avatarColor: string;
}

export interface Citation {
  index: number;
  chunkId: string;
  documentId: string;
  kbId: string;
  title: string;
  snippet: string;
  score: number;
  vectorScore?: number;
  keywordScore?: number;
}

export interface TicketMessage {
  id: string;
  role: 'customer' | 'agent' | 'ai' | 'system';
  visibility: 'public' | 'internal';
  content: string;
  citations: Citation[];
  isAi: boolean;
  aiRunId: string | null;
  createdAt: string;
  author: {
    id: string;
    name: string;
    color: string;
    role: Role;
  } | null;
}

export interface AiRun {
  id: string;
  status: 'completed' | 'accepted' | 'rejected' | 'failed';
  category: TicketCategory;
  priority: TicketPriority;
  sentiment: string;
  summary: string;
  confidence: number;
  riskFlags: string[];
  recommendedAction: 'auto_send' | 'human_review' | 'escalate';
  draft: string;
  citations: Citation[];
  model: string;
  promptTokens: number;
  completionTokens: number;
  latency: number;
  error: string;
  createdBy: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface SlaView {
  status: 'met' | 'on_track' | 'at_risk' | 'breached';
  firstResponse: {
    dueAt: string | null;
    respondedAt: string | null;
    remainingMinutes: number | null;
    state: string;
  };
  resolution: {
    dueAt: string | null;
    resolvedAt: string | null;
    remainingMinutes: number | null;
    state: string;
  };
}

export interface Ticket {
  id: string;
  number: string;
  subject: string;
  status: TicketStatus;
  statusLabel: string;
  priority: TicketPriority;
  category: TicketCategory;
  sentiment: string;
  channel: string;
  aiState: string;
  aiConfidence: number;
  aiSummary: string;
  riskFlags: string[];
  tags: string[];
  customer: { id: string; name: string; email: string; avatarColor: string };
  assignee: { id: string; name: string; avatarColor: string } | null;
  sla: SlaView;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  csat: number | null;
  preview: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TicketEvent {
  id: string;
  type: string;
  from_value: string | null;
  to_value: string | null;
  detail: string;
  actor_name: string | null;
  created_at: string;
}

export interface TicketDetail extends Ticket {
  messages: TicketMessage[];
  aiRuns: AiRun[];
  events: TicketEvent[];
}

export interface TicketListResponse {
  tickets: Ticket[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
  stats: {
    open: number;
    mine: number;
    unassigned: number;
    breached: number;
    waiting: number;
    aiDrafted: number;
  };
}

export interface Agent {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatarColor: string;
  openTickets: number;
}

export interface AnalyticsData {
  summary: {
    total: number;
    open: number;
    resolved: number;
    waiting: number;
    breached: number;
    avgFirstResponse: number;
    avgResolution: number;
    firstResponseCompliance: number;
    resolutionCompliance: number;
    csat: number;
    aiAdoption: number;
    autoResolved: number;
    aiRuns: number;
    aiAccepted: number;
    aiRejected: number;
  };
  series: Array<{ date: string; created: number; resolved: number }>;
  categories: Array<{ key: string; value: number }>;
  priorities: Array<{
    priority: string;
    total: number;
    breached: number;
    atRisk: number;
  }>;
  agents: Array<{
    id: string;
    name: string;
    color: string;
    openTickets: number;
    resolvedTickets: number;
    avgFirstResponse: number;
  }>;
  recentRuns: Array<{
    id: string;
    ticketId: string;
    number: string;
    subject: string;
    confidence: number;
    action: string;
    status: string;
    createdAt: string;
  }>;
}

export interface EvalCase {
  id: string;
  question: string;
  expectedCategory: string;
  expectedKeyword: string;
  kbId: string | null;
  difficulty: string;
}

export interface EvalResult {
  question: string;
  expectedCategory: string;
  predictedCategory: string;
  expectedKeyword: string;
  hitTitles: string[];
  intentOk: boolean;
  retrievalOk: boolean;
  citationOk: boolean;
  confidence: number;
  latency: number;
  detail: string;
}

export interface EvalRun {
  id: string;
  status: string;
  total: number;
  intentAccuracy: number;
  retrievalRecall: number;
  citationCoverage: number;
  avgLatency: number;
  avgConfidence: number;
  error: string;
  createdBy: string;
  createdAt: string;
  finishedAt: string | null;
}

export interface EvaluationData {
  cases: EvalCase[];
  runs: EvalRun[];
  latestResults: EvalResult[];
}

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  color: string;
  documents: number;
  tokens: number;
  chunks: number;
  createdAt: string;
  updatedAt: string;
}

export interface Document {
  id: string;
  kbId: string;
  title: string;
  content: string;
  tokens: number;
  status: 'ready' | 'processing' | 'error';
  chunkCount: number;
  indexError: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDetail extends Omit<KnowledgeBase, 'documents'> {
  documents: Document[];
}

export interface RetrievedChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  title: string;
  content: string;
  score: number;
  vectorScore: number;
  keywordScore: number;
}

export interface SearchResponse {
  chunks: RetrievedChunk[];
  citations: Citation[];
  mode: 'hybrid' | 'keyword';
  latencyMs: number;
  warning?: string;
}

export interface SettingsData {
  workspace: { id: string; name: string; plan: string; csatTarget: number };
  ai: {
    backend: 'mock' | 'openai';
    baseUrl: string;
    hasKey: boolean;
    maskedKey: string;
    model: string;
    autoSend: boolean;
    confidenceThreshold: number;
  };
  embedding: {
    backend: 'local' | 'openai';
    baseUrl: string;
    hasKey: boolean;
    maskedKey: string;
    model: string;
    dimensions: number;
    topK: number;
    minScore: number;
    vectorStore: string;
  };
  slaPolicies: Array<{
    id: string;
    priority: string;
    first_response_minutes: number;
    resolution_minutes: number;
    active: number;
  }>;
  counts: {
    users: number;
    tickets: number;
    documents: number;
    chunks: number;
    ai_runs: number;
  };
}
