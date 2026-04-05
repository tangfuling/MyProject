import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { RoutePath } from '../../../common/router/RoutePath';
import { useAuthStore } from '../../../common/state/authStore';
import ErrorState from '../../../common/ui/ErrorState';
import Loading from '../../../common/ui/Loading';
import AnalysisApi from '../../analysis/api/AnalysisApi';
import type { AnalysisDoneEvent, AnalysisReport } from '../../analysis/model/AnalysisModels';
import ChatApi from '../../chat/api/ChatApi';
import type { ChatDoneEvent, ChatMessage } from '../../chat/model/ChatModels';
import SettingsApi from '../../settings/api/SettingsApi';
import WorkspaceApi from '../api/WorkspaceApi';
import type { WorkspaceArticleCard } from '../model/WorkspaceModels';

type RangeCode = '7d' | '30d' | '90d' | 'all';
type SortKey = 'publish' | 'read' | 'finish' | 'duration' | 'like' | 'share' | 'wow' | 'comment' | 'follow' | 'recommend';
type ViewMode = 'all' | 'top5' | 'low3';
type ExportFormat = 'pdf' | 'image' | 'md';
type ExportStage = 'idle' | 'queue' | 'running' | 'done' | 'downloaded';
type ExportRange = '7' | '30';

type UiMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  meta?: string;
  streaming?: boolean;
};

type SourceSegment = {
  key: string;
  label: string;
  value: number;
  percent: number;
  color: string;
};

const RANGE_OPTIONS: Array<{ value: RangeCode; label: string }> = [
  { value: '7d', label: '7天' },
  { value: '30d', label: '30天' },
  { value: '90d', label: '90天' },
  { value: 'all', label: '全部' },
];

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'publish', label: '发布时间' },
  { value: 'read', label: '阅读' },
  { value: 'finish', label: '完读' },
  { value: 'duration', label: '时长' },
  { value: 'like', label: '点赞' },
  { value: 'share', label: '分享' },
  { value: 'wow', label: '在看' },
  { value: 'comment', label: '评论' },
  { value: 'follow', label: '关注' },
  { value: 'recommend', label: '推荐率' },
];

const VIEW_OPTIONS: Array<{ value: ViewMode; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'top5', label: '只看 Top5' },
  { value: 'low3', label: '低表现 3 篇' },
];

const VIEW_LABEL_MAP: Record<ViewMode, string> = {
  all: '全部',
  top5: 'Top5',
  low3: '低表现 3 篇',
};

const MODEL_OPTIONS = [
  { code: 'qwen', name: 'Qwen', price: 'CNY 2 / M tok' },
  { code: 'doubao', name: 'Doubao', price: 'CNY 3 / M tok' },
  { code: 'claude', name: 'Claude', price: 'CNY 15 / M tok' },
  { code: 'gpt', name: 'GPT', price: 'CNY 10 / M tok' },
];

const CHAT_SESSION_KEY = 'gzh_chat_session_id';
const PAGE_SIZE = 20;
const BASE_VISIBLE_COUNT = 4;
const LOAD_STEP = 2;
const RECOMMEND_GOAL_LOW = 15;
const RECOMMEND_GOAL_HIGH = 21;
const SOURCE_COLORS = ['var(--accent)', 'var(--chart-2)', 'var(--green)', 'var(--chart-muted)'];

function createSessionId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `sess-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function toPercentValue(v?: number | null) {
  const raw = v ?? 0;
  return Math.abs(raw) <= 1 ? raw * 100 : raw;
}

function fmtNum(v?: number | null) {
  return (v ?? 0).toLocaleString('zh-CN');
}

function fmtMoneyCent(v?: number | null) {
  return `CNY ${((v ?? 0) / 100).toFixed(2)}`;
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

function fmtPercent(v?: number | null, d = 1) {
  return `${toPercentValue(v).toFixed(d)}%`;
}

function fmtSignedPercent(v?: number | null, d = 1) {
  const value = toPercentValue(v);
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(d)}%`;
}

function fmtDuration(sec?: number | null) {
  const s = Math.max(0, Math.floor(sec ?? 0));
  const m = Math.floor(s / 60);
  const remain = s % 60;
  return `${m}分${String(remain).padStart(2, '0')}秒`;
}

function recommendRateFromSummary(summary: Record<string, number>) {
  for (const [k, v] of Object.entries(summary || {})) {
    if (k.includes('推荐') || k.toLowerCase().includes('recommend')) return v || 0;
  }
  return 0;
}

function recommendCount(sources: Record<string, number>) {
  return Object.entries(sources || {}).reduce((sum, [k, v]) => {
    if (k.includes('推荐') || k.toLowerCase().includes('recommend')) return sum + (v || 0);
    return sum;
  }, 0);
}

function recommendRateByArticle(article: WorkspaceArticleCard) {
  const read = Math.max(article.readCount || 0, 1);
  return (recommendCount(article.trafficSources || {}) * 100) / read;
}

function sortValue(article: WorkspaceArticleCard, key: SortKey) {
  if (key === 'publish') return article.publishTime ? new Date(article.publishTime).getTime() : 0;
  if (key === 'read') return article.readCount || 0;
  if (key === 'finish') return toPercentValue(article.completionRate);
  if (key === 'duration') return article.avgReadTimeSec || 0;
  if (key === 'like') return article.likeCount || 0;
  if (key === 'share') return article.shareCount || 0;
  if (key === 'wow') return article.wowCount || 0;
  if (key === 'comment') return article.commentCount || 0;
  if (key === 'follow') return article.newFollowers || 0;
  return recommendRateByArticle(article);
}

function metricValueText(article: WorkspaceArticleCard, key: SortKey) {
  if (key === 'publish') return `发布时间 ${fmtDateShort(article.publishTime)}`;
  if (key === 'read') return `阅读 ${fmtNum(article.readCount)}`;
  if (key === 'finish') return `完读率 ${fmtPercent(article.completionRate, 0)}`;
  if (key === 'duration') return `篇均时长 ${fmtDuration(article.avgReadTimeSec)}`;
  if (key === 'like') return `点赞 ${fmtNum(article.likeCount)}`;
  if (key === 'share') return `分享 ${fmtNum(article.shareCount)}`;
  if (key === 'wow') return `在看 ${fmtNum(article.wowCount)}`;
  if (key === 'comment') return `评论 ${fmtNum(article.commentCount)}`;
  if (key === 'follow') return `关注 ${fmtNum(article.newFollowers)}`;
  return `推荐率 ${fmtPercent(recommendRateByArticle(article), 0)}`;
}

function mapSourceLabel(key: string) {
  const lower = key.toLowerCase();
  if (lower.includes('friend')) return '朋友圈';
  if (lower.includes('message') || lower.includes('subscription')) return '公众号消息';
  if (lower.includes('search')) return '搜一搜';
  if (lower.includes('other')) return '其他';
  return key;
}

function buildSourceSegments(sources?: Record<string, number>, limit = 3): SourceSegment[] {
  const entries = Object.entries(sources || {}).filter(([, value]) => Number(value) > 0);
  if (entries.length === 0) {
    return [
      { key: 'friend', label: '朋友圈', value: 52, percent: 52, color: SOURCE_COLORS[0] },
      { key: 'message', label: '公众号消息', value: 30, percent: 30, color: SOURCE_COLORS[1] },
      { key: 'search', label: '搜一搜', value: 8, percent: 8, color: SOURCE_COLORS[2] },
      { key: 'other', label: '其他', value: 10, percent: 10, color: SOURCE_COLORS[3] },
    ];
  }

  const total = entries.reduce((sum, [, value]) => sum + value, 0) || 1;
  const sorted = [...entries].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, limit).map(([key, value], index) => ({
    key,
    label: mapSourceLabel(key),
    value,
    percent: (value * 100) / total,
    color: SOURCE_COLORS[index % SOURCE_COLORS.length],
  }));

  const restValue = sorted.slice(limit).reduce((sum, [, value]) => sum + value, 0);
  if (restValue > 0) {
    top.push({
      key: 'other',
      label: '其他',
      value: restValue,
      percent: (restValue * 100) / total,
      color: SOURCE_COLORS[top.length % SOURCE_COLORS.length],
    });
  }

  return top;
}

function tierLabel(index: number, total: number) {
  if (index < 3) return '头部样本';
  if (index >= Math.max(0, total - 3)) return '低位样本';
  return '中位样本';
}

function mapHistory(msg: ChatMessage): UiMessage {
  const tok = (msg.inputTokens || 0) + (msg.outputTokens || 0);
  return {
    id: `h-${msg.id}`,
    role: msg.role === 'assistant' ? 'assistant' : 'user',
    content: msg.content,
    meta:
      msg.role === 'assistant'
        ? `${msg.aiModel || 'AI'} | ${fmtDateTime(msg.createdAt)} | ${tok.toLocaleString('zh-CN')} tok | ${fmtMoneyCent(msg.costCent)}`
        : fmtDateTime(msg.createdAt),
  };
}

export default function WorkspacePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const profile = useAuthStore((s) => s.profile);
  const updateProfile = useAuthStore((s) => s.updateProfile);

  const [range, setRange] = useState<RangeCode>('30d');
  const [sortKey, setSortKey] = useState<SortKey>('publish');
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [visibleCount, setVisibleCount] = useState(BASE_VISIBLE_COUNT);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sortPanelOpen, setSortPanelOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadSource, setLoadSource] = useState<'manual' | 'scroll'>('manual');

  const [analysisDetail, setAnalysisDetail] = useState<AnalysisReport | null>(null);
  const [analysisGenerating, setAnalysisGenerating] = useState(false);
  const [analysisLive, setAnalysisLive] = useState('');
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const [chatMessages, setChatMessages] = useState<UiMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatStreaming, setChatStreaming] = useState(false);
  const [chatDoneMeta, setChatDoneMeta] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);

  const [sessionId, setSessionId] = useState(() => {
    const cached = localStorage.getItem(CHAT_SESSION_KEY);
    if (cached) return cached;
    const created = createSessionId();
    localStorage.setItem(CHAT_SESSION_KEY, created);
    return created;
  });

  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('pdf');
  const [exportRange, setExportRange] = useState<ExportRange>('7');
  const [includeTopLow, setIncludeTopLow] = useState(true);
  const [includeAiSummary, setIncludeAiSummary] = useState(true);
  const [exportStage, setExportStage] = useState<ExportStage>('idle');

  const chatRef = useRef<HTMLDivElement | null>(null);
  const drawerBodyRef = useRef<HTMLDivElement | null>(null);
  const sortPanelRef = useRef<HTMLDivElement | null>(null);
  const sortTriggerRef = useRef<HTMLButtonElement | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const exportTimersRef = useRef<number[]>([]);

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

  const historyQuery = useQuery({
    queryKey: ['chat-history', sessionId],
    queryFn: () => ChatApi.history(sessionId),
    enabled: Boolean(sessionId),
    staleTime: 60_000,
  });

  const modelMutation = useMutation({
    mutationFn: (model: string) => SettingsApi.updateModel(model),
    onSuccess: (_res, model) => {
      updateProfile({ aiModel: model });
      void queryClient.invalidateQueries({ queryKey: ['workspace-overview'] });
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

  const viewArticles = useMemo(() => {
    if (viewMode === 'top5') return sortedArticles.slice(0, 5);
    if (viewMode === 'low3') return sortedArticles.slice(Math.max(0, sortedArticles.length - 3));
    return sortedArticles;
  }, [sortedArticles, viewMode]);

  const shownArticles = useMemo(
    () => (viewMode === 'all' ? viewArticles.slice(0, visibleCount) : viewArticles),
    [viewMode, viewArticles, visibleCount]
  );

  const canLoadMore =
    viewMode === 'all' && (shownArticles.length < viewArticles.length || Boolean(articlesQuery.hasNextPage));

  const header = overview?.header;
  const metrics = overview?.dataPanel.metrics;
  const changes = overview?.dataPanel.changes;
  const recommendRate = recommendRateFromSummary(overview?.dataPanel.trafficSummary ?? {});
  const recommendRatePercent = Math.max(0, Math.min(100, toPercentValue(recommendRate)));
  const analysisPanel = overview?.analysisPanel;
  const analysisSummary = analysisPanel?.summary || '暂无分析总结。';
  const analysisText = analysisGenerating
    ? analysisLive
    : analysisDetail?.content || analysisPanel?.content || analysisSummary;
  const currentModelCode = header?.aiModel || profile?.aiModel || 'qwen';
  const currentModelName = MODEL_OPTIONS.find((x) => x.code === currentModelCode)?.name || currentModelCode;

  const bestArticle = sortedArticles[0];
  const lowArticle = sortedArticles[sortedArticles.length - 1];

  const trafficSegments = useMemo(
    () => buildSourceSegments(overview?.dataPanel.trafficSummary || undefined, 3),
    [overview?.dataPanel.trafficSummary]
  );

  const trendData = useMemo(() => {
    const trend = overview?.dataPanel.trend ?? [];
    const labels = trend.map((item) => item.label);
    const values = trend.map((item) => item.readCount);
    if (values.length === 0) {
      return {
        labels: ['02-24', '03-01', '03-08', '03-14', '03-24'],
        values: [58, 64, 60, 75, 88],
      };
    }
    return {
      labels,
      values,
    };
  }, [overview?.dataPanel.trend]);

  const trendCoords = useMemo(() => {
    const width = 420;
    const height = 96;
    const pad = 10;
    const values = trendData.values;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;

    return values.map((value, index) => {
      const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
      const y = pad + ((max - value) / span) * (height - pad * 2);
      return {
        x: Number(x.toFixed(1)),
        y: Number(y.toFixed(1)),
      };
    });
  }, [trendData.values]);

  const trendLine = useMemo(
    () => trendCoords.map((p) => `${p.x},${p.y}`).join(' '),
    [trendCoords]
  );

  const trendArea = useMemo(() => {
    if (!trendLine) return '';
    return `${trendLine} 420,100 0,100`;
  }, [trendLine]);

  const trendPrevLine = useMemo(
    () => trendCoords.map((p) => `${p.x},${Math.min(94, p.y + 10)}`).join(' '),
    [trendCoords]
  );

  const quickPrompts = useMemo(() => {
    const list = [
      ...(overview?.quickQuestions ?? []),
      ...(analysisPanel?.suggestedQuestions ?? []),
      ...(analysisDetail?.suggestedQuestions ?? []),
      '找出近30天高推荐样本，并总结可复用的选题与结构特征。',
      '定位低完读样本，并给出3条可执行优化动作。',
      '对比本周与上周策略效果，并给出优先级调整建议。',
    ].filter((x) => x && x.trim());
    return Array.from(new Set(list)).slice(0, 6);
  }, [overview?.quickQuestions, analysisPanel?.suggestedQuestions, analysisDetail?.suggestedQuestions]);

  const sortLabel = SORT_OPTIONS.find((item) => item.value === sortKey)?.label || '发布时间';

  const loadStatusText = useMemo(() => {
    if (viewMode !== 'all') {
      return `当前视图：${VIEW_LABEL_MAP[viewMode]} · 共 ${viewArticles.length} 篇`;
    }
    if (!canLoadMore) {
      return `已加载 ${viewArticles.length} / ${viewArticles.length} 篇 · 已全部展示`;
    }
    return `已加载 ${shownArticles.length} / ${totalArticles} 篇 · 下滑自动加载`;
  }, [viewMode, viewArticles.length, canLoadMore, shownArticles.length, totalArticles]);

  const drawerLoadMoreText = useMemo(() => {
    if (viewMode !== 'all') return '视图模式无需加载';
    if (loadingMore) return loadSource === 'scroll' ? '下滑加载中...' : '加载中...';
    if (!canLoadMore) return '已全部加载';
    return '手动加载更多';
  }, [viewMode, loadingMore, loadSource, canLoadMore]);

  const exportTask = useMemo(() => {
    if (exportStage === 'queue') {
      return {
        title: '排队中',
        meta: '任务ID R20260405-001 · 已进入导出队列，等待资源分配。',
        progress: 24,
        action: '排队中...',
      };
    }
    if (exportStage === 'running') {
      return {
        title: '生成中 62%',
        meta: '正在聚合指标、证据链和周复盘建议，请稍候。',
        progress: 62,
        action: '生成中...',
      };
    }
    if (exportStage === 'done') {
      return {
        title: '已完成，可下载',
        meta: `导出完成：周复盘_${new Date().getFullYear()}W${String(new Date().getDate()).padStart(2, '0')}.${exportFormat === 'md' ? 'md' : 'pdf'}`,
        progress: 100,
        action: '重新生成',
      };
    }
    if (exportStage === 'downloaded') {
      return {
        title: '已完成（已下载）',
        meta: '文件已下载，可继续生成其他时间范围的复盘。',
        progress: 100,
        action: '重新生成',
      };
    }
    return {
      title: '未开始',
      meta: '点击「开始生成」后进入任务队列，预计 20 秒内完成。',
      progress: 0,
      action: '开始生成',
    };
  }, [exportStage, exportFormat]);

  useEffect(() => {
    if (!historyQuery.data || chatMessages.length > 0) return;
    setChatMessages(historyQuery.data.map(mapHistory));
  }, [historyQuery.data, chatMessages.length]);

  useEffect(() => {
    const node = chatRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
  }, [chatMessages, analysisLive]);

  useEffect(() => {
    return () => {
      chatAbortRef.current?.abort();
      analysisAbortRef.current?.abort();
      exportTimersRef.current.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  useEffect(() => {
    setVisibleCount(BASE_VISIBLE_COUNT);
  }, [sortKey, viewMode, range]);

  useEffect(() => {
    if (!sortPanelOpen) return;

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSortPanelOpen(false);
    };

    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (sortPanelRef.current?.contains(target)) return;
      if (sortTriggerRef.current?.contains(target)) return;
      setSortPanelOpen(false);
    };

    document.addEventListener('keydown', onKeydown);
    document.addEventListener('click', onClickOutside);
    return () => {
      document.removeEventListener('keydown', onKeydown);
      document.removeEventListener('click', onClickOutside);
    };
  }, [sortPanelOpen]);

  const loadMore = async (source: 'manual' | 'scroll' = 'manual') => {
    if (!canLoadMore || loadingMore || viewMode !== 'all') return;

    setLoadSource(source);
    setLoadingMore(true);

    try {
      const target = visibleCount + LOAD_STEP;
      setVisibleCount(target);

      if (articlesQuery.hasNextPage && target > viewArticles.length) {
        await articlesQuery.fetchNextPage();
      }
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (!drawerOpen) return;

    const body = drawerBodyRef.current;
    if (!body) return;

    const onScroll = () => {
      if (loadingMore || viewMode !== 'all' || !canLoadMore) return;
      const nearBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 120;
      if (nearBottom) {
        void loadMore('scroll');
      }
    };

    body.addEventListener('scroll', onScroll, { passive: true });
    return () => body.removeEventListener('scroll', onScroll);
  }, [drawerOpen, loadingMore, viewMode, canLoadMore, visibleCount, viewArticles.length, articlesQuery.hasNextPage]);

  const syncWorkspace = async () => {
    setSyncing(true);
    try {
      await Promise.all([overviewQuery.refetch(), articlesQuery.refetch()]);
    } finally {
      setSyncing(false);
    }
  };

  const changeModel = (model: string) => {
    if (modelMutation.isPending || model === currentModelCode) return;
    modelMutation.mutate(model);
  };

  const openDrawer = () => {
    setDrawerOpen(true);
    setSortPanelOpen(false);
    requestAnimationFrame(() => {
      if (drawerBodyRef.current) drawerBodyRef.current.scrollTop = 0;
    });
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setSortPanelOpen(false);
    setExportOpen(false);
  };

  const clearExportTimers = () => {
    exportTimersRef.current.forEach((t) => window.clearTimeout(t));
    exportTimersRef.current = [];
  };

  const openExport = () => {
    clearExportTimers();
    setExportStage('idle');
    setExportOpen(true);
  };

  const closeExport = () => {
    setExportOpen(false);
  };

  const stopChat = () => {
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    setChatStreaming(false);
    setChatDoneMeta('已停止生成。');
  };

  const sendPrompt = (raw: string) => {
    const text = raw.trim();
    if (!text || chatStreaming) return;

    const aiId = `a-${Date.now()}`;
    setChatError(null);
    setChatDoneMeta('');
    setChatMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: 'user', content: text, meta: '刚刚' },
      { id: aiId, role: 'assistant', content: '', meta: '生成中...', streaming: true },
    ]);
    setChatStreaming(true);

    chatAbortRef.current = ChatApi.send(
      { message: text, sessionId, reportId: analysisDetail?.id ?? analysisPanel?.reportId, range },
      (chunk) => {
        setChatMessages((prev) => prev.map((m) => (m.id === aiId ? { ...m, content: `${m.content}${chunk}` } : m)));
      },
      (event: ChatDoneEvent) => {
        chatAbortRef.current = null;
        setChatStreaming(false);
        setChatDoneMeta(`消耗 ${fmtMoneyCent(event.costCent)} | ${(event.inputTokens + event.outputTokens).toLocaleString('zh-CN')} tok`);
        setChatMessages((prev) =>
          prev.map((m) => (m.id === aiId ? { ...m, streaming: false, meta: `${event.aiModel || 'AI'} | 刚刚` } : m))
        );

        if (event.sessionId && event.sessionId !== sessionId) {
          localStorage.setItem(CHAT_SESSION_KEY, event.sessionId);
          setSessionId(event.sessionId);
        }
      },
      (error: Error) => {
        chatAbortRef.current = null;
        setChatStreaming(false);
        setChatError(error.message || '对话失败。');
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === aiId
              ? { ...m, streaming: false, content: m.content || '生成失败，请重试。', meta: '失败' }
              : m
          )
        );
      }
    );
  };

  const submitPromptFromShortcut = (prompt: string) => {
    if (!prompt.trim()) return;
    closeDrawer();
    sendPrompt(prompt);
  };

  const regenerateAnalysis = () => {
    if (analysisGenerating) return;

    setAnalysisGenerating(true);
    setAnalysisLive('');
    setAnalysisError(null);

    analysisAbortRef.current = AnalysisApi.generate(
      range,
      (chunk) => setAnalysisLive((prev) => prev + chunk),
      (event: AnalysisDoneEvent) => {
        analysisAbortRef.current = null;
        setAnalysisGenerating(false);
        setChatDoneMeta(
          `分析完成。tok ${(event.inputTokens + event.outputTokens).toLocaleString('zh-CN')}，消耗 ${fmtMoneyCent(event.costCent)}`
        );
        void AnalysisApi.detail(event.reportId)
          .then(setAnalysisDetail)
          .catch(() => setAnalysisError('分析详情加载失败。'));
      },
      (error) => {
        analysisAbortRef.current = null;
        setAnalysisGenerating(false);
        setAnalysisError(error.message || '分析生成失败。');
      }
    );
  };

  const generateExport = () => {
    if (exportStage === 'queue' || exportStage === 'running') return;

    clearExportTimers();
    setExportStage('queue');

    exportTimersRef.current = [
      window.setTimeout(() => setExportStage('running'), 700),
      window.setTimeout(() => setExportStage('done'), 2600),
    ];
  };

  const downloadExport = () => {
    const lines = [
      '# 周复盘',
      '',
      `生成时间：${fmtDateTime(new Date())}`,
      `导出格式：${exportFormat.toUpperCase()}`,
      `复盘范围：近${exportRange}天`,
      `总阅读：${fmtNum(metrics?.totalRead)}`,
      `完读率：${fmtPercent(metrics?.completionRate, 0)}`,
      `推荐率：${fmtPercent(recommendRate, 1)}`,
      '',
      includeTopLow ? '包含：Top/Low样本' : '不包含：Top/Low样本',
      includeAiSummary ? '包含：AI建议摘要' : '不包含：AI建议摘要',
      '',
      analysisText || '暂无分析内容',
    ];

    const ext = exportFormat === 'md' ? 'md' : 'txt';
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `weekly-review-${Date.now()}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    setExportStage('downloaded');
  };

  const articlesWithMeta = useMemo(
    () =>
      shownArticles.map((article, index) => ({
        article,
        rank: index + 1,
        tier: tierLabel(index, viewArticles.length),
        sources: buildSourceSegments(article.trafficSources, 3),
      })),
    [shownArticles, viewArticles.length]
  );

  if (overviewQuery.isLoading && !overview) return <Loading />;
  if (overviewQuery.error) {
    return <ErrorState message={(overviewQuery.error as Error).message || '加载工作台失败。'} />;
  }

  return (
    <div className="workspace-page">
      <div className="workspace-shell">
        <div className="app-topbar">
          <a
            className="brand"
            href={RoutePath.ROOT}
            onClick={(event) => {
              event.preventDefault();
              navigate(RoutePath.ROOT);
            }}
          >
            <img className="brand-icon" src="/site-icon-64.png" alt="内容运营助手" />
            <div className="brand-name">内容运营助手</div>
          </a>

          <span className="app-topbar-account">{header?.accountName || '运营账号'}</span>

          <div className="topbar-right">
            <div className="model-chip">
              模型：{currentModelName}
              <div className="model-dropdown">
                {MODEL_OPTIONS.map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    className={`model-opt${item.code === currentModelCode ? ' active' : ''}`}
                    onClick={() => changeModel(item.code)}
                  >
                    <span>{item.name}</span>
                    <span className="model-opt-price">{item.price}</span>
                  </button>
                ))}
              </div>
            </div>

            <span className="sync-meta">
              最新发布 {bestArticle?.publishTime ? fmtDateShort(bestArticle.publishTime) : '--'} · 同步 {fmtDateTime(header?.lastSyncAt)}
            </span>

            <button className="btn btn-outline btn-xs" type="button" onClick={() => void syncWorkspace()} disabled={syncing}>
              {syncing ? '同步中...' : '一键同步'}
            </button>

            <button className="balance-chip" type="button" onClick={() => navigate(RoutePath.PROFILE)}>
              {fmtMoneyCent((header?.balanceCent || 0) + (header?.freeQuotaCent || 0))}
            </button>

            <button className="avatar-btn" type="button" onClick={() => navigate(RoutePath.PROFILE)}>
              U
            </button>
          </div>
        </div>

        <div className="workspace-body">
          <div className="ctx">
            <div className="ctx-scroll">
              <div className="ctx-sec">
                <div className="ctx-head">
                  <div className="ctx-head-left">
                    <span className="ctx-head-title">数据</span>
                  </div>
                  <div className="time-tabs">
                    {RANGE_OPTIONS.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        className={`time-tab${range === item.value ? ' active' : ''}`}
                        onClick={() => setRange(item.value)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="ctx-body">
                  <div className="goal-track-card">
                    <div className="goal-track-head">
                      <span>本周信号概览</span>
                      <span>近 {exportRange} 天</span>
                    </div>
                    <div className="goal-track-main">
                      推荐率观察区间 <b>{RECOMMEND_GOAL_LOW}%~{RECOMMEND_GOAL_HIGH}%</b> · 当前 {fmtPercent(recommendRate, 1)}
                    </div>
                    <div className="goal-track-bar">
                      <span style={{ width: `${recommendRatePercent}%` }} />
                    </div>
                  </div>

                  <div className="kpi-lite-row">
                    <div className="kpi-lite-item">
                      <span>推荐率</span>
                      <b>{fmtPercent(recommendRate, 1)}</b>
                    </div>
                    <div className="kpi-lite-item">
                      <span>完读率</span>
                      <b>{fmtPercent(metrics?.completionRate, 0)}</b>
                    </div>
                    <div className="kpi-lite-item">
                      <span>篇均阅读</span>
                      <b>{fmtNum(metrics?.avgRead)}</b>
                    </div>
                  </div>

                  <div className="risk-alert">
                    {recommendRatePercent < RECOMMEND_GOAL_LOW
                      ? '风险提示：推荐率低于目标区间，先稳分发信号，再考虑放大发文频率。'
                      : '状态良好：推荐率处于目标区间，可保持当前节奏并继续验证。'}
                  </div>

                  <div className="kpi-core-caption">核心指标（优先级：推荐率 &gt; 完读率 &gt; 阅读）</div>

                  <div className="kpi-main-grid">
                    <div className="kpi-main-card key-card">
                      <div className="kpi-main-label">阅读</div>
                      <div className="kpi-main-value">{fmtNum(metrics?.totalRead)}</div>
                      <div className="kpi-main-meta">
                        <span className={`stat-cell-delta${(changes?.totalRead || 0) >= 0 ? ' up' : ' down'}`}>
                          {fmtSignedPercent(changes?.totalRead, 0)}
                        </span>
                        <span>篇均 <b>{fmtNum(metrics?.avgRead)}</b></span>
                      </div>
                    </div>

                    <div className="kpi-main-card key-card">
                      <div className="kpi-main-label">完读</div>
                      <div className="kpi-main-value">{fmtPercent(metrics?.completionRate, 0)}</div>
                      <div className="kpi-main-meta">
                        <span className={`stat-cell-delta${(changes?.completionRate || 0) >= 0 ? ' up' : ' down'}`}>
                          {fmtSignedPercent(changes?.completionRate, 0)}
                        </span>
                        <span>时长 <b>{fmtDuration(metrics?.avgReadTimeSec)}</b></span>
                      </div>
                    </div>

                    <div className="kpi-main-card">
                      <div className="kpi-main-label">点赞</div>
                      <div className="kpi-main-value">{fmtNum(metrics?.totalLike)}</div>
                      <div className="kpi-main-meta">
                        <span className={`stat-cell-delta${(changes?.totalLike || 0) >= 0 ? ' up' : ' down'}`}>
                          {fmtSignedPercent(changes?.totalLike, 0)}
                        </span>
                        <span><b>{fmtPercent(metrics?.likeRate, 1)}</b></span>
                      </div>
                    </div>

                    <div className="kpi-main-card">
                      <div className="kpi-main-label">关注</div>
                      <div className="kpi-main-value">{fmtNum(metrics?.newFollowers)}</div>
                      <div className="kpi-main-meta">
                        <span className={`stat-cell-delta${(changes?.newFollowers || 0) >= 0 ? ' up' : ' down'}`}>
                          {fmtSignedPercent(changes?.newFollowers, 0)}
                        </span>
                        <span><b>{fmtPercent(metrics?.followRate, 1)}</b></span>
                      </div>
                    </div>
                  </div>

                  <div className="recommend-card">
                    <div className="recommend-head">
                      <span className="recommend-tag">推荐率</span>
                      <span className={`recommend-delta${recommendRatePercent >= RECOMMEND_GOAL_LOW ? ' up' : ' down'}`}>
                        {fmtSignedPercent(changes?.avgRead, 1)}
                      </span>
                    </div>
                    <div className="recommend-value">{fmtPercent(recommendRate, 1)}</div>
                    <div className="recommend-sub">平台推荐阅读占比（当前统计范围）</div>
                    <div className="recommend-bar"><span style={{ width: `${recommendRatePercent}%` }} /></div>
                    <div className="recommend-goal">
                      <span>目标区间 {RECOMMEND_GOAL_LOW}%~{RECOMMEND_GOAL_HIGH}%</span>
                      <b>当前 {fmtPercent(recommendRate, 1)}</b>
                    </div>
                  </div>

                  <div className="decision-card">
                    <div className="decision-head">
                      <span className="decision-tag">本周判断</span>
                      <span className="decision-pri">优先级 A</span>
                    </div>
                    <div className="decision-title">先观察推荐率，再决定是否放大发文节奏</div>
                    <div className="decision-meta">
                      建议保持选题结构稳定，先提升可见性和分发信号，再按周验证是否有效。
                    </div>

                    <div className="decision-actions">
                      <div className="decision-action">
                        <div className="decision-action-top">
                          <span>继续外向型选题并做关键词标题</span>
                          <span className="decision-impact">看 推荐率</span>
                        </div>
                        <div className="decision-evidence">
                          证据：{bestArticle ? `高表现样本《${bestArticle.title}》` : '暂无高表现样本'}
                        </div>
                      </div>

                      <div className="decision-action">
                        <div className="decision-action-top">
                          <span>文末增加可转发钩子</span>
                          <span className="decision-impact">看 分享率</span>
                        </div>
                        <div className="decision-evidence">证据：分享行为对推荐扩散有明显正向作用。</div>
                      </div>

                      <div className="decision-action">
                        <div className="decision-action-top">
                          <span>发布后 24 小时复盘一次</span>
                          <span className="decision-impact">看 完读率</span>
                        </div>
                        <div className="decision-evidence">
                          证据：{lowArticle ? `低位样本《${lowArticle.title}》` : '暂无低位样本'} 可作为反例追踪。
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="today-focus-card">
                    <div className="today-focus-head">
                      <span className="today-focus-tag">今日先做</span>
                      <span className="today-focus-eta">预计 15 分钟</span>
                    </div>
                    <div className="today-focus-main">生成下一篇“外向型 + 搜索关键词”选题</div>
                    <div className="today-focus-sub">完成后重点看：推荐率、搜一搜占比</div>

                    <div className="today-focus-steps">
                      <div className="today-step done">
                        <span className="today-step-dot">✓</span>
                        <span>完成近30天数据同步</span>
                        <span className="today-step-status done">已完成</span>
                      </div>
                      <div className="today-step">
                        <span className="today-step-dot">2</span>
                        <span>生成下一篇选题草案</span>
                        <span className="today-step-status pending">进行中</span>
                      </div>
                      <div className="today-step">
                        <span className="today-step-dot">3</span>
                        <span>发布后24小时复盘推荐率</span>
                        <span className="today-step-status">待复盘</span>
                      </div>
                    </div>

                    <button
                      className="today-focus-btn"
                      type="button"
                      onClick={() =>
                        submitPromptFromShortcut('请基于近30天数据生成下周选题计划，按优先级给出3个方向、标题要点和观察指标。')
                      }
                    >
                      生成下周选题
                    </button>
                  </div>

                  <details className="kpi-fold" open>
                    <summary>互动补充（分享 / 在看 / 评论）</summary>
                    <div className="kpi-interact-list">
                      <div className="kpi-interact-item">
                        <span className="name">分享</span>
                        <span className="val">{fmtNum(metrics?.totalShare)}</span>
                        <span className="rate">{fmtPercent(metrics?.shareRate, 1)}</span>
                      </div>
                      <div className="kpi-interact-item">
                        <span className="name">在看</span>
                        <span className="val">{fmtNum(metrics?.totalWow)}</span>
                        <span className="rate">{fmtPercent(metrics?.wowRate, 1)}</span>
                      </div>
                      <div className="kpi-interact-item">
                        <span className="name">评论</span>
                        <span className="val">{fmtNum(metrics?.totalComment)}</span>
                        <span className="rate">{fmtPercent(metrics?.commentRate, 1)}</span>
                      </div>
                    </div>
                  </details>

                  <div className="quick-actions">
                    <button
                      className="quick-action"
                      type="button"
                      onClick={() => submitPromptFromShortcut('找出近30天高推荐样本，并总结可复用的选题与结构特征。')}
                    >
                      查看高推荐样本
                    </button>
                    <button
                      className="quick-action"
                      type="button"
                      onClick={() => submitPromptFromShortcut('找出近30天低完读样本，并给出3条可执行优化动作。')}
                    >
                      定位低完读样本
                    </button>
                    <button
                      className="quick-action"
                      type="button"
                      onClick={() => submitPromptFromShortcut('复盘上周策略效果，并给出下周优先级调整建议。')}
                    >
                      对比上周策略效果
                    </button>
                  </div>

                  <button className="detail-link" type="button" onClick={openDrawer}>
                    查看 {totalArticles} 篇详情与完整指标 →
                  </button>
                </div>
              </div>

              <div className="ctx-sec ctx-sec-analysis">
                <div className="ctx-head">
                  <div className="ctx-head-left">
                    <span className="ctx-head-title">分析</span>
                  </div>
                  <span className="ctx-head-time">{analysisPanel?.createdAt ? fmtDateTime(analysisPanel.createdAt) : 'N/A'}</span>
                </div>

                <div className="ctx-analysis">
                  <div className="analysis-stage">阶段判断：{analysisSummary}</div>

                  <div className="ctx-sec-title">发现与判断</div>
                  <div className="finding pos"><span className="finding-dot">●</span>高表现样本中推荐率明显高于均值。</div>
                  <div className="finding pos"><span className="finding-dot">●</span>优质内容对关注增长有正向拉动。</div>
                  <div className="finding neg"><span className="finding-dot">●</span>低位样本完读率偏弱，结构需要优化。</div>
                  <div className="finding neg"><span className="finding-dot">●</span>分享率仍有提升空间，传播钩子需更明确。</div>

                  <div className="divider" />

                  <div className="ctx-sec-title">本周动作</div>
                  <div className="suggestion-guardrail">
                    策略边界：可结合热点借势，但必须保持账号核心主题和表达风格。
                  </div>

                  {(analysisPanel?.actionSuggestions?.length
                    ? analysisPanel.actionSuggestions
                    : ['执行外向型选题 1 篇，重点观察推荐率与分享率变化。', '标题加入关键词，提升搜索可见性。', '文末加入转发引导句，拉动分享行为。']
                  )
                    .slice(0, 3)
                    .map((item, idx) => (
                      <div key={`${item}-${idx}`} className="suggestion">
                        <div className="sug-num">{idx + 1}</div>
                        <div className="sug-text">{item}</div>
                      </div>
                    ))}

                  {analysisText ? <pre className="analysis-content pre-wrap">{analysisText}</pre> : null}
                </div>

                <div className="ctx-footer">
                  <div className="ctx-footer-meta">
                    统计周期 {range} · {currentModelName} · {fmtMoneyCent(analysisPanel?.costCent || 0)}
                  </div>
                  <button
                    className="btn btn-ghost btn-xs"
                    type="button"
                    onClick={regenerateAnalysis}
                    disabled={analysisGenerating}
                  >
                    {analysisGenerating ? '生成中...' : '重新生成'}
                  </button>
                </div>

                {analysisError ? <div className="error-tip" style={{ padding: '0 12px 10px' }}>{analysisError}</div> : null}
              </div>
            </div>
          </div>

          <div className="chat-wrap">
            <div className="chat-msgs" ref={chatRef}>
              {historyQuery.isLoading && chatMessages.length === 0 ? (
                <div className="msg">
                  <div className="msg-av ai">AI</div>
                  <div className="bubble ai">加载历史对话中...</div>
                </div>
              ) : null}

              {!historyQuery.isLoading && chatMessages.length === 0 ? (
                <div className="msg">
                  <div className="msg-av ai">AI</div>
                  <div>
                    <div className="analysis-msg">
                      <div className="am-head">
                        <div className="am-head-title">已完成近30天样本分析</div>
                        <div className="am-head-sub">你可以直接问我：下周选题、结构优化、传播动作、复盘节奏。</div>
                      </div>
                      <div className="am-body">
                        <div className="am-sec-title">建议你先问这三个问题</div>
                        <div className="suggest-list">
                          {quickPrompts.slice(0, 3).map((item, idx) => (
                            <div key={`${item}-${idx}`} className="suggest-item">
                              <div className="suggest-item-main">
                                <div className="suggest-item-num">{idx + 1}</div>
                                <span>{item}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="am-footer">
                        <span>点击右侧问题即可开始</span>
                        <div className="am-footer-chips">
                          {quickPrompts.slice(0, 1).map((item) => (
                            <button key={item} className="chip" type="button" onClick={() => sendPrompt(item)}>
                              生成本周选题计划
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {chatMessages.map((item) => (
                <div key={item.id} className={`msg${item.role === 'user' ? ' user' : ''}`}>
                  <div className={`msg-av ${item.role === 'user' ? 'user' : 'ai'}`}>{item.role === 'user' ? 'U' : 'AI'}</div>
                  <div>
                    <div className={`bubble ${item.role === 'user' ? 'user' : 'ai'}`}>
                      {item.content ? <pre className="pre-wrap">{item.content}</pre> : '...'}
                    </div>
                    {item.meta ? <div className="msg-meta">{item.meta}</div> : null}
                  </div>
                </div>
              ))}
            </div>

            <div className="chat-bottom">
              <div className="chat-quick-strip">
                {quickPrompts.map((item) => (
                  <button key={item} className="chat-quick-btn" type="button" onClick={() => sendPrompt(item)}>
                    {item}
                  </button>
                ))}
              </div>

              <div className="input-row">
                <textarea
                  className="chat-input"
                  placeholder="请输入关于账号运营的问题..."
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      if (chatStreaming) {
                        stopChat();
                        return;
                      }
                      const text = chatInput.trim();
                      if (!text) return;
                      setChatInput('');
                      sendPrompt(text);
                    }
                  }}
                />

                <button
                  className="send-btn"
                  type="button"
                  onClick={() => {
                    if (chatStreaming) {
                      stopChat();
                      return;
                    }
                    const text = chatInput.trim();
                    if (!text) return;
                    setChatInput('');
                    sendPrompt(text);
                  }}
                >
                  {chatStreaming ? '停止' : '发送'}
                </button>
              </div>

              {chatDoneMeta ? <div className="chat-done">{chatDoneMeta}</div> : null}
              {chatError ? <div className="error-tip">{chatError}</div> : null}
            </div>
          </div>
        </div>
      </div>

      <div className={`overlay${drawerOpen ? ' open' : ''}`} onClick={closeDrawer} />

      <div className={`drawer${drawerOpen ? ' open' : ''}`}>
        <div className="drawer-head">
          <div className="drawer-head-main">
            <div className="drawer-head-title">文章详情</div>
            <div className="drawer-head-sub">
              <span>总计 {totalArticles}</span>
              <span>更新 {fmtDateTime(header?.lastSyncAt)}</span>
            </div>
          </div>
          <div className="drawer-head-actions">
            <button className="btn btn-ghost btn-xs drawer-export-btn" type="button" onClick={openExport}>
              导出周复盘
            </button>
            <button className="drawer-close" type="button" onClick={closeDrawer}>×</button>
          </div>
        </div>

        <div className="drawer-body" ref={drawerBodyRef}>
          <div className="drawer-block-head">本周策略</div>
          <div className="drawer-decision-hero">
            <div className="drawer-decision-grid">
              <div className="drawer-decision-kpi">
                <div className="label">推荐率</div>
                <div className="value">{fmtPercent(recommendRate, 1)}</div>
                <div className="sub">目标 {RECOMMEND_GOAL_LOW}%~{RECOMMEND_GOAL_HIGH}%</div>
              </div>
              <div className="drawer-decision-kpi">
                <div className="label">完读率</div>
                <div className="value">{fmtPercent(metrics?.completionRate, 0)}</div>
                <div className="sub">篇均 {fmtDuration(metrics?.avgReadTimeSec)}</div>
              </div>
              <div className="drawer-decision-kpi">
                <div className="label">新增关注</div>
                <div className="value">{fmtNum(metrics?.newFollowers)}</div>
                <div className="sub">关注率 {fmtPercent(metrics?.followRate, 1)}</div>
              </div>
            </div>

            <div className="drawer-decision-action">
              <div className="title">当前优先动作</div>
              <div className="main">先做“外向型 + 关键词”选题，72 小时复盘推荐率</div>
              <div className="sub">先验证分发信号，再决定是否放大发文频率。</div>
            </div>

            <div className="drawer-evidence-title">关键证据</div>
            <div className="drawer-evidence-list">
              <div className="drawer-evidence-item"><b>高表现：</b>{bestArticle ? bestArticle.title : '暂无'}</div>
              <div className="drawer-evidence-item"><b>低表现：</b>{lowArticle ? lowArticle.title : '暂无'}</div>
            </div>

            <button
              className="drawer-action-btn"
              type="button"
              onClick={() => submitPromptFromShortcut('请基于当前样本生成本周选题计划，并附带每条动作的观察指标与复盘点。')}
            >
              生成本周选题计划
            </button>
          </div>

          <div className="metric-groups">
            <div className="metric-group">
              <div className="metric-group-head">内容效率</div>
              <div className="metric-group-grid">
                <div className="metric-mini">
                  <div className="metric-mini-label">总阅读</div>
                  <div className="metric-mini-value">{fmtNum(metrics?.totalRead)}</div>
                  <div className="metric-mini-sub">变化 {fmtSignedPercent(changes?.totalRead, 0)}</div>
                </div>
                <div className="metric-mini">
                  <div className="metric-mini-label">篇均阅读</div>
                  <div className="metric-mini-value">{fmtNum(metrics?.avgRead)}</div>
                  <div className="metric-mini-sub">变化 {fmtSignedPercent(changes?.avgRead, 0)}</div>
                </div>
                <div className="metric-mini">
                  <div className="metric-mini-label">完读率</div>
                  <div className="metric-mini-value">{fmtPercent(metrics?.completionRate, 0)}</div>
                  <div className="metric-mini-sub">变化 {fmtSignedPercent(changes?.completionRate, 0)}</div>
                </div>
                <div className="metric-mini">
                  <div className="metric-mini-label">平均时长</div>
                  <div className="metric-mini-value">{fmtDuration(metrics?.avgReadTimeSec)}</div>
                  <div className="metric-mini-sub">阅读效率指标</div>
                </div>
              </div>
            </div>

            <div className="metric-group">
              <div className="metric-group-head">互动反馈</div>
              <div className="metric-group-grid">
                <div className="metric-mini">
                  <div className="metric-mini-label">点赞</div>
                  <div className="metric-mini-value">{fmtNum(metrics?.totalLike)}</div>
                  <div className="metric-mini-sub">率 {fmtPercent(metrics?.likeRate, 1)}</div>
                </div>
                <div className="metric-mini">
                  <div className="metric-mini-label">分享</div>
                  <div className="metric-mini-value">{fmtNum(metrics?.totalShare)}</div>
                  <div className="metric-mini-sub">率 {fmtPercent(metrics?.shareRate, 1)}</div>
                </div>
                <div className="metric-mini">
                  <div className="metric-mini-label">在看</div>
                  <div className="metric-mini-value">{fmtNum(metrics?.totalWow)}</div>
                  <div className="metric-mini-sub">率 {fmtPercent(metrics?.wowRate, 1)}</div>
                </div>
                <div className="metric-mini">
                  <div className="metric-mini-label">评论</div>
                  <div className="metric-mini-value">{fmtNum(metrics?.totalComment)}</div>
                  <div className="metric-mini-sub">率 {fmtPercent(metrics?.commentRate, 1)}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="trend-chart-box">
            <div className="drawer-block-head">阅读趋势（近30天）</div>
            <svg width="100%" height="110" viewBox="0 0 420 100" preserveAspectRatio="none">
              {trendArea ? <polygon fill="var(--accent)" fillOpacity="0.12" points={trendArea} /> : null}
              {trendPrevLine ? (
                <polyline
                  fill="none"
                  stroke="#94a3b8"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="4 3"
                  points={trendPrevLine}
                />
              ) : null}
              {trendLine ? (
                <polyline
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={trendLine}
                />
              ) : null}
              {trendCoords.map((point, index) => (
                <circle
                  key={`trend-dot-${index}`}
                  cx={point.x}
                  cy={point.y}
                  r={index === trendCoords.length - 1 ? 4 : 3}
                  fill="var(--accent)"
                  stroke={index === trendCoords.length - 1 ? '#fff' : 'none'}
                  strokeWidth={index === trendCoords.length - 1 ? 2 : 0}
                />
              ))}
            </svg>
            <div className="trend-labels">
              {trendData.labels.map((label, index) => (
                <span key={`${label}-${index}`}>{label}</span>
              ))}
            </div>
            <div className="trend-legend">
              <div className="trend-legend-item"><span className="trend-dot" style={{ background: 'var(--accent)' }} />本周期</div>
              <div className="trend-legend-item"><span className="trend-dot" style={{ background: '#94a3b8' }} />参考线</div>
            </div>
          </div>

          <div className="src-overview">
            <div className="drawer-block-head orange">流量来源</div>
            <div className="src-bar" style={{ height: '8px', borderRadius: '8px' }}>
              {trafficSegments.map((item, index) => (
                <div
                  key={`${item.key}-${index}`}
                  className="src-seg"
                  style={{
                    width: `${Math.max(4, item.percent)}%`,
                    background: item.color,
                  }}
                />
              ))}
            </div>
            <div className="src-labels" style={{ marginTop: '8px' }}>
              {trafficSegments.map((item, index) => (
                <div key={`${item.label}-${index}`} className="src-label">
                  <span className="src-dot" style={{ background: item.color }} />
                  {item.label} {item.percent.toFixed(0)}%
                </div>
              ))}
            </div>
          </div>

          <div className="article-filter article-filter-gap">
            <div className="article-filter-head sort-panel-anchor">
              <div className="drawer-block-head green article-list-head-tag">文章列表</div>
              <button
                ref={sortTriggerRef}
                className="filter-open-btn"
                id="sortPanelTrigger"
                type="button"
                aria-expanded={sortPanelOpen}
                onClick={() => setSortPanelOpen((prev) => !prev)}
              >
                筛选维度：{sortLabel}
              </button>

              <div
                ref={sortPanelRef}
                className={`sort-panel${sortPanelOpen ? ' open' : ''}`}
                id="sortPanel"
                aria-hidden={!sortPanelOpen}
              >
                <div className="sort-panel-head">
                  <div className="sort-panel-title">筛选维度</div>
                  <button className="sort-panel-close" type="button" onClick={() => setSortPanelOpen(false)}>×</button>
                </div>

                <div className="filter-metrics">
                  {SORT_OPTIONS.map((item) => (
                    <button
                      key={item.value}
                      className={`filter-chip${sortKey === item.value ? ' active' : ''}`}
                      type="button"
                      onClick={() => {
                        setSortKey(item.value);
                        setSortPanelOpen(false);
                        if (drawerBodyRef.current) drawerBodyRef.current.scrollTop = 0;
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="filter-views">
              {VIEW_OPTIONS.map((item) => (
                <button
                  key={item.value}
                  className={`view-chip${viewMode === item.value ? ' active' : ''}`}
                  type="button"
                  onClick={() => {
                    setViewMode(item.value);
                    if (drawerBodyRef.current) drawerBodyRef.current.scrollTop = 0;
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {articlesWithMeta.map((item) => {
            const recommendPercent = recommendRateByArticle(item.article);
            return (
              <div key={item.article.id} className="art-row">
                <div className="art-top">
                  <div className="art-top-main">
                    <span
                      className={`art-rank${item.rank === 1 ? ' top1' : ''}${item.rank === 2 ? ' top2' : ''}${item.rank === 3 ? ' top3' : ''}`}
                    >
                      {item.rank}
                    </span>
                    <div className="art-title">{item.article.title}</div>
                  </div>
                  <div className="art-date">发布 {fmtDateShort(item.article.publishTime)}</div>
                </div>

                <div className="art-stats primary">
                  <div className="art-stat">阅读 <b>{fmtNum(item.article.readCount)}</b></div>
                  <div className="art-stat">完读 <b>{fmtPercent(item.article.completionRate, 0)}</b></div>
                  <div className="art-stat">推荐率 <b>{fmtPercent(recommendPercent, 0)}</b></div>
                </div>

                <div className="art-stats secondary">
                  <div className="art-stat">时长 <b>{fmtDuration(item.article.avgReadTimeSec)}</b></div>
                  <div className="art-stat">点赞 <b>{fmtNum(item.article.likeCount)}</b></div>
                  <div className="art-stat">分享 <b>{fmtNum(item.article.shareCount)}</b></div>
                  <div className="art-stat">在看 <b>{fmtNum(item.article.wowCount)}</b></div>
                  <div className="art-stat">评论 <b>{fmtNum(item.article.commentCount)}</b></div>
                  <div className="art-stat">关注 <b>{fmtNum(item.article.newFollowers)}</b></div>
                </div>

                <div className="src-bar" style={{ marginTop: '8px', height: '6px', borderRadius: '6px' }}>
                  {item.sources.map((source, index) => (
                    <div
                      key={`${item.article.id}-seg-${index}`}
                      className="src-seg"
                      style={{ width: `${Math.max(4, source.percent)}%`, background: source.color }}
                    />
                  ))}
                </div>

                <div className="src-labels compact">
                  {item.sources.map((source, index) => (
                    <div key={`${item.article.id}-label-${index}`} className="src-label">
                      <span className="src-dot" style={{ background: source.color }} />
                      {source.label} {source.percent.toFixed(0)}%
                    </div>
                  ))}
                </div>

                <div className="art-insight">
                  洞察：按{sortLabel}排序，当前为{item.tier}，{metricValueText(item.article, sortKey)}。
                </div>
              </div>
            );
          })}

          <div className="load-status">{loadStatusText}</div>

          <button
            className={`btn btn-outline btn-sm drawer-load-more${!canLoadMore || viewMode !== 'all' ? ' is-disabled' : ''}${loadingMore ? ' is-loading' : ''}`}
            type="button"
            onClick={() => void loadMore('manual')}
            disabled={!canLoadMore || viewMode !== 'all' || loadingMore}
          >
            {drawerLoadMoreText}
          </button>
        </div>
      </div>

      <div
        className={`export-modal-overlay${exportOpen ? ' open' : ''}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeExport();
        }}
      >
        <div className="export-modal" onClick={(event) => event.stopPropagation()}>
          <div className="export-modal-head">
            <div>
              <div className="export-modal-title">导出周复盘</div>
              <div className="export-modal-sub">任务队列生成，完成后可下载文件</div>
            </div>
            <button className="export-modal-close" type="button" onClick={closeExport}>×</button>
          </div>

          <div className="export-modal-body">
            <div className="export-section">
              <div className="export-section-title">导出格式</div>
              <div className="export-format-row">
                <button className={`export-format-chip${exportFormat === 'pdf' ? ' active' : ''}`} type="button" onClick={() => setExportFormat('pdf')}>PDF（推荐）</button>
                <button className={`export-format-chip${exportFormat === 'image' ? ' active' : ''}`} type="button" onClick={() => setExportFormat('image')}>长图</button>
                <button className={`export-format-chip${exportFormat === 'md' ? ' active' : ''}`} type="button" onClick={() => setExportFormat('md')}>Markdown</button>
              </div>
            </div>

            <div className="export-section">
              <div className="export-section-title">复盘范围</div>
              <div className="export-range-row">
                <button className={`export-range-chip${exportRange === '7' ? ' active' : ''}`} type="button" onClick={() => setExportRange('7')}>近7天</button>
                <button className={`export-range-chip${exportRange === '30' ? ' active' : ''}`} type="button" onClick={() => setExportRange('30')}>近30天</button>
              </div>
            </div>

            <div className="export-section">
              <div className="export-section-title">包含内容</div>
              <div className="export-items">
                <label className="export-item"><input type="checkbox" checked disabled /> 核心指标与趋势</label>
                <label className="export-item"><input type="checkbox" checked disabled /> 本周动作与证据链</label>
                <label className="export-item"><input type="checkbox" checked={includeTopLow} onChange={(e) => setIncludeTopLow(e.target.checked)} /> 文章 Top / Low 样本</label>
                <label className="export-item"><input type="checkbox" checked={includeAiSummary} onChange={(e) => setIncludeAiSummary(e.target.checked)} /> AI 建议摘要（含调性边界）</label>
              </div>
            </div>

            <div className="export-task">
              <div className="export-task-state">{exportTask.title}</div>
              <div className="export-task-meta">{exportTask.meta}</div>
              <div className="export-task-progress"><span style={{ width: `${exportTask.progress}%` }} /></div>
            </div>

            <div className="export-history">
              <div className="export-section-title">最近导出</div>
              <div className="export-history-list">
                <div className="export-history-item"><span>03-24 周复盘（PDF）</span><span>已完成</span></div>
                <div className="export-history-item"><span>03-17 周复盘（长图）</span><span>已完成</span></div>
              </div>
            </div>
          </div>

          <div className="export-modal-foot">
            <button className="btn btn-ghost btn-sm" type="button" onClick={closeExport}>关闭</button>
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={generateExport}
              disabled={exportStage === 'queue' || exportStage === 'running'}
            >
              {exportTask.action}
            </button>
            {(exportStage === 'done' || exportStage === 'downloaded') ? (
              <button className="btn btn-outline btn-sm" type="button" onClick={downloadExport}>下载</button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
