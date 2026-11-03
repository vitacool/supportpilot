import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  Loader2,
  Play,
  RefreshCw,
  Target,
  Timer,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { EvalResult, EvaluationData } from '../types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, EmptyState, Skeleton } from '../components/ui';
import { cn, formatDateTime } from '../lib/utils';

function Metric({
  label,
  value,
  sub,
  tone,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  tone: string;
  icon: React.ReactNode;
}) {
  return (
    <Card className={cn('eval-metric', `metric-${tone}`)}>
      <span className="eval-metric-icon">{icon}</span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{sub}</small>
      </div>
    </Card>
  );
}

export function EvaluationPage() {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['evaluation'],
    queryFn: () => api<EvaluationData>('/api/evaluation'),
  });
  const canRun = user?.role === 'OWNER' || user?.role === 'ADMIN';
  const latestRun = data?.runs[0];
  const results = data?.latestResults ?? [];

  const run = async () => {
    setRunning(true);
    try {
      await api('/api/evaluation/run', { method: 'POST' });
      await queryClient.invalidateQueries({ queryKey: ['evaluation'] });
      toast.success('评测完成，指标已更新');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '评测运行失败');
    } finally {
      setRunning(false);
    }
  };

  const chartData = latestRun
    ? [
        { name: '意图准确率', value: Math.round(latestRun.intentAccuracy * 100), color: '#6D8BFF' },
        { name: '检索召回率', value: Math.round(latestRun.retrievalRecall * 100), color: '#22C55E' },
        { name: '引用覆盖率', value: Math.round(latestRun.citationCoverage * 100), color: '#8B5CF6' },
      ]
    : [];

  if (isLoading || !data) {
    return (
      <div className="page">
        <Skeleton style={{ width: 280, height: 36 }} />
        <div className="eval-metric-grid" style={{ marginTop: 20 }}>
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} style={{ height: 110 }} />)}
        </div>
        <Skeleton style={{ height: 340, marginTop: 16 }} />
      </div>
    );
  }

  return (
    <div className="page evaluation-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">RAG EVALUATION</span>
          <h1>AI 评测</h1>
          <p>用固定的黄金问题集验证意图分类、知识召回和引用覆盖，避免“感觉效果不错”。</p>
        </div>
        <div className="page-actions">
          {latestRun && (
            <span className="last-run">最近运行 · {formatDateTime(latestRun.createdAt)}</span>
          )}
          <Button
            variant="primary"
            icon={running ? <Loader2 size={15} className="spin" /> : <Play size={15} />}
            loading={running}
            disabled={!canRun}
            onClick={() => void run()}
            title={!canRun ? '仅负责人和管理员可以运行评测' : undefined}
          >
            {running ? '评测运行中…' : '运行评测'}
          </Button>
        </div>
      </header>

      {!latestRun ? (
        <EmptyState
          icon={<FlaskConical size={30} />}
          title="还没有评测记录"
          description={`当前有 ${data.cases.length} 条黄金用例。运行一次评测，建立可回归的 RAG 质量基线。`}
          action={
            <Button variant="primary" loading={running} onClick={() => void run()}>
              运行第一次评测
            </Button>
          }
        />
      ) : (
        <>
          <div className="eval-metric-grid">
            <Metric label="意图准确率" value={`${Math.round(latestRun.intentAccuracy * 100)}%`} sub="分类是否符合预期" tone="blue" icon={<Target size={18} />} />
            <Metric label="检索召回率" value={`${Math.round(latestRun.retrievalRecall * 100)}%`} sub="Top 5 是否命中关键词" tone="green" icon={<TrendingUp size={18} />} />
            <Metric label="引用覆盖率" value={`${Math.round(latestRun.citationCoverage * 100)}%`} sub="回答是否带知识引用" tone="violet" icon={<FlaskConical size={18} />} />
            <Metric label="平均延迟" value={`${latestRun.avgLatency}ms`} sub={`${latestRun.total} 条用例`} tone="amber" icon={<Timer size={18} />} />
          </div>

          <div className="evaluation-grid">
            <Card className="eval-chart-card">
              <div className="card-head">
                <div><span className="eyebrow">QUALITY SCORECARD</span><h2>质量指标</h2></div>
                <Badge tone={latestRun.retrievalRecall >= 0.8 ? 'mint' : 'amber'}>
                  {latestRun.retrievalRecall >= 0.8 ? '达标' : '需优化'}
                </Badge>
              </div>
              <div className="eval-chart">
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid stroke="#EEF1F6" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: '#667085', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fill: '#98A2B3', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(value: number) => [`${value}%`, '得分']} contentStyle={{ borderRadius: 10, border: '1px solid #E8EBF1', fontSize: 12 }} />
                    <Bar dataKey="value" radius={[8, 8, 0, 0]} barSize={54} isAnimationActive={false}>
                      {chartData.map((item) => <Cell key={item.name} fill={item.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="eval-insight">
                <AlertTriangle size={14} />
                <span>
                  检索召回率决定 RAG 上限。若低于 80%，优先优化切片、Embedding 模型和混合检索权重，而不是改 Prompt。
                </span>
              </div>
            </Card>

            <Card className="eval-history-card">
              <div className="card-head">
                <div><span className="eyebrow">RUN HISTORY</span><h2>最近运行</h2></div>
                <RefreshCw size={15} className="muted" />
              </div>
              <div className="eval-history">
                {data.runs.map((item) => (
                  <div key={item.id} className="eval-history-row">
                    <span className={cn('history-dot', item.status === 'completed' ? 'is-ok' : 'is-fail')} />
                    <div>
                      <strong>{formatDateTime(item.createdAt)}</strong>
                      <span>{item.total} 条用例 · {item.createdBy}</span>
                    </div>
                    <span className="history-score">{Math.round(item.retrievalRecall * 100)}%</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Card className="results-card">
            <div className="card-head">
              <div><span className="eyebrow">PER CASE</span><h2>用例结果</h2></div>
              <span className="table-count">{results.length} 条</span>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>问题</th>
                    <th>期望分类</th>
                    <th>预测分类</th>
                    <th>检索命中</th>
                    <th>引用</th>
                    <th>置信度</th>
                    <th>结果</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((result, index) => (
                    <tr key={`${result.question}-${index}`}>
                      <td className="question-cell">{result.question}</td>
                      <td><span className="tag">{result.expectedCategory}</span></td>
                      <td><span className={cn('tag', result.intentOk ? 'is-ok' : 'is-bad')}>{result.predictedCategory}</span></td>
                      <td>
                        {result.retrievalOk ? (
                          <span className="pass"><CheckCircle2 size={13} /> {result.hitTitles[0] ?? '命中'}</span>
                        ) : (
                          <span className="fail"><XCircle size={13} /> 未命中「{result.expectedKeyword}」</span>
                        )}
                      </td>
                      <td>{result.citationOk ? <Badge tone="mint">有</Badge> : <Badge tone="rose">无</Badge>}</td>
                      <td>{Math.round(result.confidence * 100)}%</td>
                      <td>
                        <Badge tone={result.intentOk && result.retrievalOk ? 'mint' : 'amber'}>
                          {result.intentOk && result.retrievalOk ? '通过' : '需复查'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
