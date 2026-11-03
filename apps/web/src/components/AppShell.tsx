import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  BookOpenText,
  ChevronDown,
  CircleHelp,
  FlaskConical,
  Inbox,
  LogOut,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { cn, roleLabel } from '../lib/utils';
import { Avatar } from './Avatar';
import { Logo } from './Logo';

const NAV = [
  { path: '/inbox', label: '收件箱', icon: Inbox },
  { path: '/analytics', label: '数据分析', icon: BarChart3 },
  { path: '/evaluation', label: 'AI 评测', icon: FlaskConical },
  { path: '/knowledge', label: '知识库', icon: BookOpenText },
  { path: '/settings', label: '设置', icon: Settings },
];

const TITLES: Record<string, string> = {
  '/inbox': '收件箱',
  '/analytics': '数据分析',
  '/evaluation': 'AI 评测',
  '/knowledge': '知识库',
  '/settings': '设置',
};

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMobileOpen(false), [location.pathname]);
  const title = TITLES[location.pathname] ?? '收件箱';
  const isInbox = location.pathname === '/inbox';

  const nav = useMemo(() => NAV, []);

  return (
    <div className="app-shell">
      {mobileOpen && <button className="sidebar-scrim" onClick={() => setMobileOpen(false)} />}
      <aside className={cn('sidebar', mobileOpen && 'is-open')}>
        <div className="sidebar-top">
          <Logo dark />
          <button className="mobile-close" onClick={() => setMobileOpen(false)}><X size={18} /></button>
        </div>

        <div className="workspace-card">
          <span className="workspace-logo">N</span>
          <span>
            <strong>北岸云科技</strong>
            <small>Enterprise · 华东区</small>
          </span>
          <ChevronDown size={14} />
        </div>

        <div className="sidebar-label">工作台</div>
        <nav className="sidebar-nav">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) => cn('nav-item', isActive && 'is-active')}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-insight">
          <div className="insight-head">
            <span><Sparkles size={13} /> 今日 AI 表现</span>
            <span className="insight-live">LIVE</span>
          </div>
          <div className="insight-number">63.4%</div>
          <div className="insight-label">AI 辅助解决率</div>
          <div className="insight-bar"><span style={{ width: '63.4%' }} /></div>
          <div className="insight-foot">
            <span>128 次草稿</span>
            <span>+8.2%</span>
          </div>
        </div>

        <div className="sidebar-bottom">
          <button className="help-link"><CircleHelp size={16} /> 帮助与文档</button>
          <div className="sidebar-user">
            <button className="user-button" onClick={() => setMenuOpen((v) => !v)}>
              <Avatar name={user?.name ?? '用户'} color={user?.avatarColor} size={32} />
              <span>
                <strong>{user?.name}</strong>
                <small>{roleLabel(user?.role ?? 'AGENT')}</small>
              </span>
              <ChevronDown size={14} className={cn(menuOpen && 'is-open')} />
            </button>
            {menuOpen && (
              <div className="user-menu">
                <button onClick={() => navigate('/settings')}><Settings size={14} /> 设置</button>
                <button className="danger" onClick={() => { logout(); navigate('/login'); }}>
                  <LogOut size={14} /> 退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className="app-body">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu" onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
            <div className="breadcrumbs"><span>工作台</span><i>/</i><strong>{title}</strong></div>
          </div>
          <div className="topbar-right">
            <button className="topbar-search" onClick={() => navigate('/inbox')}>
              <Search size={15} /><span>搜索工单、客户或知识</span><kbd>⌘ K</kbd>
            </button>
            <span className="system-pill"><i /> 所有系统正常</span>
            <button className="icon-btn" title="安全中心"><ShieldCheck size={17} /></button>
            <Avatar name={user?.name ?? '用户'} color={user?.avatarColor} size={30} />
          </div>
        </header>
        <main className={cn('app-main', isInbox && 'app-main-inbox')}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
