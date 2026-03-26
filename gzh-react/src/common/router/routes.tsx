import { useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { RoutePath } from './RoutePath';
import RouterManager from './RouterManager';
import HomePage from '../../pages/home/view/HomePage';
import AuthGuard from '../../features/auth/AuthGuard';

export default function AppRoutes() {
  const navigate = useNavigate();

  useEffect(() => {
    RouterManager.bind(navigate);
  }, [navigate]);

  return (
    <Routes>
      <Route
        path={RoutePath.HOME}
        element={
          <AuthGuard>
            <HomePage />
          </AuthGuard>
        }
      />
      <Route path="*" element={<Navigate to={RoutePath.HOME} replace />} />
    </Routes>
  );
}
