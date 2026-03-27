import AppLayout from '../../../common/ui/AppLayout';
import PageWrapper from '../../../common/base/PageWrapper';
import { useDataViewModel } from '../viewmodel/useDataViewModel';

const ranges = [
  { code: '7d', label: '近7天' },
  { code: '30d', label: '近30天' },
  { code: '90d', label: '近90天' },
  { code: 'all', label: '全部' },
];

export default function DataPage() {
  const vm = useDataViewModel();

  return (
    <AppLayout>
      <PageWrapper loading={vm.loading} error={vm.error}>
        <section className="page-panel">
          <header className="panel-header">
            <h2>数据概览</h2>
            <div className="chip-row">
              {ranges.map((range) => (
                <button
                  key={range.code}
                  type="button"
                  className={`chip${vm.range === range.code ? ' active' : ''}`}
                  onClick={() => {
                    vm.setRange(range.code);
                    vm.setPage(1);
                  }}
                >
                  {range.label}
                </button>
              ))}
            </div>
          </header>

          <div className="metric-grid">
            <div className="metric-card">
              <div className="metric-label">总阅读</div>
              <div className="metric-value">{vm.overview?.metrics.totalRead ?? 0}</div>
              <div className="metric-change">{vm.overview?.changes.totalRead ?? 0}%</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">篇均阅读</div>
              <div className="metric-value">{vm.overview?.metrics.avgRead ?? 0}</div>
              <div className="metric-change">{vm.overview?.changes.avgRead ?? 0}%</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">完读率</div>
              <div className="metric-value">{vm.overview?.metrics.completionRate ?? 0}%</div>
              <div className="metric-change">{vm.overview?.changes.completionRate ?? 0}%</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">总分享</div>
              <div className="metric-value">{vm.overview?.metrics.totalShare ?? 0}</div>
              <div className="metric-change">{vm.overview?.changes.totalShare ?? 0}%</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">总点赞</div>
              <div className="metric-value">{vm.overview?.metrics.totalLike ?? 0}</div>
              <div className="metric-change">{vm.overview?.changes.totalLike ?? 0}%</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">新增关注</div>
              <div className="metric-value">{vm.overview?.metrics.newFollowers ?? 0}</div>
              <div className="metric-change">{vm.overview?.changes.newFollowers ?? 0}%</div>
            </div>
          </div>

          <div className="traffic-box">
            <strong>流量来源：</strong>
            {Object.entries(vm.overview?.trafficSummary ?? {}).map(([key, value]) => (
              <span key={key} className="traffic-item">{key} {value}%</span>
            ))}
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>发布时间</th>
                <th>标题</th>
                <th>阅读</th>
                <th>分享</th>
                <th>点赞</th>
                <th>完读率</th>
              </tr>
            </thead>
            <tbody>
              {(vm.articlePage?.records ?? []).map((article) => (
                <tr key={article.id}>
                  <td>{article.publishTime?.slice(0, 10)}</td>
                  <td>{article.title}</td>
                  <td>{article.readCount ?? 0}</td>
                  <td>{article.shareCount ?? 0}</td>
                  <td>{article.likeCount ?? 0}</td>
                  <td>{article.completionRate ?? 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="pager-row">
            <button type="button" className="ghost-btn" disabled={vm.page <= 1} onClick={() => vm.setPage(vm.page - 1)}>上一页</button>
            <span>第 {vm.page} / {vm.totalPages} 页</span>
            <button type="button" className="ghost-btn" disabled={vm.page >= vm.totalPages} onClick={() => vm.setPage(vm.page + 1)}>下一页</button>
          </div>
        </section>
      </PageWrapper>
    </AppLayout>
  );
}
