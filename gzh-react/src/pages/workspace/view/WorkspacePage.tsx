import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { RoutePath } from '../../../common/router/RoutePath';
import MainNavTabs from '../../../common/ui/MainNavTabs';
import type { ChatDoneEvent, ChatMessage } from '../../chat/model/ChatModels';
import ChatApi from '../../chat/api/ChatApi';
import type { AnalysisDoneEvent } from '../../analysis/model/AnalysisModels';
import AnalysisApi from '../../analysis/api/AnalysisApi';
import SettingsApi from '../../settings/api/SettingsApi';
import WorkspaceApi from '../api/WorkspaceApi';

const modelOptions = [
  { code: 'qwen', label: '千问', price: '¥2/百万tok' },
  { code: 'doubao', label: '豆包', price: '¥3/百万tok' },
  { code: 'claude', label: 'Claude', price: '¥15/百万tok' },
  { code: 'gpt', label: 'GPT', price: '¥10/百万tok' },
];

function formatDateTime(value?: string) {
  if (!value) {
    return '--';
  }
  return value.replace('T', ' ').slice(0, 16);
}

function formatDate(value?: string) {
  if (!value) {
    return '--';
  }
  return value.replace('T', ' ').slice(5, 10);
}

function percentText(value: number) {
  const abs = Math.abs(value).toFixed(0);
  if (value > 0) {
    return `↑ ${abs}%`;
  }
  if (value < 0) {
    return `↓ ${abs}%`;
  }
  return '0%';
}

function renderTraffic(items: Record<string, number>) {
  return Object.entries(items).sort((a, b) => b[1] - a[1]);
}

export default function WorkspacePage() {
  const navigate = useNavigate();
  const [range, setRange] = useState('30d');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [sessionId, setSessionId] = useState('');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatDone, setChatDone] = useState<ChatDoneEvent | null>(null);
  const streamTextRef = useRef('');
  const chatAbortRef = useRef<AbortController | null>(null);

  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const analysisAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      chatAbortRef.current?.abort();
      analysisAbortRef.current?.abort();
    };
  }, []);

  const overviewQuery = useQuery({
    queryKey: ['workspace-overview', range],
    queryFn: () => WorkspaceApi.overview(range),
  });

  const updateModelMutation = useMutation({
    mutationFn: async (model: string) => SettingsApi.updateModel(model),
    onSuccess: () => {
      void overviewQuery.refetch();
    },
  });

  const overview = overviewQuery.data;
  const analysisPanel = overview?.analysisPanel;
  const reportId = analysisPanel?.reportId;

  const drawerStats = useMemo(() => {
    const articles = overview?.articles ?? [];
    return articles.reduce(
      (acc, item) => {
        acc.totalRead += item.readCount ?? 0;
        acc.totalSend += item.sendCount ?? 0;
        acc.totalShare += item.shareCount ?? 0;
        acc.totalLike += item.likeCount ?? 0;
        acc.totalWow += item.wowCount ?? 0;
        acc.totalComment += item.commentCount ?? 0;
        acc.totalSave += item.saveCount ?? 0;
        acc.totalFollow += item.newFollowers ?? 0;
        acc.completion += Number(item.completionRate ?? 0);
        return acc;
      },
      {
        totalRead: 0,
        totalSend: 0,
        totalShare: 0,
        totalLike: 0,
        totalWow: 0,
        totalComment: 0,
        totalSave: 0,
        totalFollow: 0,
        completion: 0,
      }
    );
  }, [overview?.articles]);

  const avgCompletion = useMemo(() => {
    const size = overview?.articles.length || 1;
    return (drawerStats.completion / size).toFixed(0);
  }, [drawerStats.completion, overview?.articles.length]);

  const onSend = () => {
    const message = input.trim();
    if (!message || !overview) {
      return;
    }
    setChatError(null);
    setStreaming(true);
    setStreamText('');
    streamTextRef.current = '';
    setChatDone(null);

    const userMessage: ChatMessage = {
      id: Date.now(),
      sessionId: sessionId || 'pending',
      reportId: reportId ?? null,
      role: 'user',
      content: message,
      aiModel: '',
      inputTokens: 0,
      outputTokens: 0,
      costCent: 0,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);

    chatAbortRef.current = ChatApi.send(
      { message, sessionId: sessionId || undefined, reportId, range },
      (chunk) => {
        streamTextRef.current += chunk;
        setStreamText((prev) => prev + chunk);
      },
      (done) => {
        setStreaming(false);
        setChatDone(done);
        setSessionId(done.sessionId);
        setInput('');
        const assistant: ChatMessage = {
          id: Date.now() + 1,
          sessionId: done.sessionId,
          reportId: reportId ?? null,
          role: 'assistant',
          content: streamTextRef.current,
          aiModel: done.aiModel,
          inputTokens: done.inputTokens,
          outputTokens: done.outputTokens,
          costCent: done.costCent,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistant]);
      },
      (error) => {
        setStreaming(false);
        setChatError(error.message || '对话失败，请稍后重试');
      }
    );
  };

  const onStopChat = () => {
    chatAbortRef.current?.abort();
    setStreaming(false);
  };

  const onRegenerateAnalysis = () => {
    setAnalysisError(null);
    setAnalysisRunning(true);
    analysisAbortRef.current = AnalysisApi.generate(
      range,
      () => undefined,
      (_done: AnalysisDoneEvent) => {
        setAnalysisRunning(false);
        void overviewQuery.refetch();
      },
      (error) => {
        setAnalysisRunning(false);
        setAnalysisError(error.message || '分析失败，请稍后重试');
      }
    );
  };

  const activeModel = modelOptions.find((item) => item.code === overview?.header.aiModel) ?? modelOptions[0];

  if (overviewQuery.isPending) {
    return <div className="loading-state">Loading...</div>;
  }

  if (overviewQuery.error) {
    return <div className="error-state">{overviewQuery.error.message}</div>;
  }

  return (
    <div className="workspace-page">
      <div className="app-topbar">
        <a className="brand" href="#" onClick={(event) => event.preventDefault()}>
          <img className="brand-icon" src="/site-icon-64.png" alt="公众号助手" />
          <div className="brand-name">公众号助手</div>
        </a>
        <MainNavTabs />

        <div className="topbar-right">
          <div className="model-chip">
            <span>{activeModel.label}</span>
            <div className="model-dropdown">
              {modelOptions.map((item) => (
                <button
                  key={item.code}
                  type="button"
                  className={`model-opt${item.code === activeModel.code ? ' active' : ''}`}
                  onClick={() => updateModelMutation.mutate(item.code)}
                  disabled={updateModelMutation.isPending}
                >
                  <span>{item.label}</span>
                  <span className="model-opt-price">{item.price}</span>
                </button>
              ))}
            </div>
          </div>
          <span className="sync-meta">上次同步 {formatDateTime(overview?.header.lastSyncAt)} · {overview?.header.articleCount ?? 0} 篇</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => void overviewQuery.refetch()}>同步</button>
          <button type="button" className="balance-chip" onClick={() => navigate(RoutePath.PROFILE)}>¥{(((overview?.header.balanceCent ?? 0) + (overview?.header.freeQuotaCent ?? 0)) / 100).toFixed(2)}</button>
          <button type="button" className="avatar-btn" onClick={() => navigate(RoutePath.PROFILE)}>我</button>
        </div>
      </div>

      <div className="workspace-body">
        <div className="ctx">
          <div className="ctx-sec">
            <div className="ctx-head">
              <div className="ctx-head-left">
                <span className="ctx-head-icon">📊</span>
                <span className="ctx-head-title">数据</span>
              </div>
              <div className="time-tabs">
                <button type="button" className={`time-tab${range === '7d' ? ' active' : ''}`} onClick={() => setRange('7d')}>7天</button>
                <button type="button" className={`time-tab${range === '30d' ? ' active' : ''}`} onClick={() => setRange('30d')}>30天</button>
              </div>
            </div>

            <div className="ctx-body">
              <div className="stat-grid-3x2">
                <div className="stat-cell">
                  <div className="stat-cell-label">总阅读</div>
                  <div className="stat-cell-val">{overview?.dataPanel.metrics.totalRead ?? 0}</div>
                  <div className={`stat-cell-delta ${(overview?.dataPanel.changes.totalRead ?? 0) >= 0 ? 'up' : 'down'}`}>{percentText(overview?.dataPanel.changes.totalRead ?? 0)}</div>
                </div>
                <div className="stat-cell">
                  <div className="stat-cell-label">篇均阅读</div>
                  <div className="stat-cell-val">{overview?.dataPanel.metrics.avgRead ?? 0}</div>
                  <div className={`stat-cell-delta ${(overview?.dataPanel.changes.avgRead ?? 0) >= 0 ? 'up' : 'down'}`}>{percentText(overview?.dataPanel.changes.avgRead ?? 0)}</div>
                </div>
                <div className="stat-cell">
                  <div className="stat-cell-label">完读率</div>
                  <div className="stat-cell-val">{Math.round(overview?.dataPanel.metrics.completionRate ?? 0)}%</div>
                  <div className={`stat-cell-delta ${(overview?.dataPanel.changes.completionRate ?? 0) >= 0 ? 'up' : 'down'}`}>{percentText(overview?.dataPanel.changes.completionRate ?? 0)}</div>
                </div>
                <div className="stat-cell">
                  <div className="stat-cell-label">总分享</div>
                  <div className="stat-cell-val">{overview?.dataPanel.metrics.totalShare ?? 0}</div>
                  <div className={`stat-cell-delta ${(overview?.dataPanel.changes.totalShare ?? 0) >= 0 ? 'up' : 'down'}`}>{percentText(overview?.dataPanel.changes.totalShare ?? 0)}</div>
                </div>
                <div className="stat-cell">
                  <div className="stat-cell-label">总点赞</div>
                  <div className="stat-cell-val">{overview?.dataPanel.metrics.totalLike ?? 0}</div>
                  <div className={`stat-cell-delta ${(overview?.dataPanel.changes.totalLike ?? 0) >= 0 ? 'up' : 'down'}`}>{percentText(overview?.dataPanel.changes.totalLike ?? 0)}</div>
                </div>
                <div className="stat-cell">
                  <div className="stat-cell-label">新增关注</div>
                  <div className="stat-cell-val">{overview?.dataPanel.metrics.newFollowers ?? 0}</div>
                  <div className={`stat-cell-delta ${(overview?.dataPanel.changes.newFollowers ?? 0) >= 0 ? 'up' : 'down'}`}>{percentText(overview?.dataPanel.changes.newFollowers ?? 0)}</div>
                </div>
              </div>

              <div className="mini-trend">
                <div className="mini-trend-label">阅读趋势（近 30 天）</div>
                <svg className="sparkline" viewBox="0 0 240 40" preserveAspectRatio="none">
                  <polyline
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={(overview?.dataPanel.trend ?? []).map((item, index) => `${index * 30},${40 - Math.max(2, Math.min(38, item.readCount / 5))}`).join(' ')}
                  />
                </svg>
              </div>

              <button type="button" className="detail-link" onClick={() => setDrawerOpen(true)}>查看全部指标与文章详情 →</button>
            </div>
          </div>

          <div className="ctx-sec ctx-analysis-wrap">
            <div className="ctx-head">
              <div className="ctx-head-left">
                <span className="ctx-head-icon">📋</span>
                <span className="ctx-head-title">分析</span>
              </div>
              <span className="ctx-head-time">{analysisPanel?.createdAt ? `${formatDateTime(analysisPanel.createdAt)} 生成` : '暂无报告'}</span>
            </div>

            <div className="ctx-analysis">
              <div className="analysis-stage">{analysisPanel?.summary || '暂无分析摘要'}</div>
              <div className="ctx-sec-title">本周建议</div>
              {(analysisPanel?.actionSuggestions ?? []).map((item, index) => (
                <div key={`${item}-${index}`} className="suggestion">
                  <div className="sug-num">{index + 1}</div>
                  <div className="sug-text">{item}</div>
                </div>
              ))}
              {analysisError ? <div className="error-tip">{analysisError}</div> : null}
            </div>

            <div className="ctx-footer">
              <div className="ctx-footer-meta">{analysisPanel?.rangeCode ?? range} · <b>≈¥{((analysisPanel?.costCent ?? 0) / 100).toFixed(2)}</b></div>
              <button type="button" className="btn btn-ghost btn-xs" disabled={analysisRunning} onClick={onRegenerateAnalysis}>
                {analysisRunning ? '生成中...' : '重新生成'}
              </button>
            </div>
          </div>
        </div>

        <div className="chat-wrap">
          <div className="chat-msgs">
            {analysisPanel?.reportId ? (
              <div className="msg">
                <div className="msg-av ai">🤖</div>
                <div>
                  <div className="analysis-msg">
                    <div className="am-head">
                      <div className="am-head-title">
                        已分析你 {analysisPanel.rangeCode} 的数据
                        <span className="am-chip">{analysisPanel.aiModel} · {(analysisPanel.inputTokens ?? 0) + (analysisPanel.outputTokens ?? 0)} tok</span>
                      </div>
                    </div>
                    <div className="am-body pre-wrap">{analysisPanel.content}</div>
                  </div>
                  <div className="msg-meta">{formatDateTime(analysisPanel.createdAt)}</div>
                </div>
              </div>
            ) : null}

            {messages.map((message) => (
              <div key={`${message.id}-${message.createdAt}`} className={`msg ${message.role === 'user' ? 'user' : ''}`}>
                <div className={`msg-av ${message.role === 'user' ? 'user' : 'ai'}`}>{message.role === 'user' ? '我' : '🤖'}</div>
                <div>
                  <div className={`bubble ${message.role === 'user' ? 'user' : 'ai'} pre-wrap`}>{message.content}</div>
                  {message.role === 'assistant' ? (
                    <div className="msg-meta">{message.aiModel} · {message.inputTokens + message.outputTokens} tok · ¥{(message.costCent / 100).toFixed(2)}</div>
                  ) : null}
                </div>
              </div>
            ))}

            {streaming ? (
              <div className="msg">
                <div className="msg-av ai">🤖</div>
                <div>
                  <div className="bubble ai pre-wrap">{streamText || '思考中...'}</div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="chat-bottom">
            <div className="shortcut-row">
              {(overview?.quickQuestions ?? []).map((question) => (
                <button key={question} type="button" className="chip" onClick={() => setInput(question)}>{question}</button>
              ))}
            </div>

            <div className="input-row">
              <textarea className="chat-input" placeholder="问我关于你账号的任何问题..." value={input} onChange={(event) => setInput(event.target.value)} />
              <button type="button" className="send-btn" onClick={onSend} disabled={streaming}>发送</button>
              <button type="button" className="btn btn-ghost btn-xs" onClick={onStopChat} disabled={!streaming}>停止</button>
            </div>

            {chatError ? <div className="error-tip">{chatError}</div> : null}
            {chatDone ? <div className="chat-done">本轮消耗 {chatDone.inputTokens + chatDone.outputTokens} tok · ¥{(chatDone.costCent / 100).toFixed(2)}</div> : null}
          </div>
        </div>
      </div>

      <div className={`overlay${drawerOpen ? ' open' : ''}`} onClick={() => setDrawerOpen(false)} />
      <div className={`drawer${drawerOpen ? ' open' : ''}`}>
        <div className="drawer-head">
          <div>
            <div className="drawer-head-title">文章数据 · {range}</div>
            <div className="drawer-head-sub">{overview?.articles.length ?? 0} 篇 · 上次同步 {formatDateTime(overview?.header.lastSyncAt)}</div>
          </div>
          <button type="button" className="drawer-close" onClick={() => setDrawerOpen(false)}>✕</button>
        </div>

        <div className="drawer-body">
          <div className="drawer-stat-grid">
            <div className="dstat"><div className="dstat-label">总阅读</div><div className="dstat-val">{drawerStats.totalRead}</div></div>
            <div className="dstat"><div className="dstat-label">篇均阅读</div><div className="dstat-val">{overview?.articles.length ? Math.round(drawerStats.totalRead / overview.articles.length) : 0}</div></div>
            <div className="dstat"><div className="dstat-label">完读率</div><div className="dstat-val">{avgCompletion}%</div></div>
            <div className="dstat"><div className="dstat-label">新增关注</div><div className="dstat-val">{drawerStats.totalFollow}</div></div>
            <div className="dstat"><div className="dstat-label">总分享</div><div className="dstat-val">{drawerStats.totalShare}</div></div>
            <div className="dstat"><div className="dstat-label">总点赞</div><div className="dstat-val">{drawerStats.totalLike}</div></div>
            <div className="dstat"><div className="dstat-label">总在看</div><div className="dstat-val">{drawerStats.totalWow}</div></div>
            <div className="dstat"><div className="dstat-label">总留言</div><div className="dstat-val">{drawerStats.totalComment}</div></div>
          </div>

          <div className="drawer-section-title">流量来源</div>
          <div className="src-labels">
            {renderTraffic(overview?.dataPanel.trafficSummary ?? {}).map(([name, ratio]) => (
              <div key={name} className="src-label">{name} {ratio}%</div>
            ))}
          </div>

          <div className="drawer-section-title">文章列表</div>
          {(overview?.articles ?? []).map((article) => (
            <div key={article.id} className="art-row">
              <div className="art-top">
                <div className="art-title">{article.title}</div>
                <div className="art-date">{formatDate(article.publishTime)}</div>
              </div>
              <div className="art-stats">
                <div className="art-stat">阅读 <b>{article.readCount}</b></div>
                <div className="art-stat">分享 <b>{article.shareCount}</b></div>
                <div className="art-stat">点赞 <b>{article.likeCount}</b></div>
                <div className="art-stat">在看 <b>{article.wowCount}</b></div>
                <div className="art-stat">留言 <b>{article.commentCount}</b></div>
                <div className="art-stat">完读 <b>{Math.round(Number(article.completionRate ?? 0))}%</b></div>
              </div>
              <div className="src-labels compact">
                {renderTraffic(article.trafficSources ?? {}).slice(0, 3).map(([source, ratio]) => (
                  <div key={`${article.id}-${source}`} className="src-label">{source} {ratio}%</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
