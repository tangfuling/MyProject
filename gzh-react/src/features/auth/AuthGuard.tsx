import type { PropsWithChildren } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { RoutePath } from '../../common/router/RoutePath';
import { isAuthed } from './permission';

export default function AuthGuard({ children }: PropsWithChildren) {
  const location = useLocation();
  if (!isAuthed()) {
    return <Navigate to={RoutePath.LOGIN} replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
