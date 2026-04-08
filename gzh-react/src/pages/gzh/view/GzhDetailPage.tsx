import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { RoutePath } from '../../../common/router/RoutePath';
import WorkspaceApi from '../../workspace/api/WorkspaceApi';
import type { WorkspaceArticleCard } from '../../workspace/model/WorkspaceModels';
import './GzhPages.css';

type RangeCode = '7d' | '30d' | '90d' | 'all';
type SortKey = 'publish' | 'read' | 'finish' | 'recommend' | 'share';
type ViewMode = 'all' | 'top5' | 'low3';

type TrendPoint = {
  label: string;
  value: number;
};

const PAGE_SIZE = 20;
const SOURCE_COLORS = ['#17B89A', '#5B8FD6', '#10b981', '#D5DEEB'];

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'publish', label: '发布时间' },
  { value: 'read', label: '阅读' },
  { value: 'finish', label: '完读' },
  { value: 'recommend', label: '推荐率' },
  { value: 'share', label: '分享' },
];

const VIEW_OPTIONS: Array<{ value: ViewMode; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'top5', label: '只看Top5' },
  { value: 'low3', label: '低表现3篇' },
];

function toPercentValue(v?: number | null) {
  const raw = v ?? 0;
  return Math.abs(raw) <= 1 ? raw * 100 : raw;
}

function fmtPercent(v?: number | null, d = 1) {
  return `${toPercentValue(v).toFixed(d)}%`;
}

function fmtDeltaPercent(v?: number | null, d = 0) {
  const value = toPercentValue(v);
  const arrow = value >= 0 ? '↑' : '↓';
  return `${arrow} ${Math.abs(value).toFixed(d)}%`;
}

function fmtNum(v?: number | null) {
  return (v ?? 0).toLocaleString('zh-CN');
}

function fmtNum1(v?: number | null) {
  const value = Number(v ?? 0);
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function fmtDateTime(v?: string | Date) {
  if (!v) return '--';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '--';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtDateShort(v?: string) {
  if (!v) return '--';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '--';
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDuration(sec?: number | null) {
  const s = Math.max(0, Math.floor(sec ?? 0));
  const m = Math.floor(s / 60);
  const remain = s % 60;
  return `${m}分${String(remain).padStart(2, '0')}秒`;
}

const SOURCE_FRIEND = '\u670b\u53cb\u5708';
const SOURCE_MESSAGE = '\u516c\u4f17\u53f7\u6d88\u606f';
const SOURCE_RECOMMEND = '\u63a8\u8350';
const SOURCE_HOME = '\u516c\u4f17\u53f7\u4e3b\u9875';
const SOURCE_CHAT = '\u804a\u5929\u4f1a\u8bdd';
const SOURCE_SEARCH = '\u641c\u4e00\u641c';
const SOURCE_OTHER = '\u5176\u5b83';

const SOURCE_ORDER = [
  SOURCE_FRIEND,
  SOURCE_MESSAGE,
  SOURCE_RECOMMEND,
  SOURCE_HOME,
  SOURCE_CHAT,
  SOURCE_SEARCH,
  SOURCE_OTHER,
] as const;

function normalizeSourceKey(key: string) {
  const raw = (key || '').trim();
  const lower = raw.toLowerCase();

  if (raw.includes('\u670b\u53cb') || lower.includes('friend') || lower.includes('feed')) return SOURCE_FRIEND;
  if (raw.includes('\u6d88\u606f') || (raw.includes('\u516c\u4f17\u53f7') && !raw.includes('\u4e3b\u9875')) || lower.includes('message') || lower.includes('subscription') || lower.includes('frommsg')) return SOURCE_MESSAGE;
  if (raw.includes('\u63a8\u8350') || lower.includes('recommend')) return SOURCE_RECOMMEND;
  if (raw.includes('\u4e3b\u9875') || lower.includes('home') || lower.includes('profile')) return SOURCE_HOME;
  if (raw.includes('\u804a\u5929') || raw.includes('\u4f1a\u8bdd') || raw.includes('\u8f6c\u53d1') || lower.includes('chat') || lower.includes('session')) return SOURCE_CHAT;
  if (raw.includes('\u641c') || lower.includes('search') || lower.includes('sogou')) return SOURCE_SEARCH;
  if (raw.includes('\u5176\u4ed6') || raw.includes('\u5176\u5b83') || lower.includes('other')) return SOURCE_OTHER;
  return SOURCE_OTHER;
}

function normalizeSourceMap(sources?: Record<string, number>) {
  const result: Record<string, number> = {
    [SOURCE_FRIEND]: 0,
    [SOURCE_MESSAGE]: 0,
    [SOURCE_RECOMMEND]: 0,
    [SOURCE_HOME]: 0,
    [SOURCE_CHAT]: 0,
    [SOURCE_SEARCH]: 0,
    [SOURCE_OTHER]: 0,
  };

  for (const [key, rawValue] of Object.entries(sources || {})) {
    const value = Number(rawValue) || 0;
    if (value <= 0) continue;
    const normalizedKey = normalizeSourceKey(key);
    result[normalizedKey] = (result[normalizedKey] || 0) + value;
  }

  return result;
}

function normalizeSourceRateValue(rawValue?: number | null) {
  const value = Number(rawValue || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value <= 1) return value * 100;
  if (value > 100 && value <= 10000) return value / 100;
  return Math.min(100, value);
}

function normalizeSourceRateMap(sources?: Record<string, number>) {
  const result: Record<string, number> = {
    [SOURCE_FRIEND]: 0,
    [SOURCE_MESSAGE]: 0,
    [SOURCE_RECOMMEND]: 0,
    [SOURCE_HOME]: 0,
    [SOURCE_CHAT]: 0,
    [SOURCE_SEARCH]: 0,
    [SOURCE_OTHER]: 0,
  };

  for (const [key, rawValue] of Object.entries(sources || {})) {
    const value = normalizeSourceRateValue(rawValue);
    if (value <= 0) continue;
    const normalizedKey = normalizeSourceKey(key);
    result[normalizedKey] = (result[normalizedKey] || 0) + value;
  }

  return result;
}

function sumPositiveValues(map?: Record<string, number>) {
  if (!map) return 0;
  return Object.values(map).reduce((sum, raw) => {
    const value = Number(raw) || 0;
    return value > 0 ? sum + value : sum;
  }, 0);
}

function buildSourceRateMapForDisplay(
  rates?: Record<string, number>,
  sourceCounts?: Record<string, number>
) {
  const normalizedRates = normalizeSourceRateMap(rates);
  if (sumPositiveValues(normalizedRates) > 0) {
    return normalizedRates;
  }
  const normalizedCounts = normalizeSourceMap(sourceCounts);
  const total = sumPositiveValues(normalizedCounts);
  if (total <= 0) {
    return normalizedRates;
  }
  const fallback: Record<string, number> = {
    [SOURCE_FRIEND]: 0,
    [SOURCE_MESSAGE]: 0,
    [SOURCE_RECOMMEND]: 0,
    [SOURCE_HOME]: 0,
    [SOURCE_CHAT]: 0,
    [SOURCE_SEARCH]: 0,
    [SOURCE_OTHER]: 0,
  };
  SOURCE_ORDER.forEach((label) => {
    const value = normalizedCounts[label] || 0;
    if (value <= 0) return;
    fallback[label] = (value * 100) / total;
  });
  return fallback;
}

function recommendCount(sources: Record<string, number>) {
  const normalized = normalizeSourceMap(sources);
  return normalized[SOURCE_RECOMMEND] || 0;
}

function recommendRateByArticle(article: WorkspaceArticleCard) {
  const rateMap = buildSourceRateMapForDisplay(article.trafficSourceRates, article.trafficSources);
  return rateMap[SOURCE_RECOMMEND] || 0;
}

function sortValue(article: WorkspaceArticleCard, key: SortKey) {
  if (key === 'publish') {
    return article.publishTime ? new Date(article.publishTime).getTime() : 0;
  }
  if (key === 'read') return article.readCount || 0;
  if (key === 'finish') return toPercentValue(article.completionRate);
  if (key === 'share') return article.shareCount || 0;
  return recommendRateByArticle(article);
}

function buildSourceSegments(
  sources?: Record<string, number>,
  limit: number = SOURCE_ORDER.length,
  percentBaseTotal?: number
) {
  const normalized = normalizeSourceMap(sources);
  const ordered = SOURCE_ORDER.map((label) => ({
    key: label,
    label,
    value: normalized[label] || 0,
  }));

  const sourceTotal = ordered.reduce((sum, item) => sum + item.value, 0);
  const baseTotal = Number(percentBaseTotal || 0) > 0
    ? Math.max(Number(percentBaseTotal || 0), sourceTotal)
    : sourceTotal;

  if (limit >= SOURCE_ORDER.length) {
    return ordered.map((item, index) => ({
      ...item,
      percent: baseTotal <= 0 ? 0 : (item.value * 100) / baseTotal,
      color: SOURCE_COLORS[index % SOURCE_COLORS.length],
    }));
  }

  const sorted = [...ordered].filter((item) => item.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length === 0) {
    return ordered.slice(0, limit).map((item, index) => ({
      ...item,
      percent: 0,
      color: SOURCE_COLORS[index % SOURCE_COLORS.length],
    }));
  }

  const top = sorted.slice(0, limit).map((item, index) => ({
    ...item,
    color: SOURCE_COLORS[index % SOURCE_COLORS.length],
  }));

  const restValue = sorted.slice(limit).reduce((sum, item) => sum + item.value, 0);
  if (restValue > 0) {
    top.push({
      key: SOURCE_OTHER,
      label: SOURCE_OTHER,
      value: restValue,
      color: SOURCE_COLORS[top.length % SOURCE_COLORS.length],
    });
  }

  const compactTotal = top.reduce((sum, item) => sum + item.value, 0);
  return top.map((item) => ({
    ...item,
    percent: compactTotal <= 0 ? 0 : (item.value * 100) / compactTotal,
  }));
}

function buildSourceSegmentsFromRates(
  rates?: Record<string, number>,
  sourceCounts?: Record<string, number>
) {
  const normalized = buildSourceRateMapForDisplay(rates, sourceCounts);
  return SOURCE_ORDER.map((label, index) => ({
    key: label,
    label,
    value: normalized[label] || 0,
    percent: normalized[label] || 0,
    color: SOURCE_COLORS[index % SOURCE_COLORS.length],
  }));
}

function recommendRateFromSummary(summary: Record<string, number>) {
  const normalized = normalizeSourceMap(summary);
  const total = Object.values(normalized).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return 0;
  return ((normalized[SOURCE_RECOMMEND] || 0) * 100) / total;
}

function pctRate(numerator: number, denominator: number) {
  if (!Number.isFinite(denominator) || denominator <= 0) return 0;
  if (!Number.isFinite(numerator) || numerator <= 0) return 0;
  return (numerator * 100) / denominator;
}

function createEmptySourceSummary() {
  return {
    [SOURCE_FRIEND]: 0,
    [SOURCE_MESSAGE]: 0,
    [SOURCE_RECOMMEND]: 0,
    [SOURCE_HOME]: 0,
    [SOURCE_CHAT]: 0,
    [SOURCE_SEARCH]: 0,
    [SOURCE_OTHER]: 0,
  } as Record<string, number>;
}

function createEmptySourceRateSummary() {
  return {
    [SOURCE_FRIEND]: 0,
    [SOURCE_MESSAGE]: 0,
    [SOURCE_RECOMMEND]: 0,
    [SOURCE_HOME]: 0,
    [SOURCE_CHAT]: 0,
    [SOURCE_SEARCH]: 0,
    [SOURCE_OTHER]: 0,
  } as Record<string, number>;
}

type PanelMetrics = {
  readValue: number;
  avgReadValue: number;
  completionRate: number;
  shareValue: number;
  likeValue: number;
  wowValue: number;
  commentValue: number;
  newFollowersValue: number;
  avgReadTimeSec: number;
  followRate: number;
  shareRate: number;
  likeRate: number;
  wowRate: number;
  commentRate: number;
  recommendRate: number;
  trafficSummary: Record<string, number>;
  trafficRateSummary: Record<string, number>;
};

function isAnomalousPanelMetrics(metrics: PanelMetrics | null | undefined) {
  if (!metrics) return true;
  const coreValues = [
    metrics.readValue,
    metrics.avgReadValue,
    metrics.completionRate,
    metrics.shareValue,
    metrics.likeValue,
    metrics.wowValue,
    metrics.commentValue,
    metrics.newFollowersValue,
    metrics.avgReadTimeSec,
    metrics.followRate,
    metrics.shareRate,
    metrics.likeRate,
    metrics.wowRate,
    metrics.commentRate,
    metrics.recommendRate,
  ];
  return coreValues.every((value) => !Number.isFinite(value) || Number(value) <= 0);
}

function buildArticlePanelMetrics(article: WorkspaceArticleCard): PanelMetrics {
  const readValue = Number(article.readCount || 0);
  const shareValue = Number(article.shareCount || 0);
  const likeValue = Number(article.likeCount || 0);
  const wowValue = Number(article.wowCount || 0);
  const commentValue = Number(article.commentCount || 0);
  const newFollowersValue = Number(article.newFollowers || 0);
  const avgReadTimeSec = Number(article.avgReadTimeSec || 0);
  const completionRate = toPercentValue(article.completionRate ?? 0);
  const trafficSummary = normalizeSourceMap(article.trafficSources);
  const trafficRateSummary = buildSourceRateMapForDisplay(article.trafficSourceRates, article.trafficSources);
  const recommendRate = Number(trafficRateSummary[SOURCE_RECOMMEND] || 0);
  return {
    readValue,
    avgReadValue: readValue,
    completionRate,
    shareValue,
    likeValue,
    wowValue,
    commentValue,
    newFollowersValue,
    avgReadTimeSec,
    followRate: pctRate(newFollowersValue, readValue),
    shareRate: pctRate(shareValue, readValue),
    likeRate: pctRate(likeValue, readValue),
    wowRate: pctRate(wowValue, readValue),
    commentRate: pctRate(commentValue, readValue),
    recommendRate,
    trafficSummary,
    trafficRateSummary,
  };
}

function buildBatchAverageMetrics(articles: WorkspaceArticleCard[]): PanelMetrics {
  if (articles.length <= 0) {
    return {
      readValue: 0,
      avgReadValue: 0,
      completionRate: 0,
      shareValue: 0,
      likeValue: 0,
      wowValue: 0,
      commentValue: 0,
      newFollowersValue: 0,
      avgReadTimeSec: 0,
      followRate: 0,
      shareRate: 0,
      likeRate: 0,
      wowRate: 0,
      commentRate: 0,
      recommendRate: 0,
      trafficSummary: createEmptySourceSummary(),
      trafficRateSummary: createEmptySourceRateSummary(),
    };
  }

  const count = articles.length;
  let sumRead = 0;
  let sumShare = 0;
  let sumLike = 0;
  let sumWow = 0;
  let sumComment = 0;
  let sumNewFollowers = 0;
  let sumAvgReadTimeSec = 0;
  let sumCompletionRate = 0;
  let sumRecommendRate = 0;
  const trafficSummary = createEmptySourceSummary();
  const trafficRateSummary = createEmptySourceRateSummary();

  articles.forEach((article) => {
    const readValue = Number(article.readCount || 0);
    const shareValue = Number(article.shareCount || 0);
    const likeValue = Number(article.likeCount || 0);
    const wowValue = Number(article.wowCount || 0);
    const commentValue = Number(article.commentCount || 0);
    const newFollowersValue = Number(article.newFollowers || 0);
    const avgReadTimeSec = Number(article.avgReadTimeSec || 0);
    const completionRate = toPercentValue(article.completionRate ?? 0);
    const oneTrafficRateSummary = buildSourceRateMapForDisplay(article.trafficSourceRates, article.trafficSources);
    const recommendRate = Number(oneTrafficRateSummary[SOURCE_RECOMMEND] || 0);

    sumRead += readValue;
    sumShare += shareValue;
    sumLike += likeValue;
    sumWow += wowValue;
    sumComment += commentValue;
    sumNewFollowers += newFollowersValue;
    sumAvgReadTimeSec += avgReadTimeSec;
    sumCompletionRate += completionRate;
    sumRecommendRate += recommendRate;

    const oneSummary = normalizeSourceMap(article.trafficSources);
    Object.keys(trafficSummary).forEach((key) => {
      trafficSummary[key] = Number(trafficSummary[key] || 0) + Number(oneSummary[key] || 0);
    });
    Object.keys(trafficRateSummary).forEach((key) => {
      trafficRateSummary[key] = Number(trafficRateSummary[key] || 0) + Number(oneTrafficRateSummary[key] || 0);
    });
  });

  Object.keys(trafficRateSummary).forEach((key) => {
    trafficRateSummary[key] = Number(trafficRateSummary[key] || 0) / count;
  });

  return {
    readValue: sumRead / count,
    avgReadValue: sumRead / count,
    completionRate: sumCompletionRate / count,
    shareValue: sumShare / count,
    likeValue: sumLike / count,
    wowValue: sumWow / count,
    commentValue: sumComment / count,
    newFollowersValue: sumNewFollowers / count,
    avgReadTimeSec: sumAvgReadTimeSec / count,
    followRate: pctRate(sumNewFollowers, sumRead),
    shareRate: pctRate(sumShare, sumRead),
    likeRate: pctRate(sumLike, sumRead),
    wowRate: pctRate(sumWow, sumRead),
    commentRate: pctRate(sumComment, sumRead),
    recommendRate: sumRecommendRate / count,
    trafficSummary,
    trafficRateSummary,
  };
}

function sampleTrendPoints(list: TrendPoint[], count = 6) {
  if (list.length === 0) {
    return [
      { label: '02-24', value: 45 },
      { label: '03-01', value: 60 },
      { label: '03-08', value: 72 },
      { label: '03-14', value: 88 },
      { label: '03-20', value: 102 },
      { label: '03-24', value: 118 },
    ];
  }
  if (list.length <= count) {
    return list;
  }
  const step = (list.length - 1) / (count - 1);
  const sampled: TrendPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    sampled.push(list[Math.round(i * step)]);
  }
  return sampled;
}

function buildTrendChart(points: TrendPoint[]) {
  const sampled = sampleTrendPoints(points, 6);
  const values = sampled.map((item) => item.value || 0);
  const maxValue = Math.max(10, ...values);
  const minValue = 0;

  const xStart = 40;
  const xEnd = 560;
  const yTop = 20;
  const yBottom = 125;
  const xSpan = xEnd - xStart;
  const ySpan = yBottom - yTop;

  const currentPoints = sampled.map((item, index) => {
    const x = xStart + (xSpan * index) / Math.max(1, sampled.length - 1);
    const y = yBottom - ((item.value - minValue) / Math.max(1, maxValue - minValue)) * ySpan;
    return { x, y, label: item.label, value: item.value };
  });

  const prevPoints = currentPoints.map((item) => ({
    ...item,
    y: Math.min(yBottom, item.y + 15),
  }));

  const currentPolyline = currentPoints.map((item) => `${item.x},${item.y}`).join(' ');
  const prevPolyline = prevPoints.map((item) => `${item.x},${item.y}`).join(' ');

  const areaPath = `M${currentPoints[0]?.x ?? xStart},${currentPoints[0]?.y ?? yBottom} ${currentPoints
    .slice(1)
    .map((p) => `L${p.x},${p.y}`)
    .join(' ')} L${xEnd},${yBottom} L${xStart},${yBottom} Z`;

  const ticks = [
    Math.round(maxValue),
    Math.round(maxValue * 0.75),
    Math.round(maxValue * 0.5),
    Math.round(maxValue * 0.25),
  ];

  return {
    currentPoints,
    currentPolyline,
    prevPolyline,
    areaPath,
    ticks,
    yTop,
    yBottom,
    xStart,
    xEnd,
  };
}

export default function GzhDetailPage() {
  const navigate = useNavigate();
  const [range] = useState<RangeCode>('30d');
  const [sortKey, setSortKey] = useState<SortKey>('publish');
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [selectedArticleId, setSelectedArticleId] = useState<number | null>(null);

  useEffect(() => {
    document.title = '\u516c\u4f17\u53f7\u8fd0\u8425\u52a9\u624b \u00b7 \u6570\u636e\u8be6\u60c5';
  }, []);

  const overviewQuery = useQuery({
    queryKey: ['workspace-overview', range],
    queryFn: () => WorkspaceApi.overview(range),
  });

  const articlesQuery = useInfiniteQuery({
    queryKey: ['workspace-articles', range],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => WorkspaceApi.articles(range, Number(pageParam), PAGE_SIZE),
    getNextPageParam: (last, allPages) => {
      const loaded = allPages.reduce((sum, page) => sum + page.records.length, 0);
      return loaded >= last.total ? undefined : last.page + 1;
    },
  });

  const overview = overviewQuery.data;
  const pages = articlesQuery.data?.pages ?? [];
  const allArticles = useMemo(() => pages.flatMap((p) => p.records), [pages]);
  const totalArticles = (pages.length > 0 ? pages[pages.length - 1].total : undefined) ?? allArticles.length;

  const sortedArticles = useMemo(() => {
    const list = [...allArticles];
    list.sort((a, b) => sortValue(b, sortKey) - sortValue(a, sortKey));
    return list;
  }, [allArticles, sortKey]);

  const shownArticles = useMemo(() => {
    if (viewMode === 'top5') return sortedArticles.slice(0, 5);
    if (viewMode === 'low3') return sortedArticles.slice(Math.max(0, sortedArticles.length - 3)).reverse();
    return sortedArticles;
  }, [sortedArticles, viewMode]);

  const selectedArticle = useMemo(
    () => shownArticles.find((item) => item.id === selectedArticleId) || null,
    [shownArticles, selectedArticleId]
  );

  const publishRange = useMemo(() => {
    const times = allArticles
      .map((item) => (item.publishTime ? new Date(item.publishTime).getTime() : NaN))
      .filter((item) => Number.isFinite(item));
    if (times.length === 0) {
      return '-- ~ --';
    }
    const min = new Date(Math.min(...times));
    const max = new Date(Math.max(...times));
    return `${String(min.getMonth() + 1).padStart(2, '0')}-${String(min.getDate()).padStart(2, '0')} ~ ${String(max.getMonth() + 1).padStart(2, '0')}-${String(max.getDate()).padStart(2, '0')}`;
  }, [allArticles]);

  const metrics = overview?.dataPanel.metrics;
  const fallbackPanelMetrics = useMemo<PanelMetrics>(() => {
    const trafficSummary = normalizeSourceMap(overview?.dataPanel.trafficSummary);
    const trafficRateSummary = buildSourceRateMapForDisplay(undefined, trafficSummary);
    return {
      readValue: Number(metrics?.totalRead || 0),
      avgReadValue: Number(metrics?.avgRead || 0),
      completionRate: Number(metrics?.completionRate || 0),
      shareValue: Number(metrics?.totalShare || 0),
      likeValue: Number(metrics?.totalLike || 0),
      wowValue: Number(metrics?.totalWow || 0),
      commentValue: Number(metrics?.totalComment || 0),
      newFollowersValue: Number(metrics?.newFollowers || 0),
      avgReadTimeSec: Number(metrics?.avgReadTimeSec || 0),
      followRate: Number(metrics?.followRate || 0),
      shareRate: Number(metrics?.shareRate || 0),
      likeRate: Number(metrics?.likeRate || 0),
      wowRate: Number(metrics?.wowRate || 0),
      commentRate: Number(metrics?.commentRate || 0),
      recommendRate: Number(trafficRateSummary[SOURCE_RECOMMEND] || 0),
      trafficSummary,
      trafficRateSummary,
    };
  }, [
    metrics?.totalRead,
    metrics?.avgRead,
    metrics?.completionRate,
    metrics?.totalShare,
    metrics?.totalLike,
    metrics?.totalWow,
    metrics?.totalComment,
    metrics?.newFollowers,
    metrics?.avgReadTimeSec,
    metrics?.followRate,
    metrics?.shareRate,
    metrics?.likeRate,
    metrics?.wowRate,
    metrics?.commentRate,
    overview?.dataPanel.trafficSummary,
  ]);

  const panelMode: 'article' | 'batch' = selectedArticle ? 'article' : 'batch';
  const panelMetrics = useMemo<PanelMetrics>(() => {
    if (selectedArticle) {
      return buildArticlePanelMetrics(selectedArticle);
    }
    if (shownArticles.length > 0) {
      return buildBatchAverageMetrics(shownArticles);
    }
    return fallbackPanelMetrics;
  }, [selectedArticle, shownArticles, fallbackPanelMetrics]);

  const trafficSegments = useMemo(
    () => buildSourceSegmentsFromRates(panelMetrics.trafficRateSummary),
    [panelMetrics]
  );
  const panelMetricsAnomalous = useMemo(
    () => isAnomalousPanelMetrics(panelMetrics),
    [panelMetrics]
  );
  const panelNumDisplay = (value?: number | null) => (panelMetricsAnomalous ? '-' : fmtNum1(value));
  const panelPercentDisplay = (value?: number | null, digits = 1) => (panelMetricsAnomalous ? '-' : fmtPercent(value, digits));
  const panelDurationDisplay = (value?: number | null) => (panelMetricsAnomalous ? '-' : fmtDuration(value));

  const trendPoints = useMemo(() => {
    return (overview?.dataPanel.trend ?? []).map((item) => ({
      label: item.label,
      value: item.readCount || 0,
    }));
  }, [overview?.dataPanel.trend]);

  const trendChart = useMemo(() => buildTrendChart(trendPoints), [trendPoints]);
  const accountName = overview?.header.accountName || '\u516c\u4f17\u53f7\u8d26\u53f7';
  const selectedArticleName = selectedArticle?.title || '';
  const panelTitle = panelMode === 'article' ? '文章详情 · 单篇' : '数据汇总 · 当前筛选均值';
  const panelHint = panelMode === 'article'
    ? `已选文章：${selectedArticleName}`
    : `当前筛选样本：${shownArticles.length} 篇`;

  const balanceText = `\u00A5${(((overview?.header.balanceCent ?? 0) + (overview?.header.freeQuotaCent ?? 0)) / 100).toFixed(2)}`;

  return (
    <div className="gzh-v2-root gzh-v2-detail">
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-nav">
            <button className="topbar-nav-item" type="button" onClick={() => navigate(RoutePath.GZH_HOME)}>{'\u9996\u9875'}</button>
            <button className="topbar-nav-item" type="button" onClick={() => navigate(RoutePath.GZH_WORKSPACE)}>{'\u5de5\u4f5c\u53f0'}</button>
            <button className="topbar-nav-item active" type="button" onClick={() => navigate(RoutePath.GZH_DETAIL)}>{'\u6587\u7ae0\u8be6\u60c5'}</button>
            <button className="topbar-nav-item" type="button" onClick={() => navigate(RoutePath.GZH_PROFILE)}>{'\u4e2a\u4eba\u4e2d\u5fc3'}</button>
          </div>
          <div className="topbar-account">{accountName}</div>
        </div>
        <div className="topbar-right">
          <span className="sync-meta">统计近30天 · 同步 {fmtDateShort(overview?.header.lastSyncAt)}</span>
          <button
            className="btn btn-outline"
            type="button"
            style={{ height: '30px', fontSize: '11px', padding: '0 12px' }}
            onClick={() => {
              void overviewQuery.refetch();
              void articlesQuery.refetch();
            }}
            disabled={overviewQuery.isFetching || articlesQuery.isFetching}
          >
            {(overviewQuery.isFetching || articlesQuery.isFetching) ? '同步中...' : '一键同步'}
          </button>
          <span className="chip chip-balance">{balanceText}</span>
          <button className="avatar-btn" type="button" onClick={() => navigate(RoutePath.GZH_PROFILE)}>
            T
          </button>
        </div>
      </div>

      <div className="detail-body">
        <aside className="art-list-panel">
          <div className="art-filter-bar">
            <div className="art-filter-title">文章数据 · 近30天</div>
            <div className="art-filter-sub">
              共 {totalArticles} 篇 · 发布 {publishRange} · 同步时间 {fmtDateTime(overview?.header.lastSyncAt)}
            </div>
            <div className="filter-row">
              {SORT_OPTIONS.map((item) => (
                <button
                  key={item.value}
                  className={`filter-chip${sortKey === item.value ? ' active' : ''}`}
                  type="button"
                  onClick={() => {
                    setSelectedArticleId(null);
                    setSortKey(item.value);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="view-chips">
              {VIEW_OPTIONS.map((item) => (
                <button
                  key={item.value}
                  className={`view-chip${viewMode === item.value ? ' active' : ''}`}
                  type="button"
                  onClick={() => {
                    setSelectedArticleId(null);
                    setViewMode(item.value);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="art-list-inner">
            {shownArticles.map((article, index) => {
              const oneArticleMetrics = buildArticlePanelMetrics(article);
              const articleAnomalous = isAnomalousPanelMetrics(oneArticleMetrics);
              const recommendPercent = oneArticleMetrics.recommendRate;
              const sources = buildSourceSegmentsFromRates(article.trafficSourceRates, article.trafficSources);
              const selected = selectedArticle?.id === article.id;
              return (
                <article
                  key={article.id}
                  className={`art-card${selected ? ' active' : ''}`}
                  onClick={() => setSelectedArticleId(article.id)}
                >
                  <div className="art-card-top">
                    <div className={`rank-circle${index < 3 ? ' top' : ''}`}>{index + 1}</div>
                    <div className="art-title">{article.title}</div>
                    <div className="art-date">{fmtDateShort(article.publishTime)}</div>
                  </div>

                  <div className="art-stats">
                    <div className="stat-badge">阅读 {articleAnomalous ? '-' : fmtNum(article.readCount)}</div>
                    <div className="stat-badge">完读 {articleAnomalous ? '-' : fmtPercent(article.completionRate, 0)}</div>
                    <div className="stat-badge primary">推荐率 {articleAnomalous ? '-' : fmtPercent(recommendPercent, 0)}</div>
                    <div className="stat-badge">分享 {articleAnomalous ? '-' : fmtNum(article.shareCount)}</div>
                  </div>

                  <>
                    <div className="src-bar">
                      {sources.map((source, sourceIndex) => (
                        <div
                          key={`${article.id}-seg-${sourceIndex}`}
                          className="src-bar-seg"
                          style={{ width: `${source.percent}%`, background: source.color }}
                        />
                      ))}
                    </div>

                    <div className="src-labels">
                      {sources.map((source, sourceIndex) => (
                        <div key={`${article.id}-label-${sourceIndex}`} className="src-label">
                          <span className="src-dot" style={{ background: source.color }} />
                          {source.label} {articleAnomalous ? '-' : `${source.percent.toFixed(1)}%`}
                        </div>
                      ))}
                    </div>
                  </>
                </article>
              );
            })}

            {shownArticles.length === 0 ? <div className="empty-tip">暂无文章数据</div> : null}

            {articlesQuery.hasNextPage ? (
              <button
                className="btn btn-outline load-more-btn"
                type="button"
                onClick={() => void articlesQuery.fetchNextPage()}
                disabled={articlesQuery.isFetchingNextPage}
              >
                {articlesQuery.isFetchingNextPage ? '加载中...' : '加载更多'}
              </button>
            ) : null}
          </div>
        </aside>

        <section className="detail-right">
          <div className="period-card">
            <div className="period-head">
              <div className="period-title">{panelTitle}</div>
              <button className="btn btn-ghost" type="button" style={{ height: '30px', fontSize: '11px', padding: '0 12px' }}>
                导出数据
              </button>
            </div>
            <div className="metric-sub" style={{ marginTop: '-6px', marginBottom: '10px' }}>{panelHint}</div>
            <div className="kpi-3grid">
              <div className="kpi-3item key">
                <div className="kpi-3label" style={{ color: '#139D84' }}>推荐率（主决策指标）</div>
                <div className="kpi-3value" style={{ color: '#139D84' }}>{panelPercentDisplay(panelMetrics.recommendRate, 1)}</div>
                <div className="kpi-3sub">当前口径</div>
              </div>
              <div className="kpi-3item">
                <div className="kpi-3label">完读率（内容质量）</div>
                <div className="kpi-3value">{panelPercentDisplay(panelMetrics.completionRate, 1)}</div>
                <div className="kpi-3sub">当前口径</div>
              </div>
              <div className="kpi-3item">
                <div className="kpi-3label">关注率（增长观察）</div>
                <div className="kpi-3value">{panelPercentDisplay(panelMetrics.followRate, 1)}</div>
                <div className="kpi-3sub">当前口径</div>
              </div>
            </div>
          </div>

          <div className="period-card" style={{ paddingBottom: '14px' }}>
            <div className="metrics-group-title">阅读与质量</div>
            <div className="metrics-grid">
              <div className="metric-item">
                <div className="metric-label">{panelMode === 'article' ? '阅读人数' : '平均阅读'}</div>
                <div className="metric-value">{panelNumDisplay(panelMetrics.readValue)}</div>
                <div className="metric-sub">当前口径</div>
              </div>
              <div className="metric-item">
                <div className="metric-label">篇均阅读</div>
                <div className="metric-value">{panelNumDisplay(panelMetrics.avgReadValue)}</div>
                <div className="metric-sub">当前口径</div>
              </div>
              <div className="metric-item">
                <div className="metric-label">完读率</div>
                <div className="metric-value">{panelPercentDisplay(panelMetrics.completionRate, 1)}</div>
                <div className="metric-sub">当前口径</div>
              </div>
              <div className="metric-item">
                <div className="metric-label">篇均时长</div>
                <div className="metric-value" style={{ fontSize: '14px' }}>{panelDurationDisplay(panelMetrics.avgReadTimeSec)}</div>
                <div className="metric-sub">持续观察</div>
              </div>
            </div>

            <div className="metrics-group-title">互动</div>
            <div className="metrics-grid">
              <div className="metric-item">
                <div className="metric-label">{panelMode === 'article' ? '点赞' : '平均点赞'}</div>
                <div className="metric-value">{panelNumDisplay(panelMetrics.likeValue)}</div>
                <div className="metric-sub">点赞率 {panelPercentDisplay(panelMetrics.likeRate, 1)}</div>
              </div>
              <div className="metric-item">
                <div className="metric-label">{panelMode === 'article' ? '分享' : '平均分享'}</div>
                <div className="metric-value">{panelNumDisplay(panelMetrics.shareValue)}</div>
                <div className="metric-sub">分享率 {panelPercentDisplay(panelMetrics.shareRate, 1)}</div>
              </div>
              <div className="metric-item">
                <div className="metric-label">{panelMode === 'article' ? '在看' : '平均在看'}</div>
                <div className="metric-value">{panelNumDisplay(panelMetrics.wowValue)}</div>
                <div className="metric-sub">在看率 {panelPercentDisplay(panelMetrics.wowRate, 1)}</div>
              </div>
              <div className="metric-item">
                <div className="metric-label">{panelMode === 'article' ? '留言' : '平均留言'}</div>
                <div className="metric-value">{panelNumDisplay(panelMetrics.commentValue)}</div>
                <div className="metric-sub">留言率 {panelPercentDisplay(panelMetrics.commentRate, 1)}</div>
              </div>
            </div>

            <div className="metrics-group-title">增长</div>
            <div className="metrics-grid two-col">
              <div className="metric-item">
                <div className="metric-label">{panelMode === 'article' ? '新增关注' : '平均新增关注'}</div>
                <div className="metric-value">{panelNumDisplay(panelMetrics.newFollowersValue)}</div>
                <div className="metric-sub">关注率 {panelPercentDisplay(panelMetrics.followRate, 1)}</div>
              </div>
              <div className="metric-item">
                <div className="metric-label">推荐率</div>
                <div className="metric-value">{panelPercentDisplay(panelMetrics.recommendRate, 1)}</div>
                <div className="metric-sub">平台推荐占比</div>
              </div>
            </div>
          </div>

          {panelMode === 'batch' ? (
            <div className="trend-card">
              <div className="trend-head">
                <div className="trend-title">阅读趋势</div>
                <div className="trend-legend">
                  <div className="legend-item">
                    <div className="legend-line" style={{ background: '#17B89A' }} />本周期
                  </div>
                  <div className="legend-item">
                    <div style={{ width: '18px', borderTop: '2px dashed #D5DEEB' }} />上周期
                  </div>
                  <div className="legend-item">
                    <div style={{ width: '18px', borderTop: '2px dashed #f59e0b' }} />参考线
                  </div>
                </div>
              </div>
              <svg width="100%" height="160" viewBox="0 0 580 160" preserveAspectRatio="xMidYMid meet">
                <defs>
                  <linearGradient id="chartGradDetail" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#17B89A" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="#17B89A" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <line x1={trendChart.xStart} y1={trendChart.yTop} x2={trendChart.xEnd} y2={trendChart.yTop} stroke="#e9f0f9" strokeWidth="1" />
                <line x1={trendChart.xStart} y1={55} x2={trendChart.xEnd} y2={55} stroke="#e9f0f9" strokeWidth="1" />
                <line x1={trendChart.xStart} y1={90} x2={trendChart.xEnd} y2={90} stroke="#e9f0f9" strokeWidth="1" />
                <line x1={trendChart.xStart} y1={trendChart.yBottom} x2={trendChart.xEnd} y2={trendChart.yBottom} stroke="#e9f0f9" strokeWidth="1" />
                <line x1={trendChart.xStart} y1={75} x2={trendChart.xEnd} y2={75} stroke="#f59e0b" strokeWidth="1" strokeDasharray="4,3" />
                <polyline points={trendChart.prevPolyline} fill="none" stroke="#D5DEEB" strokeWidth="1.5" strokeDasharray="5,3" />
                <path d={trendChart.areaPath} fill="url(#chartGradDetail)" />
                <polyline points={trendChart.currentPolyline} fill="none" stroke="#17B89A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                {trendChart.currentPoints.map((point, index) => (
                  <circle key={`p-${index}`} cx={point.x} cy={point.y} r="3.5" fill="#17B89A" />
                ))}
                <text x="32" y="24" fontSize="9" fill="#94afc8" textAnchor="end">{trendChart.ticks[0]}</text>
                <text x="32" y="59" fontSize="9" fill="#94afc8" textAnchor="end">{trendChart.ticks[1]}</text>
                <text x="32" y="94" fontSize="9" fill="#94afc8" textAnchor="end">{trendChart.ticks[2]}</text>
                <text x="32" y="129" fontSize="9" fill="#94afc8" textAnchor="end">{trendChart.ticks[3]}</text>
                {trendChart.currentPoints.map((point, index) => (
                  <text key={`l-${index}`} x={point.x} y="148" fontSize="9" fill="#94afc8" textAnchor="middle">
                    {point.label || '--'}
                  </text>
                ))}
              </svg>
            </div>
          ) : null}

          <div className="traffic-card">
            <div className="traffic-title">流量来源</div>
            <>
              <div className="stacked-bar">
                {trafficSegments.map((item, index) => (
                  <div
                    key={`${item.key}-${index}`}
                    className="stacked-seg"
                    style={{
                      width: `${item.percent}%`,
                      background: item.color,
                      color: item.color === '#D5DEEB' ? '#64748b' : '#fff',
                    }}
                  >
                    {item.percent.toFixed(1)}%
                  </div>
                ))}
              </div>
              <div className="traffic-labels">
                {trafficSegments.map((item, index) => (
                  <div key={`${item.label}-${index}`} className="traffic-label-item">
                    <span className="traffic-dot" style={{ background: item.color }} />
                    {item.label} {panelMetricsAnomalous ? '-' : `${item.percent.toFixed(1)}%`}
                  </div>
                ))}
              </div>
            </>
          </div>
        </section>
      </div>
    </div>
  );
}
