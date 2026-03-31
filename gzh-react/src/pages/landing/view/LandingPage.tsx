import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { RoutePath } from '../../../common/router/RoutePath';
import { useAuthStore } from '../../../common/state/authStore';
import { useLoginModalStore } from '../../../common/state/loginModalStore';
import MainNavTabs from '../../../common/ui/MainNavTabs';

export default function LandingPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const openLoginModal = useLoginModalStore((s) => s.openModal);

  const openLogin = (nextRedirect?: string) => {
    openLoginModal(nextRedirect || RoutePath.WORKSPACE);
  };

  useEffect(() => {
    const state = location.state as { loginRequired?: boolean; redirect?: string } | null;
    if (!state?.loginRequired) {
      return;
    }
    openLoginModal(state.redirect || RoutePath.WORKSPACE);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location.pathname, location.search, location.state, navigate, openLoginModal]);

  return (
    <div className="landing-page">
      <header className="landing-header">
        <a className="brand" href="#" onClick={(event) => event.preventDefault()}>
          <div className="brand-icon">✦</div>
          <div className="brand-name">公众号数据运营助手</div>
        </a>
        <MainNavTabs />
        <div className="header-right">
          <button className="btn btn-outline btn-sm" type="button" onClick={() => openLogin(RoutePath.WORKSPACE)}>登录</button>
          <button className="btn btn-primary btn-sm" type="button">安装插件</button>
        </div>
      </header>

      <section className="hero">
        <div className="hero-eyebrow">给公众号创作者的 AI 运营助手</div>
        <h1 className="hero-title">
          同步数据，<span>AI 帮你看清</span><br />下一步该怎么做
        </h1>
        <p className="hero-subtitle">
          安装 Chrome 插件，一键同步微信公众号数据。AI 自动分析阅读趋势、渠道来源、内容风格，给你可直接执行的建议。
        </p>
        <div className="hero-ctas">
          <button className="hero-cta-primary" type="button" onClick={() => openLogin(RoutePath.WORKSPACE)}>安装 Chrome 插件，免费开始</button>
          <button
            className="hero-cta-secondary"
            type="button"
            onClick={() => {
              if (token) {
                navigate(RoutePath.WORKSPACE);
              } else {
                openLogin(RoutePath.WORKSPACE);
              }
            }}
          >
            查看示例工作台 →
          </button>
        </div>
        <div className="hero-note">新用户注册赠 <b>¥1.00</b> 免费额度 · 按 token 计费 · 无月订阅</div>
      </section>

      <section className="steps-section">
        <h2 className="steps-title">三步开始使用</h2>
        <p className="steps-sub">整个过程 2 分钟完成</p>
        <div className="steps-grid">
          <div className="step-card">
            <div className="step-num">1</div>
            <div className="step-title">安装 Chrome 插件</div>
            <div className="step-desc">从 Chrome 应用商店安装，登录手机号账号，完成绑定。</div>
          </div>
          <div className="step-card">
            <div className="step-num">2</div>
            <div className="step-title">一键同步数据</div>
            <div className="step-desc">打开微信公众号后台，点击悬浮按钮，自动采集全部文章数据。</div>
          </div>
          <div className="step-card">
            <div className="step-num">3</div>
            <div className="step-title">AI 分析 + 对话</div>
            <div className="step-desc">AI 自动生成分析报告，你可以继续追问任何运营问题。</div>
          </div>
        </div>
      </section>

      <section className="pricing-section">
        <div className="pricing-inner">
          <h2 className="pricing-title">按量计费，完全透明</h2>
          <p className="pricing-sub">没有订阅费，不用时不收费，每次调用 AI 前都会显示预估费用。</p>
          <div className="pricing-list">
            <div className="pricing-item">✓ 注册赠 ¥1.00 免费额度，够用约 5 次分析</div>
            <div className="pricing-item">✓ 生成一次分析报告约 ¥0.15–0.20</div>
            <div className="pricing-item">✓ 对话每轮约 ¥0.01–0.05</div>
            <div className="pricing-item">✓ 支付宝充值，最低 ¥10</div>
          </div>
          <button className="btn btn-primary" type="button" style={{ width: '100%', padding: '13px', fontSize: '14px' }} onClick={() => openLogin(RoutePath.WORKSPACE)}>
            免费注册开始使用
          </button>
        </div>
      </section>

      <footer className="landing-footer">© 2026 公众号数据运营助手</footer>
    </div>
  );
}
