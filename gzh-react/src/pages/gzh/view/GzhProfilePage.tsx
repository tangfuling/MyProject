import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { RoutePath } from '../../../common/router/RoutePath';
import { useAuthStore } from '../../../common/state/authStore';
import SettingsApi from '../../settings/api/SettingsApi';
import type { PaymentOrder, TokenLog } from '../../settings/model/SettingsModels';
import WorkspaceApi from '../../workspace/api/WorkspaceApi';
import './GzhPages.css';

const MODEL_OPTIONS = [
  { code: 'qwen', name: '千问', desc: '通义千问 · 国产性价比之选', price: '¥2 / 百万tokens' },
  { code: 'doubao', name: '豆包', desc: '字节豆包 · 中文理解力强', price: '¥3 / 百万tokens' },
  { code: 'claude', name: 'Claude', desc: 'Anthropic Claude · 分析能力出众', price: '¥15 / 百万tokens' },
  { code: 'gpt', name: 'GPT', desc: 'OpenAI GPT-4o · 综合能力强', price: '¥10 / 百万tokens' },
];

const RECHARGE_OPTIONS = [1000, 3000, 5000];

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

function maskPhone(phone?: string) {
  if (!phone) return '--';
  if (phone.length < 7) return phone;
  return `${phone.slice(0, 3)} **** ${phone.slice(-4)}`;
}

function formatDateTime(value?: string) {
  if (!value) {
    return '--';
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return value.replace('T', ' ').slice(0, 16);
  }
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function mapTokenType(type: string) {
  if (type === 'analysis') return '生成分析（近30天）';
  if (type === 'chat') return '对话';
  if (type === 'sync') return '数据同步';
  return type || '--';
}

function mapChannel(channel: string) {
  if (channel === 'free_quota') return '免费额度（注册赠送）';
  if (channel.toLowerCase().includes('ali')) return '支付宝';
  return channel || '--';
}

export default function GzhProfilePage() {
  const navigate = useNavigate();
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const updateAuthProfile = useAuthStore((s) => s.updateProfile);

  const [amountCent, setAmountCent] = useState(1000);
  const [tokenPage, setTokenPage] = useState(1);
  const [paymentPage, setPaymentPage] = useState(1);
  const [tokenLogs, setTokenLogs] = useState<TokenLog[]>([]);
  const [paymentOrders, setPaymentOrders] = useState<PaymentOrder[]>([]);

  const profileQuery = useQuery({ queryKey: ['profile-main'], queryFn: SettingsApi.profile });
  const workspaceBriefQuery = useQuery({
    queryKey: ['workspace-overview-profile-brief'],
    queryFn: () => WorkspaceApi.overview('30d'),
    staleTime: 60_000,
  });

  const tokenQuery = useQuery({
    queryKey: ['profile-token-logs', tokenPage],
    queryFn: () => SettingsApi.tokenLogs(tokenPage, 20),
  });

  const paymentQuery = useQuery({
    queryKey: ['profile-payment-orders', paymentPage],
    queryFn: () => SettingsApi.paymentOrders(paymentPage, 20),
  });

  useEffect(() => {
    document.title = '\u516c\u4f17\u53f7\u8fd0\u8425\u52a9\u624b \u00b7 \u4e2a\u4eba\u4e2d\u5fc3';
  }, []);

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
    onSuccess: (_res, model) => {
      updateAuthProfile({ aiModel: model });
      void profileQuery.refetch();
    },
  });

  const createPaymentMutation = useMutation({
    mutationFn: async () => SettingsApi.createPayment(amountCent),
    onSuccess: (result) => {
      window.open(result.payUrl, '_blank', 'noopener,noreferrer');
      void paymentQuery.refetch();
      void profileQuery.refetch();
    },
  });

  const profile = profileQuery.data;
  const accountName = workspaceBriefQuery.data?.header.accountName || '\u516c\u4f17\u53f7\u8fd0\u8425\u52a9\u624b';
  const balanceAmount = ((profile?.balanceCent ?? 0) + (profile?.freeQuotaCent ?? 0)) / 100;
  const hasMoreToken = useMemo(() => tokenLogs.length < (tokenQuery.data?.total ?? 0), [tokenLogs.length, tokenQuery.data?.total]);
  const hasMorePayment = useMemo(() => paymentOrders.length < (paymentQuery.data?.total ?? 0), [paymentOrders.length, paymentQuery.data?.total]);

  return (
    <div className="gzh-v2-root gzh-v2-profile">
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-nav">
            <button className="topbar-nav-item" type="button" onClick={() => navigate(RoutePath.GZH_HOME)}>{'\u9996\u9875'}</button>
            <button className="topbar-nav-item" type="button" onClick={() => navigate(RoutePath.GZH_WORKSPACE)}>{'\u5de5\u4f5c\u53f0'}</button>
            <button className="topbar-nav-item" type="button" onClick={() => navigate(RoutePath.GZH_DETAIL)}>{'\u6587\u7ae0\u8be6\u60c5'}</button>
            <button className="topbar-nav-item active" type="button" onClick={() => navigate(RoutePath.GZH_PROFILE)}>{'\u4e2a\u4eba\u4e2d\u5fc3'}</button>
          </div>
          <div className="topbar-account">{accountName}</div>
        </div>
        <div className="topbar-right">
          <button className="btn btn-ghost" type="button" onClick={() => navigate(RoutePath.GZH_WORKSPACE)}>
            ← 返回工作台
          </button>
        </div>
      </div>

      <div className="profile-body">
        <div className="profile-header-card">
          <div className="prof-avatar">T</div>
          <div>
            <div className="prof-info-name">{maskPhone(profile?.phone)}</div>
            <div className="prof-info-sub">已同步 {profile?.articleCount ?? 0} 篇文章 · {accountName}</div>
          </div>
        </div>

        <div className="profile-section">
          <div className="profile-section-title">AI 模型</div>
          <div className="section-card">
            <div className="model-grid">
              {MODEL_OPTIONS.map((model) => (
                <button
                  key={model.code}
                  type="button"
                  className={`model-option${profile?.aiModel === model.code ? ' active' : ''}`}
                  onClick={() => updateModelMutation.mutate(model.code)}
                  disabled={updateModelMutation.isPending}
                >
                  <div className="model-check">✓</div>
                  <div className="model-name">{model.name}</div>
                  <div className="model-desc">{model.desc}</div>
                  <div className="model-price">{model.price}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="profile-section">
          <div className="profile-section-title">账户余额</div>
          <div className="section-card">
            <div className="balance-amount">¥{balanceAmount.toFixed(2)}</div>
            <div className="balance-sub">含免费额度 ¥{((profile?.freeQuotaCent ?? 0) / 100).toFixed(2)}</div>
            <div className="recharge-opts">
              {RECHARGE_OPTIONS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  className={`recharge-opt${amountCent === amount ? ' active' : ''}`}
                  onClick={() => setAmountCent(amount)}
                >
                  <div>¥{amount / 100}</div>
                  <div className="recharge-opt-sub">≈ {(amount * 1100).toLocaleString('zh-CN')} tokens</div>
                </button>
              ))}
            </div>
            <button
              className="btn btn-primary"
              id="pay-btn"
              type="button"
              style={{ width: '100%', justifyContent: 'center', height: '44px', fontSize: '14px' }}
              onClick={() => createPaymentMutation.mutate()}
              disabled={createPaymentMutation.isPending}
            >
              {createPaymentMutation.isPending ? '创建订单中...' : `支付宝支付 ¥${(amountCent / 100).toFixed(0)}`}
            </button>
            {createPaymentMutation.error ? <div className="error-tip">{(createPaymentMutation.error as Error).message}</div> : null}
          </div>
        </div>

        <div className="profile-section">
          <div className="profile-section-title">消费记录</div>
          <div className="section-card">
            <table className="rec-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>类型</th>
                  <th>Token</th>
                  <th>费用</th>
                </tr>
              </thead>
              <tbody>
                {tokenLogs.length === 0 ? (
                  <tr>
                    <td colSpan={4}>暂无记录</td>
                  </tr>
                ) : (
                  tokenLogs.map((item) => (
                    <tr key={item.id}>
                      <td>{formatDateTime(item.createdAt)}</td>
                      <td>{mapTokenType(item.bizType)}</td>
                      <td>{(item.inputTokens + item.outputTokens).toLocaleString('zh-CN')} tok</td>
                      <td className="amt-negative">-¥{(item.costCent / 100).toFixed(2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {hasMoreToken ? (
              <button
                type="button"
                className="load-more"
                onClick={() => setTokenPage((prev) => prev + 1)}
                disabled={tokenQuery.isFetching}
              >
                {tokenQuery.isFetching ? '加载中...' : '加载更多'}
              </button>
            ) : null}
          </div>
        </div>

        <div className="profile-section">
          <div className="profile-section-title">充值记录</div>
          <div className="section-card">
            <table className="rec-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>渠道</th>
                  <th>金额</th>
                </tr>
              </thead>
              <tbody>
                {paymentOrders.length === 0 ? (
                  <tr>
                    <td colSpan={3}>暂无记录</td>
                  </tr>
                ) : (
                  paymentOrders.map((item) => (
                    <tr key={item.id}>
                      <td>{formatDateTime(item.createdAt)}</td>
                      <td>{mapChannel(item.channel)}</td>
                      <td className="amt-positive">+¥{(item.amountCent / 100).toFixed(2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {hasMorePayment ? (
              <button
                type="button"
                className="load-more"
                onClick={() => setPaymentPage((prev) => prev + 1)}
                disabled={paymentQuery.isFetching}
              >
                {paymentQuery.isFetching ? '加载中...' : '加载更多'}
              </button>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          className="btn logout-btn"
          onClick={() => {
            clearAuth();
            navigate(RoutePath.GZH_HOME, { replace: true });
          }}
        >
          退出登录
        </button>
      </div>
    </div>
  );
}