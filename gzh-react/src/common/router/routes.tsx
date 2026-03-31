import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { RoutePath } from './RoutePath';
import RouterManager from './RouterManager';
import Loading from '../ui/Loading';
import { useAuthStore } from '../state/authStore';

const LandingPage = lazy(() => import('../../pages/landing/view/LandingPage'));
const WorkspacePage = lazy(() => import('../../pages/workspace/view/WorkspacePage'));
const ProfilePage = lazy(() => import('../../pages/profile/view/ProfilePage'));

function RequireAuth({ element }: { element: JSX.Element }) {
  const token = useAuthStore((s) => s.token);
  const location = useLocation();
  if (token) {
    return element;
  }
  const redirect = `${location.pathname}${location.search}`;
  return <Navigate to={RoutePath.ROOT} replace state={{ loginRequired: true, redirect }} />;
}

export default function AppRoutes() {
  const navigate = useNavigate();

  useEffect(() => {
    RouterManager.bind(navigate);
  }, [navigate]);

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path={RoutePath.ROOT} element={<LandingPage />} />
        <Route path={RoutePath.WORKSPACE} element={<RequireAuth element={<WorkspacePage />} />} />
        <Route path={RoutePath.PROFILE} element={<RequireAuth element={<ProfilePage />} />} />
        <Route path="/data" element={<Navigate to={RoutePath.WORKSPACE} replace />} />
        <Route path="/analysis" element={<Navigate to={RoutePath.WORKSPACE} replace />} />
        <Route path="/chat" element={<Navigate to={RoutePath.WORKSPACE} replace />} />
        <Route path="/settings" element={<Navigate to={RoutePath.PROFILE} replace />} />
        <Route path="*" element={<Navigate to={RoutePath.ROOT} replace />} />
      </Routes>
    </Suspense>
  );
}
