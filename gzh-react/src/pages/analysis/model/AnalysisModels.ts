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
  signalOverview?: string;
  stage?: string;
  findings?: string[];
  actionSuggestions?: string[];
  rhythm?: string;
  riskHint?: string;
  suggestedQuestions: string[];
  createdAt: string;
};

export type AnalysisReportPage = PageResult<AnalysisReport>;

export type AnalysisEstimate = {
  range: string;
  articleCount: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostCent: number;
  aiModel: string;
};

export type AnalysisDoneEvent = {
  type: 'done';
  reportId: number;
  articleCount: number;
  inputTokens: number;
  outputTokens: number;
  costCent: number;
  aiModel: string;
  signalOverview?: string;
  stage?: string;
  findings?: string[];
  actionSuggestions?: string[];
  rhythm?: string;
  riskHint?: string;
  suggestedQuestions: string[];
};
