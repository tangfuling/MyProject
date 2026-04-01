import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { RoutePath } from '../../../common/router/RoutePath';
import { useAuthStore } from '../../../common/state/authStore';
import MainNavTabs from '../../../common/ui/MainNavTabs';
import SettingsApi from '../../settings/api/SettingsApi';
import type { PaymentOrder, TokenLog } from '../../settings/model/SettingsModels';

const modelOptions = [
  { code: 'qwen', name: '千问', desc: '通义千问 · 国产性价比之选', price: '¥2/百万tokens' },
  { code: 'doubao', name: '豆包', desc: '字节豆包 · 中文理解力强', price: '¥3/百万tokens' },
  { code: 'claude', name: 'Claude', desc: 'Anthropic Claude · 分析能力出众', price: '¥15/百万tokens' },
  { code: 'gpt', name: 'GPT', desc: 'OpenAI GPT · 综合能力强', price: '¥10/百万tokens' },
];

const rechargeOptions = [1000, 3000, 5000];

function mergeById<T extends { id: number }>(prev: T[], next: T[], page: number): T[] {
  if (page === 1) {
    return next;
  }
  const map = new Map<number, T>();
  for (const item of prev) {
    map.set(item.id, item);
  }
  for (const item of next) {
    map.set(item.id, item);
  }
  return Array.from(map.values());
}

function formatDateTime(value?: string) {
  if (!value) {
    return '--';
  }
  return value.replace('T', ' ').slice(0, 16);
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const clearAuth = useAuthStore((s) => s.clearAuth);

  const [amountCent, setAmountCent] = useState(1000);
  const [tokenPage, setTokenPage] = useState(1);
  const [paymentPage, setPaymentPage] = useState(1);
  const [tokenLogs, setTokenLogs] = useState<TokenLog[]>([]);
  const [paymentOrders, setPaymentOrders] = useState<PaymentOrder[]>([]);

  const profileQuery = useQuery({ queryKey: ['profile-main'], queryFn: SettingsApi.profile });
  const tokenQuery = useQuery({
    queryKey: ['profile-token-logs', tokenPage],
    queryFn: () => SettingsApi.tokenLogs(tokenPage, 20),
  });
  const paymentQuery = useQuery({
    queryKey: ['profile-payment-orders', paymentPage],
    queryFn: () => SettingsApi.paymentOrders(paymentPage, 20),
  });

  useEffect(() => {
    if (tokenQuery.data) {
      setTokenLogs((prev) => mergeById(prev, tokenQuery.data.records, tokenPage));
    }
  }, [tokenPage, tokenQuery.data]);

  useEffect(() => {
    if (paymentQuery.data) {
      setPaymentOrders((prev) => mergeById(prev, paymentQuery.data.records, paymentPage));
    }
  }, [paymentPage, paymentQuery.data]);

  const updateModelMutation = useMutation({
    mutationFn: async (model: string) => SettingsApi.updateModel(model),
    onSuccess: () => {
      void profileQuery.refetch();
    },
  });

  const createPaymentMutation = useMutation({
    mutationFn: async () => SettingsApi.createPayment(amountCent),
    onSuccess: (result) => {
      window.open(result.payUrl, '_blank', 'noopener,noreferrer');
      void paymentQuery.refetch();
    },
  });

  const profile = profileQuery.data;
  const hasMoreToken = useMemo(() => tokenLogs.length < (tokenQuery.data?.total ?? 0), [tokenLogs.length, tokenQuery.data?.total]);
  const hasMorePayment = useMemo(() => paymentOrders.length < (paymentQuery.data?.total ?? 0), [paymentOrders.length, paymentQuery.data?.total]);

  return (
    <div className="profile-page">
      <div className="profile-shell">
        <div className="app-topbar">
          <a
            className="brand"
            href={RoutePath.ROOT}
            onClick={(event) => {
              event.preventDefault();
              navigate(RoutePath.ROOT);
            }}
          >
            <img className="brand-icon" src="/site-icon-64.png" alt="公众号助手" />
            <div className="brand-name">公众号助手</div>
          </a>
          <MainNavTabs />
          <div className="topbar-right">
            <button className="btn btn-ghost btn-xs" type="button" onClick={() => navigate(RoutePath.WORKSPACE)}>返回工作台</button>
          </div>
        </div>

        <div className="profile-body">
          <div className="profile-head">
            <div className="profile-av">我</div>
            <div>
              <div className="profile-name">{profile?.phone ?? '--'}</div>
              <div className="profile-sub">已同步 {profile?.articleCount ?? 0} 篇文章</div>
            </div>
          </div>

          <div className="section-title">AI 模型</div>
          <div className="card">
            <div className="card-body">
              <div className="model-grid">
                {modelOptions.map((model) => (
                  <button
                    key={model.code}
                    type="button"
                    className={`model-card${profile?.aiModel === model.code ? ' active' : ''}`}
                    onClick={() => updateModelMutation.mutate(model.code)}
                    disabled={updateModelMutation.isPending}
                  >
                    <div className="model-card-check">✓</div>
                    <div className="model-card-name">{model.name}</div>
                    <div className="model-card-desc">{model.desc}</div>
                    <div className="model-card-price">{model.price}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="section-title">余额</div>
          <div className="card">
            <div className="card-body">
              <div className="balance-num">¥{(((profile?.balanceCent ?? 0) + (profile?.freeQuotaCent ?? 0)) / 100).toFixed(2)}</div>
              <div className="balance-sub">可用余额 ¥{((profile?.balanceCent ?? 0) / 100).toFixed(2)} · 免费额度 ¥{((profile?.freeQuotaCent ?? 0) / 100).toFixed(2)}</div>
              <div className="recharge-opts">
                {rechargeOptions.map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    className={`recharge-opt${amountCent === amount ? ' active' : ''}`}
                    onClick={() => setAmountCent(amount)}
                  >
                    <div className="recharge-opt-amount">¥{amount / 100}</div>
                    <div className="recharge-opt-sub">≈ {(amount * 1100).toLocaleString()} tokens</div>
                  </button>
                ))}
              </div>
              <div className="pay-btn-row">
                <button className="btn btn-primary" type="button" style={{ width: '100%', padding: '12px', fontSize: '13px' }} onClick={() => createPaymentMutation.mutate()} disabled={createPaymentMutation.isPending}>
                  {createPaymentMutation.isPending ? '下单中...' : `支付宝支付 ¥${(amountCent / 100).toFixed(0)}`}
                </button>
              </div>
              {createPaymentMutation.error ? <div className="error-tip">{(createPaymentMutation.error as Error).message}</div> : null}
            </div>
          </div>

          <div className="section-title">消费记录</div>
          <div className="card">
            <div className="card-body table-list">
              {tokenLogs.map((item) => (
                <div key={item.id} className="log-item">
                  <div className="log-date">{formatDateTime(item.createdAt)}</div>
                  <div className="log-type">{item.bizType === 'analysis' ? '生成分析' : '对话'}</div>
                  <div className="log-tok">{(item.inputTokens + item.outputTokens).toLocaleString()} tok</div>
                  <div className="log-cost">¥{(item.costCent / 100).toFixed(2)}</div>
                </div>
              ))}
              {hasMoreToken ? (
                <button type="button" className="more-link-btn" onClick={() => setTokenPage((prev) => prev + 1)} disabled={tokenQuery.isFetching}>
                  {tokenQuery.isFetching ? '加载中...' : '加载更多'}
                </button>
              ) : null}
            </div>
          </div>

          <div className="section-title">充值记录</div>
          <div className="card">
            <div className="card-body table-list">
              {paymentOrders.map((item) => (
                <div key={item.id} className="pay-item">
                  <div className="pay-date">{formatDateTime(item.createdAt)}</div>
                  <div className="pay-channel">{item.channel === 'free_quota' ? '免费额度（注册赠送）' : '支付宝'}</div>
                  <div className="pay-amount">+¥{(item.amountCent / 100).toFixed(2)}</div>
                </div>
              ))}
              {hasMorePayment ? (
                <button type="button" className="more-link-btn" onClick={() => setPaymentPage((prev) => prev + 1)} disabled={paymentQuery.isFetching}>
                  {paymentQuery.isFetching ? '加载中...' : '加载更多'}
                </button>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            className="btn btn-ghost"
            style={{ color: 'var(--red)', borderColor: '#fecdd3' }}
            onClick={() => {
              clearAuth();
              navigate(RoutePath.ROOT, { replace: true });
            }}
          >
            退出登录
          </button>
        </div>
      </div>
    </div>
  );
}
