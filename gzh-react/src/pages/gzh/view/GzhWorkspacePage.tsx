import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { RoutePath } from '../../../common/router/RoutePath';
import { useAuthStore } from '../../../common/state/authStore';
import AnalysisApi from '../../analysis/api/AnalysisApi';
import type { AnalysisDoneEvent, AnalysisReport } from '../../analysis/model/AnalysisModels';
import ChatApi from '../../chat/api/ChatApi';
import type { ChatDoneEvent, ChatMessage } from '../../chat/model/ChatModels';
import SettingsApi from '../../settings/api/SettingsApi';
import WorkspaceApi from '../../workspace/api/WorkspaceApi';
import './GzhPages.css';

type RangeCode = '7d' | '30d' | '90d' | 'all';

type UiMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  meta?: string;
  streaming?: boolean;
};

const RANGE_OPTIONS: Array<{ value: RangeCode; label: string }> = [
  { value: '7d', label: '7天' },
  { value: '30d', label: '30天' },
  { value: '90d', label: '90天' },
  { value: 'all', label: '全部' },
];

const MODEL_OPTIONS = [
  { code: 'qwen_3_5', name: '千问 3.5-Flash', desc: '速度更快，适合日常分析' },
  { code: 'qwen_3_6', name: '千问 3.6-Plus', desc: '推理更强，适合深度建议' },
];

const DEFAULT_QUICK_PROMPTS = [
  '哪些内容主题最该加码？',
  '下周先优化哪一项指标？',
  '哪篇文章最值得复盘？',
  '怎么提升推荐率和完读率？',
  '本周三件事怎么排优先级？',
  '怎么降低数据下滑风险？',
];

function createSessionId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `sess-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function toPercentValue(v?: number | null) {
  const raw = v ?? 0;
  return Math.abs(raw) <= 1 ? raw * 100 : raw;
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

function fmtDateShort(v?: string | Date) {
  if (!v) return '--';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '--';
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtMoneyCent(v?: number | null) {
  return `¥${((v ?? 0) / 100).toFixed(2)}`;
}

function fmtPercent(v?: number | null, digits = 1) {
  return `${toPercentValue(v).toFixed(digits)}%`;
}

function calcRateByRead(count?: number | null, readCount?: number | null) {
  const numerator = Number(count ?? 0);
  const denominator = Number(readCount ?? 0);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return (numerator * 100) / denominator;
}

function fmtDeltaPercent(v?: number | null, digits = 0) {
  const n = toPercentValue(v);
  const arrow = n >= 0 ? '↑' : '↓';
  return `${arrow} ${Math.abs(n).toFixed(digits)}%`;
}

function fmtDuration(sec?: number | null) {
  const s = Math.max(0, Math.floor(sec ?? 0));
  const m = Math.floor(s / 60);
  const remain = s % 60;
  return `${m}分${String(remain).padStart(2, '0')}秒`;
}

function recommendRateFromSummary(summary: Record<string, number>) {
  const entries = Object.entries(summary || {}).filter(([, v]) => Number(v) > 0);
  if (entries.length === 0) return 0;

  let explicitRate: number | null = null;
  let recommendCount = 0;
  let total = 0;

  for (const [k, raw] of entries) {
    const value = Number(raw) || 0;
    const lower = k.toLowerCase();
    const isRecommend = k.includes('\u63a8\u8350') || lower.includes('recommend');
    const isRateKey = k.includes('\u7387') || lower.includes('rate');

    total += value;
    if (isRecommend) {
      recommendCount += value;
      if (isRateKey) {
        explicitRate = Math.abs(value) <= 1 ? value * 100 : value;
      }
    }
  }

  if (explicitRate !== null) return explicitRate;
  if (total <= 0) return 0;
  return (recommendCount * 100) / total;
}

function normalizeSignalRateText(text: string) {
  if (!text || !text.trim()) {
    return text;
  }
  return text.replace(
    /((?:率|转化|占比|比例|留存|完读|点击|打开|推荐|关注|互动)[^0-9%]{0,6})(-?\d+(?:\.\d+)?)(?!\s*%)/g,
    (_match, prefix: string, rawNumber: string) => {
      const value = Number(rawNumber);
      if (!Number.isFinite(value) || value === 0 || Math.abs(value) >= 1) {
        return `${prefix}${rawNumber}`;
      }
      const percentValue = value * 100;
      const digits = Math.abs(percentValue) < 1 ? 2 : Math.abs(percentValue) < 10 ? 1 : 0;
      return `${prefix}${percentValue.toFixed(digits)}%`;
    }
  );
}

type IndustryPoint = {
  label: string;
  value: number;
  bench: number;
  digits: number;
};

function buildIndustrySignalOverview(
  metrics: {
    completionRate?: number | null;
    followRate?: number | null;
  } | undefined,
  recommendRate: number,
  fallbackText: string
) {
  const fallback = normalizeSignalRateText(fallbackText);
  if (!metrics) {
    return fallback;
  }

  const points: IndustryPoint[] = [
    { label: '推荐率', value: toPercentValue(recommendRate), bench: 18.0, digits: 1 },
    { label: '完读率', value: toPercentValue(metrics.completionRate), bench: 42.0, digits: 0 },
    { label: '关注转化', value: toPercentValue(metrics.followRate), bench: 1.2, digits: 1 },
  ].filter((item) => Number.isFinite(item.value) && item.value > 0);

  if (points.length === 0) {
    return fallback;
  }

  const ranked = [...points].sort((a, b) => b.value - b.bench - (a.value - a.bench));
  const top = ranked[0];
  const topDelta = top.value - top.bench;
  const strongThreshold = top.label === '关注转化' ? 0.8 : 6;
  const positiveThreshold = top.label === '关注转化' ? 0.3 : 2;
  const weakThreshold = top.label === '关注转化' ? -0.8 : -6;

  let verdict = '接近行业平均';
  if (topDelta >= strongThreshold) {
    verdict = '显著高于行业平均';
  } else if (topDelta >= positiveThreshold) {
    verdict = '高于行业平均';
  } else if (topDelta <= weakThreshold) {
    verdict = '低于行业平均';
  }

  const head = `${verdict}：${top.label}${top.value.toFixed(top.digits)}%（行业${top.bench.toFixed(top.digits)}%）`;
  const second = ranked[1];
  if (!second) {
    return head;
  }

  const secondDelta = second.value - second.bench;
  const secondThreshold = second.label === '关注转化' ? 0.2 : 2;
  if (Math.abs(secondDelta) < secondThreshold) {
    return head;
  }
  return `${head}；${second.label}${second.value.toFixed(second.digits)}%（行业${second.bench.toFixed(second.digits)}%）。`;
}

function mapHistory(msg: ChatMessage): UiMessage {
  const tok = (msg.inputTokens || 0) + (msg.outputTokens || 0);
  return {
    id: `h-${msg.id}`,
    role: msg.role === 'assistant' ? 'assistant' : 'user',
    content: msg.content,
    meta:
      msg.role === 'assistant'
        ? `${msg.aiModel || 'AI'} · ${fmtDateShort(msg.createdAt)} · ${tok.toLocaleString('zh-CN')} tok · ${fmtMoneyCent(msg.costCent)}`
        : fmtDateShort(msg.createdAt),
  };
}

export default function GzhWorkspacePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const profile = useAuthStore((s) => s.profile);
  const updateProfile = useAuthStore((s) => s.updateProfile);

  const [range, setRange] = useState<RangeCode>('30d');
  const [modelOpen, setModelOpen] = useState(false);

  const [analysisDetail, setAnalysisDetail] = useState<AnalysisReport | null>(null);
  const [analysisGenerating, setAnalysisGenerating] = useState(false);
  const [analysisLive, setAnalysisLive] = useState('');
  const [analysisStatusText, setAnalysisStatusText] = useState('');
  const [analysisElapsedSec, setAnalysisElapsedSec] = useState(0);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const [chatMessages, setChatMessages] = useState<UiMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatStreaming, setChatStreaming] = useState(false);
  const [chatDoneMeta, setChatDoneMeta] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);

  const [sessionId, setSessionId] = useState(() => createSessionId());

  const chatRef = useRef<HTMLDivElement | null>(null);
  const modelRef = useRef<HTMLDivElement | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const analysisLiveRef = useRef('');
  const analysisTickerRef = useRef<number | null>(null);
  const chatTypingTargetIdRef = useRef<string | null>(null);
  const chatTypingBufferRef = useRef('');
  const chatTypingDoneRef = useRef(false);
  const chatTypingTimerRef = useRef<number | null>(null);

  const overviewQuery = useQuery({
    queryKey: ['workspace-overview', range],
    queryFn: () => WorkspaceApi.overview(range),
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
  const header = overview?.header;
  const metrics = overview?.dataPanel.metrics;
  const changes = overview?.dataPanel.changes;
  const recommendRate = recommendRateFromSummary(overview?.dataPanel.trafficSummary || {});
  const recommendPercent = Math.max(0, Math.min(100, toPercentValue(recommendRate)));
  const interactionRates = useMemo(
    () => ({
      share: calcRateByRead(metrics?.totalShare, metrics?.totalRead),
      wow: calcRateByRead(metrics?.totalWow, metrics?.totalRead),
      comment: calcRateByRead(metrics?.totalComment, metrics?.totalRead),
    }),
    [metrics?.totalComment, metrics?.totalRead, metrics?.totalShare, metrics?.totalWow]
  );
  const analysisPanel = overview?.analysisPanel;
  const analysisSummary = analysisPanel?.summary || '等待千问分析生成后展示。';
  const waitingSuffix = analysisElapsedSec > 0 ? `（已等待${analysisElapsedSec}s）` : '';
  const analysisFallback = analysisStatusText
    ? `${analysisStatusText}${waitingSuffix}`
    : `千问正在思考中，请稍候…${waitingSuffix}`;
  const analysisText = analysisGenerating
    ? analysisLive || analysisFallback
    : analysisDetail?.content || analysisPanel?.content || analysisSummary;

  const currentModelCode = header?.aiModel || profile?.aiModel || 'qwen_3_5';
  const currentModelName = MODEL_OPTIONS.find((x) => x.code === currentModelCode)?.name || currentModelCode;

  const analysisStage = analysisDetail?.stage || analysisPanel?.stage || '';
  const analysisFindings = (analysisDetail?.findings || analysisPanel?.findings || []).filter((x) => x && x.trim());
  const actionSuggestions = (analysisDetail?.actionSuggestions || analysisPanel?.actionSuggestions || []).filter((x) => x && x.trim());
  const analysisRhythm = analysisDetail?.rhythm || analysisPanel?.rhythm || '';
  const analysisSignalOverviewRaw = analysisDetail?.signalOverview || analysisPanel?.signalOverview || '等待千问生成信号概览';
  const analysisSignalOverview = analysisGenerating
    ? '千问正在生成信号概览…'
    : buildIndustrySignalOverview(metrics, recommendRate, analysisSignalOverviewRaw);
  const riskText = analysisGenerating
    ? '千问正在生成风险提示…'
    : analysisDetail?.riskHint || analysisPanel?.riskHint || '等待千问生成风险提示';
  const analysisRangeLabel = RANGE_OPTIONS.find((x) => x.value === range)?.label ?? '30天';
  const analysisArticleCount = analysisDetail?.articleCount ?? analysisPanel?.articleCount ?? header?.articleCount ?? 0;
  const analysisCoverageText = `${analysisGenerating ? '正在分析您近' : '已分析您近'}${analysisRangeLabel}${fmtNum(analysisArticleCount)}篇文章的数据`;

  const quickPrompts = useMemo(() => {
    if (analysisGenerating) {
      return [];
    }
    const currentReportQuestions = (analysisDetail?.suggestedQuestions ?? [])
      .filter((x) => x && x.trim());
    const base =
      currentReportQuestions.length > 0
        ? currentReportQuestions
        : [
            ...(analysisPanel?.suggestedQuestions ?? []),
            ...(overview?.quickQuestions ?? []),
          ].filter((x) => x && x.trim());
    return Array.from(new Set([...base, ...DEFAULT_QUICK_PROMPTS])).slice(0, 12);
  }, [analysisGenerating, overview?.quickQuestions, analysisPanel?.suggestedQuestions, analysisDetail?.suggestedQuestions]);
  const goodHighlights = useMemo(() => {
    const positiveFindings = analysisFindings.filter((item) => {
      const hasPositive = /(增长|提升|上升|改善|回升|稳定|亮点|高于|突破|增加|优化|有效|良好|健康)/.test(item);
      const hasNegative = /(下降|下滑|风险|不足|偏低|流失|波动|问题|回落)/.test(item);
      return hasPositive && !hasNegative;
    });

    const result: string[] = [];
    for (const item of positiveFindings) {
      result.push(item);
      if (result.length >= 3) {
        return result;
      }
    }

    if (toPercentValue(changes?.totalRead) > 0) {
      result.push(
        `总阅读较上一统计周期（前${analysisRangeLabel}）提升 ${Math.abs(toPercentValue(changes?.totalRead)).toFixed(0)}%，触达在改善。`
      );
    }
    if (toPercentValue(changes?.completionRate) > 0) {
      result.push(
        `完读率较上一统计周期（前${analysisRangeLabel}）提升 ${Math.abs(toPercentValue(changes?.completionRate)).toFixed(0)}%，内容吸引力在增强。`
      );
    }
    if ((metrics?.followRate ?? 0) > 0) {
      result.push(`关注转化约 ${fmtPercent(metrics?.followRate, 1)}，转粉链路有效。`);
    }
    if ((metrics?.totalShare ?? 0) > 0) {
      result.push(`分享累计 ${fmtNum(metrics?.totalShare)} 次，具备扩散潜力。`);
    }
    return Array.from(new Set(result)).slice(0, 3);
  }, [analysisFindings, analysisRangeLabel, changes?.completionRate, changes?.totalRead, metrics?.followRate, metrics?.totalShare]);

  const stopAnalysisTicker = () => {
    if (analysisTickerRef.current !== null) {
      window.clearInterval(analysisTickerRef.current);
      analysisTickerRef.current = null;
    }
  };

  const stopChatTyping = (flush = false) => {
    if (chatTypingTimerRef.current !== null) {
      window.clearInterval(chatTypingTimerRef.current);
      chatTypingTimerRef.current = null;
    }
    if (flush && chatTypingTargetIdRef.current && chatTypingBufferRef.current) {
      const targetId = chatTypingTargetIdRef.current;
      const rest = chatTypingBufferRef.current;
      setChatMessages((prev) =>
        prev.map((msg) => (msg.id === targetId ? { ...msg, content: `${msg.content}${rest}` } : msg))
      );
    }
    chatTypingBufferRef.current = '';
    chatTypingDoneRef.current = false;
    chatTypingTargetIdRef.current = null;
  };

  const resetChatSession = () => {
    chatAbortRef.current?.abort();
    stopChatTyping(false);
    setChatMessages([]);
    setChatInput('');
    setChatDoneMeta('');
    setChatError(null);
    setChatStreaming(false);
    setSessionId(createSessionId());
  };

  const ensureChatTypingTicker = () => {
    if (chatTypingTimerRef.current !== null) {
      return;
    }
    chatTypingTimerRef.current = window.setInterval(() => {
      const targetId = chatTypingTargetIdRef.current;
      if (!targetId) {
        stopChatTyping(false);
        return;
      }

      const buffer = chatTypingBufferRef.current;
      if (!buffer) {
        if (chatTypingDoneRef.current) {
          stopChatTyping(false);
        }
        return;
      }

      const step = buffer.length > 120 ? 10 : buffer.length > 60 ? 6 : 3;
      const next = buffer.slice(0, step);
      chatTypingBufferRef.current = buffer.slice(step);
      setChatMessages((prev) =>
        prev.map((msg) => (msg.id === targetId ? { ...msg, content: `${msg.content}${next}` } : msg))
      );
    }, 16);
  };

  useEffect(() => {
    document.title = '\u516c\u4f17\u53f7\u8fd0\u8425\u52a9\u624b \u00b7 \u5de5\u4f5c\u53f0';
  }, []);

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
      stopAnalysisTicker();
      stopChatTyping(false);
    };
  }, []);

  useEffect(() => {
    if (!modelOpen) return;

    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (modelRef.current?.contains(target)) return;
      setModelOpen(false);
    };

    document.addEventListener('click', onClickOutside);
    return () => document.removeEventListener('click', onClickOutside);
  }, [modelOpen]);

  const runAnalysis = () => {
    if (analysisGenerating) return;

    resetChatSession();
    analysisAbortRef.current?.abort();
    stopAnalysisTicker();
    setAnalysisError(null);
    setAnalysisGenerating(true);
    setAnalysisLive('');
    setAnalysisStatusText('正在准备分析数据');
    setAnalysisElapsedSec(0);
    analysisLiveRef.current = '';
    setAnalysisDetail(null);
    analysisTickerRef.current = window.setInterval(() => {
      setAnalysisElapsedSec((prev) => prev + 1);
    }, 1000);

    analysisAbortRef.current = AnalysisApi.generate(
      range,
      (chunk) => {
        if (!analysisLiveRef.current) {
          setAnalysisStatusText('千问正在输出分析内容…');
        }
        analysisLiveRef.current += chunk;
        setAnalysisLive((prev) => prev + chunk);
      },
      (event: AnalysisDoneEvent) => {
        const finalContent = analysisLiveRef.current || analysisPanel?.content || analysisSummary;
        stopAnalysisTicker();
        setAnalysisGenerating(false);
        setAnalysisLive('');
        setAnalysisStatusText('');
        setAnalysisElapsedSec(0);
        setAnalysisDetail({
          id: event.reportId,
          rangeCode: range,
          articleCount: event.articleCount ?? header?.articleCount ?? 0,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          costCent: event.costCent,
          aiModel: event.aiModel,
          content: finalContent,
          signalOverview: event.signalOverview || '',
          stage: event.stage || '',
          findings: event.findings || [],
          actionSuggestions: event.actionSuggestions || [],
          rhythm: event.rhythm || '',
          riskHint: event.riskHint || '',
          suggestedQuestions: event.suggestedQuestions || [],
          createdAt: new Date().toISOString(),
        });
        analysisLiveRef.current = '';
      },
      (error) => {
        stopAnalysisTicker();
        setAnalysisGenerating(false);
        setAnalysisLive('');
        setAnalysisStatusText('');
        setAnalysisElapsedSec(0);
        setAnalysisError(error.message || '分析失败，请稍后重试。');
        analysisLiveRef.current = '';
      },
      (event) => {
        const message = typeof event.message === 'string' ? event.message.trim() : '';
        if (message) {
          setAnalysisStatusText(message);
        }
      }
    );
  };

  const submitPrompt = (text: string) => {
    const content = text.trim();
    if (!content || chatStreaming) return;

    stopChatTyping(true);

    const userMsg: UiMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content,
      meta: fmtDateShort(new Date()),
    };

    const assistantId = `a-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const assistantMsg: UiMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      streaming: true,
    };

    setChatMessages((prev) => [...prev, userMsg, assistantMsg]);
    setChatStreaming(true);
    setChatDoneMeta('');
    setChatError(null);
    chatTypingTargetIdRef.current = assistantId;
    chatTypingBufferRef.current = '';
    chatTypingDoneRef.current = false;

    chatAbortRef.current?.abort();
    chatAbortRef.current = ChatApi.send(
      { message: content, sessionId, reportId: analysisPanel?.reportId, range },
      (chunk) => {
        if (!chunk) {
          return;
        }
        if (chatTypingTargetIdRef.current !== assistantId) {
          chatTypingTargetIdRef.current = assistantId;
        }
        chatTypingBufferRef.current += chunk;
        ensureChatTypingTicker();
      },
      (event: ChatDoneEvent) => {
        chatTypingDoneRef.current = true;
        ensureChatTypingTicker();
        setChatStreaming(false);
        setChatDoneMeta(`${event.aiModel} · ${(event.inputTokens + event.outputTokens).toLocaleString('zh-CN')} tok · ${fmtMoneyCent(event.costCent)}`);
        setChatMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  streaming: false,
                  meta: `${event.aiModel} · ${fmtDateShort(new Date())} · ${(event.inputTokens + event.outputTokens).toLocaleString('zh-CN')} tok · ${fmtMoneyCent(event.costCent)}`,
                }
              : msg
          )
        );
      },
      (error) => {
        stopChatTyping(true);
        setChatStreaming(false);
        setChatError(error.message || '发送失败，请稍后重试。');
      }
    );
  };

  const sendSuggestedPrompt = (text: string) => {
    if (chatStreaming) {
      return;
    }
    setChatInput('');
    submitPrompt(text);
  };

  const sendFromInput = () => {
    const text = chatInput.trim();
    if (!text) return;
    setChatInput('');
    submitPrompt(text);
  };

  const onChatKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendFromInput();
    }
  };

  const aiModelName = analysisDetail?.aiModel || analysisPanel?.aiModel || currentModelName;
  const aiTokens =
    (analysisDetail?.inputTokens ?? analysisPanel?.inputTokens ?? 0) +
    (analysisDetail?.outputTokens ?? analysisPanel?.outputTokens ?? 0);
  const gotoDetailPage = () => {
    navigate({
      pathname: RoutePath.GZH_DETAIL,
      search: `?range=${range}`,
    });
  };

  return (
    <div className="gzh-v2-root gzh-v2-workspace">
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-nav">
            <button className="topbar-nav-item" type="button" onClick={() => navigate(RoutePath.GZH_HOME)}>首页</button>
            <button className="topbar-nav-item active" type="button" onClick={() => navigate(RoutePath.GZH_WORKSPACE)}>工作台</button>
            <button className="topbar-nav-item" type="button" onClick={gotoDetailPage}>文章详情</button>
            <button className="topbar-nav-item" type="button" onClick={() => navigate(RoutePath.GZH_PROFILE)}>个人中心</button>
          </div>
          <div className="topbar-account">{header?.accountName || '公众号账号'}</div>
        </div>
        <div className="topbar-right">
          <div className="model-dd-wrap" ref={modelRef}>
            <button className="chip" type="button" onClick={() => setModelOpen((prev) => !prev)}>
              {currentModelName} ▼
            </button>
            {modelOpen ? (
              <div className="model-dropdown">
                {MODEL_OPTIONS.map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    className={`model-dd-item${currentModelCode === item.code ? ' active' : ''}`}
                    onClick={() => {
                      setModelOpen(false);
                      modelMutation.mutate(item.code);
                    }}
                    disabled={modelMutation.isPending}
                  >
                    {item.name} · {item.desc}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <span className="sync-meta">
            统计近{RANGE_OPTIONS.find((x) => x.value === range)?.label ?? '30天'} · 同步 {fmtDateShort(header?.lastSyncAt)}
          </span>
          <button className="avatar-btn" type="button" onClick={() => navigate(RoutePath.GZH_PROFILE)}>
            T
          </button>
        </div>
      </div>

      <div className="ws-body">
        <aside className="ctx">
          <div className="ctx-head">
            <span className="ctx-head-label">数据</span>
            <div className="time-tabs">
              {RANGE_OPTIONS.map((item) => (
                <button
                  key={item.value}
                  className={`time-tab${range === item.value ? ' active' : ''}`}
                  type="button"
                  onClick={() => setRange(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="ctx-body">
            <div className="goal-card">
              <div className="goal-title">本周信号概览</div>
              <div className="goal-sub">{analysisSignalOverview}</div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${Math.max(6, recommendPercent)}%` }} />
              </div>
            </div>

            <div className="kpi-chips">
              <div className="kpi-chip">推荐率 {fmtPercent(recommendRate, 1)}</div>
              <div className="kpi-chip">完读率 {fmtPercent(metrics?.completionRate, 0)}</div>
              <div className="kpi-chip">篇均阅读 {fmtNum(metrics?.avgRead)}</div>
            </div>

            <div className="risk-alert">
              <b>风险提示：</b>{riskText}
            </div>

            <div className="good-alert">
              <b>做得好的点：</b>
              {goodHighlights.length === 0 ? '等待千问生成后展示亮点。' : null}
            </div>
            {goodHighlights.length > 0 ? (
              <div className="good-list">
                {goodHighlights.map((item, index) => (
                  <div key={`good-${index}`} className="good-item">
                    {item}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="ctx-caption">核心指标</div>
            <div className="kpi-grid">
              <div className="kpi-item">
                <div className="kpi-item-main">
                  <div className="kpi-item-left">
                    <div className="kpi-item-label">阅读</div>
                    <div className="kpi-item-sub">篇均 {fmtNum(metrics?.avgRead)}</div>
                  </div>
                  <div className="kpi-item-right">
                    <div className="kpi-item-value">{fmtNum(metrics?.totalRead)}</div>
                    <div className={`kpi-item-delta ${toPercentValue(changes?.totalRead) >= 0 ? 'delta-up' : 'delta-down'}`}>
                      {fmtDeltaPercent(changes?.totalRead, 0)}
                    </div>
                  </div>
                </div>
              </div>
              <div className="kpi-item">
                <div className="kpi-item-main">
                  <div className="kpi-item-left">
                    <div className="kpi-item-label">完读率</div>
                    <div className="kpi-item-sub">时长 {fmtDuration(metrics?.avgReadTimeSec)}</div>
                  </div>
                  <div className="kpi-item-right">
                    <div className="kpi-item-value">{fmtPercent(metrics?.completionRate, 0)}</div>
                    <div className={`kpi-item-delta ${toPercentValue(changes?.completionRate) >= 0 ? 'delta-up' : 'delta-down'}`}>
                      {fmtDeltaPercent(changes?.completionRate, 0)}
                    </div>
                  </div>
                </div>
              </div>
              <div className="kpi-item">
                <div className="kpi-item-main">
                  <div className="kpi-item-left">
                    <div className="kpi-item-label">点赞</div>
                    <div className="kpi-item-sub">点赞率 {fmtPercent(metrics?.likeRate, 1)}</div>
                  </div>
                  <div className="kpi-item-right">
                    <div className="kpi-item-value">{fmtNum(metrics?.totalLike)}</div>
                    <div className={`kpi-item-delta ${toPercentValue(changes?.totalLike) >= 0 ? 'delta-up' : 'delta-down'}`}>
                      {fmtDeltaPercent(changes?.totalLike, 0)}
                    </div>
                  </div>
                </div>
              </div>
              <div className="kpi-item">
                <div className="kpi-item-main">
                  <div className="kpi-item-left">
                    <div className="kpi-item-label">关注</div>
                    <div className="kpi-item-sub">转化 {fmtPercent(metrics?.followRate, 1)}</div>
                  </div>
                  <div className="kpi-item-right">
                    <div className="kpi-item-value">{fmtNum(metrics?.newFollowers)}</div>
                    <div className={`kpi-item-delta ${toPercentValue(changes?.newFollowers) >= 0 ? 'delta-up' : 'delta-down'}`}>
                      {fmtDeltaPercent(changes?.newFollowers, 0)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rec-card">
              <div className="rec-title">
                推荐率 <span className="delta-up" style={{ fontSize: '12px' }}>{fmtPercent(recommendRate, 1)}</span>
                <span className={toPercentValue(changes?.totalRead) >= 0 ? 'delta-up' : 'delta-down'} style={{ fontSize: '10px' }}>
                  {fmtDeltaPercent(changes?.totalRead, 1)}
                </span>
              </div>
              <div className="rec-bar">
                <div className="rec-fill" style={{ width: `${Math.max(6, recommendPercent)}%` }} />
              </div>
            </div>

            <div className="interact-row interact-row-plain">
              <div className="interact-chip">分享 {fmtNum(metrics?.totalShare)}（{interactionRates.share.toFixed(1)}%）</div>
              <div className="interact-chip">在看 {fmtNum(metrics?.totalWow)}（{interactionRates.wow.toFixed(1)}%）</div>
              <div className="interact-chip">留言 {fmtNum(metrics?.totalComment)}（{interactionRates.comment.toFixed(1)}%）</div>
            </div>

            <div className="ctx-bottom-actions">
              <div className="ctx-actions">
                <button className="btn btn-primary" type="button" onClick={runAnalysis} disabled={analysisGenerating}>
                  {analysisGenerating ? '分析中...' : '生成分析'}
                </button>
              </div>

              <button className="ctx-link" type="button" onClick={gotoDetailPage}>
                查看文章详情 →
              </button>
            </div>

            {analysisError ? <div className="error-tip">{analysisError}</div> : null}
          </div>
        </aside>

        <section className="chat-wrap">
          <div className="chat-messages" ref={chatRef} id="chat-messages">
            <div className="msg-ai">
              <div className="ai-card">
                <div className="ai-card-head">
                  <div className="ai-card-title">{analysisCoverageText}</div>
                  <div className="ai-badge">
                    {aiModelName} · {fmtDateShort(analysisDetail?.createdAt || analysisPanel?.createdAt || header?.lastSyncAt)} · {fmtNum(aiTokens)} tok
                  </div>
                </div>
                <div className="ai-sub">{analysisText}</div>
                {analysisGenerating ? (
                  <div className="thinking-card">
                    <div className="thinking-title">千问思考中...</div>
                    <div className="thinking-sub">
                      {analysisStatusText || '正在整理风险提示、核心发现和可执行建议'}
                    </div>
                    <div className="thinking-meta">{analysisElapsedSec > 0 ? `已等待 ${analysisElapsedSec}s` : '正在连接千问...'}</div>
                  </div>
                ) : null}
                {analysisStage ? (
                  <div className="stage-block">
                    <b>阶段判断：</b>{analysisStage}
                  </div>
                ) : null}

                <div className="findings-title">核心发现</div>
                {analysisGenerating ? <div className="thinking-skeleton" /> : null}
                {!analysisGenerating && analysisFindings.length === 0 ? <div className="empty-tip">等待千问生成核心发现。</div> : null}
                {!analysisGenerating && analysisFindings.map((item, index) => (
                  <div key={`finding-${index}`} className="finding-item">
                    <span className="fi-good">•</span>
                    {item}
                  </div>
                ))}

                <div className="actions-title">本周可执行的 3 件事</div>
                {analysisGenerating ? <div className="thinking-skeleton" /> : null}
                {!analysisGenerating && actionSuggestions.length === 0 ? <div className="empty-tip">等待千问生成可执行建议。</div> : null}
                {!analysisGenerating && actionSuggestions.map((item, index) => (
                  <div key={`action-${index}`} className="action-item">
                    <div className="action-row">
                      <div className="action-num">{index + 1}</div>
                      <div className="action-text">{item}</div>
                    </div>
                  </div>
                ))}

                <div className="mood-block">{analysisRhythm || (analysisGenerating ? '千问正在组织节奏建议…' : '等待千问生成节奏建议。')}</div>

                <div className="ai-footer">
                  {quickPrompts.slice(0, 4).map((item) => (
                    <span key={`tag-${item}`} className="ai-tag" onClick={() => sendSuggestedPrompt(item)}>
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {chatMessages.map((msg) => (
              <div key={msg.id} className={msg.role === 'assistant' ? 'msg-ai' : 'msg-user'}>
                <div className={msg.role === 'assistant' ? 'bubble-ai' : 'bubble-user'}>{msg.content}</div>
                {msg.meta ? <div className="bubble-meta">{msg.meta}</div> : null}
              </div>
            ))}

            {chatMessages.length === 0 ? <div className="empty-tip">输入问题，基于你的数据和分析报告进行对话。</div> : null}
          </div>

          <div className="chat-quick">
            {quickPrompts.length === 0 ? (
              <button className="quick-btn" type="button" disabled>
                生成分析后显示推荐问题
              </button>
            ) : (
              quickPrompts.slice(0, 4).map((item) => (
                <button
                  key={item}
                  className="quick-btn"
                  type="button"
                  onClick={() => sendSuggestedPrompt(item)}
                  disabled={chatStreaming}
                >
                  {item}
                </button>
              ))
            )}
          </div>

          <div className="chat-input-bar">
            <textarea
              id="chat-input"
              className="chat-textarea"
              value={chatInput}
              placeholder="问 AI 关于近30天数据的任何问题…"
              rows={1}
              onChange={(event) => {
                setChatInput(event.target.value);
                event.currentTarget.style.height = '';
                event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 120)}px`;
              }}
              onKeyDown={onChatKeyDown}
              disabled={chatStreaming}
            />
            <button className="btn btn-teal" type="button" onClick={sendFromInput} disabled={chatStreaming}>
              {chatStreaming ? '发送中...' : '发送'}
            </button>
          </div>

          {chatError ? <div className="chat-status error">{chatError}</div> : null}
          {!chatError && chatDoneMeta ? <div className="chat-status">{chatDoneMeta}</div> : null}
        </section>
      </div>
    </div>
  );
}
