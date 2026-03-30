import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import ChatApi from '../api/ChatApi';
import AnalysisApi from '../../analysis/api/AnalysisApi';
import type { ChatDoneEvent, ChatMessage } from '../model/ChatModels';

export function useChatViewModel(initialQuestion?: string, initialReportId?: number) {
  const [sessionId, setSessionId] = useState('');
  const [input, setInput] = useState(initialQuestion ?? '');
  const [reportId, setReportId] = useState<number | undefined>(initialReportId);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [lastDone, setLastDone] = useState<ChatDoneEvent | null>(null);
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const streamTextRef = useRef('');

  useEffect(() => {
    if (initialQuestion) {
      setInput(initialQuestion);
    }
  }, [initialQuestion]);

  useEffect(() => {
    if (initialReportId) {
      setReportId(initialReportId);
    }
  }, [initialReportId]);

  const historyQuery = useQuery({
    queryKey: ['chat-history', sessionId],
    queryFn: () => ChatApi.history(sessionId),
    enabled: sessionId.length > 0,
  });

  const reportDetailQuery = useQuery({
    queryKey: ['analysis-report-detail-for-chat', reportId],
    queryFn: () => AnalysisApi.detail(reportId as number),
    enabled: typeof reportId === 'number' && Number.isFinite(reportId),
  });

  const latestReportQuery = useQuery({
    queryKey: ['analysis-reports-for-chat'],
    queryFn: () => AnalysisApi.reports(1, 1),
  });

  useEffect(() => {
    if (historyQuery.data) {
      setLocalMessages(historyQuery.data);
    }
  }, [historyQuery.data]);

  const send = () => {
    if (!input.trim()) {
      return;
    }
    const currentInput = input.trim();
    setStreaming(true);
    setStreamText('');
    streamTextRef.current = '';
    setLastDone(null);

    const userMessage: ChatMessage = {
      id: Date.now(),
      sessionId: sessionId || 'pending',
      reportId: reportId ?? null,
      role: 'user',
      content: currentInput,
      aiModel: '',
      inputTokens: 0,
      outputTokens: 0,
      costCent: 0,
      createdAt: new Date().toISOString(),
    };
    setLocalMessages((prev) => [...prev, userMessage]);

    abortRef.current = ChatApi.send(
      { message: currentInput, sessionId: sessionId || undefined, reportId, range: '30d' },
      (chunk) => {
        streamTextRef.current += chunk;
        setStreamText((prev) => prev + chunk);
      },
      (done) => {
        setStreaming(false);
        setLastDone(done);
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
        setLocalMessages((prev) => [...prev, assistant]);
      },
      (error) => {
        setStreaming(false);
        setStreamText((prev) => `${prev}\n\n[ERROR] ${error.message}`);
      }
    );
  };

  const stop = () => {
    abortRef.current?.abort();
    setStreaming(false);
  };

  const quickQuestions = useMemo(() => {
    const fromReport = reportDetailQuery.data?.suggestedQuestions ?? [];
    if (fromReport.length > 0) {
      return fromReport;
    }
    const latest = latestReportQuery.data?.records?.[0];
    return latest?.suggestedQuestions ?? [];
  }, [latestReportQuery.data?.records, reportDetailQuery.data?.suggestedQuestions]);

  return {
    sessionId,
    setSessionId,
    input,
    setInput,
    reportId,
    setReportId,
    messages: localMessages,
    streamText,
    streaming,
    lastDone,
    quickQuestions,
    loading: historyQuery.isPending,
    error: historyQuery.error?.message ?? null,
    send,
    stop,
  };
}
