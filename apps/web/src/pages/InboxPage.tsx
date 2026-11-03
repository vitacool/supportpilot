import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  BookOpenText,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  CornerDownLeft,
  Inbox,
  Loader2,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Tag,
  UserPlus,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type {
  Agent,
  AiRun,
  Citation,
  Ticket,
  TicketCategory,
  TicketDetail,
  TicketListResponse,
  TicketPriority,
  TicketStatus,
} from '../types';
import {
  categoryLabel,
  cn,
  formatDateTime,
  formatMinutes,
  priorityLabel,
  relativeTime,
  slaStatusLabel,
} from '../lib/utils';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { Avatar } from '../components/Avatar';
import { Badge, Button, EmptyState, Select, Skeleton } from '../components/ui';

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'mine', label: '我的' },
  { key: 'unassigned', label: '未分配' },
  { key: 'ai', label: 'AI 待审' },
  { key: 'breached', label: 'SLA 超时' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

function priorityClass(priority: TicketPriority) {
  return `priority-${priority}`;
}

function statusTone(status: TicketStatus) {
  return (
    {
      new: 'blue',
      triaged: 'violet',
      ai_drafted: 'amber',
      waiting_customer: 'mint',
      escalated: 'rose',
      resolved: 'mint',
      closed: 'neutral',
    } as const
  )[status];
}

function CitationList({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;
  return (
    <div className="citation-list">
      {citations.map((citation) => (
        <div className="citation-card" key={citation.chunkId}>
          <span className="citation-index">{String(citation.index).padStart(2, '0')}</span>
          <span>
            <strong>{citation.title}</strong>
            <small>{citation.snippet}</small>
          </span>
          <em>{Math.round(citation.score * 100)}%</em>
        </div>
      ))}
    </div>
  );
}

export function InboxPage() {
  const toast = useToast();
  const { confirm } = useConfirm();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [draft, setDraft] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [showCopilot, setShowCopilot] = useState(true);
  const [showEvents, setShowEvents] = useState(false);

  const params = useMemo(() => {
    const p = new URLSearchParams({ pageSize: '50' });
    if (filter === 'mine') p.set('assignee', 'me');
    if (filter === 'unassigned') p.set('assignee', 'unassigned');
    if (filter === 'ai') p.set('status', 'ai_drafted');
    if (filter === 'breached') p.set('sla', 'breached');
    if (search.trim()) p.set('search', search.trim());
    return p.toString();
  }, [filter, search]);

  const ticketsQuery = useQuery({
    queryKey: ['tickets', params],
    queryFn: () => api<TicketListResponse>(`/api/tickets?${params}`),
    refetchInterval: 20_000,
  });
  const agentsQuery = useQuery({
    queryKey: ['agents'],
    queryFn: () => api<Agent[]>('/api/users/agents'),
  });
  const detailQuery = useQuery({
    queryKey: ['ticket', selectedId],
    queryFn: () => api<TicketDetail>(`/api/tickets/${selectedId}`),
    enabled: Boolean(selectedId),
    refetchInterval: 20_000,
  });

  const tickets = ticketsQuery.data?.tickets ?? [];
  const detail = detailQuery.data;
  const stats = ticketsQuery.data?.stats;
  const latestRun = detail?.aiRuns?.[0];

  useEffect(() => {
    if (!selectedId && tickets.length > 0) setSelectedId(tickets[0].id);
  }, [selectedId, tickets]);

  useEffect(() => {
    if (detail) {
      setReply('');
      setInternal(false);
      setDraft(latestRun?.draft ?? '');
    }
  }, [detail?.id, latestRun?.id]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['tickets'] }),
      queryClient.invalidateQueries({ queryKey: ['ticket', selectedId] }),
    ]);
  };

  const updateTicket = async (payload: Record<string, unknown>) => {
    if (!selectedId) return;
    try {
      await api(`/api/tickets/${selectedId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      await refresh();
      toast.success('工单已更新');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '更新失败');
    }
  };

  const changeStatus = async (status: TicketStatus) => {
    if (!selectedId) return;
    try {
      await api(`/api/tickets/${selectedId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      await refresh();
      toast.success(`状态已变更为 ${status}`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '状态变更失败');
    }
  };

  const sendReply = async () => {
    if (!selectedId || !reply.trim()) return;
    setSending(true);
    try {
      await api(`/api/tickets/${selectedId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: reply.trim(), visibility: internal ? 'internal' : 'public' }),
      });
      setReply('');
      await refresh();
      toast.success(internal ? '内部备注已添加' : '回复已发送');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '发送失败');
    } finally {
      setSending(false);
    }
  };

  const runAi = async () => {
    if (!selectedId) return;
    setAiBusy(true);
    try {
      const result = await api<{ run: AiRun; ticket: TicketDetail; warning?: string }>(
        `/api/tickets/${selectedId}/ai/run`,
        { method: 'POST' },
      );
      setDraft(result.run.draft);
      await refresh();
      if (result.warning) toast.info(result.warning);
      if (result.run.recommendedAction === 'auto_send') {
        toast.success('AI 草稿已达到自动发送条件，已发送');
      } else {
        toast.success('AI 已生成草稿，等待人工审核');
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'AI 运行失败');
    } finally {
      setAiBusy(false);
    }
  };

  const acceptAi = async (send: boolean) => {
    if (!selectedId || !latestRun) return;
    if (!draft.trim()) {
      toast.error('草稿不能为空');
      return;
    }
    setAiBusy(true);
    try {
      await api(`/api/tickets/${selectedId}/ai/runs/${latestRun.id}/accept`, {
        method: 'POST',
        body: JSON.stringify({ content: draft, send }),
      });
      await refresh();
      toast.success(send ? 'AI 草稿已发送给客户' : '草稿已保存为内部备注');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '采纳失败');
    } finally {
      setAiBusy(false);
    }
  };

  const rejectAi = async () => {
    if (!selectedId || !latestRun) return;
    const ok = await confirm({
      title: '拒绝这份 AI 草稿？',
      description: '工单会回到「已分诊」状态，你可以手动回复或重新生成。',
      confirmText: '拒绝草稿',
      danger: true,
    });
    if (!ok) return;
    setAiBusy(true);
    try {
      await api(`/api/tickets/${selectedId}/ai/runs/${latestRun.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: '人工判断不适用' }),
      });
      await refresh();
      toast.success('AI 草稿已拒绝');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '操作失败');
    } finally {
      setAiBusy(false);
    }
  };

  const resolve = async () => {
    const ok = await confirm({
      title: '将工单标记为已解决？',
      description: '客户会收到解决通知，并可以对本次服务进行评价。',
      confirmText: '标记已解决',
    });
    if (!ok) return;
    await changeStatus('resolved');
  };

  return (
    <div className="inbox-page">
      <aside className={cn('queue-panel', selectedId && 'has-selection')}>
        <div className="queue-head">
          <div>
            <span className="eyebrow">INBOX</span>
            <h1>收件箱</h1>
          </div>
          <button className="icon-btn" onClick={() => void refresh()} title="刷新">
            <RefreshCw size={16} />
          </button>
        </div>
        <div className="queue-stats">
          <span><strong>{stats?.open ?? '—'}</strong> 待处理</span>
          <span className="danger"><strong>{stats?.breached ?? 0}</strong> 超时</span>
          <span><strong>{stats?.aiDrafted ?? 0}</strong> AI 待审</span>
        </div>
        <div className="queue-search">
          <SearchIcon />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索工单号、主题或客户"
          />
        </div>
        <div className="queue-filters">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              className={cn(filter === item.key && 'is-active')}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
              {item.key === 'mine' && stats?.mine ? <i>{stats.mine}</i> : null}
            </button>
          ))}
        </div>
        <div className="queue-list">
          {ticketsQuery.isLoading &&
            [0, 1, 2, 3].map((item) => (
              <Skeleton key={item} style={{ height: 102, borderRadius: 10, marginBottom: 6 }} />
            ))}
          {!ticketsQuery.isLoading && tickets.length === 0 && (
            <div className="queue-empty">
              <Inbox size={22} />
              <span>没有符合条件的工单</span>
            </div>
          )}
          {tickets.map((ticket) => (
            <button
              key={ticket.id}
              className={cn('queue-item', selectedId === ticket.id && 'is-active')}
              onClick={() => setSelectedId(ticket.id)}
            >
              <span className={cn('priority-line', priorityClass(ticket.priority))} />
              <span className="queue-item-top">
                <span className="queue-customer">
                  <Avatar name={ticket.customer.name} color={ticket.customer.avatarColor} size={22} />
                  {ticket.customer.name}
                </span>
                <span className="queue-time">{relativeTime(ticket.updatedAt)}</span>
              </span>
              <strong className="queue-subject">{ticket.subject}</strong>
              <span className="queue-preview">{ticket.preview || '暂无消息'}</span>
              <span className="queue-item-foot">
                <span className="queue-number">{ticket.number}</span>
                <span className={cn('sla-chip', `sla-${ticket.sla.status}`)}>
                  {slaStatusLabel(ticket.sla.status)}
                </span>
                {ticket.status === 'ai_drafted' && <span className="ai-chip"><Sparkles size={9} /> AI</span>}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className={cn('conversation-panel', !selectedId && 'is-empty')}>
        {!selectedId ? (
          <EmptyState
            icon={<Inbox size={28} />}
            title="选择一张工单"
            description="从左侧队列选择工单，开始人机协同处理。"
          />
        ) : detailQuery.isLoading || !detail ? (
          <div className="conversation-loading">
            <Skeleton style={{ height: 90 }} />
            <Skeleton style={{ height: 260 }} />
            <Skeleton style={{ height: 120 }} />
          </div>
        ) : (
          <>
            <header className="conversation-head">
              <div className="conversation-title">
                <button className="mobile-back" onClick={() => setSelectedId(null)} aria-label="返回队列">
                  <ArrowLeft size={17} />
                </button>
                <div className="conversation-topline">
                  <span className="ticket-number">{detail.number}</span>
                  <Badge tone={statusTone(detail.status)}>{detail.statusLabel}</Badge>
                  <span className={cn('priority-pill', priorityClass(detail.priority))}>
                    {priorityLabel(detail.priority)}
                  </span>
                  <span className="category-pill"><Tag size={11} /> {categoryLabel(detail.category)}</span>
                </div>
                <h2>{detail.subject}</h2>
                <div className="conversation-customer">
                  <Avatar name={detail.customer.name} color={detail.customer.avatarColor} size={24} />
                  <span>{detail.customer.name}</span>
                  <span>{detail.customer.email}</span>
                  <span>·</span>
                  <span>{detail.channel === 'email' ? '邮件' : '客户门户'}</span>
                </div>
              </div>
              <div className="conversation-actions">
                <Select
                  className="inline-select"
                  value={detail.assignee?.id ?? ''}
                  onChange={(event) =>
                    void updateTicket({ assigneeId: event.target.value || null })
                  }
                >
                  <option value="">未分配</option>
                  {(agentsQuery.data ?? []).map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.name}</option>
                  ))}
                </Select>
                <Select
                  className="inline-select status-select"
                  value={detail.status}
                  onChange={(event) => void changeStatus(event.target.value as TicketStatus)}
                >
                  <option value="new" disabled>待分诊</option>
                  <option value="triaged">已分诊</option>
                  <option value="ai_drafted">AI 草稿待审</option>
                  <option value="waiting_customer">等待客户</option>
                  <option value="escalated">已升级</option>
                  <option value="resolved">已解决</option>
                  <option value="closed">已关闭</option>
                </Select>
                {!showCopilot && (
                  <Button variant="secondary" size="sm" icon={<Sparkles size={14} />} onClick={() => setShowCopilot(true)}>
                    AI
                  </Button>
                )}
                <Button variant="primary" size="sm" icon={<CheckCircle2 size={14} />} onClick={() => void resolve()}>
                  解决
                </Button>
                <button className="icon-btn" title="更多"><MoreHorizontal size={17} /></button>
              </div>
            </header>

            <div className="sla-strip">
              <div className={cn('sla-block', `sla-${detail.sla.firstResponse.state}`)}>
                <span><Clock3 size={13} /> 首次响应</span>
                <strong>{formatMinutes(detail.sla.firstResponse.remainingMinutes)}</strong>
                <small>{detail.sla.firstResponse.respondedAt ? '已响应' : '目标 15m / 30m / 2h'}</small>
              </div>
              <div className={cn('sla-block', `sla-${detail.sla.resolution.state}`)}>
                <span><ShieldAlert size={13} /> 解决时限</span>
                <strong>{formatMinutes(detail.sla.resolution.remainingMinutes)}</strong>
                <small>目标 {detail.priority === 'urgent' ? '4h' : detail.priority === 'high' ? '8h' : '24h'}</small>
              </div>
              <div className="sla-summary">
                <span className={cn('sla-badge', `sla-${detail.sla.status}`)}>
                  {slaStatusLabel(detail.sla.status)}
                </span>
                <button onClick={() => setShowEvents((value) => !value)}>
                  {showEvents ? '隐藏动态' : '查看工单动态'}
                </button>
              </div>
            </div>

            {showEvents && (
              <div className="ticket-events">
                {detail.events.slice(-6).map((event) => (
                  <div key={event.id}>
                    <i />
                    <span>{event.detail}</span>
                    <time>{formatDateTime(event.created_at)}</time>
                  </div>
                ))}
              </div>
            )}

            <div className="conversation-scroll">
              <div className="conversation-date">今天 · 对话记录</div>
              {detail.messages.map((message) => {
                const isCustomer = message.role === 'customer';
                const isInternal = message.visibility === 'internal';
                return (
                  <div
                    key={message.id}
                    className={cn(
                      'ticket-message',
                      isCustomer ? 'is-customer' : 'is-agent',
                      isInternal && 'is-internal',
                    )}
                  >
                    <Avatar
                      name={message.author?.name ?? (message.role === 'ai' ? 'AI' : '系统')}
                      color={message.author?.color ?? '#6D8BFF'}
                      size={30}
                    />
                    <div className="message-content">
                      <div className="message-author">
                        <strong>{message.author?.name ?? (message.role === 'ai' ? 'SupportPilot AI' : '系统')}</strong>
                        {message.isAi && <span className="ai-author"><Sparkles size={10} /> AI</span>}
                        {isInternal && <span className="internal-tag"><Lock size={9} /> 内部备注</span>}
                        <time>{formatDateTime(message.createdAt)}</time>
                      </div>
                      <div className="message-bubble">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                        <CitationList citations={message.citations} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="composer">
              <div className="composer-tabs">
                <button className={cn(!internal && 'is-active')} onClick={() => setInternal(false)}>
                  <MessageSquare size={13} /> 公开回复
                </button>
                <button className={cn(internal && 'is-active')} onClick={() => setInternal(true)}>
                  <Lock size={13} /> 内部备注
                </button>
                <span className="composer-to">
                  {internal ? '仅客服可见' : `发送给 ${detail.customer.name}`}
                </span>
              </div>
              <textarea
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                placeholder={internal ? '记录内部判断、排查过程或交接信息…' : '输入给客户的回复，Enter 发送，Shift + Enter 换行…'}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void sendReply();
                  }
                }}
              />
              <div className="composer-foot">
                <div>
                  <button className="icon-btn" title="附件"><Paperclip size={16} /></button>
                  <span>支持 Markdown</span>
                </div>
                <div>
                  <span className="kbd-hint">Enter 发送</span>
                  <Button variant="primary" size="sm" loading={sending} onClick={() => void sendReply()}>
                    发送回复 <CornerDownLeft size={13} />
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      {detail && showCopilot && (
        <aside className="copilot-panel">
          <div className="copilot-head">
            <div>
              <span className="copilot-eyebrow"><Sparkles size={12} /> AI COPILOT</span>
              <h3>人机协同</h3>
            </div>
            <button className="icon-btn" onClick={() => setShowCopilot(false)}><X size={16} /></button>
          </div>

          {!latestRun ? (
            <div className="copilot-empty">
              <div className="copilot-orb"><Sparkles size={24} /></div>
              <h4>让 AI 先做一轮准备</h4>
              <p>自动分类、判断优先级、检索知识库，并生成一封可编辑的回复草稿。</p>
              <Button
                variant="primary"
                icon={aiBusy ? <Loader2 size={15} className="spin" /> : <Zap size={15} />}
                loading={aiBusy}
                onClick={() => void runAi()}
              >
                运行 AI 分诊与草稿
              </Button>
              <div className="copilot-safe"><ShieldAlert size={12} /> 默认人工审核，不会自动发送</div>
            </div>
          ) : (
            <div className="copilot-body">
              <div className="ai-meta">
                <Badge tone={latestRun.recommendedAction === 'auto_send' ? 'mint' : latestRun.recommendedAction === 'escalate' ? 'rose' : 'amber'}>
                  {latestRun.recommendedAction === 'auto_send' ? '可自动发送' : latestRun.recommendedAction === 'escalate' ? '建议升级' : '需要人工审核'}
                </Badge>
                <span>{latestRun.model}</span>
              </div>

              <div className="confidence-box">
                <div className="confidence-head">
                  <span>AI 置信度</span>
                  <strong>{Math.round(latestRun.confidence * 100)}%</strong>
                </div>
                <div className="confidence-bar"><i style={{ width: `${latestRun.confidence * 100}%` }} /></div>
                <div className="confidence-foot">
                  <span>{latestRun.citations.length} 条知识引用</span>
                  <span>{latestRun.latency}ms</span>
                </div>
              </div>

              <div className="ai-classification">
                <div><span>分类</span><strong>{categoryLabel(latestRun.category)}</strong></div>
                <div><span>优先级</span><strong>{priorityLabel(latestRun.priority)}</strong></div>
                <div><span>情绪</span><strong>{latestRun.sentiment === 'negative' ? '负面' : latestRun.sentiment === 'positive' ? '正面' : '中性'}</strong></div>
              </div>

              {latestRun.riskFlags.length > 0 && (
                <div className="risk-flags">
                  <AlertTriangle size={13} />
                  {latestRun.riskFlags.map((flag) => <span key={flag}>{flag}</span>)}
                </div>
              )}

              <div className="ai-summary">
                <span>AI 摘要</span>
                <p>{latestRun.summary}</p>
              </div>

              <div className="draft-head">
                <span>建议回复</span>
                {latestRun.status === 'completed' && <span className="draft-editable">可编辑后发送</span>}
              </div>
              <textarea
                className="draft-textarea"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={latestRun.status !== 'completed' || aiBusy}
              />

              {latestRun.citations.length > 0 && (
                <div className="ai-citations">
                  <div className="ai-citations-head"><BookOpenText size={12} /> 知识引用</div>
                  <CitationList citations={latestRun.citations} />
                </div>
              )}

              {latestRun.status === 'completed' ? (
                <div className="copilot-actions">
                  <Button
                    variant="primary"
                    icon={<Check size={15} />}
                    loading={aiBusy}
                    onClick={() => void acceptAi(true)}
                  >
                    采纳并发送
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => void acceptAi(false)}>
                    存为内部备注
                  </Button>
                  <button className="reject-link" onClick={() => void rejectAi()}>拒绝草稿</button>
                </div>
              ) : (
                <div className="copilot-resolved">
                  <CheckCircle2 size={16} />
                  {latestRun.status === 'accepted' ? '该草稿已被采纳，可继续在下方对话中跟进。' : '该草稿已被拒绝。'}
                </div>
              )}
              <button className="regenerate" onClick={() => void runAi()} disabled={aiBusy}>
                <RefreshCw size={12} className={aiBusy ? 'spin' : undefined} /> 重新生成
              </button>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
    </svg>
  );
}
