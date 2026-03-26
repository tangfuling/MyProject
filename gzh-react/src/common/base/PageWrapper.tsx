import type { ReactNode } from 'react';
import Loading from '../ui/Loading';
import ErrorState from '../ui/ErrorState';

type Props = {
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
};

export default function PageWrapper({ loading, error, children }: Props) {
  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} />;
  return <>{children}</>;
}
