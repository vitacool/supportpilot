import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock3,
  Headphones,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../lib/api';
import { Logo } from '../components/Logo';
import { Button, Field, Input } from '../components/ui';

const demos = [
  {
    role: '负责人',
    name: '林知夏',
    email: 'admin@supportpilot.local',
    color: '#6D8BFF',
  },
  {
    role: '客服',
    name: '陈默',
    email: 'agent@supportpilot.local',
    color: '#22C55E',
  },
  {
    role: '客户',
    name: '周宁',
    email: 'customer@supportpilot.local',
    color: '#8B5CF6',
  },
];

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@supportpilot.local');
  const [password, setPassword] = useState('Support@2026');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const doLogin = async (nextEmail: string, nextPassword: string) => {
    setError('');
    setLoading(true);
    try {
      const user = await login(nextEmail, nextPassword);
      navigate(user.role === 'CUSTOMER' ? '/portal' : '/inbox', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请稍后再试');
    } finally {
      setLoading(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void doLogin(email.trim(), password);
  };

  return (
    <div className="login-page">
      <section className="login-visual">
        <div className="login-grid" />
        <div className="login-visual-inner">
          <Logo dark />
          <div className="login-hero">
            <div className="login-kicker">
              <span className="pulse-dot" />
              HUMAN-IN-THE-LOOP SUPPORT
            </div>
            <h1>
              让 AI 处理重复问题，
              <br />
              让客服专注
              <span>复杂关系</span>。
            </h1>
            <p>
              工单分诊、知识检索、回复草稿、SLA 监控与人工审核，
              在一个工作台里完成。每一次自动回复都可追溯、可评测。
            </p>
          </div>

          <div className="login-ticket-demo">
            <div className="ticket-demo-head">
              <span className="demo-dot" />
              <span>SP-1042 · 企业版退款申请</span>
              <span className="demo-badge">AI 草稿待审</span>
            </div>
            <div className="ticket-demo-message">
              <span>客户</span>
              <p>购买后还没有开始使用，可以按 7 天无理由退款吗？</p>
            </div>
            <div className="ticket-demo-ai">
              <span className="ai-mini">
                <Sparkles size={12} /> AI Copilot
              </span>
              <p>
                根据退款政策，首次购买 7 天内可申请全额退款。已为你生成回复，
                引用「退款政策」资料。
              </p>
              <div className="demo-confidence">
                <span>置信度 86%</span>
                <div><i style={{ width: '86%' }} /></div>
                <span>人工审核</span>
              </div>
            </div>
          </div>

          <div className="login-proof">
            <div><strong>63%</strong><span>AI 辅助解决率</span></div>
            <div><strong>96.8%</strong><span>SLA 达成率</span></div>
            <div><strong>1.2h</strong><span>平均首响</span></div>
          </div>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-form-wrap">
          <div className="login-mobile-brand"><Logo /></div>
          <div className="login-heading">
            <div className="login-badge"><ShieldCheck size={14} /> 企业级安全登录</div>
            <h2>欢迎回来</h2>
            <p>登录 SupportPilot，开始今天的人机协同。</p>
          </div>

          <form className="login-form" onSubmit={submit}>
            <Field label="工作邮箱">
              <div className="input-with-icon">
                <Mail size={16} />
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
            </Field>
            <Field label="密码">
              <div className="input-with-icon">
                <LockKeyhole size={16} />
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>
            </Field>
            {error && <div className="form-error">{error}</div>}
            <Button type="submit" variant="primary" size="lg" loading={loading} className="login-submit">
              进入工作台 <ArrowRight size={17} />
            </Button>
          </form>

          <div className="demo-accounts">
            <div className="demo-accounts-head">
              <span>快速体验不同角色</span>
              <small>密码统一为 Support@2026</small>
            </div>
            {demos.map((demo) => (
              <button
                key={demo.email}
                className="demo-account"
                onClick={() => void doLogin(demo.email, 'Support@2026')}
              >
                <span className="demo-avatar" style={{ background: demo.color }}>
                  {demo.name.slice(0, 1)}
                </span>
                <span>
                  <strong>{demo.name}</strong>
                  <small>{demo.role} · {demo.email}</small>
                </span>
                <ArrowRight size={14} />
              </button>
            ))}
          </div>

          <div className="login-features">
            <span><Bot size={14} /> RAG 引用</span>
            <span><Clock3 size={14} /> SLA 监控</span>
            <span><Users size={14} /> 人机协同</span>
            <span><CheckCircle2 size={14} /> 评测闭环</span>
          </div>
          <div className="login-foot">© 2026 SupportPilot · Northstar Cloud</div>
        </div>
      </section>
    </div>
  );
}
