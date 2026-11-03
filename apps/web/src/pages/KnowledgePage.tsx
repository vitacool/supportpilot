import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpenText,
  CheckCircle2,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Upload,
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type {
  KnowledgeBase,
  KnowledgeDetail,
  SearchResponse,
} from '../types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { Modal } from '../components/Modal';
import { Badge, Button, Card, EmptyState, Field, Input, Skeleton, Textarea } from '../components/ui';
import { cn, formatCompact, formatDateTime } from '../lib/utils';

export function KnowledgePage() {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canEdit = user?.role !== 'AGENT';
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [docOpen, setDocOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);

  const listQuery = useQuery({
    queryKey: ['knowledge'],
    queryFn: () => api<KnowledgeBase[]>('/api/knowledge-bases'),
  });
  const detailQuery = useQuery({
    queryKey: ['knowledge-detail', selectedId],
    queryFn: () => api<KnowledgeDetail>(`/api/knowledge-bases/${selectedId}`),
    enabled: Boolean(selectedId),
    refetchInterval: (query) => {
      const data = query.state.data as KnowledgeDetail | undefined;
      return data?.documents.some((doc) => doc.status === 'processing') ? 1500 : false;
    },
  });
  const bases = listQuery.data ?? [];
  const detail = detailQuery.data;

  useEffect(() => {
    if (!selectedId && bases.length) setSelectedId(bases[0].id);
  }, [bases, selectedId]);

  const totalChunks = useMemo(
    () => bases.reduce((sum, kb) => sum + kb.chunks, 0),
    [bases],
  );

  const saveDoc = async () => {
    if (!selectedId || !title.trim() || content.trim().length < 10) {
      toast.error('请填写标题和至少 10 个字符的内容');
      return;
    }
    setSaving(true);
    try {
      await api(`/api/knowledge-bases/${selectedId}/documents`, {
        method: 'POST',
        body: JSON.stringify({ title, content }),
      });
      setDocOpen(false);
      setTitle('');
      setContent('');
      void queryClient.invalidateQueries({ queryKey: ['knowledge-detail', selectedId] });
      void queryClient.invalidateQueries({ queryKey: ['knowledge'] });
      toast.success('文档已提交，正在建立向量索引');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const reindex = async () => {
    if (!selectedId) return;
    try {
      await api(`/api/knowledge-bases/${selectedId}/reindex`, { method: 'POST' });
      void queryClient.invalidateQueries({ queryKey: ['knowledge-detail', selectedId] });
      toast.success('已提交重建索引');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '重建失败');
    }
  };

  const search = async () => {
    if (!selectedId || !query.trim()) return;
    setSearching(true);
    try {
      const result = await api<SearchResponse>(
        `/api/knowledge-bases/${selectedId}/search?q=${encodeURIComponent(query)}`,
      );
      setSearchResult(result);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '检索失败');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="page knowledge-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">KNOWLEDGE · RAG</span>
          <h1>知识库</h1>
          <p>客服回复的事实来源。文档切片、向量索引与混合检索都在这里管理。</p>
        </div>
        {canEdit && selectedId && (
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => setDocOpen(true)}>
            添加文档
          </Button>
        )}
      </header>

      <div className="knowledge-summary">
        <span><strong>{bases.length}</strong> 个知识库</span>
        <i />
        <span><strong>{bases.reduce((sum, kb) => sum + kb.documents, 0)}</strong> 篇文档</span>
        <i />
        <span><strong>{formatCompact(totalChunks)}</strong> 个向量切片</span>
        <span className="knowledge-live"><span className="pulse-dot" /> 混合检索已启用</span>
      </div>

      <div className="knowledge-layout">
        <aside className="kb-sidebar">
          <div className="kb-sidebar-head"><span>知识库</span><BookOpenText size={15} /></div>
          {listQuery.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 68, marginBottom: 6 }} />)}
          {bases.map((kb) => (
            <button
              key={kb.id}
              className={cn('kb-nav-item', selectedId === kb.id && 'is-active')}
              onClick={() => { setSelectedId(kb.id); setSearchResult(null); }}
            >
              <span className="kb-nav-icon" style={{ color: kb.color, background: `${kb.color}12` }}>
                <BookOpenText size={16} />
              </span>
              <span>
                <strong>{kb.name}</strong>
                <small>{kb.documents} 篇 · {formatCompact(kb.chunks)} chunks</small>
              </span>
            </button>
          ))}
        </aside>

        <section className="kb-main">
          {!selectedId ? (
            <EmptyState icon={<BookOpenText size={28} />} title="选择知识库" description="从左侧选择知识库查看文档和检索效果。" />
          ) : detailQuery.isLoading || !detail ? (
            <div className="kb-loading"><Skeleton style={{ height: 60 }} /><Skeleton style={{ height: 260 }} /></div>
          ) : (
            <>
              <div className="kb-header">
                <div>
                  <div className="kb-title-row">
                    <span style={{ background: detail.color }} />
                    <h2>{detail.name}</h2>
                    <Badge tone="neutral">{detail.documents.length} 篇</Badge>
                  </div>
                  <p>{detail.description}</p>
                  <div className="kb-meta">
                    <span>{formatCompact(detail.tokens)} tokens</span>
                    <span>{formatCompact(detail.chunks)} 个切片</span>
                    <span>更新于 {formatDateTime(detail.updatedAt)}</span>
                    <span className="vector-pill"><Sparkles size={11} /> 向量索引</span>
                  </div>
                </div>
                <Button variant="secondary" size="sm" icon={<RefreshCw size={14} />} onClick={() => void reindex()}>
                  重建索引
                </Button>
              </div>

              <div className="kb-tabs">
                <span className="is-active">文档</span>
                <span>向量检索</span>
              </div>

              <div className="kb-search">
                <div className="kb-search-input">
                  <Search size={15} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => event.key === 'Enter' && void search()}
                    placeholder="测试知识库：例如「忘记密码怎么重置」"
                  />
                </div>
                <Button variant="primary" size="sm" loading={searching} onClick={() => void search()}>
                  混合检索
                </Button>
              </div>

              {searchResult && (
                <div className="kb-search-result">
                  <div className="kb-search-head">
                    <span>命中 {searchResult.chunks.length} 个片段 · {searchResult.mode === 'hybrid' ? '混合检索' : '关键词降级'}</span>
                    <span>{searchResult.latencyMs}ms</span>
                  </div>
                  {searchResult.chunks.map((chunk, index) => (
                    <div className="kb-hit" key={chunk.id}>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <div>
                        <strong>{chunk.title}</strong>
                        <p>{chunk.content}</p>
                        <div className="kb-hit-scores">
                          <Badge tone="mint">{Math.round(chunk.score * 100)}%</Badge>
                          <small>V {Math.round(chunk.vectorScore * 100)} · K {Math.round(chunk.keywordScore * 100)}</small>
                        </div>
                      </div>
                    </div>
                  ))}
                  {searchResult.chunks.length === 0 && (
                    <div className="kb-no-hit">没有达到阈值的片段，尝试换一个问法。</div>
                  )}
                </div>
              )}

              <div className="document-list">
                {detail.documents.map((doc) => (
                  <div className="document-row" key={doc.id}>
                    <span className="document-icon"><FileText size={18} /></span>
                    <div className="document-copy">
                      <strong>{doc.title}</strong>
                      <p>{doc.content.slice(0, 140)}…</p>
                      <div>
                        <span>{formatCompact(doc.tokens)} tokens</span>
                        <span>{formatDateTime(doc.updatedAt)}</span>
                        {doc.status === 'processing' ? (
                          <Badge tone="amber"><Loader2 size={10} className="spin" /> 索引中</Badge>
                        ) : doc.status === 'error' ? (
                          <Badge tone="rose">索引失败</Badge>
                        ) : (
                          <Badge tone="mint" dot>已索引 · {doc.chunkCount} chunks</Badge>
                        )}
                      </div>
                      {doc.status === 'error' && <small className="doc-error">{doc.indexError}</small>}
                    </div>
                  </div>
                ))}
                {detail.documents.length === 0 && (
                  <EmptyState icon={<FileText size={24} />} title="还没有文档" description="添加产品手册、FAQ 或服务政策，AI 才能引用事实。" />
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <Modal
        open={docOpen}
        onClose={() => setDocOpen(false)}
        title="添加知识文档"
        description="保存后会自动切片并建立向量索引，通常几秒内完成。"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDocOpen(false)}>取消</Button>
            <Button variant="primary" loading={saving} onClick={() => void saveDoc()}>添加并索引</Button>
          </>
        }
      >
        <div className="form-stack">
          <Field label="文档标题" required>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：账户与登录" />
          </Field>
          <Field label="正文" required hint="支持 Markdown 标题，系统会按标题和段落切片。">
            <Textarea value={content} onChange={(event) => setContent(event.target.value)} rows={15} placeholder="粘贴文档内容…" />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
