import type { PropsWithChildren } from 'react';
import { canVisitHome } from './permission';

export default function AuthGuard({ children }: PropsWithChildren) {
  if (!canVisitHome()) {
    return <div className="error-state">Unauthorized</div>;
  }
  return <>{children}</>;
}
