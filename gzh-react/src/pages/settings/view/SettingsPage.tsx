import { RoutePath } from '../../../common/router/RoutePath';
import RouterManager from '../../../common/router/RouterManager';
import AppLayout from '../../../common/ui/AppLayout';
import PageWrapper from '../../../common/base/PageWrapper';
import { useSettingsViewModel } from '../viewmodel/useSettingsViewModel';

const models = ['qwen', 'doubao', 'gpt', 'claude'];

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
            <div className="chip-row">
              {models.map((model) => (
                <button
                  key={model}
                  type="button"
                  className={`chip${vm.profile?.aiModel === model ? ' active' : ''}`}
                  onClick={() => vm.updateModel(model)}
                  disabled={vm.updatingModel}
                >
                  {model}
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
