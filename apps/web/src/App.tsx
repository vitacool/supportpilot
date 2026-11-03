import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { LogoMark } from './components/Logo';
import { useAuth } from './context/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { InboxPage } from './pages/InboxPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { EvaluationPage } from './pages/EvaluationPage';
import { KnowledgePage } from './pages/KnowledgePage';
import { SettingsPage } from './pages/SettingsPage';
import { PortalPage } from './pages/PortalPage';

function Splash() {
  return (
    <div className="splash">
      <LogoMark size={48} />
      <div className="splash-word">SupportPilot</div>
      <span />
    </div>
  );
}

function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

function AgentRoute() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'CUSTOMER') return <Navigate to="/portal" replace />;
  return <Outlet />;
}

function CustomerRoute() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'CUSTOMER') return <Navigate to="/inbox" replace />;
  return <Outlet />;
}

function LoginRoute() {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  if (user) return <Navigate to={user.role === 'CUSTOMER' ? '/portal' : '/inbox'} replace />;
  return <LoginPage />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<Navigate to="/inbox" replace />} />
        <Route element={<AgentRoute />}>
          <Route element={<AppShell />}>
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/evaluation" element={<EvaluationPage />} />
            <Route path="/knowledge" element={<KnowledgePage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route element={<CustomerRoute />}>
          <Route path="/portal" element={<PortalPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
