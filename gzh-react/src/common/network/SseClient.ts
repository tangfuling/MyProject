export type SseCallbacks<TDone> = {
  onChunk: (content: string) => void;
  onDone: (data: TDone) => void;
  onError: (error: Error) => void;
  onStatus?: (data: Record<string, unknown>) => void;
};

export function createSseStream<TDone>(
  url: string,
  body: Record<string, unknown>,
  token: string,
  callbacks: SseCallbacks<TDone>
): AbortController {
  const controller = new AbortController();

  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok || !response.body) {
        throw new Error(`SSE request failed: ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';

        for (const block of blocks) {
          const lines = block.split('\n');
          for (const line of lines) {
            if (!line.startsWith('data:')) {
              continue;
            }
            const payload = line.slice(5).trim();
            if (!payload) {
              continue;
            }
            const json = JSON.parse(payload) as Record<string, unknown>;
            if (json.type === 'chunk') {
              callbacks.onChunk(String(json.content ?? ''));
            } else if (json.type === 'status') {
              callbacks.onStatus?.(json);
            } else if (json.type === 'done') {
              callbacks.onDone(json as TDone);
            } else if (json.type === 'error') {
              callbacks.onError(new Error(String(json.message ?? 'SSE error')));
            }
          }
        }
      }
    })
    .catch((error: unknown) => {
      if ((error as { name?: string }).name === 'AbortError') {
        return;
      }
      callbacks.onError(error instanceof Error ? error : new Error('Unknown SSE error'));
    });

  return controller;
}
