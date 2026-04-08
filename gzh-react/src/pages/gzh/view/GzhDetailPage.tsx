import { useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
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

function recommendCount(sources: Record<string, number>) {
  const normalized = normalizeSourceMap(sources);
  return normalized[SOURCE_RECOMMEND] || 0;
}

function recommendRateByArticle(article: WorkspaceArticleCard) {
  const normalized = normalizeSourceMap(article.trafficSources || {});
  const total = Object.values(normalized).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return 0;
  return ((normalized[SOURCE_RECOMMEND] || 0) * 100) / total;
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

function buildSourceSegments(sources?: Record<string, number>, limit: number = SOURCE_ORDER.length) {
  const normalized = normalizeSourceMap(sources);
  const ordered = SOURCE_ORDER.map((label) => ({
    key: label,
    label,
    value: normalized[label] || 0,
  }));

  const total = ordered.reduce((sum, item) => sum + item.value, 0);

  if (limit >= SOURCE_ORDER.length) {
    return ordered.map((item, index) => ({
      ...item,
      percent: total <= 0 ? 0 : (item.value * 100) / total,
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

function recommendRateFromSummary(summary: Record<string, number>) {
  const normalized = normalizeSourceMap(summary);
  const total = Object.values(normalized).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return 0;
  return ((normalized[SOURCE_RECOMMEND] || 0) * 100) / total;
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
  const changes = overview?.dataPanel.changes;
  const recommendRate = recommendRateFromSummary(overview?.dataPanel.trafficSummary ?? {});
  const trafficSegments = useMemo(
    () => buildSourceSegments(overview?.dataPanel.trafficSummary || undefined, SOURCE_ORDER.length),
    [overview?.dataPanel.trafficSummary]
  );

  const trendPoints = useMemo(() => {
    return (overview?.dataPanel.trend ?? []).map((item) => ({
      label: item.label,
      value: item.readCount || 0,
    }));
  }, [overview?.dataPanel.trend]);

  const trendChart = useMemo(() => buildTrendChart(trendPoints), [trendPoints]);
  const accountName = overview?.header.accountName || '\u516c\u4f17\u53f7\u8d26\u53f7';

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
                  onClick={() => setSortKey(item.value)}
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
                  onClick={() => setViewMode(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="art-list-inner">
            {shownArticles.map((article, index) => {
              const recommendPercent = recommendRateByArticle(article);
              const sources = buildSourceSegments(article.trafficSources, 3);
              return (
                <article key={article.id} className="art-card">
                  <div className="art-card-top">
                    <div className={`rank-circle${index < 3 ? ' top' : ''}`}>{index + 1}</div>
                    <div className="art-title">{article.title}</div>
                    <div className="art-date">{fmtDateShort(article.publishTime)}</div>
                  </div>

                  <div className="art-stats">
                    <div className="stat-badge">阅读 {fmtNum(article.readCount)}</div>
                    <div className="stat-badge">完读 {fmtPercent(article.completionRate, 0)}</div>
                    <div className="stat-badge primary">推荐率 {fmtPercent(recommendPercent, 0)}</div>
                    <div className="stat-badge">分享 {fmtNum(article.shareCount)}</div>
                  </div>

                  <div className="src-bar">
                    {sources.map((source, sourceIndex) => (
                      <div
                        key={`${article.id}-seg-${sourceIndex}`}
                        className="src-bar-seg"
                        style={{ width: `${Math.max(4, source.percent)}%`, background: source.color }}
                      />
                    ))}
                  </div>

                  <div className="src-labels">
                    {sources.map((source, sourceIndex) => (
                      <div key={`${article.id}-label-${sourceIndex}`} className="src-label">
                        <span className="src-dot" style={{ background: source.color }} />
                        {source.label} {source.percent.toFixed(0)}%
                      </div>
                    ))}
                  </div>
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
              <div className="period-title">数据汇总 · 近30天</div>
              <button className="btn btn-ghost" type="button" style={{ height: '30px', fontSize: '11px', padding: '0 12px' }}>
                导出数据
              </button>
            </div>
            <div className="kpi-3grid">
              <div className="kpi-3item key">
                <div className="kpi-3label" style={{ color: '#139D84' }}>推荐率（主决策指标）</div>
                <div className="kpi-3value" style={{ color: '#139D84' }}>{fmtPercent(recommendRate, 1)}</div>
                <div className={`kpi-3sub ${toPercentValue(changes?.totalRead) >= 0 ? 'delta-up' : 'delta-down'}`}>
                  {fmtDeltaPercent(changes?.totalRead, 1)} 环比
                </div>
              </div>
              <div className="kpi-3item">
                <div className="kpi-3label">完读率（内容质量）</div>
                <div className="kpi-3value">{fmtPercent(metrics?.completionRate, 0)}</div>
                <div className={`kpi-3sub ${toPercentValue(changes?.completionRate) >= 0 ? 'delta-up' : 'delta-down'}`}>
                  {fmtDeltaPercent(changes?.completionRate, 1)} 环比
                </div>
              </div>
              <div className="kpi-3item">
                <div className="kpi-3label">关注率（增长观察）</div>
                <div className="kpi-3value">{fmtPercent(metrics?.followRate, 1)}</div>
                <div className={`kpi-3sub ${toPercentValue(changes?.newFollowers) >= 0 ? 'delta-up' : 'delta-down'}`}>
                  {fmtDeltaPercent(changes?.newFollowers, 1)} 环比
                </div>
              </div>
            </div>
          </div>

          <div className="period-card" style={{ paddingBottom: '14px' }}>
            <div className="metrics-group-title">阅读与质量</div>
            <div className="metrics-grid">
              <div className="metric-item">
                <div className="metric-label">总阅读</div>
                <div className="metric-value">{fmtNum(metrics?.totalRead)}</div>
                <div className={`metric-sub ${toPercentValue(changes?.totalRead) >= 0 ? 'delta-up' : 'delta-down'}`}>
                  环比 {fmtDeltaPercent(changes?.totalRead, 0)}
                </div>
              </div>
              <div className="metric-item">
                <div className="metric-label">篇均阅读</div>
                <div className="metric-value">{fmtNum(metrics?.avgRead)}</div>
                <div className={`metric-sub ${toPercentValue(changes?.avgRead) >= 0 ? 'delta-up' : 'delta-down'}`}>
                  环比 {fmtDeltaPercent(changes?.avgRead, 0)}
                </div>
              </div>
              <div className="metric-item">
                <div className="metric-label">完读率</div>
                <div className="metric-value">{fmtPercent(metrics?.completionRate, 0)}</div>
                <div className={`metric-sub ${toPercentValue(changes?.completionRate) >= 0 ? 'delta-up' : 'delta-down'}`}>
                  环比 {fmtDeltaPercent(changes?.completionRate, 0)}
                </div>
              </div>
              <div className="metric-item">
                <div className="metric-label">篇均时长</div>
                <div className="metric-value" style={{ fontSize: '14px' }}>{fmtDuration(metrics?.avgReadTimeSec)}</div>
                <div className="metric-sub">持续观察</div>
              </div>
            </div>

            <div className="metrics-group-title">互动</div>
            <div className="metrics-grid">
              <div className="metric-item">
                <div className="metric-label">总点赞</div>
                <div className="metric-value">{fmtNum(metrics?.totalLike)}</div>
                <div className="metric-sub">点赞率 {fmtPercent(metrics?.likeRate, 1)}</div>
              </div>
              <div className="metric-item">
                <div className="metric-label">总分享</div>
                <div className="metric-value">{fmtNum(metrics?.totalShare)}</div>
                <div className="metric-sub">分享率 {fmtPercent(metrics?.shareRate, 1)}</div>
              </div>
              <div className="metric-item">
                <div className="metric-label">总在看</div>
                <div className="metric-value">{fmtNum(metrics?.totalWow)}</div>
                <div className="metric-sub">在看率 {fmtPercent(metrics?.wowRate, 1)}</div>
              </div>
              <div className="metric-item">
                <div className="metric-label">总留言</div>
                <div className="metric-value">{fmtNum(metrics?.totalComment)}</div>
                <div className="metric-sub">留言率 {fmtPercent(metrics?.commentRate, 1)}</div>
              </div>
            </div>

            <div className="metrics-group-title">增长</div>
            <div className="metrics-grid two-col">
              <div className="metric-item">
                <div className="metric-label">新增关注</div>
                <div className="metric-value">{fmtNum(metrics?.newFollowers)}</div>
                <div className="metric-sub">关注率 {fmtPercent(metrics?.followRate, 1)}</div>
              </div>
              <div className="metric-item">
                <div className="metric-label">推荐率</div>
                <div className="metric-value">{fmtPercent(recommendRate, 1)}</div>
                <div className="metric-sub">平台推荐占比</div>
              </div>
            </div>
          </div>

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

          <div className="traffic-card">
            <div className="traffic-title">流量来源</div>
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
                  {item.percent.toFixed(0)}%
                </div>
              ))}
            </div>
            <div className="traffic-labels">
              {trafficSegments.map((item, index) => (
                <div key={`${item.label}-${index}`} className="traffic-label-item">
                  <span className="traffic-dot" style={{ background: item.color }} />
                  {item.label} {item.percent.toFixed(0)}%
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
