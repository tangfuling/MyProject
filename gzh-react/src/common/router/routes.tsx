import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { RoutePath } from './RoutePath';
import RouterManager from './RouterManager';
import AuthGuard from '../../features/auth/AuthGuard';
import Loading from '../ui/Loading';

const LoginPage = lazy(() => import('../../pages/login/view/LoginPage'));
const DataPage = lazy(() => import('../../pages/data/view/DataPage'));
const AnalysisPage = lazy(() => import('../../pages/analysis/view/AnalysisPage'));
const ChatPage = lazy(() => import('../../pages/chat/view/ChatPage'));
const SettingsPage = lazy(() => import('../../pages/settings/view/SettingsPage'));

function Guarded(element: JSX.Element) {
  return <AuthGuard>{element}</AuthGuard>;
}

export default function AppRoutes() {
  const navigate = useNavigate();

  useEffect(() => {
    RouterManager.bind(navigate);
  }, [navigate]);

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path={RoutePath.LOGIN} element={<LoginPage />} />
        <Route path={RoutePath.DATA} element={Guarded(<DataPage />)} />
        <Route path={RoutePath.ANALYSIS} element={Guarded(<AnalysisPage />)} />
        <Route path={RoutePath.CHAT} element={Guarded(<ChatPage />)} />
        <Route path={RoutePath.SETTINGS} element={Guarded(<SettingsPage />)} />
        <Route path={RoutePath.ROOT} element={<Navigate to={RoutePath.DATA} replace />} />
        <Route path="*" element={<Navigate to={RoutePath.DATA} replace />} />
      </Routes>
    </Suspense>
  );
}
