import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { RoutePath } from '../../../common/router/RoutePath';
import { useAuthStore } from '../../../common/state/authStore';
import { useLoginModalStore } from '../../../common/state/loginModalStore';
import { HttpConfig } from '../../../common/network/HttpConfig';
import WorkspaceApi from '../../workspace/api/WorkspaceApi';
import './GzhPages.css';

type HomePreviewMetrics = {
  totalRead: number;
  avgRead: number;
  recommendRate: number;
  completionRate: number;
  totalReadDelta: number;
  avgReadDelta: number;
  recommendRateDelta: number;
  completionRateDelta: number;
  syncAt: string;
  rangeLabel: string;
};

const FALLBACK_PREVIEW: HomePreviewMetrics = {
  totalRead: 640,
  avgRead: 80,
  recommendRate: 18.6,
  completionRate: 62,
  totalReadDelta: 12,
  avgReadDelta: 5,
  recommendRateDelta: 4.2,
  completionRateDelta: -3,
  syncAt: '2026-03-24 14:30',
  rangeLabel: '近30天',
};

const RANGE_LABEL_MAP: Record<string, string> = {
  '7d': '近7天',
  '30d': '近30天',
  '90d': '近90天',
  all: '全部',
};

const PLUGIN_DOWNLOAD_URL = (import.meta.env.VITE_GZH_PLUGIN_DOWNLOAD_URL || '').trim();

function fmtNum(v: number) {
  return v.toLocaleString('zh-CN');
}

function fmtDateTime(v?: string | Date) {
  if (!v) return '--';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '--';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtDeltaPercent(value: number, digits = 0) {
  const arrow = value >= 0 ? '↑' : '↓';
  return `${arrow} ${Math.abs(value).toFixed(digits)}%`;
}

function normalizePercent(raw?: number | null) {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n <= 1 ? n * 100 : n;
}

function recommendRateFromSummary(summary: Record<string, number>) {
  const entries = Object.entries(summary || {}).filter(([, value]) => Number(value) > 0);
  if (entries.length === 0) return 0;
  let recommendCount = 0;
  let total = 0;
  entries.forEach(([key, value]) => {
    const amount = Number(value) || 0;
    const lower = key.toLowerCase();
    if (key.includes('推荐') || lower.includes('recommend')) {
      recommendCount += amount;
    }
    total += amount;
  });
  if (total <= 0) return 0;
  return (recommendCount * 100) / total;
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

export default function GzhHomePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const profile = useAuthStore((s) => s.profile);
  const openLoginModal = useLoginModalStore((s) => s.openModal);

  const openLogin = (redirect?: string) => {
    openLoginModal(redirect || RoutePath.GZH_WORKSPACE);
  };

  const gotoWorkspace = () => {
    if (token) {
      navigate(RoutePath.GZH_WORKSPACE);
      return;
    }
    openLogin(RoutePath.GZH_WORKSPACE);
  };

  useEffect(() => {
    document.title = '公众号运营助手';
  }, []);

  useEffect(() => {
    const state = location.state as { loginRequired?: boolean; redirect?: string } | null;
    const query = new URLSearchParams(location.search);
    const needLogin = state?.loginRequired || query.get('openLogin') === '1';
    if (!needLogin) {
      return;
    }
    const redirect = state?.redirect || query.get('redirect') || RoutePath.GZH_WORKSPACE;
    openLoginModal(redirect);
    if (query.get('openLogin') === '1') {
      query.delete('openLogin');
      query.delete('redirect');
      const cleaned = query.toString();
      navigate(`${location.pathname}${cleaned ? `?${cleaned}` : ''}`, { replace: true, state: null });
    }
  }, [location.pathname, location.search, location.state, navigate, openLoginModal]);

  const overviewQuery = useQuery({
    queryKey: ['home-preview-overview'],
    queryFn: () => WorkspaceApi.overview('30d'),
    enabled: Boolean(token),
    staleTime: 60_000,
  });

  const preview = useMemo<HomePreviewMetrics>(() => {
    if (!token || !overviewQuery.data) {
      return FALLBACK_PREVIEW;
    }
    const overview = overviewQuery.data;
    const metrics = overview.dataPanel?.metrics;
    const changes = overview.dataPanel?.changes;
    if (!metrics) {
      return FALLBACK_PREVIEW;
    }
    return {
      totalRead: Number(metrics.totalRead || 0),
      avgRead: Number(metrics.avgRead || 0),
      recommendRate: recommendRateFromSummary(overview.dataPanel?.trafficSummary || {}),
      completionRate: normalizePercent(metrics.completionRate),
      totalReadDelta: Number(changes?.totalRead || 0),
      avgReadDelta: Number(changes?.avgRead || 0),
      recommendRateDelta: 0,
      completionRateDelta: Number(changes?.completionRate || 0),
      syncAt: fmtDateTime(overview.header?.lastSyncAt),
      rangeLabel: RANGE_LABEL_MAP[overview.range] || '近30天',
    };
  }, [overviewQuery.data, token]);

  const accountName = overviewQuery.data?.header.accountName || profile?.mpAccountName?.trim() || '公众号账号';
  const userName = profile?.displayName?.trim() || profile?.phone || '创作者';
  const userInitial = userName.slice(0, 1).toUpperCase() || '创';
  const userAvatarUrl = resolveAvatarUrl(profile?.avatarUrl);
  const hasPluginDownload = Boolean(PLUGIN_DOWNLOAD_URL);

  return (
    <div className="gzh-v2-root gzh-v2-home">
      <div className="home-topbar">
        <div className="topbar-left">
          <div className="topbar-nav">
            <button className="topbar-nav-item active" type="button" onClick={() => navigate(RoutePath.GZH_HOME)}>{'首页'}</button>
            <button className="topbar-nav-item" type="button" onClick={() => (token ? navigate(RoutePath.GZH_WORKSPACE) : openLogin(RoutePath.GZH_WORKSPACE))}>{'工作台'}</button>
            <button className="topbar-nav-item" type="button" onClick={() => (token ? navigate(RoutePath.GZH_DETAIL) : openLogin(RoutePath.GZH_DETAIL))}>{'文章详情'}</button>
            <button className="topbar-nav-item" type="button" onClick={() => (token ? navigate(RoutePath.GZH_PROFILE) : openLogin(RoutePath.GZH_PROFILE))}>{'个人中心'}</button>
          </div>
          <div className="topbar-account">{accountName}</div>
        </div>
        <div className="home-topbar-right">
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => {
              if (!hasPluginDownload) return;
              window.open(PLUGIN_DOWNLOAD_URL, '_blank', 'noopener,noreferrer');
            }}
            disabled={!hasPluginDownload}
            title={hasPluginDownload ? '下载安装公众号运营助手插件' : '请先配置 VITE_GZH_PLUGIN_DOWNLOAD_URL'}
          >
            {hasPluginDownload ? '下载插件' : '插件地址待配置'}
          </button>
          {token ? (
            <button className="home-user-chip" type="button" onClick={() => navigate(RoutePath.GZH_PROFILE)}>
              <span className="home-user-avatar">
                {userAvatarUrl ? (
                  <img src={userAvatarUrl} alt={userName} />
                ) : (
                  <span>{userInitial}</span>
                )}
              </span>
              <span className="home-user-name">{userName}</span>
            </button>
          ) : (
            <>
              <button className="btn btn-ghost" type="button" onClick={() => openLogin(RoutePath.GZH_WORKSPACE)}>{'登录 / 注册'}</button>
              <button className="btn btn-primary" type="button" onClick={gotoWorkspace}>{'免费开始'}</button>
            </>
          )}
        </div>
      </div>

      <div className="hero">
        <div className="eyebrow">✓ AI 驱动 · 公众号数据分析</div>
        <h1>
          让每一篇内容
          <br />
          <span className="grad-text">数据可见、写作可循</span>
        </h1>
        <p className="hero-sub">
          一键同步公众号历史数据，AI 深度分析阅读趋势、互动规律与读者偏好，帮助你持续写出更受欢迎的内容。
        </p>
        <div className="hero-ctas">
          <button className="btn btn-primary" type="button" onClick={gotoWorkspace}>免费开始使用</button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => {
              if (token) {
                navigate(RoutePath.GZH_WORKSPACE);
              } else {
                openLogin(RoutePath.GZH_WORKSPACE);
              }
            }}
          >
            查看演示
          </button>
        </div>
        <p className="hero-note">注册即送 ¥1 试用额度 · 无月费 · 随时可升级</p>

        <div className="hero-preview">
          <div className="preview-head">
            <span className="preview-head-title">数据概览 · {preview.rangeLabel}</span>
            <span className="preview-sync">
              {token && overviewQuery.isFetching ? '同步中...' : `同步时间 ${preview.syncAt}`}
            </span>
          </div>
          <div className="preview-kpis">
            <div className="kpi-tile">
              <div className="kpi-tile-label">总阅读</div>
              <div className="kpi-tile-value">{fmtNum(preview.totalRead)}</div>
              <div className={`kpi-tile-delta ${preview.totalReadDelta >= 0 ? 'delta-up' : 'delta-down'}`}>{fmtDeltaPercent(preview.totalReadDelta, 0)}</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile-label">篇均阅读</div>
              <div className="kpi-tile-value">{fmtNum(preview.avgRead)}</div>
              <div className={`kpi-tile-delta ${preview.avgReadDelta >= 0 ? 'delta-up' : 'delta-down'}`}>{fmtDeltaPercent(preview.avgReadDelta, 0)}</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile-label">推荐率</div>
              <div className="kpi-tile-value">{preview.recommendRate.toFixed(1)}%</div>
              <div className={`kpi-tile-delta ${preview.recommendRateDelta >= 0 ? 'delta-up' : 'delta-down'}`}>{fmtDeltaPercent(preview.recommendRateDelta, 1)}</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile-label">完读率</div>
              <div className="kpi-tile-value">{preview.completionRate.toFixed(0)}%</div>
              <div className={`kpi-tile-delta ${preview.completionRateDelta >= 0 ? 'delta-up' : 'delta-down'}`}>{fmtDeltaPercent(preview.completionRateDelta, 0)}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-title">三步开始提升内容效果</div>
        <div className="section-sub">流程简单，开箱即可用</div>
        <div className="steps-grid">
          <div className="step-card">
            <div className="step-num">1</div>
            <div className="step-title">下载安装插件</div>
            <div className="step-desc">
              从 OSS 下载「公众号运营助手」插件包，解压后在 Chrome 扩展管理页点击“加载已解压的扩展程序”即可使用。
            </div>
            {hasPluginDownload ? (
              <button
                className="btn btn-ghost step-download-btn"
                type="button"
                onClick={() => window.open(PLUGIN_DOWNLOAD_URL, '_blank', 'noopener,noreferrer')}
              >
                下载插件
              </button>
            ) : null}
          </div>
          <div className="step-card">
            <div className="step-num">2</div>
            <div className="step-title">一键同步数据</div>
            <div className="step-desc">登录公众号后台后点击插件按钮，自动抓取文章列表、阅读量、推荐率等指标。</div>
          </div>
          <div className="step-card">
            <div className="step-num">3</div>
            <div className="step-title">AI 智能分析</div>
            <div className="step-desc">在工作台中，AI 基于数据给你提供具体可执行的选题与写作建议。</div>
          </div>
        </div>
      </div>

      <div className="section" style={{ paddingTop: 0 }}>
        <div className="section-title">为内容创作者打造的数据工具</div>
        <div className="section-sub">不只展示数据，更给可执行建议</div>
        <div className="features-grid">
          <div className="feat-card">
            <div className="feat-icon">📳</div>
            <div className="feat-title">数据全面同步</div>
            <div className="feat-desc">支持同步文章全文、阅读量、推荐率、分享、完读率，建立完整数据档案。</div>
          </div>
          <div className="feat-card">
            <div className="feat-icon">🧠</div>
            <div className="feat-title">AI 周期分析</div>
            <div className="feat-desc">基于你选定的时间范围分析高阅读规律、读者互动模式，给出可执行写作建议。</div>
          </div>
          <div className="feat-card">
            <div className="feat-icon">✍️</div>
            <div className="feat-title">持续优化写作</div>
            <div className="feat-desc">每次分析输出本周可执行动作，帮助你持续迭代内容策略。</div>
          </div>
        </div>
      </div>

      <div className="section" style={{ paddingTop: 0 }}>
        <div className="pricing-card">
          <div className="pricing-title">额度与费用说明</div>
          <div className="pricing-sub">新用户注册赠送 ¥1 试用额度，按实际调用结算</div>
          <ul className="pricing-list">
            <li>新用户注册即送 ¥1 试用额度</li>
            <li>按量计费，无月费无隐藏费用</li>
            <li>随时充值，余额长期有效</li>
          </ul>
          <div className="pricing-note">可在个人中心切换 AI 模型（千问 / 豆包 / Claude / GPT）</div>
          <button className="btn btn-primary pricing-main-btn" type="button" onClick={gotoWorkspace}>
            免费开始，领取 ¥1 试用额度
          </button>
        </div>
      </div>

      <div className="home-footer">© 2026 北京青天牛马科技有限公司 版权所有</div>
    </div>
  );
}
