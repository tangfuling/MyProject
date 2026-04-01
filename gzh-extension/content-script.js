(() => {
  const STATE = {
    syncing: false,
  };

  const PANEL_ID = 'gzh-sync-panel';
  const STYLE_ID = 'gzh-sync-style';
  const LAUNCHER_ID = 'gzh-sync-launcher';

  const STAGE_LABELS = {
    need_login_web: '未登录',
    ready: '已登录 · 待同步',
    fetch_list: '同步中',
    fetch_detail: '同步中',
    upload: '同步中',
    done: '同步完成',
    login_expired: '登录过期',
    partial_failed: '部分失败',
    error: '失败',
    idle: '待同步',
  };

  const RUNNING_STAGES = new Set(['fetch_list', 'fetch_detail', 'upload']);
  const WEB_URL = 'http://localhost:5173';
  const CONTEXT_INVALIDATED_RE = /extension context invalidated|invalidated|receiving end does not exist/i;

  let latestAuthToken = '';
  let latestLastSync = null;
  let lastAutoSyncAuthToken = '';
  let zeroMetricsLogCount = 0;
  let panelState = {
    stage: 'idle',
    message: '等待同步',
    progress: 0,
    synced: 0,
    total: 0,
  };

  function isRuntimeAvailable() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  function isContextInvalidatedError(errorOrMessage) {
    const msg = typeof errorOrMessage === 'string'
      ? errorOrMessage
      : String(errorOrMessage?.message || errorOrMessage || '');
    return CONTEXT_INVALIDATED_RE.test(msg);
  }

  function safeSendMessage(payload) {
    if (!isRuntimeAvailable()) {
      return;
    }
    try {
      chrome.runtime.sendMessage(payload);
    } catch (error) {
      if (!isContextInvalidatedError(error)) {
        console.warn('[gzh-extension] sendMessage threw', error);
      }
    }
  }

  function proxyFetchJson(url, options) {
    return new Promise((resolve, reject) => {
      if (!isRuntimeAvailable()) {
        reject(new Error('扩展上下文不可用'));
        return;
      }
      try {
        chrome.runtime.sendMessage(
          {
            type: 'proxy-fetch-json',
            payload: {
              url,
              method: options?.method || 'GET',
              headers: options?.headers || {},
              body: options?.body || null,
            },
          },
          (response) => {
            const err = chrome.runtime?.lastError;
            if (err) {
              reject(new Error(err.message || '请求代理失败'));
              return;
            }
            if (!response?.ok) {
              reject(new Error(response?.error || '请求代理失败'));
              return;
            }
            resolve(response);
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  function runtimeGetURL(path) {
    if (!isRuntimeAvailable()) {
      return '';
    }
    try {
      return chrome.runtime.getURL(path);
    } catch (error) {
      if (!isContextInvalidatedError(error)) {
        console.warn('[gzh-extension] getURL failed', error);
      }
      return '';
    }
  }

  function stageClass(stage) {
    if (stage === 'done') {
      return 'done';
    }
    if (stage === 'partial_failed') {
      return 'warn';
    }
    if (stage === 'login_expired' || stage === 'error' || stage === 'need_login_web') {
      return 'error';
    }
    if (RUNNING_STAGES.has(stage)) {
      return 'running';
    }
    return 'ready';
  }

  function formatTime(iso) {
    if (!iso) {
      return '--';
    }
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return '--';
    }
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const date = String(d.getDate()).padStart(2, '0');
    const hour = String(d.getHours()).padStart(2, '0');
    const minute = String(d.getMinutes()).padStart(2, '0');
    return `${month}-${date} ${hour}:${minute}`;
  }

  function withDefaultState(state) {
    if (state && RUNNING_STAGES.has(state.stage)) {
      return state;
    }
    if (state && state.stage === 'need_login_web') {
      if (!latestAuthToken) {
        return state;
      }
    }
    if (state && (
      state.stage === 'done'
      || state.stage === 'partial_failed'
      || state.stage === 'login_expired'
      || state.stage === 'error'
    )) {
      return state;
    }

    if (!latestAuthToken) {
      return {
        stage: 'need_login_web',
        message: '请先前往公众号助手登录，才能同步数据',
        progress: 0,
        synced: 0,
        total: 0,
      };
    }

    return {
      stage: 'ready',
      message: latestLastSync
        ? `上次同步：${formatTime(latestLastSync.updatedAt)}`
        : '已登录，可开始同步',
      progress: 0,
      synced: 0,
      total: latestLastSync?.total || 0,
    };
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        right: 20px;
        bottom: 72px;
        width: 320px;
        border-radius: 14px;
        background: #ffffff;
        border: 1px solid #e5e7eb;
        box-shadow: 0 20px 50px -12px rgba(0, 0, 0, 0.2);
        z-index: 1000000;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", Arial, sans-serif;
      }
      #${PANEL_ID}.hidden {
        display: none;
      }
      .gzh-sync-head {
        height: 40px;
        background: linear-gradient(135deg, #1f2937, #111827);
        color: #f3f4f6;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 12px;
        font-size: 13px;
      }
      .gzh-sync-title-wrap {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .gzh-sync-title-icon {
        width: 16px;
        height: 16px;
        display: block;
        object-fit: contain;
        border-radius: 4px;
      }
      .gzh-sync-title {
        font-weight: 700;
      }
      .gzh-sync-close {
        border: none;
        background: none;
        color: #9ca3af;
        font-size: 14px;
        cursor: pointer;
      }
      .gzh-sync-close:hover {
        color: #e5e7eb;
      }
      .gzh-sync-body {
        padding: 12px;
      }
      .gzh-sync-state-line {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
        gap: 8px;
      }
      .gzh-sync-state {
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
        padding: 4px 8px;
        color: #4b5563;
        background: #f3f4f6;
      }
      .gzh-sync-state.ready {
        color: #4338ca;
        background: #eef2ff;
      }
      .gzh-sync-state.running {
        color: #5b21b6;
        background: #ede9fe;
      }
      .gzh-sync-state.done {
        color: #047857;
        background: #ecfdf5;
      }
      .gzh-sync-state.warn {
        color: #b45309;
        background: #fffbeb;
      }
      .gzh-sync-state.error {
        color: #b91c1c;
        background: #fef2f2;
      }
      .gzh-sync-progress-text {
        font-size: 11px;
        color: #64748b;
      }
      .gzh-sync-message {
        font-size: 12px;
        color: #334155;
        line-height: 1.45;
        margin-bottom: 8px;
      }
      .gzh-sync-progress-wrap {
        height: 6px;
        border-radius: 999px;
        background: #e5e7eb;
        overflow: hidden;
      }
      .gzh-sync-progress-bar {
        display: block;
        height: 100%;
        width: 0;
        border-radius: 999px;
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
      }
      .gzh-sync-count {
        margin-top: 6px;
        font-size: 11px;
        color: #64748b;
      }
      .gzh-sync-steps {
        margin-top: 8px;
        font-size: 11px;
        color: #94a3b8;
      }
      .gzh-sync-summary {
        margin-top: 6px;
        font-size: 11px;
        color: #64748b;
      }
      .gzh-sync-actions {
        display: flex;
        gap: 8px;
        margin-top: 10px;
      }
      .gzh-sync-btn {
        flex: 1;
        border-radius: 9px;
        border: 1px solid #e5e7eb;
        background: #fff;
        color: #334155;
        font-size: 12px;
        font-weight: 600;
        padding: 9px 10px;
        cursor: pointer;
      }
      .gzh-sync-btn.primary {
        border: none;
        color: #fff;
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
      }
      .gzh-sync-btn:disabled {
        cursor: not-allowed;
        opacity: 0.6;
      }
      #${LAUNCHER_ID} {
        position: fixed;
        right: 20px;
        bottom: 20px;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border: none;
        border-radius: 999px;
        padding: 10px 14px;
        color: #ffffff;
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
        box-shadow: 0 12px 28px -12px rgba(99, 102, 241, 0.75);
        font-size: 13px;
        font-weight: 700;
        line-height: 1;
        cursor: pointer;
        z-index: 999999;
      }
      #${LAUNCHER_ID}:hover {
        transform: translateY(-1px);
      }
      #${LAUNCHER_ID} img {
        width: 20px;
        height: 20px;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.96);
        padding: 2px;
        object-fit: contain;
        display: block;
      }
      #${LAUNCHER_ID}[data-running="true"] {
        opacity: 0.86;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function getStorage(keys) {
    return new Promise((resolve) => {
      if (!isRuntimeAvailable() || !chrome.storage?.local) {
        resolve({});
        return;
      }
      try {
        chrome.storage.local.get(keys, (result) => {
          const err = chrome.runtime?.lastError;
          if (err) {
            if (!isContextInvalidatedError(err.message)) {
              console.warn('[gzh-extension] storage.get failed', err.message);
            }
            resolve({});
            return;
          }
          resolve(result || {});
        });
      } catch (error) {
        if (!isContextInvalidatedError(error)) {
          console.warn('[gzh-extension] storage.get threw', error);
        }
        resolve({});
      }
    });
  }

  function setStorage(payload) {
    return new Promise((resolve) => {
      if (!isRuntimeAvailable() || !chrome.storage?.local) {
        resolve(false);
        return;
      }
      try {
        chrome.storage.local.set(payload, () => {
          const err = chrome.runtime?.lastError;
          if (err && !isContextInvalidatedError(err.message)) {
            console.warn('[gzh-extension] storage.set failed', err.message);
          }
          resolve(!err);
        });
      } catch (error) {
        if (!isContextInvalidatedError(error)) {
          console.warn('[gzh-extension] storage.set threw', error);
        }
        resolve(false);
      }
    });
  }

  function openPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) {
      return;
    }
    panel.classList.remove('hidden');
  }

  function closePanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) {
      return;
    }
    panel.classList.add('hidden');
  }

  function updateLauncherState() {
    const launcher = document.getElementById(LAUNCHER_ID);
    if (!launcher) {
      return;
    }
    if (STATE.syncing) {
      launcher.setAttribute('data-running', 'true');
      launcher.setAttribute('title', '同步中，点击查看进度');
    } else {
      launcher.setAttribute('data-running', 'false');
      launcher.setAttribute('title', '同步到公众号助手');
    }
  }

  function renderPanel(rawState) {
    const state = withDefaultState(rawState || panelState);
    panelState = state;

    const stageEl = document.getElementById('gzh-sync-stage');
    const progressTextEl = document.getElementById('gzh-sync-progress-text');
    const messageEl = document.getElementById('gzh-sync-message');
    const barEl = document.getElementById('gzh-sync-progress-bar');
    const countEl = document.getElementById('gzh-sync-count');
    const stepsEl = document.getElementById('gzh-sync-steps');
    const summaryEl = document.getElementById('gzh-sync-summary');
    const primaryBtn = document.getElementById('gzh-sync-primary');
    const secondaryBtn = document.getElementById('gzh-sync-secondary');
    if (!stageEl || !progressTextEl || !messageEl || !barEl || !countEl || !stepsEl || !summaryEl || !primaryBtn || !secondaryBtn) {
      return;
    }

    stageEl.textContent = STAGE_LABELS[state.stage] || '待同步';
    stageEl.className = `gzh-sync-state ${stageClass(state.stage)}`;

    const progress = Number(state.progress || 0);
    progressTextEl.textContent = `${progress}%`;
    messageEl.textContent = state.message || '等待同步';
    barEl.style.width = `${progress}%`;

    if (state.total) {
      countEl.textContent = `已处理 ${state.synced || 0}/${state.total}`;
    } else {
      countEl.textContent = '';
    }

    if (RUNNING_STAGES.has(state.stage) || state.stage === 'done' || state.stage === 'partial_failed') {
      const listDone = state.stage !== 'fetch_list';
      const detailDone = state.stage === 'upload' || state.stage === 'done' || state.stage === 'partial_failed';
      const uploadDone = state.stage === 'done' || state.stage === 'partial_failed';
      const listMark = listDone ? '✓' : '…';
      const detailMark = detailDone ? '✓' : (state.stage === 'fetch_detail' ? '…' : '·');
      const uploadMark = uploadDone ? '✓' : (state.stage === 'upload' ? '…' : '·');
      stepsEl.textContent = `文章列表 ${listMark}  文章详情 ${detailMark}  数据上传 ${uploadMark}`;
    } else {
      stepsEl.textContent = '';
    }

    if (state.stage === 'done') {
      summaryEl.textContent = `新增 ${state.newArticles || 0}，更新 ${state.updatedArticles || 0}`;
    } else if (state.stage === 'partial_failed') {
      const failCount = (state.failedMetrics || 0) + (state.failedContent || 0);
      summaryEl.textContent = `已完成上传，失败 ${failCount}（指标 ${state.failedMetrics || 0} / 全文 ${state.failedContent || 0}）`;
    } else if (state.stage === 'ready' && latestLastSync) {
      summaryEl.textContent = `上次同步 ${formatTime(latestLastSync.updatedAt)} · ${latestLastSync.total || 0} 篇`;
    } else {
      summaryEl.textContent = '';
    }

    let primaryAction = 'start';
    let primaryText = '同步到公众号助手';
    let secondaryAction = 'close';
    let secondaryText = '关闭';
    let primaryDisabled = false;

    if (state.stage === 'need_login_web') {
      primaryAction = 'open_web_login';
      primaryText = '前往公众号助手登录';
      secondaryAction = 'close';
      secondaryText = '取消';
    } else if (state.stage === 'login_expired') {
      primaryAction = 'refresh';
      primaryText = '刷新页面';
      secondaryAction = 'open_web';
      secondaryText = '打开公众号助手';
    } else if (RUNNING_STAGES.has(state.stage)) {
      primaryAction = 'running';
      primaryText = '同步中...';
      primaryDisabled = true;
      secondaryAction = 'close';
      secondaryText = '收起';
    } else if (state.stage === 'done' || state.stage === 'partial_failed') {
      primaryAction = 'open_workspace';
      primaryText = '前往公众号助手查看 →';
      secondaryAction = 'start';
      secondaryText = '重新同步';
    } else if (state.stage === 'error') {
      primaryAction = 'start';
      primaryText = '重新同步';
      secondaryAction = 'close';
      secondaryText = '关闭';
    }

    primaryBtn.textContent = primaryText;
    primaryBtn.dataset.action = primaryAction;
    primaryBtn.disabled = primaryDisabled;

    secondaryBtn.textContent = secondaryText;
    secondaryBtn.dataset.action = secondaryAction;
  }

  function handlePanelAction(action) {
    if (action === 'start') {
      openPanel();
      void startSync();
      return;
    }
    if (action === 'open_web') {
      window.open(WEB_URL, '_blank', 'noopener,noreferrer');
      return;
    }
    if (action === 'open_workspace') {
      window.open(`${WEB_URL}/workspace`, '_blank', 'noopener,noreferrer');
      return;
    }
    if (action === 'open_web_login') {
      try {
        const url = new URL(WEB_URL);
        url.searchParams.set('openLogin', '1');
        url.searchParams.set('redirect', '/workspace');
        window.open(url.toString(), '_blank', 'noopener,noreferrer');
      } catch {
        window.open(`${WEB_URL}?openLogin=1&redirect=%2Fworkspace`, '_blank', 'noopener,noreferrer');
      }
      return;
    }
    if (action === 'refresh') {
      window.location.reload();
      return;
    }
    closePanel();
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID)) {
      return;
    }
    injectStyle();

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'hidden';
    const iconUrl = runtimeGetURL('icons/icon-32.png');
    const titleIcon = iconUrl
      ? `<img class="gzh-sync-title-icon" src="${iconUrl}" alt="公众号助手" />`
      : '<span class="gzh-sync-title-icon" aria-hidden="true"></span>';
    panel.innerHTML = `
      <div class="gzh-sync-head">
        <div class="gzh-sync-title-wrap">
          ${titleIcon}
          <div class="gzh-sync-title">公众号助手</div>
        </div>
        <button type="button" class="gzh-sync-close" id="gzh-sync-close">✕</button>
      </div>
      <div class="gzh-sync-body">
        <div class="gzh-sync-state-line">
          <span class="gzh-sync-state ready" id="gzh-sync-stage">待同步</span>
          <span class="gzh-sync-progress-text" id="gzh-sync-progress-text">0%</span>
        </div>
        <div class="gzh-sync-message" id="gzh-sync-message">等待同步</div>
        <div class="gzh-sync-progress-wrap"><span class="gzh-sync-progress-bar" id="gzh-sync-progress-bar"></span></div>
        <div class="gzh-sync-count" id="gzh-sync-count"></div>
        <div class="gzh-sync-steps" id="gzh-sync-steps"></div>
        <div class="gzh-sync-summary" id="gzh-sync-summary"></div>
        <div class="gzh-sync-actions">
          <button type="button" class="gzh-sync-btn primary" id="gzh-sync-primary" data-action="start">同步到公众号助手</button>
          <button type="button" class="gzh-sync-btn" id="gzh-sync-secondary" data-action="close">关闭</button>
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    const closeBtn = document.getElementById('gzh-sync-close');
    const primaryBtn = document.getElementById('gzh-sync-primary');
    const secondaryBtn = document.getElementById('gzh-sync-secondary');

    if (closeBtn) {
      closeBtn.addEventListener('click', closePanel);
    }
    if (primaryBtn) {
      primaryBtn.addEventListener('click', () => {
        handlePanelAction(primaryBtn.dataset.action || 'close');
      });
    }
    if (secondaryBtn) {
      secondaryBtn.addEventListener('click', () => {
        handlePanelAction(secondaryBtn.dataset.action || 'close');
      });
    }

    renderPanel(panelState);
    updateLauncherState();
  }

  function createLauncher() {
    if (document.getElementById(LAUNCHER_ID)) {
      return;
    }

    injectStyle();
    const launcher = document.createElement('button');
    launcher.id = LAUNCHER_ID;
    launcher.type = 'button';
    const iconUrl = runtimeGetURL('icons/icon-32.png');
    const launcherIcon = iconUrl ? `<img src="${iconUrl}" alt="公众号助手" />` : '';
    launcher.innerHTML = `${launcherIcon}<span>同步到公众号助手</span>`;
    launcher.addEventListener('click', () => {
      createPanel();
      openPanel();
      if (!STATE.syncing) {
        void startSync();
      }
    });

    document.body.appendChild(launcher);
    updateLauncherState();
  }

  function notifyState(payload) {
    const state = {
      stage: payload.stage,
      message: payload.message,
      progress: payload.progress ?? 0,
      synced: payload.synced ?? 0,
      total: payload.total ?? 0,
      newArticles: payload.newArticles ?? 0,
      updatedArticles: payload.updatedArticles ?? 0,
      failedMetrics: payload.failedMetrics ?? 0,
      failedContent: payload.failedContent ?? 0,
      updatedAt: new Date().toISOString(),
    };

    if (state.stage === 'done' || state.stage === 'partial_failed') {
      latestLastSync = {
        updatedAt: state.updatedAt,
        total: state.total,
        synced: state.synced,
        newArticles: state.newArticles,
        updatedArticles: state.updatedArticles,
        failedMetrics: state.failedMetrics,
        failedContent: state.failedContent,
      };
    }

    panelState = state;
    renderPanel(state);

    safeSendMessage({
      type: 'sync-state',
      payload: state,
    });
  }

  function maybeAutoStartSyncOnAuthReady(prevToken, nextToken, source) {
    const oldToken = (prevToken || '').trim();
    const newToken = (nextToken || '').trim();
    if (!newToken) {
      lastAutoSyncAuthToken = '';
      return;
    }
    if (oldToken) {
      return;
    }
    if (STATE.syncing) {
      return;
    }
    if (lastAutoSyncAuthToken === newToken) {
      return;
    }

    const mpToken = parseTokenFromUrl();
    if (!mpToken) {
      console.info('[gzh-extension] skip auto sync: no mp token in page', { source });
      return;
    }

    lastAutoSyncAuthToken = newToken;
    console.info('[gzh-extension] auto start sync after auth ready', { source });
    createPanel();
    openPanel();
    void startSync();
  }

  function parseTokenFromUrl() {
    try {
      const url = new URL(window.location.href);
      const token = url.searchParams.get('token');
      if (token) {
        return token;
      }
    } catch {
      // ignore
    }
    const match = window.location.href.match(/[?&#]token=([^&#]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function parseMidFromUrl(rawUrl) {
    if (!rawUrl) {
      return '';
    }
    try {
      const normalized = rawUrl.startsWith('http') ? rawUrl : `https://mp.weixin.qq.com${rawUrl}`;
      const url = new URL(normalized);
      return url.searchParams.get('mid') || '';
    } catch {
      return '';
    }
  }

  function sanitizeMsgId(raw) {
    if (raw == null) {
      return '';
    }
    const text = String(raw).trim();
    if (!text) {
      return '';
    }
    const first = text.split('_')[0];
    const digits = first.match(/\d+/)?.[0];
    return digits || first;
  }

  function toPositiveInt(raw, fallback = 1) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      return fallback;
    }
    return Math.floor(value);
  }

  async function startSync() {
    if (STATE.syncing) {
      return;
    }
    STATE.syncing = true;
    updateLauncherState();
    try {
      const token = parseTokenFromUrl();
      if (!token) {
        notifyState({
          stage: 'login_expired',
          message: '微信后台登录已过期，请刷新页面重新登录微信公众平台后再同步',
          progress: 0,
        });
        return;
      }

      const storage = await getStorage(['gzhAuthToken', 'gzhApiBase', 'gzhSyncedArticleIds']);
      const authToken = storage.gzhAuthToken;
      const apiBase = storage.gzhApiBase || 'http://127.0.0.1:8081';
      const syncedArticleIds = storage.gzhSyncedArticleIds || {};

      latestAuthToken = authToken || '';

      if (!authToken) {
        notifyState({
          stage: 'need_login_web',
          message: '请先前往公众号助手登录，才能同步数据',
          progress: 0,
        });
        return;
      }

      notifyState({ stage: 'fetch_list', message: '正在读取文章列表...', progress: 5 });
      const articles = await fetchAllArticles(token);

      if (articles.length === 0) {
        const lastSync = {
          updatedAt: new Date().toISOString(),
          total: 0,
          synced: 0,
          newArticles: 0,
          updatedArticles: 0,
          failedMetrics: 0,
          failedContent: 0,
        };
        await setStorage({ gzhLastSync: lastSync });
        notifyState({ stage: 'done', message: '没有读取到可同步文章', progress: 100, total: 0, synced: 0 });
        return;
      }

      const snapshots = [];
      const syncArticles = [];
      const mergedIds = { ...syncedArticleIds };
      let failedMetrics = 0;
      let failedContent = 0;
      let newCandidates = 0;

      for (let index = 0; index < articles.length; index += 1) {
        const article = articles[index];
        const isNew = !mergedIds[article.wxArticleId];
        if (isNew) {
          newCandidates += 1;
        }

        notifyState({
          stage: 'fetch_detail',
          message: `${isNew ? '新文章' : '旧文章'}：${index + 1}/${articles.length}`,
          progress: Math.round(((index + 1) / articles.length) * 70) + 10,
          total: articles.length,
          synced: index,
        });

        const metrics = await fetchArticleMetrics(token, article).catch(() => {
          failedMetrics += 1;
          return {};
        });

        let content = null;
        let wordCount = null;
        if (isNew) {
          const fetchedContent = await fetchArticleContent(article.contentUrl).catch(() => {
            failedContent += 1;
            return '';
          });
          content = fetchedContent;
          wordCount = fetchedContent.length;
        }
        syncArticles.push({
          wxArticleId: article.wxArticleId,
          title: article.title,
          content,
          wordCount,
          publishTime: article.publishTime,
        });

        snapshots.push({
          wxArticleId: article.wxArticleId,
          readCount: metrics.readCount || 0,
          sendCount: metrics.sendCount || 0,
          shareCount: metrics.shareCount || 0,
          likeCount: metrics.likeCount || 0,
          wowCount: metrics.wowCount || 0,
          commentCount: metrics.commentCount || 0,
          saveCount: metrics.saveCount || 0,
          completionRate: metrics.completionRate || 0,
          trafficSources: metrics.trafficSources || {},
          newFollowers: metrics.newFollowers || 0,
        });

        mergedIds[article.wxArticleId] = true;
      }

      notifyState({ stage: 'upload', message: '正在上传到后端...', progress: 92, total: articles.length, synced: articles.length });
      console.info('[gzh-extension] sync upload payload', {
        apiBase,
        fetchedArticles: articles.length,
        uploadArticles: syncArticles.length,
        snapshots: snapshots.length,
        newCandidates,
        failedMetrics,
        failedContent,
      });

      const proxyResponse = await proxyFetchJson(`${apiBase}/sync/articles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ articles: syncArticles, snapshots }),
      });
      const response = {
        status: proxyResponse.status,
        ok: !!proxyResponse.httpOk,
      };
      const json = proxyResponse.body || {};
      console.info('[gzh-extension] sync upload response', {
        status: response.status,
        ok: response.ok,
        code: json?.code,
        message: json?.message,
        data: json?.data,
      });
      if (!response.ok || json.code !== 0) {
        throw new Error(json.message || '同步上传失败');
      }

      const newArticles = json.data?.newArticles ?? json.data?.new_articles ?? 0;
      const updatedArticles = json.data?.updatedArticles ?? json.data?.updated_articles ?? 0;
      const lastSync = {
        updatedAt: new Date().toISOString(),
        total: articles.length,
        synced: articles.length,
        newArticles,
        updatedArticles,
        failedMetrics,
        failedContent,
      };

      await setStorage({ gzhSyncedArticleIds: mergedIds, gzhLastSync: lastSync });

      const failedCount = failedMetrics + failedContent;
      if (failedCount > 0) {
        notifyState({
          stage: 'partial_failed',
          message: `同步部分完成：新增 ${newArticles}，更新 ${updatedArticles}，失败 ${failedCount}`,
          progress: 100,
          total: articles.length,
          synced: articles.length,
          newArticles,
          updatedArticles,
          failedMetrics,
          failedContent,
        });
        return;
      }

      notifyState({
        stage: 'done',
        message: `同步完成：新增 ${newArticles}，更新 ${updatedArticles}`,
        progress: 100,
        total: articles.length,
        synced: articles.length,
        newArticles,
        updatedArticles,
      });
    } catch (error) {
      notifyState({ stage: 'error', message: error.message || '同步失败', progress: 0 });
    } finally {
      STATE.syncing = false;
      updateLauncherState();
    }
  }

  async function fetchAllArticles(token) {
    const all = [];
    let begin = 0;
    const pageSize = 10;
    let pageIndex = 0;

    while (begin < 1000) {
      const url = `/cgi-bin/appmsgpublish?sub=list&begin=${begin}&count=${pageSize}&token=${encodeURIComponent(token)}&lang=zh_CN&f=json&ajax=1`;
      const response = await fetch(url, {
        credentials: 'include',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });
      const text = await response.text();
      const json = parseMaybeJson(text);
      if (!json || typeof json !== 'object') {
        console.warn('[gzh-extension] appmsgpublish response not json', {
          begin,
          status: response.status,
          bodyHead: String(text).slice(0, 180),
        });
        throw new Error('读取文章列表失败：接口返回格式异常');
      }

      const ret = Number(json.base_resp?.ret ?? json.ret ?? 0);
      const errMsg = String(json.base_resp?.err_msg || json.err_msg || '');
      if (ret !== 0) {
        console.warn('[gzh-extension] appmsgpublish returned non-zero ret', { ret, errMsg, begin });
        if (ret === 200013 || /invalid|expired|登录|token/i.test(errMsg)) {
          throw new Error('微信后台登录已过期，请刷新页面重新登录后再同步');
        }
        throw new Error(`读取文章列表失败(${ret})：${errMsg || '未知错误'}`);
      }

      const publishPage = parseMaybeJson(json.publish_page) || parseMaybeJson(json.publishPage) || {};
      const publishListRaw = publishPage.publish_list
        ?? publishPage.publishList
        ?? publishPage.list
        ?? json.publish_list
        ?? json.publishList
        ?? json.list
        ?? [];
      const publishListParsed = Array.isArray(publishListRaw)
        ? publishListRaw
        : (parseMaybeJson(publishListRaw) || []);
      const publishList = Array.isArray(publishListParsed) ? publishListParsed : [];

      const parsed = publishList.flatMap((item, itemIndex) => parseArticlesFromPublishItem(item, itemIndex));
      console.info('[gzh-extension] appmsgpublish page', {
        pageIndex,
        begin,
        publishList: publishList.length,
        parsed: parsed.length,
      });
      if (publishList.length > 0 && parsed.length === 0) {
        const sample = publishList[0] || {};
        console.warn('[gzh-extension] publish list parse empty on non-empty page', {
          sampleKeys: Object.keys(sample),
          samplePublishInfoHead: String(sample.publish_info || sample.publishInfo || '').slice(0, 180),
        });
      }
      if (publishList.length === 0) {
        break;
      }

      all.push(...parsed);
      begin += pageSize;
      pageIndex += 1;
      if (publishList.length < pageSize) {
        break;
      }
    }

    const deduped = dedupeById(all);
    console.info('[gzh-extension] appmsgpublish done', {
      rawCount: all.length,
      dedupedCount: deduped.length,
    });
    return deduped;
  }

  function parseArticlesFromPublishItem(item, itemIndex) {
    const candidates = [];
    const info = parseMaybeJson(item?.publish_info)
      || parseMaybeJson(item?.publishInfo)
      || item?.publish_info
      || item?.publishInfo
      || {};
    collectArticleCandidates(info, candidates, 0);
    collectArticleCandidates(item, candidates, 0);

    const seen = new Set();
    const publishTsFallback = Number(item?.publish_time || 0) || Math.floor(Date.now() / 1000);
    const result = [];
    candidates.forEach((article, idx) => {
      const articleUrlRaw = article.link || article.content_url || article.url || article.contentUrl || article.article_url || '';
      const articleUrl = normalizeMpUrl(articleUrlRaw);
      const metricMsgId = sanitizeMsgId(
        article.appmsgid
          || article.appmsg_id
          || article.msgid
          || parseMidFromUrl(articleUrl)
      );
      const metricMsgIndex = toPositiveInt(
        article.idx
          || article.itemidx
          || article.item_idx
          || article.article_idx
          || article.sn_idx
          || 1,
        1
      );
      const title = String(article.title || article.appmsg_title || article.name || '').trim() || '未命名文章';
      const publishTs = Number(article.create_time || article.publish_time || publishTsFallback) || publishTsFallback;
      const wxArticleId = String(
        article.aid
          || article.appmsgid
          || article.appmsg_id
          || article.msgid
          || parseMidFromUrl(articleUrl)
          || `${title}-${publishTs}-${itemIndex}-${idx}`
      );

      if (!wxArticleId) {
        return;
      }
      const uniqKey = `${wxArticleId}|${title}|${articleUrl}`;
      if (seen.has(uniqKey)) {
        return;
      }
      seen.add(uniqKey);
      result.push({
        wxArticleId,
        title,
        contentUrl: articleUrl,
        publishTime: new Date(publishTs * 1000).toISOString(),
        metricMsgId,
        metricMsgIndex,
      });
    });

    return result;
  }

  function collectArticleCandidates(node, output, depth) {
    if (!node || depth > 8) {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item) => collectArticleCandidates(item, output, depth + 1));
      return;
    }
    if (typeof node !== 'object') {
      return;
    }

    const title = node.title || node.appmsg_title;
    const url = node.link || node.content_url || node.url || node.contentUrl || node.article_url;
    const id = node.aid || node.appmsgid || node.appmsg_id || node.msgid;
    if ((title && url) || id || (url && parseMidFromUrl(String(url)))) {
      output.push(node);
    }

    Object.values(node).forEach((value) => {
      if (value && (typeof value === 'object')) {
        collectArticleCandidates(value, output, depth + 1);
      }
    });
  }

  function normalizeMpUrl(rawUrl) {
    if (!rawUrl) {
      return '';
    }
    const source = String(rawUrl).trim();
    if (!source) {
      return '';
    }

    const protocolRelative = source.startsWith('//') ? `https:${source}` : source;
    if (/^https?:\/\//i.test(protocolRelative)) {
      try {
        const parsed = new URL(protocolRelative);
        if (parsed.protocol === 'http:') {
          parsed.protocol = 'https:';
          return parsed.toString();
        }
        return protocolRelative;
      } catch {
        return protocolRelative.replace(/^http:\/\//i, 'https://');
      }
    }

    return `https://mp.weixin.qq.com${protocolRelative.startsWith('/') ? protocolRelative : `/${protocolRelative}`}`;
  }

  function responseRet(payload) {
    return Number(payload?.base_resp?.ret ?? payload?.ret ?? 0);
  }

  function responseErrMsg(payload) {
    return String(payload?.base_resp?.err_msg || payload?.err_msg || '');
  }

  async function requestMetricsPayload(token, msgId, publishDate) {
    const url = `/misc/appmsganalysis?action=detailpage&msgid=${encodeURIComponent(msgId)}&publish_date=${publishDate}&type=int&pageVersion=1&token=${encodeURIComponent(token)}&lang=zh_CN&f=json&ajax=1`;
    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    const text = await response.text();
    const json = parseMaybeJson(text);
    if (!json || typeof json !== 'object') {
      throw new Error('文章指标接口返回格式异常');
    }
    return json;
  }

  function findFirstNumberByKeys(root, keys) {
    if (!root || !keys?.length) {
      return 0;
    }
    const keySet = new Set(keys.map((k) => String(k).toLowerCase()));
    const queue = [root];
    const visited = new Set();
    let fallback = null;
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || typeof current !== 'object') {
        continue;
      }
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);

      if (Array.isArray(current)) {
        current.forEach((item) => queue.push(item));
        continue;
      }

      Object.entries(current).forEach(([key, value]) => {
        if (value && typeof value === 'object') {
          queue.push(value);
        }
        if (!keySet.has(key.toLowerCase())) {
          return;
        }
        const num = Number(value);
        if (!Number.isFinite(num)) {
          return;
        }
        if (num > 0) {
          fallback = num;
          queue.length = 0;
          return;
        }
        if (fallback == null) {
          fallback = num;
        }
      });
    }
    return Number(fallback ?? 0);
  }

  function collectSceneItems(root) {
    const result = [];
    const queue = [root];
    const visited = new Set();
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || typeof current !== 'object') {
        continue;
      }
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);

      if (Array.isArray(current)) {
        current.forEach((item) => {
          if (item && typeof item === 'object') {
            if (Object.prototype.hasOwnProperty.call(item, 'scene')
              || Object.prototype.hasOwnProperty.call(item, 'scene_id')
              || Object.prototype.hasOwnProperty.call(item, 'source_scene')) {
              result.push(item);
            }
            queue.push(item);
          }
        });
        continue;
      }

      Object.values(current).forEach((value) => {
        if (value && typeof value === 'object') {
          queue.push(value);
        }
      });
    }
    return result;
  }

  function buildTrafficSources(root) {
    const direct = {
      '公众号消息': findFirstNumberByKeys(root, ['frommsg']),
      '朋友圈': findFirstNumberByKeys(root, ['fromfeed']),
      '搜一搜': findFirstNumberByKeys(root, ['fromsogou']),
      '推荐': findFirstNumberByKeys(root, ['fromrecommend']),
    };
    if (Object.values(direct).some((v) => v > 0)) {
      return direct;
    }

    const byScene = {
      '公众号消息': 0,
      '朋友圈': 0,
      '搜一搜': 0,
      '推荐': 0,
    };
    const sceneItems = collectSceneItems(root);
    sceneItems.forEach((item) => {
      const scene = Number(item.scene ?? item.scene_id ?? item.source_scene);
      const count = findFirstNumberByKeys(item, ['int_page_read_user', 'read_num', 'read_uv', 'read_count', 'value', 'count']);
      if (!Number.isFinite(scene) || !Number.isFinite(count) || count <= 0) {
        return;
      }
      if (scene === 0) {
        byScene['公众号消息'] += count;
      } else if (scene === 2) {
        byScene['朋友圈'] += count;
      } else if (scene === 7) {
        byScene['搜一搜'] += count;
      } else if (scene === 6) {
        byScene['推荐'] += count;
      }
    });
    return byScene;
  }

  async function fetchArticleMetrics(token, article) {
    const msgIdBase = sanitizeMsgId(article.metricMsgId || parseMidFromUrl(article.contentUrl) || String(article.wxArticleId).split('_')[0]);
    if (!msgIdBase) {
      throw new Error('缺少文章 msgid');
    }

    const msgIndex = toPositiveInt(article.metricMsgIndex, 1);
    const publishDate = (article.publishTime || '').slice(0, 10);

    let json = await requestMetricsPayload(token, `${msgIdBase}_${msgIndex}`, publishDate);
    let ret = responseRet(json);
    if (ret !== 0 && msgIndex !== 1) {
      const fallback = await requestMetricsPayload(token, `${msgIdBase}_1`, publishDate).catch(() => null);
      if (fallback) {
        json = fallback;
        ret = responseRet(json);
      }
    }
    if (ret !== 0) {
      const errMsg = responseErrMsg(json);
      throw new Error(`文章指标接口异常(${ret})${errMsg ? `: ${errMsg}` : ''}`);
    }

    const articleData = parseMaybeJson(json.articleData) || json.articleData || {};
    const articleDataNew = parseMaybeJson(articleData.article_data_new || json.article_data_new)
      || articleData.article_data_new
      || json.article_data_new
      || {};
    const subsTransform = parseMaybeJson(articleData.subs_transform || json.subs_transform)
      || articleData.subs_transform
      || json.subs_transform
      || {};

    const root = { json, articleData, articleDataNew, subsTransform };
    const readCount = findFirstNumberByKeys(root, ['int_page_read_user', 'read_num', 'read_uv']);
    const sendCount = findFirstNumberByKeys(root, ['send_uv']);
    const shareCount = findFirstNumberByKeys(root, ['share_user', 'share_count', 'share_uv']);
    const likeCount = findFirstNumberByKeys(root, ['like_num', 'like_cnt']);
    const wowCount = findFirstNumberByKeys(root, ['old_like_num', 'wow_num', 'zaikan_cnt']);
    const commentCount = findFirstNumberByKeys(root, ['comment_id_count', 'comment_cnt']);
    const saveCount = findFirstNumberByKeys(root, ['fav_num', 'save_count', 'collection_uv']);
    const completionRate = findFirstNumberByKeys(root, ['complete_read_rate', 'finished_read_pv_ratio']);
    const newFollowers = findFirstNumberByKeys(root, ['new_fans', 'follow_after_read_uv']);
    const trafficSources = buildTrafficSources(root);

    if (
      zeroMetricsLogCount < 5
      && readCount === 0
      && sendCount === 0
      && shareCount === 0
      && likeCount === 0
      && wowCount === 0
      && commentCount === 0
      && saveCount === 0
    ) {
      zeroMetricsLogCount += 1;
      console.warn('[gzh-extension] metrics all zero', {
        msgIdBase,
        msgIndex,
        publishDate,
        topKeys: Object.keys(json || {}),
      });
    }

    return {
      readCount,
      sendCount,
      shareCount,
      likeCount,
      wowCount,
      commentCount,
      saveCount,
      completionRate,
      trafficSources,
      newFollowers,
    };
  }

  async function fetchArticleContent(url) {
    if (!url) {
      return '';
    }
    const secureUrl = normalizeMpUrl(url);
    if (!secureUrl) {
      return '';
    }
    const response = await fetch(secureUrl, { credentials: 'include' });
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    return (doc.body?.innerText || '').trim().slice(0, 20000);
  }

  function parseMaybeJson(value) {
    if (!value) {
      return null;
    }
    if (typeof value === 'object') {
      return value;
    }
    if (typeof value !== 'string') {
      return null;
    }

    const raw = value.trim();
    if (!raw) {
      return null;
    }

    const candidates = [
      raw,
      raw.replace(/^\)\]\}',?\s*/, ''),
      decodeHtmlEntities(raw),
      decodeHtmlEntities(raw).replace(/^\)\]\}',?\s*/, ''),
    ];
    for (const one of candidates) {
      if (!one) {
        continue;
      }
      try {
        return JSON.parse(one);
      } catch {
        // keep trying
      }
    }
    return null;
  }

  function decodeHtmlEntities(text) {
    if (!text) {
      return '';
    }
    const el = document.createElement('textarea');
    el.innerHTML = text;
    return el.value;
  }

  function dedupeById(items) {
    const map = new Map();
    items.forEach((item) => {
      map.set(item.wxArticleId, item);
    });
    return Array.from(map.values());
  }

  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.type === 'start-sync') {
        createPanel();
        openPanel();
        void startSync();
        sendResponse({ ok: true });
        return true;
      }
      return undefined;
    });
  } catch (error) {
    if (!isContextInvalidatedError(error)) {
      console.warn('[gzh-extension] bind runtime listener failed', error);
    }
  }

  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') {
        return;
      }

      let prevAuthToken = latestAuthToken;
      let shouldRender = false;
      if (Object.prototype.hasOwnProperty.call(changes, 'gzhAuthToken')) {
        latestAuthToken = changes.gzhAuthToken?.newValue || '';
        shouldRender = true;
      }
      if (Object.prototype.hasOwnProperty.call(changes, 'gzhLastSync')) {
        latestLastSync = changes.gzhLastSync?.newValue || null;
        shouldRender = true;
      }

      if (shouldRender) {
        renderPanel(panelState);
      }

      if (Object.prototype.hasOwnProperty.call(changes, 'gzhAuthToken')) {
        maybeAutoStartSyncOnAuthReady(prevAuthToken, latestAuthToken, 'storage.onChanged');
      }
    });
  } catch (error) {
    if (!isContextInvalidatedError(error)) {
      console.warn('[gzh-extension] bind storage listener failed', error);
    }
  }

  async function refreshFromStorage(allowAutoSync = true) {
    try {
      const prevAuthToken = latestAuthToken;
      const storage = await getStorage(['gzhAuthToken', 'gzhLastSync']);
      latestAuthToken = storage.gzhAuthToken || '';
      latestLastSync = storage.gzhLastSync || null;
      renderPanel(panelState);
      if (allowAutoSync) {
        maybeAutoStartSyncOnAuthReady(prevAuthToken, latestAuthToken, 'refreshFromStorage');
      }
    } catch (error) {
      if (!isContextInvalidatedError(error)) {
        console.warn('[gzh-extension] refreshFromStorage failed', error);
      }
    }
  }

  async function init() {
    await refreshFromStorage(false);
    createLauncher();
    createPanel();
    renderPanel(panelState);
    closePanel();

    window.addEventListener('focus', () => {
      void refreshFromStorage();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        void refreshFromStorage();
      }
    });
  }

  void init().catch((error) => {
    if (!isContextInvalidatedError(error)) {
      console.warn('[gzh-extension] init failed', error);
    }
  });
})();
