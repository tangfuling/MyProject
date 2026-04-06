import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { RoutePath } from '../../../common/router/RoutePath';
import { useAuthStore } from '../../../common/state/authStore';
import { useLoginModalStore } from '../../../common/state/loginModalStore';
import './GzhPages.css';

export default function GzhHomePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const openLoginModal = useLoginModalStore((s) => s.openModal);

  const openLogin = (redirect?: string) => {
    openLoginModal(redirect || RoutePath.GZH_WORKSPACE);
  };

  useEffect(() => {
    document.title = '\u516c\u4f17\u53f7\u8fd0\u8425\u52a9\u624b';
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

  return (
    <div className="gzh-v2-root gzh-v2-home">
      <div className="home-topbar">
        <div className="home-topbar-brand">
          <img src="/site-icon-64.png" alt="icon" />
          公众号运营助手
        </div>
        <div className="home-topbar-right">
          <button className="btn btn-ghost" type="button" onClick={() => openLogin(RoutePath.GZH_WORKSPACE)}>登录 / 注册</button>
          <button className="btn btn-primary" type="button" onClick={() => openLogin(RoutePath.GZH_WORKSPACE)}>免费使用</button>
        </div>
      </div>

      <div className="hero">
        <div className="eyebrow">✦ AI 驱动 · 公众号数据分析</div>
        <h1>
          让每一篇文章
          <br />
          <span className="grad-text">数据可见、写作可优</span>
        </h1>
        <p className="hero-sub">
          一键同步公众号历史数据，AI 深度分析阅读趋势、互动规律与读者偏好，帮助你持续写出更受欢迎的内容。
        </p>
        <div className="hero-ctas">
          <button className="btn btn-primary" type="button" onClick={() => openLogin(RoutePath.GZH_WORKSPACE)}>免费开始使用</button>
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
        <p className="hero-note">无需信用卡 · 首月免费 · 随时可取消</p>

        <div className="hero-preview">
          <div className="preview-head">
            <span className="preview-head-title">数据概览 · 近30天</span>
            <span className="preview-sync">同步时间 2026-03-24 14:30</span>
          </div>
          <div className="preview-kpis">
            <div className="kpi-tile">
              <div className="kpi-tile-label">总阅读</div>
              <div className="kpi-tile-value">640</div>
              <div className="kpi-tile-delta delta-up">↑ 12%</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile-label">篇均阅读</div>
              <div className="kpi-tile-value">80</div>
              <div className="kpi-tile-delta delta-up">↑ 5%</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile-label">推荐率</div>
              <div className="kpi-tile-value">18.6%</div>
              <div className="kpi-tile-delta delta-up">↑ 4.2%</div>
            </div>
            <div className="kpi-tile">
              <div className="kpi-tile-label">完读率</div>
              <div className="kpi-tile-value">62%</div>
              <div className="kpi-tile-delta delta-down">↓ 3%</div>
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-title">三步开始提升内容效果</div>
        <div className="section-sub">简单几步，开启你的数据驱动写作之旅</div>
        <div className="steps-grid">
          <div className="step-card">
            <div className="step-num">1</div>
            <div className="step-title">安装 Chrome 插件</div>
            <div className="step-desc">从 Chrome 商店安装「公众号运营助手」插件，无需配置，开箱即用。</div>
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
        <div className="section-sub">不只是数据展示，而是真正可执行的写作建议</div>
        <div className="features-grid">
          <div className="feat-card">
            <div className="feat-icon">📊</div>
            <div className="feat-title">数据全面同步</div>
            <div className="feat-desc">支持同步文章全文、阅读量、推荐率、分享、完读率，建立完整数据档案。</div>
          </div>
          <div className="feat-card">
            <div className="feat-icon">🤖</div>
            <div className="feat-title">AI 周期分析</div>
            <div className="feat-desc">基于 30 天数据分析高阅读规律、读者互动模式，给出可执行的写作建议。</div>
          </div>
          <div className="feat-card">
            <div className="feat-icon">✏️</div>
            <div className="feat-title">持续优化写作</div>
            <div className="feat-desc">每次分析均输出「本周可执行的 3 件事」，帮助你持续迭代内容策略。</div>
          </div>
        </div>
      </div>

      <div className="section" style={{ paddingTop: 0 }}>
        <div className="pricing-card">
          <div className="pricing-title">简单透明的定价</div>
          <div className="pricing-sub">按 token 消费，无月费无隐藏费用</div>
          <ul className="pricing-list">
            <li>一次分析约 ¥0.18（2万 token）</li>
            <li>对话约 ¥0.01（1000 token）</li>
            <li>新用户赠送 ¥1 免费额度</li>
            <li>随时充值，余额永不过期</li>
          </ul>
          <div className="pricing-note">基于千问模型定价，可在个人中心切换模型（豆包 / Claude / GPT）</div>
          <button className="btn btn-primary pricing-main-btn" type="button" onClick={() => openLogin(RoutePath.GZH_WORKSPACE)}>
            免费注册，领取 ¥1 额度
          </button>
        </div>
      </div>

      <div className="home-footer">© 2026 北京青天牛马科技有限公司 版权所有</div>
    </div>
  );
}
