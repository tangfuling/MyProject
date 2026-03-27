import http from '../../../common/network/HttpClient';
import { ApiConfig } from '../../../common/network/ApiConfig';
import { createSseStream } from '../../../common/network/SseClient';
import { useAuthStore } from '../../../common/state/authStore';
import type { AnalysisDoneEvent, AnalysisReport, AnalysisReportPage } from '../model/AnalysisModels';

const AnalysisApi = {
  reports(page: number, size: number) {
    return http.get<AnalysisReportPage>('/analysis/reports', { params: { page, size } });
  },
  detail(id: number) {
    return http.get<AnalysisReport>(`/analysis/reports/${id}`);
  },
  generate(range: string, onChunk: (chunk: string) => void, onDone: (event: AnalysisDoneEvent) => void, onError: (error: Error) => void) {
    const token = useAuthStore.getState().token ?? '';
    return createSseStream<AnalysisDoneEvent>(
      `${ApiConfig.baseUrl}/analysis/generate`,
      { range },
      token,
      { onChunk, onDone, onError }
    );
  },
};

export default AnalysisApi;
