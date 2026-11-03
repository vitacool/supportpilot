import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Headphones,
  LogOut,
  MessageSquarePlus,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  X,
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { Ticket, TicketDetail } from '../types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { Logo } from '../components/Logo';
import { Avatar } from '../components/Avatar';
import { Modal } from '../components/Modal';
import { Badge, Button, EmptyState, Field, Input, Skeleton, Textarea } from '../components/ui';
import { cn, formatDateTime, relativeTime, statusLabelForPortal } from '../lib/utils';

interface PortalData {
  tickets: Ticket[];
  stats: { open: number; resolved: number; total: number };
}

const statusTone = (status: string) =>
  ({
    new: 'blue',
    triaged: 'violet',
    ai_drafted: 'amber',
    waiting_customer: 'mint',
    escalated: 'rose',
    resolved: 'mint',
    closed: 'neutral',
  } as const)[status] ?? 'neutral';

export function PortalPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const listQuery = useQuery({
    queryKey: ['portal'],
    queryFn: () => api<PortalData>('/api/portal/tickets'),
  });
  const detailQuery = useQuery({
    queryKey: ['portal-ticket', selectedId],
    queryFn: () => api<TicketDetail>(`/api/portal/tickets/${selectedId}`),
    enabled: Boolean(selectedId),
  });
  const tickets = listQuery.data?.tickets ?? [];
  const detail = detailQuery.data;

  useEffect(() => {
    if (!selectedId && tickets.length) setSelectedId(tickets[0].id);
  }, [selectedId, tickets]);

  const createTicket = async () => {
    if (!subject.trim() || content.trim().length < 10) {
      toast.error('请填写主题和至少 10 个字符的问题描述');
      return;
    }
    setSaving(true);
    try {
      const created = await api<TicketDetail>('/api/tickets', {
        method: 'POST',
        body: JSON.stringify({ subject, content }),
      });
      setSelectedId(created.id);
      setNewOpen(false);
      setSubject('');
      setContent('');
      void queryClient.invalidateQueries({ queryKey: ['portal'] });
      toast.success('工单已提交，客服会尽快回复');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '提交失败');
    } finally {
      setSaving(false);
    }
  };

  const sendReply = async () => {
    if (!selectedId || !reply.trim()) return;
    setSending(true);
    try {
      await api(`/api/tickets/${selectedId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: reply.trim(), visibility: 'public' }),
      });
      setReply('');
      void queryClient.invalidateQueries({ queryKey: ['portal-ticket', selectedId] });
      void queryClient.invalidateQueries({ queryKey: ['portal'] });
      toast.success('回复已发送');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '发送失败');
    } finally {
      setSending(false);
    }
  };

  const rate = async (score: number) => {
    if (!selectedId) return;
    try {
      await api(`/api/tickets/${selectedId}/csat`, {
        method: 'POST',
        body: JSON.stringify({ score }),
      });
      void queryClient.invalidateQueries({ queryKey: ['portal-ticket', selectedId] });
      toast.success('感谢你的评价');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '评价失败');
    }
  };

  return (
    <div className="portal-page">
      <header className="portal-header">
        <Logo />
        <nav>
          <button className="is-active">我的工单</button>
          <button onClick={() => setNewOpen(true)}>帮助中心</button>
        </nav>
        <div className="portal-user">
          <Avatar name={user?.name ?? '客户'} color={user?.avatarColor} size={30} />
          <span>{user?.name}</span>
          <button onClick={() => { logout(); navigate('/login'); }} title="退出"><LogOut size={16} /></button>
        </div>
      </header>

      <div className="portal-body">
        <section className="portal-hero">
          <div>
            <span className="eyebrow">CUSTOMER SUPPORT</span>
            <h1>你好，{user?.name}。<br />需要什么帮助？</h1>
            <p>提交问题后，AI 会先检索知识库并生成处理建议，客服会在 SLA 时限内跟进。</p>
            <Button variant="primary" size="lg" icon={<MessageSquarePlus size={17} />} onClick={() => setNewOpen(true)}>
              新建支持工单
            </Button>
          </div>
          <div className="portal-hero-stats">
            <div><strong>{listQuery.data?.stats.open ?? '—'}</strong><span>处理中</span></div>
            <div><strong>{listQuery.data?.stats.resolved ?? '—'}</strong><span>已解决</span></div>
            <div><strong>{listQuery.data?.stats.total ?? '—'}</strong><span>全部工单</span></div>
          </div>
        </section>

        <div className="portal-layout">
          <aside className="portal-tickets">
            <div className="portal-tickets-head"><span>我的工单</span><button onClick={() => setNewOpen(true)}><Plus size={15} /></button></div>
            {listQuery.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 84, marginBottom: 6 }} />)}
            {tickets.map((ticket) => (
              <button
                key={ticket.id}
                className={cn('portal-ticket-item', selectedId === ticket.id && 'is-active')}
                onClick={() => setSelectedId(ticket.id)}
              >
                <div className="portal-ticket-top">
                  <span>{ticket.number}</span>
                  <time>{relativeTime(ticket.updatedAt)}</time>
                </div>
                <strong>{ticket.subject}</strong>
                <div className="portal-ticket-foot">
                  <Badge tone={statusTone(ticket.status)}>{statusLabelForPortal(ticket.status)}</Badge>
                  <span>{ticket.messageCount} 条消息</span>
                  <ChevronRight size={13} />
                </div>
              </button>
            ))}
            {!listQuery.isLoading && tickets.length === 0 && (
              <EmptyState icon={<Headphones size={24} />} title="还没有工单" description="提交一个问题，我们会尽快回复。" />
            )}
          </aside>

          <section className="portal-conversation">
            {!selectedId ? (
              <EmptyState icon={<MessageSquarePlus size={28} />} title="选择一张工单" description="查看对话进度和客服回复。" />
            ) : detailQuery.isLoading || !detail ? (
              <div className="portal-loading"><Skeleton style={{ height: 80 }} /><Skeleton style={{ height: 300 }} /></div>
            ) : (
              <>
                <div className="portal-ticket-head">
                  <div>
                    <div className="portal-ticket-number">{detail.number} · {statusLabelForPortal(detail.status)}</div>
                    <h2>{detail.subject}</h2>
                    <p>提交于 {formatDateTime(detail.createdAt)} · 最近更新 {relativeTime(detail.updatedAt)}</p>
                  </div>
                  <Badge tone={statusTone(detail.status)}>{statusLabelForPortal(detail.status)}</Badge>
                </div>

                <div className="portal-timeline">
                  {detail.messages.map((message) => {
                    const mine = message.role === 'customer';
                    return (
                      <div key={message.id} className={cn('portal-message', mine ? 'is-mine' : 'is-agent')}>
                        {!mine && (
                          <span className="portal-agent-avatar">
                            {message.isAi ? <Sparkles size={14} /> : <Headphones size={14} />}
                          </span>
                        )}
                        <div>
                          <div className="portal-message-meta">
                            <strong>{mine ? '你' : message.isAi ? 'SupportPilot AI' : message.author?.name ?? '客服'}</strong>
                            <span>{formatDateTime(message.createdAt)}</span>
                          </div>
                          <div className="portal-message-bubble">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {['resolved', 'closed'].includes(detail.status) ? (
                  <div className="portal-csat">
                    <div>
                      <CheckCircle2 size={18} />
                      <span>这张工单已经解决。你的反馈会帮助我们改进 AI 与人工服务。</span>
                    </div>
                    <div className="portal-stars">
                      {[1, 2, 3, 4, 5].map((score) => (
                        <button key={score} onClick={() => void rate(score)} title={`${score} 分`}>
                          <Star size={22} fill={detail.csat && detail.csat >= score ? '#F59E0B' : 'none'} />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="portal-reply">
                    <textarea
                      value={reply}
                      onChange={(event) => setReply(event.target.value)}
                      placeholder="回复客服，补充信息或继续追问…"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          void sendReply();
                        }
                      }}
                    />
                    <div>
                      <span>客服会在 SLA 时限内回复</span>
                      <Button variant="primary" size="sm" loading={sending} icon={<Send size={13} />} onClick={() => void sendReply()}>
                        发送
                      </Button>
                    </div>
                  </div>
                )}
                <div className="portal-security"><ShieldCheck size={12} /> 对话仅你和授权客服可见</div>
              </>
            )}
          </section>
        </div>
      </div>

      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="新建支持工单"
        description="描述得越具体，AI 和客服越能快速给出解决方案。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewOpen(false)}>取消</Button>
            <Button variant="primary" loading={saving} onClick={() => void createTicket()}>提交工单</Button>
          </>
        }
      >
        <div className="form-stack">
          <Field label="问题主题" required>
            <Input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="例如：忘记密码后无法登录后台" />
          </Field>
          <Field label="问题描述" required hint="请附上账号、订单号或错误信息，便于快速定位。">
            <Textarea value={content} onChange={(event) => setContent(event.target.value)} rows={7} placeholder="请描述你遇到的问题…" />
          </Field>
          <div className="portal-ai-note"><Sparkles size={14} /> 提交后，AI 会先检索知识库，客服会基于引用给出回复。</div>
        </div>
      </Modal>
    </div>
  );
}
