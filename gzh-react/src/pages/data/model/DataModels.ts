import type { PageResult } from '../../../common/network/ApiResponse';

export type OverviewMetrics = {
  totalRead: number;
  avgRead: number;
  completionRate: number;
  totalShare: number;
  totalLike: number;
  newFollowers: number;
};

export type OverviewChanges = {
  totalRead: number;
  avgRead: number;
  completionRate: number;
  totalShare: number;
  totalLike: number;
  newFollowers: number;
};

export type Overview = {
  range: string;
  articleCount: number;
  metrics: OverviewMetrics;
  changes: OverviewChanges;
  trafficSummary: Record<string, number>;
};

export type Article = {
  id: number;
  wxArticleId: string;
  title: string;
  wordCount: number;
  publishTime: string;
  readCount: number;
  shareCount: number;
  likeCount: number;
  wowCount: number;
  commentCount: number;
  saveCount: number;
  newFollowers: number;
  completionRate: number;
  trafficSources: Record<string, number>;
};

export type ArticlePage = PageResult<Article>;
