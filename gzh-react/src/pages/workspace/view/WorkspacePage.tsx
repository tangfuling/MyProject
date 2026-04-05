import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { RoutePath } from '../../../common/router/RoutePath';
import { useAuthStore } from '../../../common/state/authStore';
import ErrorState from '../../../common/ui/ErrorState';
import Loading from '../../../common/ui/Loading';
import MainNavTabs from '../../../common/ui/MainNavTabs';
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

type UiMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  meta?: string;
  streaming?: boolean;
};

const RANGE_OPTIONS: Array<{ value: RangeCode; label: string }> = [
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' },
  { value: '90d', label: '90 天' },
  { value: 'all', label: '全部' },
];

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'publish', label: '发布时间' },
  { value: 'read', label: '阅读数' },
  { value: 'finish', label: '完读率' },
  { value: 'duration', label: '阅读时长' },
  { value: 'like', label: '点赞' },
  { value: 'share', label: '分享' },
  { value: 'wow', label: '在看' },
  { value: 'comment', label: '评论' },
  { value: 'follow', label: '关注' },
  { value: 'recommend', label: '推荐率' },
];

const VIEW_OPTIONS: Array<{ value: ViewMode; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'top5', label: '前 5' },
  { value: 'low3', label: '后 3' },
];

const MODEL_OPTIONS = [
  { code: 'qwen', name: 'Qwen', price: 'CNY 2 / M tok' },
  { code: 'doubao', name: 'Doubao', price: 'CNY 3 / M tok' },
  { code: 'claude', name: 'Claude', price: 'CNY 15 / M tok' },
  { code: 'gpt', name: 'GPT', price: 'CNY 10 / M tok' },
];

const CHAT_SESSION_KEY = 'gzh_chat_session_id';
const PAGE_SIZE = 20;

function createSessionId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `sess-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function fmtNum(v?: number | null) { return (v ?? 0).toLocaleString('zh-CN'); }
function fmtMoneyCent(v?: number | null) { return `CNY ${((v ?? 0) / 100).toFixed(2)}`; }
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
  const raw = v ?? 0;
  const p = Math.abs(raw) <= 1 ? raw * 100 : raw;
  return `${p.toFixed(d)}%`;
}
function fmtDuration(sec?: number | null) {
  const s = sec ?? 0;
  if (s <= 0) return '--';
  const m = Math.floor(s / 60);
  return `${m}m${String(s % 60).padStart(2, '0')}s`;
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
  if (key === 'finish') return Math.abs(article.completionRate || 0) <= 1 ? (article.completionRate || 0) * 100 : (article.completionRate || 0);
  if (key === 'duration') return article.avgReadTimeSec || 0;
  if (key === 'like') return article.likeCount || 0;
  if (key === 'share') return article.shareCount || 0;
  if (key === 'wow') return article.wowCount || 0;
  if (key === 'comment') return article.commentCount || 0;
  if (key === 'follow') return article.newFollowers || 0;
  return recommendRateByArticle(article);
}
function metricText(article: WorkspaceArticleCard, key: SortKey) {
  if (key === 'publish') return `发布时间 ${fmtDateShort(article.publishTime)}`;
  if (key === 'read') return `阅读 ${fmtNum(article.readCount)}`;
  if (key === 'finish') return `完读率 ${fmtPercent(article.completionRate, 0)}`;
  if (key === 'duration') return `时长 ${fmtDuration(article.avgReadTimeSec)}`;
  if (key === 'recommend') return `推荐率 ${fmtPercent(recommendRateByArticle(article), 0)}`;
  return '';
}
function mapHistory(msg: ChatMessage): UiMessage {
  const tok = (msg.inputTokens || 0) + (msg.outputTokens || 0);
  return {
    id: `h-${msg.id}`,
    role: msg.role === 'assistant' ? 'assistant' : 'user',
    content: msg.content,
    meta: msg.role === 'assistant'
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
  const [visibleCount, setVisibleCount] = useState(6);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

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
  const [exportStage, setExportStage] = useState<ExportStage>('idle');

  const chatRef = useRef<HTMLDivElement | null>(null);
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

  const shownArticles = useMemo(() => (viewMode === 'all' ? viewArticles.slice(0, visibleCount) : viewArticles), [viewMode, viewArticles, visibleCount]);
  const canLoadMore = viewMode === 'all' && (shownArticles.length < totalArticles || Boolean(articlesQuery.hasNextPage));

  const header = overview?.header;
  const metrics = overview?.dataPanel.metrics;
  const changes = overview?.dataPanel.changes;
  const recommendRate = recommendRateFromSummary(overview?.dataPanel.trafficSummary ?? {});
  const analysisPanel = overview?.analysisPanel;
  const analysisSummary = analysisPanel?.summary || '暂无分析总结。';
  const analysisText = analysisGenerating ? analysisLive : (analysisDetail?.content || analysisPanel?.content || analysisSummary);
  const currentModelCode = header?.aiModel || profile?.aiModel || 'qwen';
  const currentModelName = MODEL_OPTIONS.find((x) => x.code === currentModelCode)?.name || currentModelCode;

  const quickPrompts = useMemo(() => {
    const list = [
      ...(overview?.quickQuestions ?? []),
      ...(analysisPanel?.suggestedQuestions ?? []),
      ...(analysisDetail?.suggestedQuestions ?? []),
      '下周写什么？请给 3 个选题和 KPI 检查点。',
      '如何提升分享率？请给标题/结构/CTA 的具体动作。',
      '对比本周与上周，并调整优先级。',
    ].filter((x) => x && x.trim());
    return Array.from(new Set(list)).slice(0, 5);
  }, [overview?.quickQuestions, analysisPanel?.suggestedQuestions, analysisDetail?.suggestedQuestions]);

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

  const loadMore = async () => {
    if (!canLoadMore) return;
    setVisibleCount((prev) => prev + 4);
    if (articlesQuery.hasNextPage) await articlesQuery.fetchNextPage();
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
    setChatMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', content: text, meta: '刚刚' }, { id: aiId, role: 'assistant', content: '', meta: '生成中...', streaming: true }]);
    setChatStreaming(true);

    chatAbortRef.current = ChatApi.send(
      { message: text, sessionId, reportId: analysisDetail?.id ?? analysisPanel?.reportId, range },
      (chunk) => setChatMessages((prev) => prev.map((m) => (m.id === aiId ? { ...m, content: `${m.content}${chunk}` } : m))),
      (event: ChatDoneEvent) => {
        chatAbortRef.current = null;
        setChatStreaming(false);
        setChatDoneMeta(`消耗 ${fmtMoneyCent(event.costCent)} | ${(event.inputTokens + event.outputTokens).toLocaleString('zh-CN')} tok`);
        setChatMessages((prev) => prev.map((m) => (m.id === aiId ? { ...m, streaming: false, meta: `${event.aiModel || 'AI'} | 刚刚` } : m)));
        if (event.sessionId && event.sessionId !== sessionId) {
          localStorage.setItem(CHAT_SESSION_KEY, event.sessionId);
          setSessionId(event.sessionId);
        }
      },
      (error: Error) => {
        chatAbortRef.current = null;
        setChatStreaming(false);
        setChatError(error.message || '对话失败。');
        setChatMessages((prev) => prev.map((m) => (m.id === aiId ? { ...m, streaming: false, content: m.content || '生成失败，请重试。', meta: '失败' } : m)));
      }
    );
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
        setChatDoneMeta(`分析完成。tok ${(event.inputTokens + event.outputTokens).toLocaleString('zh-CN')}，消耗 ${fmtMoneyCent(event.costCent)}`);
        void AnalysisApi.detail(event.reportId).then(setAnalysisDetail).catch(() => setAnalysisError('分析详情加载失败。'));
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
    exportTimersRef.current.forEach((t) => window.clearTimeout(t));
    setExportStage('queue');
    exportTimersRef.current = [
      window.setTimeout(() => setExportStage('running'), 700),
      window.setTimeout(() => setExportStage('done'), 2100),
    ];
  };

  const downloadExport = () => {
    const lines = [
      '# 周复盘',
      '',
      `生成时间：${fmtDateTime(new Date())}`,
      `周期：${range}`,
      `总阅读：${fmtNum(metrics?.totalRead)}`,
      `完读率：${fmtPercent(metrics?.completionRate, 0)}`,
      `推荐率：${fmtPercent(recommendRate, 1)}`,
      '',
      analysisText || '暂无',
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

  if (overviewQuery.isLoading && !overview) return <Loading />;
  if (overviewQuery.error) return <ErrorState message={(overviewQuery.error as Error).message || '加载工作台失败'} />;

  return (
    <div className="workspace-page">
      <div className="workspace-shell">
        <div className="app-topbar">
          <a className="brand" href={RoutePath.ROOT} onClick={(e) => { e.preventDefault(); navigate(RoutePath.ROOT); }}>
            <img className="brand-icon" src="/site-icon-64.png" alt="内容运营助手" />
            <div className="brand-name">内容运营助手</div>
          </a>
          <MainNavTabs />
          <span className="app-topbar-account">{header?.accountName || '运营账号'}</span>
          <div className="topbar-right">
            <div className="model-chip">模型：{currentModelName}<div className="model-dropdown">{MODEL_OPTIONS.map((m) => <button key={m.code} type="button" className={`model-opt${m.code === currentModelCode ? ' active' : ''}`} onClick={() => changeModel(m.code)}><span>{m.name}</span><span className="model-opt-price">{m.price}</span></button>)}</div></div>
            <button className="btn btn-outline btn-xs" type="button" onClick={() => void syncWorkspace()} disabled={syncing}>{syncing ? '同步中...' : '同步'}</button>
            <button className="balance-chip" type="button" onClick={() => navigate(RoutePath.PROFILE)}>{fmtMoneyCent((header?.balanceCent || 0) + (header?.freeQuotaCent || 0))}</button>
          </div>
        </div>

        <div className="workspace-body">
          <div className="ctx">
            <div className="ctx-scroll">
              <div className="ctx-sec">
                <div className="ctx-head"><div className="ctx-head-left"><span className="ctx-head-title">数据总览</span></div><div className="time-tabs">{RANGE_OPTIONS.map((r) => <button key={r.value} type="button" className={`time-tab${range === r.value ? ' active' : ''}`} onClick={() => setRange(r.value)}>{r.label}</button>)}</div></div>
                <div className="ctx-body">
                  <div className="kpi-lite-row">
                    <div className="kpi-lite-item"><span>总阅读</span><b>{fmtNum(metrics?.totalRead)}</b></div>
                    <div className="kpi-lite-item"><span>完读率</span><b>{fmtPercent(metrics?.completionRate, 0)}</b></div>
                    <div className="kpi-lite-item"><span>推荐率</span><b>{fmtPercent(recommendRate, 1)}</b></div>
                  </div>
                  <div className="risk-alert">{recommendRate < 15 ? '风险：推荐率低于目标区间，优先稳住分发信号。' : '状态良好：推荐率在目标区间，保持节奏。'}</div>
                </div>
              </div>

              <div className="ctx-sec ctx-sec-analysis">
                <div className="ctx-head"><div className="ctx-head-left"><span className="ctx-head-title">分析结论</span></div><span className="ctx-head-time">{analysisPanel?.createdAt ? fmtDateTime(analysisPanel.createdAt) : 'N/A'}</span></div>
                <div className="ctx-analysis">
                  <div className="analysis-stage">阶段判断：{analysisSummary}</div>
                  <div className="ctx-sec-title">本周动作</div>
                  {(analysisPanel?.actionSuggestions?.length ? analysisPanel.actionSuggestions : ['保持每周节奏，并用 KPI 验证效果。']).slice(0, 3).map((x, idx) => <div key={`${x}-${idx}`} className="suggestion"><div className="sug-num">{idx + 1}</div><div className="sug-text">{x}</div></div>)}
                  {analysisText ? <pre className="analysis-content pre-wrap">{analysisText}</pre> : null}
                </div>
                <div className="ctx-footer"><div className="ctx-footer-meta">范围 {range} | {currentModelName}</div><button className="btn btn-ghost btn-xs" type="button" onClick={regenerateAnalysis} disabled={analysisGenerating}>{analysisGenerating ? '生成中...' : '重新生成'}</button></div>
                {analysisError ? <div className="error-tip" style={{ padding: '0 12px 10px' }}>{analysisError}</div> : null}
              </div>
            </div>
          </div>

          <div className="chat-wrap">
            <div className="chat-msgs" ref={chatRef}>
              {historyQuery.isLoading && chatMessages.length === 0 ? <div className="msg"><div className="msg-av ai">AI</div><div className="bubble ai">加载历史对话中...</div></div> : null}
              {chatMessages.map((m) => <div key={m.id} className={`msg${m.role === 'user' ? ' user' : ''}`}><div className={`msg-av ${m.role === 'user' ? 'user' : 'ai'}`}>{m.role === 'user' ? 'U' : 'AI'}</div><div><div className={`bubble ${m.role === 'user' ? 'user' : 'ai'}`}>{m.content ? <pre className="pre-wrap">{m.content}</pre> : '...'}</div>{m.meta ? <div className="msg-meta">{m.meta}</div> : null}</div></div>)}
            </div>
            <div className="chat-bottom">
              <div className="chat-quick-strip">{quickPrompts.map((p) => <button key={p} className="chat-quick-btn" type="button" onClick={() => sendPrompt(p)}>{p}</button>)}</div>
              <div className="input-row">
                <textarea className="chat-input" placeholder="请输入关于账号运营的问题..." value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (chatStreaming) stopChat(); else { const t = chatInput.trim(); if (t) { setChatInput(''); sendPrompt(t); } } } }} />
                <button className="send-btn" type="button" onClick={() => { if (chatStreaming) stopChat(); else { const t = chatInput.trim(); if (t) { setChatInput(''); sendPrompt(t); } } }}>{chatStreaming ? '停止' : '发送'}</button>
              </div>
              {chatDoneMeta ? <div className="chat-done">{chatDoneMeta}</div> : null}
              {chatError ? <div className="error-tip">{chatError}</div> : null}
            </div>
          </div>
        </div>
      </div>

      <div className={`overlay${drawerOpen ? ' open' : ''}`} onClick={() => setDrawerOpen(false)} />
      <div className={`drawer${drawerOpen ? ' open' : ''}`}>
        <div className="drawer-head"><div className="drawer-head-main"><div className="drawer-head-title">文章列表</div><div className="drawer-head-sub"><span>总计 {totalArticles}</span><span>更新 {fmtDateTime(header?.lastSyncAt)}</span></div></div><div className="drawer-head-actions"><button className="btn btn-ghost btn-xs drawer-export-btn" type="button" onClick={() => { setExportOpen(true); setExportStage('idle'); }}>导出周复盘</button><button className="drawer-close" type="button" onClick={() => setDrawerOpen(false)}>x</button></div></div>
        <div className="drawer-body">
          <div className="article-filter article-filter-gap"><div className="article-filter-head"><div className="drawer-block-head green article-list-head-tag">排序</div><div className="filter-metrics">{SORT_OPTIONS.map((s) => <button key={s.value} type="button" className={`filter-chip${sortKey === s.value ? ' active' : ''}`} onClick={() => setSortKey(s.value)}>{s.label}</button>)}</div></div><div className="filter-views">{VIEW_OPTIONS.map((v) => <button key={v.value} type="button" className={`view-chip${viewMode === v.value ? ' active' : ''}`} onClick={() => { setViewMode(v.value); if (v.value === 'all') setVisibleCount(6); }}>{v.label}</button>)}</div></div>
          {shownArticles.map((a) => <div key={a.id} className="art-row"><div className="art-top"><div className="art-top-main"><div className="art-title">{a.title}</div></div><div className="art-date">{fmtDateShort(a.publishTime)}</div></div><div className="art-stats primary"><div className="art-stat">阅读 <b>{fmtNum(a.readCount)}</b></div><div className="art-stat">完读率 <b>{fmtPercent(a.completionRate, 0)}</b></div><div className="art-stat">推荐率 <b>{fmtPercent(recommendRateByArticle(a), 0)}</b></div></div><div className="art-insight">洞察：{metricText(a, sortKey)}</div></div>)}
          <div className="load-status">已加载 {shownArticles.length}/{totalArticles}</div>
          <button className={`more-link drawer-load-more${!canLoadMore ? ' is-disabled' : ''}`} type="button" onClick={() => void loadMore()} disabled={!canLoadMore}>{canLoadMore ? '加载更多' : '已全部加载'}</button>
        </div>
      </div>

      <div className={`export-modal-overlay${exportOpen ? ' open' : ''}`} onClick={(e) => e.target === e.currentTarget && setExportOpen(false)}>
        <div className="export-modal" onClick={(e) => e.stopPropagation()}>
          <div className="export-modal-head"><div><div className="export-modal-title">导出周复盘</div><div className="export-modal-sub">任务排队生成，完成后可下载。</div></div><button className="export-modal-close" type="button" onClick={() => setExportOpen(false)}>x</button></div>
          <div className="export-modal-body">
            <div className="export-section"><div className="export-section-title">格式</div><div className="export-format-row"><button className={`export-format-chip${exportFormat === 'pdf' ? ' active' : ''}`} type="button" onClick={() => setExportFormat('pdf')}>PDF</button><button className={`export-format-chip${exportFormat === 'image' ? ' active' : ''}`} type="button" onClick={() => setExportFormat('image')}>图片</button><button className={`export-format-chip${exportFormat === 'md' ? ' active' : ''}`} type="button" onClick={() => setExportFormat('md')}>Markdown</button></div></div>
            <div className="export-task"><div className="export-task-state">{exportStage === 'idle' ? '未开始' : exportStage === 'queue' ? '排队中' : exportStage === 'running' ? '执行中' : exportStage === 'done' ? '已完成，可下载' : '已下载'}</div><div className="export-task-progress"><span style={{ width: exportStage === 'idle' ? '0%' : exportStage === 'queue' ? '25%' : exportStage === 'running' ? '65%' : '100%' }} /></div></div>
          </div>
          <div className="export-modal-foot"><button className="btn btn-ghost btn-sm" type="button" onClick={() => setExportOpen(false)}>关闭</button><button className="btn btn-primary btn-sm" type="button" onClick={generateExport} disabled={exportStage === 'queue' || exportStage === 'running'}>{exportStage === 'queue' || exportStage === 'running' ? '执行中...' : (exportStage === 'done' || exportStage === 'downloaded' ? '重新生成' : '生成')}</button>{(exportStage === 'done' || exportStage === 'downloaded') ? <button className="btn btn-outline btn-sm" type="button" onClick={downloadExport}>下载</button> : null}</div>
        </div>
      </div>
    </div>
  );
}
