import { useMemo } from 'react';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';

export function useViewModel<TData>(
  options: UseQueryOptions<TData, Error, TData, readonly unknown[]>
) {
  const query = useQuery(options);

  return useMemo(
    () => ({
      data: query.data,
      loading: query.isPending,
      error: query.error?.message ?? null,
      refresh: query.refetch,
    }),
    [query.data, query.isPending, query.error, query.refetch]
  );
}
