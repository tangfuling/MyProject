import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import DataApi from '../api/DataApi';

export function useDataViewModel() {
  const [range, setRange] = useState('30d');
  const [page, setPage] = useState(1);
  const [showDetail, setShowDetail] = useState(false);
  const size = 20;

  const profileQuery = useQuery({
    queryKey: ['user-profile-brief'],
    queryFn: DataApi.profile,
  });

  const overviewQuery = useQuery({
    queryKey: ['overview', range],
    queryFn: () => DataApi.overview(range),
  });

  const articleQuery = useQuery({
    queryKey: ['articles', range, page, size],
    queryFn: () => DataApi.page(range, page, size),
  });

  const records = articleQuery.data?.records ?? [];

  const totalPages = useMemo(() => {
    const total = articleQuery.data?.total ?? 0;
    return Math.max(1, Math.ceil(total / size));
  }, [articleQuery.data?.total]);

  const trendReads = useMemo(
    () => records
      .slice()
      .sort((a, b) => new Date(a.publishTime).getTime() - new Date(b.publishTime).getTime())
      .map((item) => item.readCount ?? 0),
    [records]
  );

  const detailStats = useMemo(() => {
    const sum = records.reduce(
      (acc, item) => {
        acc.wow += item.wowCount ?? 0;
        acc.comment += item.commentCount ?? 0;
        acc.save += item.saveCount ?? 0;
        acc.share += item.shareCount ?? 0;
        acc.like += item.likeCount ?? 0;
        acc.read += item.readCount ?? 0;
        acc.send += item.sendCount ?? 0;
        acc.follow += item.newFollowers ?? 0;
        acc.completion += item.completionRate ?? 0;
        return acc;
      },
      { wow: 0, comment: 0, save: 0, share: 0, like: 0, read: 0, send: 0, follow: 0, completion: 0 }
    );
    const count = records.length || 1;
    return {
      totalWow: sum.wow,
      totalComment: sum.comment,
      totalSave: sum.save,
      totalShare: sum.share,
      totalLike: sum.like,
      totalRead: sum.read,
      totalSend: sum.send,
      totalFollow: sum.follow,
      avgCompletion: Number((sum.completion / count).toFixed(2)),
    };
  }, [records]);

  return {
    range,
    setRange,
    page,
    setPage,
    totalPages,
    showDetail,
    setShowDetail,
    trendReads,
    detailStats,
    profile: profileQuery.data,
    overview: overviewQuery.data,
    articlePage: articleQuery.data,
    loading: profileQuery.isPending || overviewQuery.isPending || articleQuery.isPending,
    error: profileQuery.error?.message ?? overviewQuery.error?.message ?? articleQuery.error?.message ?? null,
  };
}
