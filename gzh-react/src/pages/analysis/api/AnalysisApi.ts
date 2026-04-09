import http from '../../../common/network/HttpClient';
import { HttpConfig } from '../../../common/network/HttpConfig';
import { createSseStream } from '../../../common/network/SseClient';
import { useAuthStore } from '../../../common/state/authStore';
import type { AnalysisDoneEvent, AnalysisEstimate, AnalysisReport, AnalysisReportPage } from '../model/AnalysisModels';

const AnalysisApi = {
  estimate(range: string) {
    return http.get<AnalysisEstimate>('/analysis/estimate', { params: { range } });
  },
  reports(page: number, size: number) {
    return http.get<AnalysisReportPage>('/analysis/reports', { params: { page, size } });
  },
  detail(id: number) {
    return http.get<AnalysisReport>(`/analysis/reports/${id}`);
  },
  generate(
    range: string,
    onChunk: (chunk: string) => void,
    onDone: (event: AnalysisDoneEvent) => void,
    onError: (error: Error) => void,
    onStatus?: (event: Record<string, unknown>) => void
  ) {
    const token = useAuthStore.getState().token ?? '';
    return createSseStream<AnalysisDoneEvent>(
      `${HttpConfig.getBaseUrl()}/analysis/generate`,
      { range },
      token,
      { onChunk, onDone, onError, onStatus }
    );
  },
};

export default AnalysisApi;
