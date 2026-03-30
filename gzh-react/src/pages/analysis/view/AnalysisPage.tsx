import AppLayout from '../../../common/ui/AppLayout';
import StreamText from '../../../common/ui/StreamText';
import { useAnalysisViewModel } from '../viewmodel/useAnalysisViewModel';
import RouterManager from '../../../common/router/RouterManager';
import { RoutePath } from '../../../common/router/RoutePath';

const ranges = [
  { code: '7d', label: '近7天' },
  { code: '30d', label: '近30天' },
  { code: '90d', label: '近90天' },
  { code: 'all', label: '全部' },
];

export default function AnalysisPage() {
  const vm = useAnalysisViewModel();

  return (
    <AppLayout>
      <section className="page-panel two-col">
        <div className="left-col">
          <h2>分析报告</h2>
          <div className="chip-row">
            {ranges.map((range) => (
              <button
                key={range.code}
                type="button"
                className={`chip${vm.range === range.code ? ' active' : ''}`}
                onClick={() => vm.setRange(range.code)}
              >
                {range.label}
              </button>
            ))}
          </div>
          <p className="muted">将分析 {vm.estimate?.articleCount ?? 0} 篇文章</p>
          <p className="muted">
            预估消耗 {(vm.estimate?.estimatedInputTokens ?? 0) + (vm.estimate?.estimatedOutputTokens ?? 0)} tokens
            （约 ¥{((vm.estimate?.estimatedCostCent ?? 0) / 100).toFixed(2)}，模型 {vm.estimate?.aiModel ?? '-'}）
          </p>
          <div className="action-row">
            <button type="button" className="primary-btn" disabled={vm.running} onClick={vm.startGenerate}>生成分析报告</button>
            <button type="button" className="ghost-btn" disabled={!vm.running} onClick={vm.stopGenerate}>停止</button>
          </div>
          {vm.lastDone ? (
            <div className="done-tip">
              已完成: 消耗 {vm.lastDone.inputTokens + vm.lastDone.outputTokens} tokens，费用 ¥{(vm.lastDone.costCent / 100).toFixed(2)}
            </div>
          ) : null}

          {vm.lastDone?.suggestedQuestions?.length ? (
            <div className="suggest-box">
              <div className="muted">推荐问题：</div>
              <div className="chip-row">
                {vm.lastDone.suggestedQuestions.map((question) => (
                  <button
                    key={question}
                    type="button"
                    className="chip"
                    onClick={() => RouterManager.navigate(`${RoutePath.CHAT}?q=${encodeURIComponent(question)}&reportId=${vm.lastDone?.reportId}`)}
                  >
                    {question}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <StreamText content={vm.streamText} />
        </div>

        <div className="right-col">
          <h3>历史报告</h3>
          {vm.reportsError ? <div className="error-tip">{vm.reportsError}</div> : null}
          <ul className="report-list">
            {vm.reports.map((report) => (
              <li key={report.id}>
                <button
                  type="button"
                  className={`report-item${vm.selectedId === report.id ? ' active' : ''}`}
                  onClick={() => vm.setSelectedId(report.id)}
                >
                  <div>{report.createdAt?.slice(0, 16)} · {report.rangeCode}</div>
                  <div className="muted">{report.inputTokens + report.outputTokens} tok · ¥{(report.costCent / 100).toFixed(2)}</div>
                </button>
              </li>
            ))}
          </ul>
          {vm.selectedReport ? (
            <div className="report-detail">
              <h4>报告详情</h4>
              <div className="muted">
                {vm.selectedReport.aiModel} · {vm.selectedReport.inputTokens + vm.selectedReport.outputTokens} tok · ¥{(vm.selectedReport.costCent / 100).toFixed(2)}
              </div>
              <div className="action-row">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => RouterManager.navigate(`${RoutePath.CHAT}?reportId=${vm.selectedReport?.id}`)}
                >
                  基于此报告开始对话
                </button>
              </div>
              <StreamText content={vm.selectedReport.content} />
            </div>
          ) : null}
        </div>
      </section>
    </AppLayout>
  );
}
