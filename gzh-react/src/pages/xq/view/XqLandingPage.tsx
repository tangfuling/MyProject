import { useEffect, useMemo, useRef, type MouseEvent } from 'react';
import './XqLandingPage.css';

const IOS_URL = 'https://www.niumatech.com/download/xinqiong-ios';
const ANDROID_URL = 'https://www.niumatech.com/download/xinqiong-android';
const QR_API = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=0&color=0f1d33&bgcolor=ffffff&data=';

type Platform = 'ios' | 'android' | 'desktop';

type FeatureItem = {
  num: string;
  title: string;
  desc: string;
};

type GalleryItem = {
  tag: string;
  title: string;
  descTitle: string;
  desc: string;
  no: string;
  bg: string;
};

const FEATURES: FeatureItem[] = [
  { num: '1', title: '高品质 3D 数字人，形象生动', desc: '高细节角色表现，表情与姿态自然，塑造更有“在场感”的互动体验。' },
  { num: '2', title: '360° 全景空间，自由探索', desc: '沉浸式全景环境，支持多视角浏览与路径探索，体验更连贯。' },
  { num: '3', title: '实时动作操控，互动更真实', desc: '可操控角色动作与状态反馈，让互动从“观看”升级为“参与”。' },
  { num: '4', title: 'AI 智能实时交流，可对话可回应', desc: '支持文字 / 语音双通道交流，具备自然理解与即时回应能力。' },
  { num: '5', title: 'AR 现实融合，拓展更多使用场景', desc: '将数字人带入真实空间，增强展示、互动与陪伴的场景延展性。' },
];

const GALLERY: GalleryItem[] = [
  {
    tag: 'AI 交流',
    title: 'AI 智能实时交流',
    descTitle: '实时对话',
    desc: '文字 / 语音双通道 · AI 即时回应',
    no: '01',
    bg: 'radial-gradient(ellipse 80% 60% at 50% 30%, rgba(91,143,214,.16), transparent 70%), radial-gradient(ellipse 60% 50% at 70% 70%, rgba(23,184,154,.12), transparent 65%), linear-gradient(160deg, #edf3fb, #e5f5f2)',
  },
  {
    tag: '全景空间',
    title: '360° 全景沉浸空间',
    descTitle: '360° 全景',
    desc: '沉浸环境 · 多视角自由浏览',
    no: '02',
    bg: 'radial-gradient(ellipse 80% 55% at 55% 25%, rgba(91,143,214,.18), transparent 70%), radial-gradient(ellipse 65% 50% at 30% 75%, rgba(23,184,154,.14), transparent 65%), linear-gradient(160deg, #edf3fb, #e0eeea)',
  },
  {
    tag: '动作操控',
    title: '可操控角色动作',
    descTitle: '实时操控',
    desc: '角色动作 · 状态即时反馈',
    no: '03',
    bg: 'radial-gradient(ellipse 70% 60% at 40% 30%, rgba(23,184,154,.18), transparent 70%), radial-gradient(ellipse 60% 50% at 65% 70%, rgba(91,143,214,.14), transparent 65%), linear-gradient(160deg, #e7f4f1, #edf3fb)',
  },
  {
    tag: 'AR 融合',
    title: 'AR 融合现实世界',
    descTitle: 'AR 现实融合',
    desc: '数字人进入真实空间',
    no: '04',
    bg: 'radial-gradient(ellipse 75% 55% at 50% 40%, rgba(91,143,214,.15), transparent 70%), radial-gradient(ellipse 65% 55% at 60% 65%, rgba(23,184,154,.16), transparent 65%), linear-gradient(160deg, #edf3fb, #e5f5f0)',
  },
  {
    tag: '自然对话',
    title: '自然对话即时回应',
    descTitle: '自然回应',
    desc: 'AI 理解语义 · 情境感知对话',
    no: '05',
    bg: 'radial-gradient(ellipse 80% 60% at 45% 35%, rgba(23,184,154,.16), transparent 70%), radial-gradient(ellipse 60% 50% at 68% 72%, rgba(91,143,214,.16), transparent 65%), linear-gradient(160deg, #e8f3f0, #edf3fb)',
  },
];

function detectPlatform(): Platform {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

export default function XqLandingPage() {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const platform = useMemo(() => detectPlatform(), []);

  const smartText = platform === 'ios'
    ? '下载 iOS 版 (App Store)'
    : platform === 'android'
      ? '下载 Android 版'
      : '立即下载（自动识别设备）';

  const smartHint = platform === 'ios'
    ? '已识别 iOS 设备，点击跳转 App Store 下载页'
    : platform === 'android'
      ? '已识别 Android 设备，点击下载安装包'
      : '请使用手机扫描右侧二维码，或直接访问下载链接';

  const heroDownloadHref = platform === 'ios' ? IOS_URL : platform === 'android' ? ANDROID_URL : '#download';
  const heroDownloadText = platform === 'ios' ? '下载 iOS 版 (App Store)' : platform === 'android' ? '下载 Android 版' : '下载心穹 App';

  useEffect(() => {
    document.title = '\u5fc3\u7a79 \u00b7 VastHub';
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const revealEls = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (revealEls.length === 0) return;

    if (!('IntersectionObserver' in window)) {
      revealEls.forEach((el) => el.classList.add('revealed'));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('revealed');
          io.unobserve(entry.target);
        });
      },
      { threshold: 0.12 }
    );

    revealEls.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const openIOS = () => {
    window.location.href = IOS_URL;
  };

  const openAndroid = () => {
    window.location.href = ANDROID_URL;
  };

  const onHeaderCtaClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (platform === 'ios') {
      event.preventDefault();
      openIOS();
      return;
    }
    if (platform === 'android') {
      event.preventDefault();
      openAndroid();
    }
  };

  const onSmartDownloadClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (platform === 'ios') {
      openIOS();
      return;
    }
    if (platform === 'android') {
      openAndroid();
      return;
    }

    const qrArea = document.getElementById('xq-qr-area');
    qrArea?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="xq-page" ref={rootRef}>
      <header className="xq-header">
        <div className="xq-wrap xq-header-inner">
          <a href="#" className="xq-brand" onClick={(event) => event.preventDefault()}>
            <span className="xq-brand-mark"><img src="/site-icon-64.png" alt="心穹品牌图标" /></span>
            <span className="xq-brand-text">
              <span className="xq-brand-title">心穹 · VastHub</span>
              <span className="xq-brand-sub">可对话的 3D 数字人世界</span>
            </span>
          </a>
          <nav className="xq-header-nav">
            <a href="#features" className="xq-btn xq-btn-ghost">核心功能</a>
            <a href="#download" className="xq-btn xq-btn-primary" onClick={onHeaderCtaClick}>立即体验</a>
          </nav>
        </div>
      </header>

      <section className="xq-hero">
        <div className="xq-wrap">
          <div className="xq-hero-grid">
            <div className="xq-hero-left" data-reveal>
              <div className="xq-hero-tag">
                <span className="xq-hero-tag-dot" />
                XINQIONG APP · 3D DIGITAL HUMAN + AR + AI
              </div>
              <h1 className="xq-hero-h1">心穹・<span className="xq-gradient-text">可对话的 3D 数字人世界</span></h1>
              <p className="xq-hero-sub">会交流・能操控・可 AR・可陪伴</p>
              <p className="xq-hero-desc">
                心穹・VastHub 以 3D 数字人、沉浸空间、AI 实时交流与 AR 现实融合为核心，打造更自然的互动体验。
                你可以自由探索 360° 全景、实时操控角色动作，并通过文字 / 语音与数字人即时对话。AI 让角色真正“会回应”，空间让互动更有在场感。
              </p>
              <div className="xq-hero-actions">
                <a href={heroDownloadHref} className="xq-btn xq-btn-primary">{heroDownloadText}</a>
                <a href="#gallery" className="xq-btn xq-btn-ghost">查看截图</a>
              </div>
              <div className="xq-keyword-chips">
                <span className="xq-keyword-chip">心穹</span>
                <span className="xq-keyword-chip">VastHub</span>
                <span className="xq-keyword-chip">3D 数字人</span>
                <span className="xq-keyword-chip">AI 互动</span>
                <span className="xq-keyword-chip">沉浸交流</span>
                <span className="xq-keyword-chip">AR 体验</span>
                <span className="xq-keyword-chip">可操控角色</span>
                <span className="xq-keyword-chip">智能陪伴</span>
              </div>
            </div>

            <div className="xq-hero-stage" data-reveal style={{ ['--d' as string]: '0.12s' }}>
              <div className="xq-hero-stage-card">
                <div className="xq-stage-ring xq-stage-ring-1" />
                <div className="xq-stage-ring xq-stage-ring-2" />
                <div className="xq-avatar-card">
                  <div className="xq-avatar-card-header">
                    <span className="xq-avatar-card-title">数字人 · AI Real-time</span>
                    <span className="xq-live-dot-wrap">
                      <span className="xq-live-dot" />
                      LIVE
                    </span>
                  </div>
                  <div className="xq-avatar-face">
                    <span className="xq-avatar-blob xq-avatar-blob-1" />
                    <span className="xq-avatar-blob xq-avatar-blob-2" />
                    <span className="xq-avatar-label">AI 数字人 · 实时响应中</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="xq-features" id="features">
        <div className="xq-wrap">
          <div className="xq-section-header" data-reveal>
            <h2 className="xq-section-title">核心功能</h2>
            <p className="xq-section-sub">围绕“数字人 + 空间 + 交流 + 现实融合”打造完整互动闭环。</p>
          </div>

          <div className="xq-features-grid">
            {FEATURES.map((item, index) => (
              <article key={item.title} className="xq-feature-card" data-reveal style={{ ['--d' as string]: `${0.04 + index * 0.04}s` }}>
                <div className="xq-feature-num">{item.num}</div>
                <h3>{item.title}</h3>
                <p>{item.desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="xq-gallery" id="gallery">
        <div className="xq-wrap">
          <div className="xq-section-header" data-reveal>
            <h2 className="xq-section-title">功能截图与场景展示</h2>
            <p className="xq-section-sub">以下截图均来自心穹 App 实际界面，展示 AI 实时交流、沉浸空间、动作操控与 AR 融合体验。</p>
          </div>

          <div className="xq-gallery-grid">
            {GALLERY.map((item, index) => (
              <article key={item.no} className="xq-gallery-card" data-reveal style={{ ['--d' as string]: `${0.04 + index * 0.04}s` }}>
                <div className="xq-shot-frame" style={{ background: item.bg }}>
                  <span className="xq-shot-blob xq-shot-blob-1" />
                  <span className="xq-shot-blob xq-shot-blob-2" />
                  <span className="xq-shot-avatar-placeholder" />
                  <span className="xq-shot-label-tag">{item.tag}</span>
                  <span className="xq-shot-ui-badge">
                    <strong>{item.descTitle}</strong>
                    {item.desc}
                  </span>
                  <span className="xq-shot-num-tag">{item.no}</span>
                </div>
                <p className="xq-shot-title">{item.title}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="xq-download" id="download">
        <div className="xq-wrap">
          <div className="xq-download-card" data-reveal>
            <div className="xq-download-content">
              <h2 className="xq-download-title">开启你的数字人沉浸交流</h2>
              <p className="xq-download-desc">在统一应用内完成数字人互动、空间探索、AR 融合与 AI 陪伴体验。欢迎下载心穹 App，进入可对话的 3D 数字人世界。</p>
              <div className="xq-download-actions">
                <button type="button" id="xq-smart-dl-btn" className="xq-btn xq-btn-primary" onClick={onSmartDownloadClick}>{smartText}</button>
                <a href="#" className="xq-btn xq-btn-ghost" onClick={(event) => { event.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>返回顶部</a>
              </div>
              <p className="xq-download-hint" id="xq-dl-hint">{smartHint}</p>

              <div className="xq-download-btns-mobile" id="xq-mobile-btns">
                <a href={IOS_URL} className="xq-download-btn-mobile xq-download-btn-ios">下载 iOS 版 (App Store)</a>
                <a href={ANDROID_URL} className="xq-download-btn-mobile xq-download-btn-android">下载 Android 版</a>
              </div>
            </div>

            <div className="xq-qr-area" id="xq-qr-area">
              <div className="xq-qr-card">
                <div className="xq-qr-platform">iOS</div>
                <img src={`${QR_API}${encodeURIComponent(IOS_URL)}`} alt="iOS 下载二维码" width={110} height={110} />
                <div className="xq-qr-card-label">iOS 版下载</div>
                <div className="xq-qr-card-sub">App Store</div>
              </div>
              <div className="xq-qr-card">
                <div className="xq-qr-platform">Android</div>
                <img src={`${QR_API}${encodeURIComponent(ANDROID_URL)}`} alt="Android 下载二维码" width={110} height={110} />
                <div className="xq-qr-card-label">Android 版下载</div>
                <div className="xq-qr-card-sub">APK 直接下载</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="xq-footer">
        <div className="xq-wrap">
          <p>
            © 2026 北京青天牛马科技有限公司 版权所有
            &nbsp;|&nbsp;
            网站备案：
            <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">京ICP备20005186号</a>
          </p>
        </div>
      </footer>
    </div>
  );
}

