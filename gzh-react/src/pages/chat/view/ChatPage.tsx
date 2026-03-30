import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import AppLayout from '../../../common/ui/AppLayout';
import StreamText from '../../../common/ui/StreamText';
import { useChatViewModel } from '../viewmodel/useChatViewModel';

export default function ChatPage() {
  const [params] = useSearchParams();
  const initQuestion = params.get('q') ?? undefined;
  const initReportId = useMemo(() => {
    const raw = params.get('reportId');
    if (!raw) {
      return undefined;
    }
    const num = Number(raw);
    return Number.isFinite(num) ? num : undefined;
  }, [params]);

  const vm = useChatViewModel(initQuestion, initReportId);

  return (
    <AppLayout>
      <section className="page-panel chat-panel">
        <h2>AI 对话</h2>
        <div className="muted">会话ID: {vm.sessionId || '新会话'} {vm.reportId ? `· 报告 ${vm.reportId}` : ''}</div>
        {vm.quickQuestions.length ? (
          <div className="chip-row">
            {vm.quickQuestions.map((question) => (
              <button key={question} type="button" className="chip" onClick={() => vm.setInput(question)}>
                {question}
              </button>
            ))}
          </div>
        ) : null}

        <div className="chat-box">
          {vm.messages.map((message) => (
            <div key={`${message.id}-${message.createdAt}`} className={`chat-item ${message.role}`}>
              <div className="chat-role">{message.role === 'assistant' ? '助手' : '我'}</div>
              <div className="chat-content">{message.content}</div>
              {message.role === 'assistant' ? (
                <div className="muted small">
                  {message.aiModel} · {message.inputTokens + message.outputTokens} tok · ¥{(message.costCent / 100).toFixed(2)}
                </div>
              ) : null}
            </div>
          ))}
          {vm.streaming ? (
            <div className="chat-item assistant">
              <div className="chat-role">助手</div>
              <StreamText content={vm.streamText} />
            </div>
          ) : null}
        </div>

        <div className="chat-input-row">
          <textarea
            value={vm.input}
            onChange={(event) => vm.setInput(event.target.value)}
            className="chat-input"
            placeholder="输入你的问题，例如：下周选题应该怎么排？"
          />
          <div className="action-row">
            <button type="button" className="primary-btn" onClick={vm.send} disabled={vm.streaming}>发送</button>
            <button type="button" className="ghost-btn" onClick={vm.stop} disabled={!vm.streaming}>停止</button>
          </div>
        </div>
        {vm.lastDone ? (
          <div className="done-tip">本轮消耗: {vm.lastDone.inputTokens + vm.lastDone.outputTokens} tok · ¥{(vm.lastDone.costCent / 100).toFixed(2)}</div>
        ) : null}
      </section>
    </AppLayout>
  );
}
