import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { RoutePath } from '../../../common/router/RoutePath';
import { useAuthStore } from '../../../common/state/authStore';
import { useLoginModalStore } from '../../../common/state/loginModalStore';

type Persona = 'new' | 'steady' | 'bottleneck';

const personaCases: Record<Persona, { head: string; main: string; sub: string }> = {
  new: {
    head: '案例 | 新账号（前 3 个月）',
    main: '推荐率 4.3% -> 12.8%，篇均阅读 +37%',
    sub: '聚焦：稳定更新 + 关键词标题模板 + 24 小时 KPI 复盘',
  },
  steady: {
    head: '案例 | 稳定期账号（6 个月+）',
    main: '推荐率 12.2% -> 19.6%，完读率稳定在 60% 以上',
    sub: '聚焦：选题结构 7:3 + 清晰周反馈闭环',
  },
  bottleneck: {
    head: '案例 | 增长瓶颈期',
    main: '推荐率 8.5% -> 16.9%，搜索流量占比 +2.4x',
    sub: '聚焦：关键词标题 + 转发钩子 + 热点对齐但不跑偏',
  },
};

const stepCards = [
  {
    num: '1',
    title: '连接账号',
    desc: '安装插件并完成一次登录。',
    detail: '支持 Chrome 与 Edge',
  },
  {
    num: '2',
    title: '同步样本',
    desc: '自动同步近期文章指标和来源结构。',
    detail: '覆盖发布/阅读/完读/互动/关注',
  },
  {
    num: '3',
    title: '执行复盘',
    desc: '输出本周优先级和可执行检查项。',
    detail: '判断 -> 动作 -> KPI -> 下次复盘',
  },
];

export default function LandingPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const openLoginModal = useLoginModalStore((s) => s.openModal);

  const [persona, setPersona] = useState<Persona>('new');
  const [analysisCount, setAnalysisCount] = useState(2);
  const [chatRounds, setChatRounds] = useState(20);

  const cost = useMemo(() => {
    const value = analysisCount * 0.18 + chatRounds * 0.02;
    return value.toFixed(2);
  }, [analysisCount, chatRounds]);

  const openLogin = (redirect?: string) => {
    openLoginModal(redirect || RoutePath.WORKSPACE);
  };

  useEffect(() => {
    const state = location.state as { loginRequired?: boolean; redirect?: string } | null;
    const query = new URLSearchParams(location.search);
    const needLogin = state?.loginRequired || query.get('openLogin') === '1';
    if (!needLogin) {
      return;
    }
    const redirect = state?.redirect || query.get('redirect') || RoutePath.WORKSPACE;
    openLoginModal(redirect);
    if (query.get('openLogin') === '1') {
      query.delete('openLogin');
      query.delete('redirect');
      const cleaned = query.toString();
      navigate(`${location.pathname}${cleaned ? `?${cleaned}` : ''}`, { replace: true, state: null });
    }
  }, [location.pathname, location.search, location.state, navigate, openLoginModal]);

  const currentCase = personaCases[persona];

  return (
    <div className="landing-page" id="page-home">
      <header className="landing-header">
        <a className="brand" href="#" onClick={(event) => event.preventDefault()}>
          <img className="brand-icon" src="/site-icon-64.png" alt="内容运营助手" />
          <div className="brand-name">内容运营助手</div>
        </a>
        <div className="header-right">
          <button className="btn btn-outline btn-sm" type="button" onClick={() => openLogin(RoutePath.WORKSPACE)}>
            登录
          </button>
          <button className="btn btn-primary btn-sm" type="button" onClick={() => openLogin(RoutePath.WORKSPACE)}>
            安装插件
          </button>
        </div>
      </header>

      <section className="hero">
        <div className="hero-eyebrow">面向内容创作者的数据优先周复盘</div>
        <h1 className="hero-title">
          把内容运营变成可复用的决策系统
          <br />
          <span>先看关键信号，再执行本周动作</span>
        </h1>
        <p className="hero-subtitle">
          2 分钟接入，自动同步近期文章指标。
          <br />
          获得阶段判断、明确优先级和可执行下一步。
        </p>

        <div className="hero-ctas">
          <button className="hero-cta-primary" type="button" onClick={() => openLogin(RoutePath.WORKSPACE)}>
            免费开始（CNY 1 试用）
          </button>
          <button
            className="hero-cta-secondary hero-cta-demo"
            type="button"
            onClick={() => {
              if (token) {
                navigate(RoutePath.WORKSPACE);
              } else {
                openLogin(RoutePath.WORKSPACE);
              }
            }}
          >
            1 分钟演示
          </button>
        </div>

        <div className="hero-kpi-strip">
          <div className="hero-mini-kpi"><span>首个洞察</span><b>&lt; 20s</b></div>
          <div className="hero-mini-kpi"><span>核心 KPI</span><b>推荐率</b></div>
          <div className="hero-mini-kpi"><span>每周动作</span><b>3 个重点动作</b></div>
          <div className="hero-mini-kpi"><span>接入时间</span><b>2 分钟</b></div>
        </div>

        <div className="hero-proof">
          <div className="hero-proof-card">
            <div className="proof-head">真实样例 · 过程展示</div>
            <div className="proof-main">推荐率 <b>8.2% -&gt; 18.6%</b>，阅读环比 <b>+12%</b></div>
            <div className="proof-sub">同阶段账号路径示例，结果受选题、发布节奏和执行质量影响。</div>
          </div>
        </div>

        <div className="hero-preview">
          <div className="hero-preview-head">
            <span className="hero-preview-title">工作台预览</span>
            <span>一屏完成：决策 + 证据 + 动作</span>
          </div>
          <div className="hero-preview-grid">
            <div className="hero-preview-kpi"><div className="label">推荐率</div><div className="value">18.6%</div><div className="sub">7 天重点</div></div>
            <div className="hero-preview-kpi"><div className="label">完读率</div><div className="value">62%</div><div className="sub">平均 1m48s</div></div>
            <div className="hero-preview-kpi"><div className="label">总阅读</div><div className="value">640</div><div className="sub">环比 +12%</div></div>
            <div className="hero-preview-kpi"><div className="label">新增关注</div><div className="value">12</div><div className="sub">转化率 1.9%</div></div>
          </div>
        </div>

        <div className="hero-persona">
          <button type="button" className={`persona-chip${persona === 'new' ? ' active' : ''}`} onClick={() => setPersona('new')}>我是新号</button>
          <button type="button" className={`persona-chip${persona === 'steady' ? ' active' : ''}`} onClick={() => setPersona('steady')}>我是稳定期</button>
          <button type="button" className={`persona-chip${persona === 'bottleneck' ? ' active' : ''}`} onClick={() => setPersona('bottleneck')}>我遇到瓶颈</button>
        </div>

        <div className="hero-case-card">
          <div className="hero-case-head">{currentCase.head}</div>
          <div className="hero-case-main">{currentCase.main}</div>
          <div className="hero-case-sub">{currentCase.sub}</div>
        </div>

        <div className="hero-cost-card">
          <div className="hero-cost-head">开始前估算本周成本</div>
          <div className="hero-cost-grid">
            <div className="hero-cost-row">
              <span>分析次数</span>
              <select value={analysisCount} onChange={(event) => setAnalysisCount(Number(event.target.value))}>
                <option value={1}>1 次</option>
                <option value={2}>2 次</option>
                <option value={3}>3 次</option>
                <option value={4}>4 次</option>
              </select>
            </div>
            <div className="hero-cost-row">
              <span>对话轮次</span>
              <select value={chatRounds} onChange={(event) => setChatRounds(Number(event.target.value))}>
                <option value={10}>10 轮</option>
                <option value={20}>20 轮</option>
                <option value={30}>30 轮</option>
                <option value={40}>40 轮</option>
              </select>
            </div>
          </div>
          <div className="hero-cost-total">
            <span>预估本周成本</span>
            <span>约 CNY <b>{cost}</b></span>
          </div>
        </div>

        <div className="hero-note">新用户赠送 <b>CNY 1.00</b> 试用额度 | 按 token 计费 | 无月费</div>
        <div className="hero-trust">
          <div className="hero-trust-item">无需改公众号设置</div>
          <div className="hero-trust-item">支持多维筛选与样本追踪</div>
          <div className="hero-trust-item">建议可执行、可验证、可复盘</div>
        </div>
      </section>

      <section className="steps-section">
        <h2 className="steps-title">2 分钟接入，开始每周运营闭环</h2>
        <p className="steps-sub">接入 -&gt; 同步 -&gt; 执行，流程短且可度量。</p>
        <div className="steps-grid">
          {stepCards.map((item) => (
            <div key={item.title} className="step-card">
              <div className="step-num">{item.num}</div>
              <div className="step-title">{item.title}</div>
              <div className="step-desc">{item.desc}</div>
              <div className="step-detail">{item.detail}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="feature-section">
        <div className="feature-inner">
          <div className="feature-item">
            <div className="feature-icon blue">1</div>
            <div className="feature-title">决策先于分析</div>
            <div className="feature-desc">先判断本周优先级，再看证据细节，避免陷入指标堆叠。</div>
          </div>
          <div className="feature-item">
            <div className="feature-icon green">2</div>
            <div className="feature-title">建议可落地</div>
            <div className="feature-desc">每条建议绑定观察指标，执行后可量化验证是否有效。</div>
          </div>
          <div className="feature-item">
            <div className="feature-icon purple">3</div>
            <div className="feature-title">样本可追踪</div>
            <div className="feature-desc">支持发布时间、阅读、完读、互动等多维排序定位样本。</div>
          </div>
        </div>
      </section>

      <section className="pricing-section">
        <div className="pricing-inner">
          <h2 className="pricing-title">轻量起步，按结果扩投入</h2>
          <p className="pricing-sub">先做低成本周实验，再决定后续投入。</p>
          <div className="pricing-list">
            <div className="pricing-item">新用户赠送 CNY 1.00 试用额度</div>
            <div className="pricing-item">单次分析约 CNY 0.15-0.20</div>
            <div className="pricing-item">每轮对话约 CNY 0.01-0.05</div>
            <div className="pricing-item">调用前展示预估 token 与成本</div>
          </div>
          <div className="pricing-cost-note">参考：每周 2 次分析 + 20 轮对话，约 CNY {cost} / 周。</div>
          <button
            className="btn btn-primary"
            type="button"
            style={{ width: '100%', padding: '13px', fontSize: '14px', marginTop: '14px' }}
            onClick={() => openLogin(RoutePath.WORKSPACE)}
          >
            免费开始
          </button>
        </div>
      </section>

      <footer className="landing-footer">(c) 2026 内容运营助手</footer>
    </div>
  );
}

