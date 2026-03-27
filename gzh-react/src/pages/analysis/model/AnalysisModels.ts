import type { PageResult } from '../../../common/network/ApiResponse';

export type AnalysisReport = {
  id: number;
  rangeCode: string;
  articleCount: number;
  inputTokens: number;
  outputTokens: number;
  costCent: number;
  aiModel: string;
  content: string;
  suggestedQuestions: string[];
  createdAt: string;
};

export type AnalysisReportPage = PageResult<AnalysisReport>;

export type AnalysisDoneEvent = {
  type: 'done';
  reportId: number;
  inputTokens: number;
  outputTokens: number;
  costCent: number;
  aiModel: string;
  suggestedQuestions: string[];
};
