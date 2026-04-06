import { Link } from 'react-router-dom';
import { RoutePath } from '../../../common/router/RoutePath';
import { useEffect } from 'react';
import './PortalPage.css';

function EnterArrow() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function PortalPage() {
  useEffect(() => {
    document.title = '\u9752\u5929\u725b\u9a6c\u79d1\u6280';
  }, []);

  return (
    <div className="portal-page">
      <header className="portal-header">
        <a className="portal-brand" href="#" onClick={(event) => event.preventDefault()}>
          <span className="portal-brand-mark">
            <img src="/site-icon-64.png" alt="品牌图标" />
          </span>
          <span className="portal-brand-name">青天牛马科技</span>
        </a>
      </header>

      <main className="portal-main">
        <section className="portal-hero">
          <div className="portal-hero-badge portal-reveal" style={{ ['--d' as string]: '0.05s' }}>PRODUCT PORTAL</div>
          <h1 className="portal-reveal" style={{ ['--d' as string]: '0.12s' }}>北京青天牛马科技有限公司</h1>
          <p className="portal-hero-sub portal-reveal" style={{ ['--d' as string]: '0.20s' }}>旗下产品导航，欢迎选择您需要的产品。</p>
        </section>

        <section className="portal-grid">
          <article className="portal-card portal-card-blue portal-reveal" style={{ ['--d' as string]: '0.28s' }}>
            <div className="portal-card-inner">
              <div className="portal-card-left">
                <div className="portal-card-accent" />
                <h2 className="portal-card-title">心穹 App · VastHub</h2>
                <p className="portal-card-desc">可对话的 3D 数字人世界。高品质数字人互动、沉浸空间探索、AR 现实融合与 AI 实时交流于一体。</p>
                <Link className="portal-btn" to={RoutePath.XQ}>
                  进入产品页
                  <EnterArrow />
                </Link>
                <p className="portal-card-qr-hint">或扫码加入心穹产品交流群</p>
              </div>
              <div className="portal-card-right">
                <div className="portal-qr-wrap">
                  <img
                    src="https://tangfuling.oss-cn-hangzhou.aliyuncs.com/mypublic/app/%E5%BF%83%E7%A9%B9APP.jpg"
                    alt="心穹 App 交流群二维码"
                    loading="lazy"
                  />
                </div>
              </div>
            </div>
          </article>

          <article className="portal-card portal-card-teal portal-reveal" style={{ ['--d' as string]: '0.36s' }}>
            <div className="portal-card-inner">
              <div className="portal-card-left">
                <div className="portal-card-accent" />
                <h2 className="portal-card-title">公众号运营助手</h2>
                <p className="portal-card-desc">AI 驱动的公众号数据分析平台。一键同步历史数据，智能分析写作趋势，助力内容持续增长。</p>
                <Link className="portal-btn" to={RoutePath.GZH_HOME}>
                  进入产品页
                  <EnterArrow />
                </Link>
                <p className="portal-card-qr-hint">或扫码加入公众号运营助手交流群</p>
              </div>
              <div className="portal-card-right">
                <div className="portal-qr-wrap">
                  <img
                    src="https://tangfuling.oss-cn-hangzhou.aliyuncs.com/mypublic/app/%E5%85%AC%E4%BC%97%E5%8F%B7%E5%8A%A9%E6%89%8B.jpg"
                    alt="公众号运营助手交流群二维码"
                    loading="lazy"
                  />
                </div>
              </div>
            </div>
          </article>
        </section>
      </main>

      <footer className="portal-footer">
        © 2026 北京青天牛马科技有限公司 版权所有 |
        网站备案：
        <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">京ICP备20005186号</a>
      </footer>
    </div>
  );
}
