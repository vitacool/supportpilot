import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  CheckCircle2,
  Database,
  Loader2,
  LockKeyhole,
  Save,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Timer,
  Users,
  Zap,
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { SettingsData } from '../types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { AccessDenied } from '../components/AccessDenied';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Select,
  Skeleton,
  Toggle,
} from '../components/ui';
import { cn, roleLabel } from '../lib/utils';

const priorityLabels: Record<string, string> = {
  urgent: '紧急',
  high: '高',
  normal: '普通',
  low: '低',
};

export function SettingsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canAdmin = user?.role === 'OWNER' || user?.role === 'ADMIN';
  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<SettingsData>('/api/settings'),
  });

  const [aiBackend, setAiBackend] = useState<'mock' | 'openai'>('mock');
  const [aiBaseUrl, setAiBaseUrl] = useState('');
  const [aiKey, setAiKey] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [autoSend, setAutoSend] = useState(false);
  const [threshold, setThreshold] = useState(0.78);
  const [savingAi, setSavingAi] = useState(false);
  const [testingAi, setTestingAi] = useState(false);

  const [embedBackend, setEmbedBackend] = useState<'local' | 'openai'>('local');
  const [embedBaseUrl, setEmbedBaseUrl] = useState('');
  const [embedKey, setEmbedKey] = useState('');
  const [embedModel, setEmbedModel] = useState('');
  const [dimensions, setDimensions] = useState(1536);
  const [topK, setTopK] = useState(5);
  const [minScore, setMinScore] = useState(0.1);
  const [savingEmbed, setSavingEmbed] = useState(false);
  const [testingEmbed, setTestingEmbed] = useState(false);

  const [slaValues, setSlaValues] = useState<Record<string, { first: string; resolution: string }>>({});
  const [savingSla, setSavingSla] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setAiBackend(data.ai.backend);
    setAiBaseUrl(data.ai.baseUrl);
    setAiModel(data.ai.model);
    setAutoSend(data.ai.autoSend);
    setThreshold(data.ai.confidenceThreshold);
    setEmbedBackend(data.embedding.backend);
    setEmbedBaseUrl(data.embedding.baseUrl);
    setEmbedModel(data.embedding.model);
    setDimensions(data.embedding.dimensions);
    setTopK(data.embedding.topK);
    setMinScore(data.embedding.minScore);
    setSlaValues(
      Object.fromEntries(
        data.slaPolicies.map((policy) => [
          policy.id,
          { first: String(policy.first_response_minutes), resolution: String(policy.resolution_minutes) },
        ]),
      ),
    );
  }, [data]);

  if (!canAdmin) return <AccessDenied />;
  if (isLoading || !data) return <div className="page"><Skeleton style={{ height: 500 }} /></div>;

  const testAi = async () => {
    setTestingAi(true);
    try {
      const result = await api<{ model: string; latencyMs: number; content: string }>('/api/settings/ai/test', { method: 'POST' });
      toast.success(`AI 连接成功 · ${result.model} · ${result.latencyMs}ms`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '连接失败');
    } finally {
      setTestingAi(false);
    }
  };

  const saveAi = async () => {
    setSavingAi(true);
    try {
      await api('/api/settings/ai', {
        method: 'PATCH',
        body: JSON.stringify({
          backend: aiBackend,
          baseUrl: aiBaseUrl,
          ...(aiKey ? { apiKey: aiKey } : {}),
          model: aiModel,
          autoSend,
          confidenceThreshold: threshold,
        }),
      });
      setAiKey('');
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('AI 引擎配置已保存');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '保存失败');
    } finally {
      setSavingAi(false);
    }
  };

  const testEmbed = async () => {
    setTestingEmbed(true);
    try {
      const result = await api<{ dimensions: number; latencyMs: number; model: string }>('/api/settings/embedding/test', {
        method: 'POST',
        body: JSON.stringify({
          backend: embedBackend,
          baseUrl: embedBaseUrl,
          ...(embedKey ? { apiKey: embedKey } : {}),
          model: embedModel,
          dimensions,
        }),
      });
      toast.success(`Embedding 连接成功 · ${result.dimensions} 维 · ${result.latencyMs}ms`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '连接失败');
    } finally {
      setTestingEmbed(false);
    }
  };

  const saveEmbed = async () => {
    setSavingEmbed(true);
    try {
      await api('/api/settings/embedding', {
        method: 'PATCH',
        body: JSON.stringify({
          backend: embedBackend,
          baseUrl: embedBaseUrl,
          ...(embedKey ? { apiKey: embedKey } : {}),
          model: embedModel,
          dimensions,
          topK,
          minScore,
        }),
      });
      setEmbedKey('');
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      void queryClient.invalidateQueries({ queryKey: ['knowledge'] });
      toast.success('Embedding 配置已保存，索引正在重建');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '保存失败');
    } finally {
      setSavingEmbed(false);
    }
  };

  const saveSla = async (id: string) => {
    const values = slaValues[id];
    if (!values) return;
    setSavingSla(id);
    try {
      await api(`/api/settings/sla/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          firstResponseMinutes: Number(values.first),
          resolutionMinutes: Number(values.resolution),
        }),
      });
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('SLA 策略已更新');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '保存失败');
    } finally {
      setSavingSla(null);
    }
  };

  return (
    <div className="page settings-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">WORKSPACE SETTINGS</span>
          <h1>设置</h1>
          <p>AI 引擎、向量检索与 SLA 策略。所有变更会写入审计日志。</p>
        </div>
        <Badge tone="mint"><ShieldCheck size={12} /> 企业版</Badge>
      </header>

      <div className="settings-summary">
        <div><Users size={16} /><span>工作区成员</span><strong>{data.counts.users}</strong></div>
        <div><Bot size={16} /><span>工单总数</span><strong>{data.counts.tickets}</strong></div>
        <div><Database size={16} /><span>向量切片</span><strong>{data.counts.chunks}</strong></div>
        <div><Sparkles size={16} /><span>AI 运行</span><strong>{data.counts.ai_runs}</strong></div>
      </div>

      <div className="settings-grid">
        <Card className="settings-card">
          <div className="settings-card-head">
            <div><span className="eyebrow">AI ENGINE</span><h2>对话与草稿模型</h2><p>用于生成客服回复草稿和结构化建议。</p></div>
            <Bot size={18} className="muted" />
          </div>
          <div className="form-stack">
            <Field label="运行模式">
              <div className="mode-switch">
                <button className={cn(aiBackend === 'mock' && 'is-active')} onClick={() => setAiBackend('mock')}>
                  <Zap size={16} /> 模拟引擎
                </button>
                <button className={cn(aiBackend === 'openai' && 'is-active')} onClick={() => {
                  setAiBackend('openai');
                  if (aiModel.includes('mock') || !aiModel) setAiModel('gpt-4o-mini');
                  if (!aiBaseUrl) setAiBaseUrl('https://api.openai.com/v1');
                }}>
                  <Sparkles size={16} /> OpenAI 兼容
                </button>
              </div>
            </Field>
            {aiBackend === 'openai' && (
              <>
                <Field label="Base URL"><Input value={aiBaseUrl} onChange={(e) => setAiBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" /></Field>
                <Field label="API Key" hint={data.ai.hasKey ? `已保存：${data.ai.maskedKey}。留空保持不变。` : '仅加密存储在服务端。'}>
                  <Input type="password" value={aiKey} onChange={(e) => setAiKey(e.target.value)} placeholder="sk-…" />
                </Field>
                <Field label="模型"><Input value={aiModel} onChange={(e) => setAiModel(e.target.value)} placeholder="gpt-4o-mini" /></Field>
              </>
            )}
            <div className="settings-row">
              <div><strong>允许 AI 自动发送</strong><span>仅高置信度、低风险工单自动回复；默认关闭。</span></div>
              <Toggle checked={autoSend} onChange={setAutoSend} />
            </div>
            <Field label={`自动发送置信度阈值 · ${Math.round(threshold * 100)}%`}>
              <input className="range" type="range" min={0.5} max={0.95} step={0.01} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
            </Field>
            <div className="settings-actions">
              <Button variant="secondary" icon={<Sparkles size={14} />} loading={testingAi} onClick={() => void testAi()}>测试连接</Button>
              <Button variant="primary" icon={<Save size={14} />} loading={savingAi} onClick={() => void saveAi()}>保存 AI 配置</Button>
            </div>
          </div>
        </Card>

        <Card className="settings-card">
          <div className="settings-card-head">
            <div><span className="eyebrow">EMBEDDING · RAG</span><h2>知识向量配置</h2><p>决定知识库检索质量。修改维度会重建全部向量。</p></div>
            <Database size={18} className="muted" />
          </div>
          <div className="form-stack">
            <Field label="运行模式">
              <div className="mode-switch">
                <button className={cn(embedBackend === 'local' && 'is-active')} onClick={() => setEmbedBackend('local')}>
                  <Zap size={16} /> 本地哈希
                </button>
                <button className={cn(embedBackend === 'openai' && 'is-active')} onClick={() => {
                  setEmbedBackend('openai');
                  if (embedModel.includes('hash') || !embedModel) setEmbedModel('text-embedding-3-small');
                  if (!embedBaseUrl) setEmbedBaseUrl('https://api.openai.com/v1');
                }}>
                  <Sparkles size={16} /> 语义 Embedding
                </button>
              </div>
            </Field>
            {embedBackend === 'openai' && (
              <>
                <Field label="Base URL"><Input value={embedBaseUrl} onChange={(e) => setEmbedBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" /></Field>
                <Field label="API Key" hint={data.embedding.hasKey ? `已保存：${data.embedding.maskedKey}。留空保持不变。` : '仅加密存储在服务端。'}>
                  <Input type="password" value={embedKey} onChange={(e) => setEmbedKey(e.target.value)} placeholder="sk-…" />
                </Field>
                <Field label="Embedding 模型"><Input value={embedModel} onChange={(e) => setEmbedModel(e.target.value)} placeholder="text-embedding-3-small" /></Field>
              </>
            )}
            <div className="settings-two-col">
              <Field label="向量维度"><Input type="number" value={dimensions} onChange={(e) => setDimensions(Number(e.target.value))} /></Field>
              <Field label="Top K">
                <Select value={topK} onChange={(e) => setTopK(Number(e.target.value))}>
                  {[3, 4, 5, 6, 8, 10].map((value) => <option key={value} value={value}>{value} 个片段</option>)}
                </Select>
              </Field>
            </div>
            <Field label={`最低相关度 · ${minScore.toFixed(2)}`}>
              <input className="range" type="range" min={0} max={0.6} step={0.01} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
            </Field>
            <div className="embed-status">
              <CheckCircle2 size={15} />
              <span><strong>{data.embedding.vectorStore}</strong> · {data.embedding.backend === 'local' ? '本地哈希向量' : data.embedding.model}</span>
              <Badge tone={data.embedding.backend === 'openai' ? 'mint' : 'amber'}>
                {data.embedding.backend === 'openai' ? '语义检索' : '演示模式'}
              </Badge>
            </div>
            <div className="settings-actions">
              <Button variant="secondary" icon={<Database size={14} />} loading={testingEmbed} onClick={() => void testEmbed()}>测试连接</Button>
              <Button variant="primary" icon={<Save size={14} />} loading={savingEmbed} onClick={() => void saveEmbed()}>保存并重建索引</Button>
            </div>
          </div>
        </Card>
      </div>

      <Card className="settings-card sla-card">
        <div className="settings-card-head">
          <div><span className="eyebrow">SERVICE LEVEL</span><h2>SLA 策略</h2><p>按优先级配置首次响应和解决时限，工单创建时自动套用。</p></div>
          <Timer size={18} className="muted" />
        </div>
        <div className="sla-table">
          <div className="sla-table-head"><span>优先级</span><span>首次响应（分钟）</span><span>解决时限（分钟）</span><span>状态</span><span /></div>
          {data.slaPolicies.map((policy) => (
            <div className="sla-table-row" key={policy.id}>
              <span className={cn('priority-pill', `priority-${policy.priority}`)}>{priorityLabels[policy.priority]}</span>
              <Input
                value={slaValues[policy.id]?.first ?? ''}
                onChange={(e) => setSlaValues((current) => ({ ...current, [policy.id]: { ...current[policy.id], first: e.target.value } }))}
              />
              <Input
                value={slaValues[policy.id]?.resolution ?? ''}
                onChange={(e) => setSlaValues((current) => ({ ...current, [policy.id]: { ...current[policy.id], resolution: e.target.value } }))}
              />
              <Badge tone="mint" dot>启用</Badge>
              <Button variant="secondary" size="sm" loading={savingSla === policy.id} onClick={() => void saveSla(policy.id)}>保存</Button>
            </div>
          ))}
        </div>
      </Card>

      <Card className="settings-card">
        <div className="settings-card-head">
          <div><span className="eyebrow">WORKSPACE</span><h2>工作区与安全</h2><p>当前账号和系统状态。</p></div>
          <LockKeyhole size={18} className="muted" />
        </div>
        <div className="workspace-detail">
          <div><span>工作区</span><strong>{data.workspace.name}</strong></div>
          <div><span>套餐</span><strong>{data.workspace.plan}</strong></div>
          <div><span>登录身份</span><strong>{user?.name} · {roleLabel(user?.role ?? '')}</strong></div>
          <div><span>数据隔离</span><strong>按工作区强制过滤</strong></div>
          <div><span>密钥存储</span><strong>AES-256-GCM</strong></div>
          <div><span>审计</span><strong>所有配置变更留痕</strong></div>
        </div>
      </Card>
    </div>
  );
}
