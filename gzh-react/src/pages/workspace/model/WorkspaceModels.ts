import type { PageResult } from '../../../common/network/ApiResponse';

export type WorkspaceOverview = {
  range: string;
  header: WorkspaceHeader;
  dataPanel: WorkspaceDataPanel;
  analysisPanel: WorkspaceAnalysisPanel;
  articles: WorkspaceArticleCard[];
  quickQuestions: string[];
};

export type WorkspaceHeader = {
  accountName: string;
  phoneMasked: string;
  aiModel: string;
  balanceCent: number;
  freeQuotaCent: number;
  articleCount: number;
  lastSyncAt?: string;
};

export type WorkspaceDataPanel = {
  metrics: {
    totalRead: number;
    avgRead: number;
    completionRate: number;
    totalShare: number;
    totalLike: number;
    totalWow: number;
    totalComment: number;
    newFollowers: number;
    avgReadTimeSec: number;
    followRate: number;
    shareRate: number;
    likeRate: number;
    wowRate: number;
    commentRate: number;
  };
  changes: {
    totalRead: number;
    avgRead: number;
    completionRate: number;
    totalShare: number;
    totalLike: number;
    newFollowers: number;
  };
  trafficSummary: Record<string, number>;
  trend: Array<{
    label: string;
    readCount: number;
  }>;
};

export type WorkspaceAnalysisPanel = {
  reportId?: number;
  rangeCode?: string;
  articleCount?: number;
  createdAt?: string;
  aiModel?: string;
  inputTokens?: number;
  outputTokens?: number;
  costCent?: number;
  summary: string;
  signalOverview?: string;
  stage?: string;
  findings?: string[];
  rhythm?: string;
  riskHint?: string;
  actionSuggestions: string[];
  suggestedQuestions: string[];
  content: string;
};

export type WorkspaceArticleCard = {
  id: number;
  wxArticleId: string;
  title: string;
  content?: string;
  wordCount?: number;
  publishTime?: string;
  readCount: number;
  sendCount: number;
  shareCount: number;
  likeCount: number;
  wowCount: number;
  commentCount: number;
  saveCount: number;
  avgReadTimeSec?: number;
  newFollowers: number;
  completionRate?: number;
  trafficSources: Record<string, number>;
  trafficSourceRates?: Record<string, number>;
};

export type WorkspaceArticlePage = PageResult<WorkspaceArticleCard>;
