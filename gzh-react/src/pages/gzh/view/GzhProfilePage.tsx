import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { RoutePath } from '../../../common/router/RoutePath';
import { useAuthStore } from '../../../common/state/authStore';
import { HttpConfig } from '../../../common/network/HttpConfig';
import SettingsApi from '../../settings/api/SettingsApi';
import type { PaymentOrder, TokenLog, UpdateUserProfilePayload } from '../../settings/model/SettingsModels';
import WorkspaceApi from '../../workspace/api/WorkspaceApi';
import './GzhPages.css';

const MODEL_OPTIONS = [
  { code: 'qwen_3_5', name: '千问 3.5-Flash', desc: '通义千问 3.5-Flash · 速度更快，适合日常分析' },
  { code: 'qwen_3_6', name: '千问 3.6-Plus', desc: '通义千问 3.6-Plus · 推理更强，适合深度建议' },
];

const RECHARGE_OPTIONS = [10, 100, 1000, 3000, 5000];

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

function fmtToken(v?: number | null) {
  const n = Math.max(0, Math.round(v ?? 0));
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}K`;
  }
  return n.toLocaleString('zh-CN');
}

function formatAmount(amountCent: number) {
  return new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amountCent / 100);
}

function mapTokenType(type: string) {
  if (type === 'analysis') return '生成分析（按筛选时间）';
  if (type === 'chat') return '对话';
  if (type === 'sync') return '数据同步';
  return type || '--';
}

function mapChannel(channel: string) {
  if (channel === 'free_quota') return '免费额度（注册赠送）';
  if (channel.toLowerCase().includes('ali')) return '支付宝';
  return channel || '--';
}

function mapPaymentStatus(status: string) {
  const value = (status || '').toUpperCase();
  if (value === 'PAID') return '支付成功';
  if (value === 'PENDING') return '待支付';
  if (value === 'EXPIRED') return '已过期';
  if (value === 'CLOSED') return '已关闭';
  return status || '--';
}

function resolveAvatarUrl(rawUrl?: string) {
  const url = (rawUrl || '').trim();
  if (!url) return '';
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('data:')) {
    return url;
  }
  const base = HttpConfig.getBaseUrl().replace(/\/+$/, '');
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
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
  const [editingName, setEditingName] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const avatarFileRef = useRef<HTMLInputElement | null>(null);

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
    document.title = '公众号运营助手 · 个人中心';
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

  useEffect(() => {
    const profile = profileQuery.data;
    if (!profile) return;
    if (!editingName) {
      setDisplayNameDraft(profile.displayName || '');
    }
  }, [editingName, profileQuery.data]);

  useEffect(() => {
    const profile = profileQuery.data;
    if (!profile) return;
    updateAuthProfile({
      displayName: profile.displayName || undefined,
      mpAccountName: profile.mpAccountName || undefined,
      avatarUrl: profile.avatarUrl || undefined,
      aiModel: profile.aiModel,
    });
  }, [profileQuery.data]);

  const updateModelMutation = useMutation({
    mutationFn: async (model: string) => SettingsApi.updateModel(model),
    onSuccess: (_res, model) => {
      updateAuthProfile({ aiModel: model });
      void profileQuery.refetch();
    },
  });

  const updateProfileMutation = useMutation({
    mutationFn: async (payload: UpdateUserProfilePayload) => SettingsApi.updateProfile(payload),
    onSuccess: (_res, payload) => {
      if (payload.displayName !== undefined) {
        updateAuthProfile({ displayName: payload.displayName || undefined });
      }
      setEditingName(false);
      void profileQuery.refetch();
      void workspaceBriefQuery.refetch();
    },
  });

  const uploadAvatarMutation = useMutation({
    mutationFn: async (file: File) => SettingsApi.uploadAvatar(file),
    onSuccess: (avatarUrl) => {
      setAvatarPreview(null);
      updateAuthProfile({ avatarUrl });
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

  const saveDisplayName = () => {
    const value = displayNameDraft.trim();
    if (!value) {
      return;
    }
    updateProfileMutation.mutate({ displayName: value });
  };

  const handlePickAvatar = () => {
    avatarFileRef.current?.click();
  };

  const handleAvatarFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setAvatarPreview(reader.result);
      }
    };
    reader.readAsDataURL(file);
    uploadAvatarMutation.mutate(file);
  };

  const profile = profileQuery.data;
  const accountName = profile?.mpAccountName?.trim() || workspaceBriefQuery.data?.header.accountName || '公众号账号';
  const userName = profile?.displayName?.trim() || '创作者';
  const balanceAmount = ((profile?.balanceCent ?? 0) + (profile?.freeQuotaCent ?? 0)) / 100;
  const hasMoreToken = useMemo(() => tokenLogs.length < (tokenQuery.data?.total ?? 0), [tokenLogs.length, tokenQuery.data?.total]);
  const hasMorePayment = useMemo(() => paymentOrders.length < (paymentQuery.data?.total ?? 0), [paymentOrders.length, paymentQuery.data?.total]);
  const avatarText = userName.slice(0, 1).toUpperCase() || '创';
  const currentAvatarUrl = avatarPreview || resolveAvatarUrl(profile?.avatarUrl);

  return (
    <div className="gzh-v2-root gzh-v2-profile">
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-nav">
            <button className="topbar-nav-item" type="button" onClick={() => navigate(RoutePath.GZH_HOME)}>{'首页'}</button>
            <button className="topbar-nav-item" type="button" onClick={() => navigate(RoutePath.GZH_WORKSPACE)}>{'工作台'}</button>
            <button className="topbar-nav-item" type="button" onClick={() => navigate(RoutePath.GZH_DETAIL)}>{'文章详情'}</button>
            <button className="topbar-nav-item active" type="button" onClick={() => navigate(RoutePath.GZH_PROFILE)}>{'个人中心'}</button>
          </div>
          <div className="topbar-account">{accountName}</div>
        </div>
        <div className="topbar-right">
          <button className="btn btn-ghost" type="button" onClick={() => navigate(RoutePath.GZH_WORKSPACE)}>
            {'返回工作台'}
          </button>
        </div>
      </div>

      <div className="profile-body">
        <div className="profile-header-card">
          <input
            ref={avatarFileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleAvatarFileChange}
          />
          <button className="prof-avatar clickable" type="button" onClick={handlePickAvatar}>
            {currentAvatarUrl ? <img src={currentAvatarUrl} alt={userName} /> : avatarText}
            <span className="prof-avatar-edit">{uploadAvatarMutation.isPending ? '上传中...' : '更换'}</span>
          </button>
          <div>
            <div className="prof-info-name-row">
              {editingName ? (
                <input
                  className="profile-input prof-name-input"
                  type="text"
                  maxLength={64}
                  value={displayNameDraft}
                  onChange={(event) => setDisplayNameDraft(event.target.value)}
                  placeholder="请输入用户名称"
                />
              ) : (
                <div className="prof-info-name">{userName}</div>
              )}
              {editingName ? (
                <div className="prof-name-actions">
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={saveDisplayName}
                    disabled={updateProfileMutation.isPending || !displayNameDraft.trim()}
                  >
                    {updateProfileMutation.isPending ? '保存中...' : '保存'}
                  </button>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => {
                      setEditingName(false);
                      setDisplayNameDraft(profile?.displayName || '');
                    }}
                    disabled={updateProfileMutation.isPending}
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button className="btn btn-ghost prof-edit-btn" type="button" onClick={() => setEditingName(true)}>
                  编辑
                </button>
              )}
            </div>
            <div className="prof-info-sub">公众号：{accountName} · 已同步 {profile?.articleCount ?? 0} 篇文章 · 绑定手机 {maskPhone(profile?.phone)}</div>
            {updateProfileMutation.error ? <div className="error-tip">{(updateProfileMutation.error as Error).message}</div> : null}
            {uploadAvatarMutation.error ? <div className="error-tip">{(uploadAvatarMutation.error as Error).message}</div> : null}
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
                  <div>¥{formatAmount(amount)}</div>
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
              {createPaymentMutation.isPending ? '创建订单中...' : `支付宝支付 ¥${formatAmount(amountCent)}`}
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
                      <td>{fmtToken(item.inputTokens + item.outputTokens)} token</td>
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
                  <th>支付状态</th>
                </tr>
              </thead>
              <tbody>
                {paymentOrders.length === 0 ? (
                  <tr>
                    <td colSpan={4}>暂无记录</td>
                  </tr>
                ) : (
                  paymentOrders.map((item) => (
                    <tr key={item.id}>
                      <td>{formatDateTime(item.createdAt)}</td>
                      <td>{mapChannel(item.channel)}</td>
                      <td className="amt-positive">+¥{(item.amountCent / 100).toFixed(2)}</td>
                      <td>{mapPaymentStatus(item.status)}</td>
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
