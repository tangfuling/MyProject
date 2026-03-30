import { RoutePath } from '../../../common/router/RoutePath';
import RouterManager from '../../../common/router/RouterManager';
import AppLayout from '../../../common/ui/AppLayout';
import PageWrapper from '../../../common/base/PageWrapper';
import { useSettingsViewModel } from '../viewmodel/useSettingsViewModel';

const models = [
  { code: 'qwen', name: '通义千问', price: '约 ¥2 / 百万输入', desc: '默认模型，性价比高' },
  { code: 'doubao', name: '字节豆包', price: '约 ¥3 / 百万输入', desc: '中文理解能力强' },
  { code: 'gpt', name: 'GPT', price: '约 ¥10 / 百万输入', desc: '综合能力更均衡' },
  { code: 'claude', name: 'Claude', price: '约 ¥15 / 百万输入', desc: '推理与长文本表现强' },
];

export default function SettingsPage() {
  const vm = useSettingsViewModel();

  return (
    <AppLayout>
      <PageWrapper loading={vm.loading} error={vm.error}>
        <section className="page-panel settings-panel">
          <h2>个人中心</h2>

          <div className="setting-card">
            <h3>账户信息</h3>
            <div>手机号: {vm.profile?.phone}</div>
            <div>已同步文章: {vm.profile?.articleCount ?? 0}</div>
            <div>余额: ¥{((vm.profile?.balanceCent ?? 0) / 100).toFixed(2)}</div>
            <div>免费额度: ¥{((vm.profile?.freeQuotaCent ?? 0) / 100).toFixed(2)}</div>
          </div>

          <div className="setting-card">
            <h3>AI 模型</h3>
            <div className="model-grid">
              {models.map((model) => (
                <button
                  key={model.code}
                  type="button"
                  className={`model-card${vm.profile?.aiModel === model.code ? ' active' : ''}`}
                  onClick={() => vm.updateModel(model.code)}
                  disabled={vm.updatingModel}
                >
                  <div className="model-name">{model.name}</div>
                  <div className="model-desc">{model.desc}</div>
                  <div className="model-price">{model.price}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="setting-card">
            <h3>充值</h3>
            <div className="action-row">
              <input
                type="number"
                min={100}
                step={100}
                className="field-input"
                value={vm.amountCent}
                onChange={(event) => vm.setAmountCent(Number(event.target.value))}
              />
              <button type="button" className="primary-btn" onClick={vm.createPayment} disabled={vm.paying}>
                {vm.paying ? '处理中...' : '发起支付宝支付'}
              </button>
            </div>
            {vm.payError ? <div className="error-tip">{vm.payError}</div> : null}
          </div>

          <div className="setting-card">
            <h3>消费记录</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>类型</th>
                  <th>模型</th>
                  <th>tokens</th>
                  <th>费用</th>
                </tr>
              </thead>
              <tbody>
                {vm.tokenLogs.map((item) => (
                  <tr key={item.id}>
                    <td>{item.createdAt?.slice(0, 16)}</td>
                    <td>{item.bizType}</td>
                    <td>{item.aiModel}</td>
                    <td>{item.inputTokens + item.outputTokens}</td>
                    <td>¥{(item.costCent / 100).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {vm.hasMoreTokenLogs ? (
              <button type="button" className="ghost-btn" onClick={vm.loadMoreTokenLogs} disabled={vm.loadingMoreTokenLogs}>
                {vm.loadingMoreTokenLogs ? '加载中...' : '加载更多'}
              </button>
            ) : null}
          </div>

          <div className="setting-card">
            <h3>充值记录</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>渠道</th>
                  <th>订单号</th>
                  <th>金额</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {vm.paymentOrders.map((item) => (
                  <tr key={item.id}>
                    <td>{item.createdAt?.slice(0, 16)}</td>
                    <td>{item.channel}</td>
                    <td>{item.orderNo}</td>
                    <td>¥{(item.amountCent / 100).toFixed(2)}</td>
                    <td>{item.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {vm.hasMorePaymentOrders ? (
              <button type="button" className="ghost-btn" onClick={vm.loadMorePaymentOrders} disabled={vm.loadingMorePaymentOrders}>
                {vm.loadingMorePaymentOrders ? '加载中...' : '加载更多'}
              </button>
            ) : null}
          </div>

          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              vm.logout();
              RouterManager.navigate(RoutePath.LOGIN, { replace: true });
            }}
          >
            退出登录
          </button>
        </section>
      </PageWrapper>
    </AppLayout>
  );
}
