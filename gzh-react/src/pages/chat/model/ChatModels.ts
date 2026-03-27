export type ChatMessage = {
  id: number;
  sessionId: string;
  reportId: number | null;
  role: 'user' | 'assistant';
  content: string;
  aiModel: string;
  inputTokens: number;
  outputTokens: number;
  costCent: number;
  createdAt: string;
};

export type ChatDoneEvent = {
  type: 'done';
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  costCent: number;
  aiModel: string;
};
