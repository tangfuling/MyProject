import AppLayout from '../../../common/ui/AppLayout';
import PageWrapper from '../../../common/base/PageWrapper';
import { useDataViewModel } from '../viewmodel/useDataViewModel';

const ranges = [
  { code: '7d', label: '近7天' },
  { code: '30d', label: '近30天' },
  { code: '90d', label: '近90天' },
  { code: 'all', label: '全部' },
];

function renderSparkline(values: number[]) {
  if (values.length <= 1) {
    return null;
  }
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const width = 360;
  const height = 80;
  const points = values.map((value, idx) => {
    const x = (idx / (values.length - 1)) * width;
    const ratio = max === min ? 0.5 : (value - min) / (max - min);
    const y = height - ratio * height;
    return `${x},${y}`;
  });
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="sparkline" preserveAspectRatio="none">
      <polyline points={points.join(' ')} fill="none" stroke="#0f766e" strokeWidth="2.5" />
    </svg>
  );
}

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

          <div className="trend-box">
            <div className="trend-title">阅读趋势（当前页）</div>
            {renderSparkline(vm.trendReads)}
          </div>

          <div className="traffic-box">
            <strong>流量来源：</strong>
            {Object.entries(vm.overview?.trafficSummary ?? {}).map(([key, value]) => (
              <span key={key} className="traffic-item">{key} {value}%</span>
            ))}
            <button
              type="button"
              className="ghost-btn"
              onClick={() => vm.setShowDetail(!vm.showDetail)}
            >
              {vm.showDetail ? '收起详情' : '查看全部指标与文章详情'}
            </button>
          </div>

          {vm.showDetail ? (
            <div className="detail-drawer">
              <div className="metric-grid detail-grid">
                <div className="metric-card"><div className="metric-label">总阅读</div><div className="metric-value">{vm.detailStats.totalRead}</div></div>
                <div className="metric-card"><div className="metric-label">总分享</div><div className="metric-value">{vm.detailStats.totalShare}</div></div>
                <div className="metric-card"><div className="metric-label">总点赞</div><div className="metric-value">{vm.detailStats.totalLike}</div></div>
                <div className="metric-card"><div className="metric-label">总在看</div><div className="metric-value">{vm.detailStats.totalWow}</div></div>
                <div className="metric-card"><div className="metric-label">总收藏</div><div className="metric-value">{vm.detailStats.totalSave}</div></div>
                <div className="metric-card"><div className="metric-label">总留言</div><div className="metric-value">{vm.detailStats.totalComment}</div></div>
                <div className="metric-card"><div className="metric-label">新增关注</div><div className="metric-value">{vm.detailStats.totalFollow}</div></div>
                <div className="metric-card"><div className="metric-label">平均完读率</div><div className="metric-value">{vm.detailStats.avgCompletion}%</div></div>
              </div>
            </div>
          ) : null}

          <table className="data-table">
            <thead>
              <tr>
                <th>发布时间</th>
                <th>标题</th>
                <th>阅读</th>
                <th>分享</th>
                <th>点赞</th>
                <th>在看</th>
                <th>留言</th>
                <th>收藏</th>
                <th>完读率</th>
                <th>来源</th>
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
                  <td>{article.wowCount ?? 0}</td>
                  <td>{article.commentCount ?? 0}</td>
                  <td>{article.saveCount ?? 0}</td>
                  <td>{article.completionRate ?? 0}%</td>
                  <td>
                    {Object.entries(article.trafficSources ?? {})
                      .slice(0, 2)
                      .map(([k, v]) => `${k}:${v}`)
                      .join(' | ')}
                  </td>
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
