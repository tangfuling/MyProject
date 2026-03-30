import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AnalysisApi from '../api/AnalysisApi';
import { useAuthStore } from '../../../common/state/authStore';
import type { AnalysisDoneEvent } from '../model/AnalysisModels';

export function useAnalysisViewModel() {
  const [range, setRange] = useState('30d');
  const [streamText, setStreamText] = useState('');
  const [running, setRunning] = useState(false);
  const [lastDone, setLastDone] = useState<AnalysisDoneEvent | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();
  const aiModel = useAuthStore((s) => s.profile?.aiModel ?? 'qwen');

  const estimateQuery = useQuery({
    queryKey: ['analysis-estimate', range, aiModel],
    queryFn: () => AnalysisApi.estimate(range),
  });

  const reportsQuery = useQuery({
    queryKey: ['analysis-reports'],
    queryFn: () => AnalysisApi.reports(1, 20),
  });

  const detailQuery = useQuery({
    queryKey: ['analysis-report-detail', selectedId],
    queryFn: () => AnalysisApi.detail(selectedId as number),
    enabled: selectedId !== null,
  });

  const startGenerate = () => {
    setRunning(true);
    setStreamText('');
    setLastDone(null);

    abortRef.current = AnalysisApi.generate(
      range,
      (chunk) => setStreamText((prev) => prev + chunk),
      (doneEvent) => {
        setRunning(false);
        setLastDone(doneEvent);
        void queryClient.invalidateQueries({ queryKey: ['analysis-reports'] });
        void queryClient.invalidateQueries({ queryKey: ['analysis-estimate'] });
      },
      (error) => {
        setRunning(false);
        setStreamText((prev) => `${prev}\n\n[ERROR] ${error.message}`);
      }
    );
  };

  const stopGenerate = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  return {
    range,
    setRange,
    estimate: estimateQuery.data,
    reports: reportsQuery.data?.records ?? [],
    streamText,
    running,
    lastDone,
    selectedId,
    setSelectedId,
    selectedReport: detailQuery.data,
    reportsLoading: reportsQuery.isPending,
    reportsError: reportsQuery.error?.message ?? null,
    startGenerate,
    stopGenerate,
  };
}
