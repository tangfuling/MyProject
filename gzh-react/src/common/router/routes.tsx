import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { RoutePath } from './RoutePath';
import RouterManager from './RouterManager';
import Loading from '../ui/Loading';
import { useAuthStore } from '../state/authStore';

const PortalPage = lazy(() => import('../../pages/portal/view/PortalPage'));
const XqLandingPage = lazy(() => import('../../pages/xq/view/XqLandingPage'));
const GzhHomePage = lazy(() => import('../../pages/gzh/view/GzhHomePage'));
const GzhWorkspacePage = lazy(() => import('../../pages/gzh/view/GzhWorkspacePage'));
const GzhDetailPage = lazy(() => import('../../pages/gzh/view/GzhDetailPage'));
const GzhProfilePage = lazy(() => import('../../pages/gzh/view/GzhProfilePage'));

function RequireAuth({ element }: { element: JSX.Element }) {
  const token = useAuthStore((s) => s.token);
  const location = useLocation();
  if (token) {
    return element;
  }
  const redirect = `${location.pathname}${location.search}`;
  return <Navigate to={RoutePath.GZH_HOME} replace state={{ loginRequired: true, redirect }} />;
}

export default function AppRoutes() {
  const navigate = useNavigate();

  useEffect(() => {
    RouterManager.bind(navigate);
  }, [navigate]);

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path={RoutePath.ROOT} element={<PortalPage />} />
        <Route path={RoutePath.XQ} element={<XqLandingPage />} />
        <Route path={RoutePath.GZH_HOME} element={<GzhHomePage />} />
        <Route path={RoutePath.GZH_WORKSPACE} element={<RequireAuth element={<GzhWorkspacePage />} />} />
        <Route path={RoutePath.GZH_DETAIL} element={<RequireAuth element={<GzhDetailPage />} />} />
        <Route path={RoutePath.GZH_PROFILE} element={<RequireAuth element={<GzhProfilePage />} />} />
        <Route path="*" element={<Navigate to={RoutePath.ROOT} replace />} />
      </Routes>
    </Suspense>
  );
}
