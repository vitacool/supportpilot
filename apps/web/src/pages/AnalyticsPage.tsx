import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
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
  Bot,
  CheckCircle2,
  Clock3,
  Gauge,
  Headphones,
  ShieldAlert,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import { api } from '../lib/api';
import type { AnalyticsData } from '../types';
import {
  categoryLabel,
  cn,
  formatDateTime,
  formatMinutes,
  formatNumber,
  priorityLabel,
} from '../lib/utils';
import { Avatar } from '../components/Avatar';
import { Badge, Card, Segmented, Skeleton } from '../components/ui';

const CATEGORY_COLORS = ['#6D8BFF', '#22C55E', '#F59E0B', '#8B5CF6', '#EC4899', '#94A3B8'];

function Kpi({
  label,
  value,
  sub,
  icon,
  tone = 'blue',
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  tone?: string;
}) {
  return (
    <Card className={cn('kpi-card', `kpi-${tone}`)}>
      <div className="kpi-top">
        <span className="kpi-icon">{icon}</span>
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <small>{sub}</small>
    </Card>
  );
}

export function AnalyticsPage() {
  const [days, setDays] = useState<14 | 30>(14);
  const { data, isLoading } = useQuery({
    queryKey: ['analytics', days],
    queryFn: () => api<AnalyticsData>(`/api/analytics?days=${days}`),
  });

  if (isLoading || !data) {
    return (
      <div className="page">
        <Skeleton style={{ width: 260, height: 36 }} />
        <div className="kpi-grid" style={{ marginTop: 20 }}>
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} style={{ height: 120 }} />)}
        </div>
        <Skeleton style={{ height: 320, marginTop: 16 }} />
      </div>
    );
  }

  const { summary } = data;
  const chartData = data.series.map((item) => ({
    ...item,
    label: new Date(item.date).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
  }));
  const maxCategory = Math.max(...data.categories.map((item) => item.value), 1);

  return (
    <div className="page analytics-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">SUPPORT OPERATIONS</span>
          <h1>数据分析</h1>
          <p>从工单量、SLA、AI 采纳到客户满意度，掌握客服团队的真实运行状态。</p>
        </div>
        <Segmented
          value={days}
          onChange={setDays}
          options={[
            { label: '近 14 天', value: 14 },
            { label: '近 30 天', value: 30 },
          ]}
        />
      </header>

      <div className="kpi-grid">
        <Kpi label="待处理工单" value={formatNumber(summary.open)} sub={`共 ${summary.total} 张工单`} icon={<Headphones size={17} />} tone="blue" />
        <Kpi label="SLA 达成率" value={`${summary.firstResponseCompliance}%`} sub={`${summary.breached} 张当前超时`} icon={<ShieldAlert size={17} />} tone={summary.firstResponseCompliance > 90 ? 'green' : 'amber'} />
        <Kpi label="平均首次响应" value={formatMinutes(summary.avgFirstResponse)} sub={`解决平均 ${formatMinutes(summary.avgResolution)}`} icon={<Clock3 size={17} />} tone="violet" />
        <Kpi label="AI 辅助解决率" value={`${summary.aiAdoption}%`} sub={`${summary.autoResolved}% 全自动解决`} icon={<Sparkles size={17} />} tone="green" />
      </div>

      <div className="analytics-grid main">
        <Card className="chart-card">
          <div className="card-head">
            <div>
              <span className="eyebrow">VOLUME</span>
              <h2>工单流量与解决趋势</h2>
            </div>
            <div className="chart-legend">
              <span><i className="dot-blue" /> 新建</span>
              <span><i className="dot-green" /> 已解决</span>
            </div>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 12, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="createdFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6D8BFF" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#6D8BFF" stopOpacity={0.01} />
                  </linearGradient>
                  <linearGradient id="resolvedFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22C55E" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#22C55E" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#EEF1F6" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: '#8A94A6', fontSize: 11 }} axisLine={false} tickLine={false} dy={8} />
                <YAxis tick={{ fill: '#8A94A6', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 10, border: '1px solid #E8EBF1', fontSize: 12 }}
                  labelStyle={{ color: '#667085' }}
                />
                <Area type="monotone" dataKey="created" name="新建" stroke="#6D8BFF" strokeWidth={2} fill="url(#createdFill)" isAnimationActive={false} />
                <Area type="monotone" dataKey="resolved" name="已解决" stroke="#22C55E" strokeWidth={2} fill="url(#resolvedFill)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="analytics-side">
          <div className="card-head">
            <div><span className="eyebrow">SLA BY PRIORITY</span><h2>优先级与超时</h2></div>
          </div>
          <div className="priority-sla-list">
            {data.priorities.map((item) => (
              <div key={item.priority} className="priority-sla">
                <div className="priority-sla-head">
                  <span className={cn('priority-dot', `priority-${item.priority}`)} />
                  <strong>{priorityLabel(item.priority)}</strong>
                  <span>{item.total} 张</span>
                </div>
                <div className="priority-sla-bar">
                  <span style={{ width: `${item.total ? Math.min(100, (item.breached / item.total) * 100 + 4) : 0}%` }} />
                </div>
                <div className="priority-sla-foot">
                  <span>{item.breached} 超时</span>
                  <span>{item.atRisk} 即将超时</span>
                </div>
              </div>
            ))}
          </div>
          <div className="analytics-divider" />
          <div className="mini-csat">
            <div className="mini-csat-head"><Star size={15} /> 客户满意度</div>
            <strong>{summary.csat || '—'}<span>/ 5.0</span></strong>
            <div className="star-row">{Array.from({ length: 5 }).map((_, i) => <Star key={i} size={13} fill={i < Math.round(summary.csat) ? '#F59E0B' : 'none'} />)}</div>
            <small>基于已完成工单的 CSAT 评价</small>
          </div>
        </Card>
      </div>

      <div className="analytics-grid lower">
        <Card className="chart-card">
          <div className="card-head">
            <div><span className="eyebrow">CATEGORY MIX</span><h2>问题类型分布</h2></div>
            <Badge tone="neutral">{data.categories.length} 类</Badge>
          </div>
          <div className="category-chart">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.categories} layout="vertical" margin={{ left: 10, right: 20, top: 10, bottom: 0 }}>
                <CartesianGrid stroke="#EEF1F6" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#8A94A6', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis dataKey="key" type="category" tickFormatter={categoryLabel} tick={{ fill: '#667085', fontSize: 11 }} axisLine={false} tickLine={false} width={54} />
                <Tooltip formatter={(value: number) => [value, '工单']} contentStyle={{ borderRadius: 10, border: '1px solid #E8EBF1', fontSize: 12 }} />
                <Bar dataKey="value" radius={[0, 5, 5, 0]} barSize={16} isAnimationActive={false}>
                  {data.categories.map((item, index) => <Cell key={item.key} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="agent-card">
          <div className="card-head">
            <div><span className="eyebrow">TEAM LOAD</span><h2>客服负载</h2></div>
            <Users size={17} className="muted" />
          </div>
          <div className="agent-list">
            {data.agents.map((agent) => (
              <div key={agent.id} className="agent-row">
                <Avatar name={agent.name} color={agent.color} size={32} />
                <div>
                  <strong>{agent.name}</strong>
                  <span>{agent.resolvedTickets} 已解决 · 首响 {formatMinutes(agent.avgFirstResponse)}</span>
                </div>
                <Badge tone={agent.openTickets > 8 ? 'amber' : 'neutral'}>{agent.openTickets} 待处理</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="analytics-grid lower">
        <Card className="run-card">
          <div className="card-head">
            <div><span className="eyebrow">AI ACTIVITY</span><h2>最近 AI 运行</h2></div>
            <Badge tone="mint">{summary.aiRuns} 次</Badge>
          </div>
          <div className="run-list">
            {data.recentRuns.map((run) => (
              <div key={run.id} className="run-row">
                <span className="run-icon"><Bot size={14} /></span>
                <div>
                  <strong>{run.number} · {run.subject}</strong>
                  <span>{formatDateTime(run.createdAt)} · {run.action === 'auto_send' ? '自动发送' : run.action === 'escalate' ? '升级人工' : '人工审核'}</span>
                </div>
                <span className="run-confidence">{Math.round(run.confidence * 100)}%</span>
                <Badge tone={run.status === 'accepted' ? 'mint' : run.status === 'rejected' ? 'rose' : 'amber'}>
                  {run.status === 'accepted' ? '已采纳' : run.status === 'rejected' ? '已拒绝' : '待审核'}
                </Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card className="ai-impact-card">
          <div className="card-head">
            <div><span className="eyebrow">AI IMPACT</span><h2>AI 运行指标</h2></div>
            <Gauge size={17} className="muted" />
          </div>
          <div className="impact-grid">
            <div><span>运行次数</span><strong>{summary.aiRuns}</strong><small>全部 AI Copilot 调用</small></div>
            <div><span>采纳数</span><strong>{summary.aiAccepted}</strong><small>人工采纳或自动发送</small></div>
            <div><span>拒绝数</span><strong>{summary.aiRejected}</strong><small>人工判断不适用</small></div>
            <div><span>自动解决</span><strong>{summary.autoResolved}%</strong><small>无需人工介入</small></div>
          </div>
          <div className="impact-note">
            <Sparkles size={14} />
            <span>AI 建议始终由置信度阈值和风险规则控制，低置信度会自动转人工。</span>
          </div>
        </Card>
      </div>
    </div>
  );
}
