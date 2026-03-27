import http from '../../../common/network/HttpClient';
import { ApiConfig } from '../../../common/network/ApiConfig';
import { createSseStream } from '../../../common/network/SseClient';
import { useAuthStore } from '../../../common/state/authStore';
import type { ChatDoneEvent, ChatMessage } from '../model/ChatModels';

const ChatApi = {
  history(sessionId: string) {
    return http.get<ChatMessage[]>('/chat/history', { params: { sessionId } });
  },
  send(payload: { message: string; sessionId?: string; reportId?: number; range?: string }, onChunk: (chunk: string) => void, onDone: (event: ChatDoneEvent) => void, onError: (error: Error) => void) {
    const token = useAuthStore.getState().token ?? '';
    return createSseStream<ChatDoneEvent>(
      `${ApiConfig.baseUrl}/chat/send`,
      payload,
      token,
      { onChunk, onDone, onError }
    );
  },
};

export default ChatApi;
