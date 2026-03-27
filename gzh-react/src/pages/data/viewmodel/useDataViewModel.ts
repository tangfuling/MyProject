import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import DataApi from '../api/DataApi';

export function useDataViewModel() {
  const [range, setRange] = useState('30d');
  const [page, setPage] = useState(1);
  const size = 20;

  const overviewQuery = useQuery({
    queryKey: ['overview', range],
    queryFn: () => DataApi.overview(range),
  });

  const articleQuery = useQuery({
    queryKey: ['articles', range, page, size],
    queryFn: () => DataApi.page(range, page, size),
  });

  const totalPages = useMemo(() => {
    const total = articleQuery.data?.total ?? 0;
    return Math.max(1, Math.ceil(total / size));
  }, [articleQuery.data?.total]);

  return {
    range,
    setRange,
    page,
    setPage,
    totalPages,
    overview: overviewQuery.data,
    articlePage: articleQuery.data,
    loading: overviewQuery.isPending || articleQuery.isPending,
    error: overviewQuery.error?.message ?? articleQuery.error?.message ?? null,
  };
}
