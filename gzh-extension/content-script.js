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
  const FREQ_CONTROL_RE = /freq\s*control|频控|频率|频繁|操作过于频繁/i;
  const LOG_PREFIX = '[tfling]';
  const METRICS_BASE_INTERVAL_MS = 180;
  const METRICS_MIN_INTERVAL_MS = 120;
  const METRICS_MAX_INTERVAL_MS = 1400;
  const METRICS_FREQ_RETRY_MIN_MS = 900;
  const METRICS_FREQ_RETRY_JITTER_MS = 350;

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
        safeLog('warn', 'sendMessage threw', {
          reason: error?.message || String(error),
        });
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
        safeLog('warn', 'getURL failed', {
          reason: error?.message || String(error),
        });
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
              safeLog('warn', 'storage.get failed', { reason: err.message });
            }
            resolve({});
            return;
          }
          resolve(result || {});
        });
      } catch (error) {
        if (!isContextInvalidatedError(error)) {
          safeLog('warn', 'storage.get threw', {
            reason: error?.message || String(error),
          });
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
            safeLog('warn', 'storage.set failed', { reason: err.message });
          }
          resolve(!err);
        });
      } catch (error) {
        if (!isContextInvalidatedError(error)) {
          safeLog('warn', 'storage.set threw', {
            reason: error?.message || String(error),
          });
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
      const failCount = (state.failedMetrics || 0) + (state.failedContent || 0) + (state.failedUpload || 0);
      summaryEl.textContent = `已完成上传，失败 ${failCount}（指标 ${state.failedMetrics || 0} / 全文 ${state.failedContent || 0} / 上传 ${state.failedUpload || 0}）`;
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
      failedUpload: payload.failedUpload ?? 0,
      uploadedSnapshots: payload.uploadedSnapshots ?? 0,
      uploadedSnapshotsWithMetrics: payload.uploadedSnapshotsWithMetrics ?? 0,
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
        failedUpload: state.failedUpload,
        uploadedSnapshots: state.uploadedSnapshots,
        uploadedSnapshotsWithMetrics: state.uploadedSnapshotsWithMetrics,
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
      safeLog('info', 'skip auto sync: no mp token in page', { source });
      return;
    }

    lastAutoSyncAuthToken = newToken;
    safeLog('info', 'auto start sync after auth ready', { source });
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

  function isLikelyArticleUrl(rawUrl) {
    if (!rawUrl) {
      return false;
    }
    try {
      const url = new URL(rawUrl);
      if (!/mp\.weixin\.qq\.com$/i.test(url.hostname)) {
        return false;
      }
      if (url.pathname === '/s' || url.pathname.startsWith('/s/')) {
        return true;
      }
      return url.searchParams.has('mid') || url.searchParams.has('__biz') || url.searchParams.has('idx');
    } catch {
      return false;
    }
  }

  function isTruthyFlag(value) {
    if (value === true) {
      return true;
    }
    if (typeof value === 'number') {
      return value > 0;
    }
    if (typeof value === 'string') {
      const text = value.trim().toLowerCase();
      return text === '1' || text === 'true' || text === 'yes' || text === 'y';
    }
    return false;
  }

  function hasDeleteKeywordInKey(key) {
    const text = String(key || '').toLowerCase();
    return text.includes('is_deleted')
      || text.includes('is_delete')
      || text.includes('deleted')
      || text.includes('is_del')
      || text.includes('del_flag')
      || text.includes('delete_flag')
      || text.includes('remove_flag')
      || text.includes('is_invalid');
  }

  function titleLooksDeleted(title) {
    const text = String(title || '').trim();
    if (!text) {
      return false;
    }
    return /^(已删除|内容已删除|该内容已被发布者删除|已下架|已失效)/.test(text)
      || /\[已删除\]|\(已删除\)|（已删除）/.test(text);
  }

  function hasDeleteFlag(node, maxDepth = 2) {
    if (!node || typeof node !== 'object') {
      return false;
    }
    const queue = [{ value: node, depth: 0 }];
    const visited = new Set();
    while (queue.length > 0) {
      const current = queue.shift();
      const value = current?.value;
      const depth = current?.depth ?? 0;
      if (!value || typeof value !== 'object') {
        continue;
      }
      if (visited.has(value)) {
        continue;
      }
      visited.add(value);

      if (Array.isArray(value)) {
        if (depth < maxDepth) {
          value.forEach((item) => queue.push({ value: item, depth: depth + 1 }));
        }
        continue;
      }

      for (const [key, one] of Object.entries(value)) {
        if (hasDeleteKeywordInKey(key) && isTruthyFlag(one)) {
          return true;
        }
        if (depth < maxDepth && one && typeof one === 'object') {
          queue.push({ value: one, depth: depth + 1 });
        }
      }
    }
    return false;
  }

  function isDeletedArticleCandidate(node) {
    if (!node || typeof node !== 'object') {
      return false;
    }
    if (hasDeleteFlag(node, 2)) {
      return true;
    }
    const title = String(node.title || node.appmsg_title || node.name || '').trim();
    if (titleLooksDeleted(title)) {
      return true;
    }
    return false;
  }

  function toPositiveInt(raw, fallback = 1) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      return fallback;
    }
    return Math.floor(value);
  }

  function sleep(ms) {
    const waitMs = Math.max(0, Number(ms) || 0);
    if (waitMs <= 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      setTimeout(resolve, waitMs);
    });
  }

  function isFreqControlReason(reason) {
    return FREQ_CONTROL_RE.test(String(reason || ''));
  }

  function safeLog(level, message, payload) {
    try {
      const fn = typeof console?.[level] === 'function' ? console[level] : console.log;
      const text = `${LOG_PREFIX} ${message}`;
      if (payload === undefined) {
        fn.call(console, text);
        return;
      }
      fn.call(console, text, payload);
    } catch {
      // ignore log failures in extension context
    }
  }

  function buildSnapshotPayload(article, metrics) {
    if (!article || !metrics) {
      return null;
    }
    return {
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
    };
  }

  function hasSnapshotCoreMetrics(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      return false;
    }
    return Number(snapshot.readCount || 0) > 0
      || Number(snapshot.sendCount || 0) > 0
      || Number(snapshot.shareCount || 0) > 0
      || Number(snapshot.likeCount || 0) > 0
      || Number(snapshot.wowCount || 0) > 0
      || Number(snapshot.commentCount || 0) > 0
      || Number(snapshot.saveCount || 0) > 0
      || Number(snapshot.newFollowers || 0) > 0;
  }

  async function uploadSyncChunk(apiBase, authToken, articles, snapshots) {
    const proxyResponse = await proxyFetchJson(`${apiBase}/sync/articles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        articles: Array.isArray(articles) ? articles : [],
        snapshots: Array.isArray(snapshots) ? snapshots : [],
      }),
    });
    const response = {
      status: proxyResponse.status,
      ok: !!proxyResponse.httpOk,
    };
    const json = proxyResponse.body || {};
    if (!response.ok || json.code !== 0) {
      throw new Error(json.message || `同步上传失败(status=${response.status})`);
    }
    return {
      newArticles: json.data?.newArticles ?? json.data?.new_articles ?? 0,
      updatedArticles: json.data?.updatedArticles ?? json.data?.updated_articles ?? 0,
      status: response.status,
      message: json?.message || 'OK',
    };
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

      const mergedIds = { ...syncedArticleIds };
      let failedMetrics = 0;
      let failedContent = 0;
      let failedUpload = 0;
      let newCandidates = 0;
      let uploadedArticles = 0;
      let uploadedSnapshots = 0;
      let uploadedSnapshotsWithMetrics = 0;
      let newArticles = 0;
      let updatedArticles = 0;
      let lastMetricsRequestedAt = 0;
      let metricsRequestIntervalMs = METRICS_BASE_INTERVAL_MS;

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

        const contentPromise = isNew
          ? fetchArticleContent(article.contentUrl)
            .then((text) => ({ ok: true, text }))
            .catch((error) => ({ ok: false, error }))
          : null;

        let metrics = null;
        const elapsedMs = Date.now() - lastMetricsRequestedAt;
        const waitMs = metricsRequestIntervalMs - elapsedMs;
        if (waitMs > 0) {
          await sleep(waitMs + Math.floor(Math.random() * 40));
        }
        lastMetricsRequestedAt = Date.now();
        let metricsError = await fetchArticleMetrics(token, article)
          .then((result) => {
            metrics = result;
            return null;
          })
          .catch((error) => error);
        if (metricsError && isFreqControlReason(metricsError?.message || String(metricsError))) {
          metricsRequestIntervalMs = Math.min(
            METRICS_MAX_INTERVAL_MS,
            Math.max(metricsRequestIntervalMs + 220, METRICS_BASE_INTERVAL_MS + 120)
          );
          await sleep(METRICS_FREQ_RETRY_MIN_MS + Math.floor(Math.random() * METRICS_FREQ_RETRY_JITTER_MS));
          lastMetricsRequestedAt = Date.now();
          metricsError = await fetchArticleMetrics(token, article)
            .then((result) => {
              metrics = result;
              return null;
            })
            .catch((error) => error);
        }
        if (!metricsError) {
          metricsRequestIntervalMs = Math.max(
            METRICS_MIN_INTERVAL_MS,
            Math.floor(metricsRequestIntervalMs * 0.95)
          );
        }
        if (metricsError) {
          failedMetrics += 1;
          if (failedMetrics <= 5) {
            safeLog('warn', 'metrics fetch failed', {
              index,
              wxArticleId: article?.wxArticleId ?? '',
              title: article?.title ?? '',
              reason: metricsError?.message || String(metricsError),
              intervalMs: metricsRequestIntervalMs,
            });
          }
        }

        let content = null;
        let wordCount = null;
        if (isNew && contentPromise) {
          const contentResult = await contentPromise;
          if (!contentResult.ok) {
            const error = contentResult.error;
            failedContent += 1;
            if (failedContent <= 5) {
              safeLog('warn', 'content fetch failed', {
                index,
                wxArticleId: article?.wxArticleId ?? '',
                title: article?.title ?? '',
                reason: error?.message || String(error),
              });
            }
            content = '';
            wordCount = 0;
          } else {
            content = contentResult.text;
            wordCount = contentResult.text.length;
          }
        }
        const syncItem = {
          wxArticleId: article.wxArticleId,
          title: article.title,
          content,
          wordCount,
          publishTime: article.publishTime,
        };

        const snapshot = buildSnapshotPayload(article, metrics);
        const snapshotHasMetrics = hasSnapshotCoreMetrics(snapshot);
        notifyState({
          stage: 'upload',
          message: `正在上传 ${index + 1}/${articles.length}...`,
          progress: 70 + Math.round(((index + 1) / Math.max(1, articles.length)) * 28),
          total: articles.length,
          synced: uploadedArticles,
        });
        try {
          const uploadResult = await uploadSyncChunk(
            apiBase,
            authToken,
            [syncItem],
            snapshot ? [snapshot] : []
          );
          newArticles += Number(uploadResult.newArticles || 0);
          updatedArticles += Number(uploadResult.updatedArticles || 0);
          uploadedArticles += 1;
          if (snapshot) {
            uploadedSnapshots += 1;
            if (snapshotHasMetrics) {
              uploadedSnapshotsWithMetrics += 1;
            }
          }
          mergedIds[article.wxArticleId] = true;
          if (index < 3 || (index + 1) % 10 === 0 || index + 1 === articles.length) {
            safeLog('info', 'sync incremental progress', {
              index: index + 1,
              total: articles.length,
              uploadedArticles,
              uploadedSnapshots,
              uploadedSnapshotsWithMetrics,
              newArticles,
              updatedArticles,
              failedMetrics,
              failedContent,
              failedUpload,
              metricsRequestIntervalMs,
            });
          }
        } catch (error) {
          failedUpload += 1;
          if (failedUpload <= 5) {
            safeLog('warn', 'upload failed', {
              index,
              wxArticleId: article?.wxArticleId ?? '',
              title: article?.title ?? '',
              reason: error?.message || String(error),
            });
          }
        }
      }

      safeLog('info', 'sync done summary', {
        apiBase,
        fetchedArticles: articles.length,
        uploadArticles: uploadedArticles,
        snapshots: uploadedSnapshots,
        snapshotsWithMetrics: uploadedSnapshotsWithMetrics,
        newCandidates,
        failedMetrics,
        failedContent,
        failedUpload,
        newArticles,
        updatedArticles,
      });
      const lastSync = {
        updatedAt: new Date().toISOString(),
        total: articles.length,
        synced: uploadedArticles,
        newArticles,
        updatedArticles,
        failedMetrics,
        failedContent,
        failedUpload,
        uploadedSnapshots,
        uploadedSnapshotsWithMetrics,
      };

      await setStorage({ gzhSyncedArticleIds: mergedIds, gzhLastSync: lastSync });

      const failedCount = failedMetrics + failedContent + failedUpload;
      if (failedCount > 0) {
        notifyState({
          stage: 'partial_failed',
          message: `同步部分完成：新增 ${newArticles}，更新 ${updatedArticles}，失败 ${failedCount}`,
          progress: 100,
          total: articles.length,
          synced: uploadedArticles,
          newArticles,
          updatedArticles,
          failedMetrics,
          failedContent,
          failedUpload,
          uploadedSnapshots,
          uploadedSnapshotsWithMetrics,
        });
        return;
      }

      notifyState({
        stage: 'done',
        message: `同步完成：新增 ${newArticles}，更新 ${updatedArticles}`,
        progress: 100,
        total: articles.length,
        synced: uploadedArticles,
        newArticles,
        updatedArticles,
        uploadedSnapshots,
        uploadedSnapshotsWithMetrics,
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
      let json = parseMaybeJson(text);
      if (!json || typeof json !== 'object') {
        const htmlPublishPage = parsePublishPageFromHtml(text);
        if (htmlPublishPage) {
          json = {
            base_resp: { ret: 0, err_msg: '' },
            publish_page: htmlPublishPage,
          };
        }
      }
      if (!json || typeof json !== 'object') {
        safeLog('warn', 'appmsgpublish response not json', {
          begin,
          status: response.status,
          bodyHead: String(text).slice(0, 180),
        });
        throw new Error('读取文章列表失败：接口返回格式异常');
      }

      const ret = Number(json.base_resp?.ret ?? json.ret ?? 0);
      const errMsg = String(json.base_resp?.err_msg || json.err_msg || '');
      if (ret !== 0) {
        safeLog('warn', 'appmsgpublish returned non-zero ret', { ret, errMsg, begin });
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
      if (publishList.length > 0 && parsed.length === 0) {
        const sample = publishList[0] || {};
        safeLog('warn', 'publish list parse empty on non-empty page', {
          sampleKeys: Object.keys(sample),
          samplePublishInfoHead: String(sample.publish_info || sample.publishInfo || '').slice(0, 180),
        });
      }
      if (publishList.length === 0) {
        break;
      }

      all.push(...parsed);
      begin += pageSize;
      if (publishList.length < pageSize) {
        break;
      }
    }

    const deduped = dedupeById(all);
    safeLog('info', 'appmsgpublish done', {
      rawCount: all.length,
      dedupedCount: deduped.length,
    });
    return deduped;
  }

  function parseArticlesFromPublishItem(item, itemIndex) {
    if (isDeletedArticleCandidate(item)) {
      return [];
    }
    const candidates = [];
    const info = parseMaybeJson(item?.publish_info)
      || parseMaybeJson(item?.publishInfo)
      || item?.publish_info
      || item?.publishInfo
      || {};
    collectArticleCandidates(info, candidates, 0);
    collectArticleCandidates(item, candidates, 0);

    const seen = new Set();
    const publishTsFallback = Number(item?.publish_time || item?.create_time || 0);
    const result = [];
    candidates.forEach((article, idx) => {
      if (isDeletedArticleCandidate(article)) {
        return;
      }
      const articleUrlRaw = article.link || article.content_url || article.url || article.contentUrl || article.article_url || '';
      const articleUrl = normalizeMpUrl(articleUrlRaw);
      if (!isLikelyArticleUrl(articleUrl)) {
        return;
      }
      const rawTitle = String(article.title || article.appmsg_title || article.name || '').trim();
      if (!rawTitle) {
        return;
      }
      const midFromUrl = parseMidFromUrl(articleUrl);
      const metricMsgId = sanitizeMsgId(
        midFromUrl
          || article.msgid
          || article.appmsgid
          || article.appmsg_id
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
      const title = rawTitle;
      const publishTs = Number(article.publish_time || article.create_time || publishTsFallback || 0);
      const wxArticleId = String(
        article.aid
          || `${midFromUrl || metricMsgId || ''}_${metricMsgIndex}`
          || article.appmsgid
          || article.appmsg_id
          || article.msgid
          || midFromUrl
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
        publishTime: publishTs > 0 ? new Date(publishTs * 1000).toISOString() : '',
        publishDate: publishTs > 0 ? formatChinaDateFromUnixSeconds(publishTs) : '',
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

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function formatChinaDateFromUnixSeconds(seconds) {
    const ts = Number(seconds);
    if (!Number.isFinite(ts) || ts <= 0) {
      return '';
    }
    const shifted = new Date(ts * 1000 + 8 * 60 * 60 * 1000);
    const y = shifted.getUTCFullYear();
    const m = shifted.getUTCMonth() + 1;
    const d = shifted.getUTCDate();
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }

  function formatIsoFromUnixSeconds(seconds) {
    const ts = Number(seconds);
    if (!Number.isFinite(ts) || ts <= 0) {
      return '';
    }
    return new Date(ts * 1000).toISOString();
  }

  function formatDateFromDateWithOffset(date, offsetHours) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return '';
    }
    const shifted = new Date(date.getTime() + offsetHours * 60 * 60 * 1000);
    const y = shifted.getUTCFullYear();
    const m = shifted.getUTCMonth() + 1;
    const d = shifted.getUTCDate();
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }

  function shiftYmd(ymd, days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) {
      return '';
    }
    const [y, m, d] = String(ymd).split('-').map((item) => Number(item));
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    const yy = dt.getUTCFullYear();
    const mm = dt.getUTCMonth() + 1;
    const dd = dt.getUTCDate();
    return `${yy}-${pad2(mm)}-${pad2(dd)}`;
  }

  function buildPublishDateCandidates(article) {
    const candidates = [];
    const pushIfValid = (value) => {
      const text = String(value || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return;
      }
      if (!candidates.includes(text)) {
        candidates.push(text);
      }
    };

    pushIfValid(article.publishDate);

    if (article.publishTime) {
      const date = new Date(article.publishTime);
      pushIfValid(formatDateFromDateWithOffset(date, 8));
      pushIfValid(formatDateFromDateWithOffset(date, 0));
    }

    if (candidates.length === 0) {
      return [];
    }

    const base = candidates[0];
    pushIfValid(shiftYmd(base, -1));
    pushIfValid(shiftYmd(base, 1));
    return candidates;
  }

  function responseRet(payload) {
    return Number(payload?.base_resp?.ret ?? payload?.ret ?? 0);
  }

  function responseErrMsg(payload) {
    return String(payload?.base_resp?.err_msg || payload?.err_msg || '');
  }

  function extractBalancedBlock(text, startIndex) {
    if (typeof text !== 'string' || startIndex < 0 || startIndex >= text.length) {
      return '';
    }
    const open = text[startIndex];
    const close = open === '{' ? '}' : (open === '[' ? ']' : '');
    if (!close) {
      return '';
    }
    let depth = 0;
    let quote = '';
    let escaped = false;
    for (let i = startIndex; i < text.length; i += 1) {
      const ch = text[i];
      if (quote) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === quote) {
          quote = '';
        }
        continue;
      }
      if (ch === '"' || ch === '\'' || ch === '`') {
        quote = ch;
        continue;
      }
      if (ch === open) {
        depth += 1;
        continue;
      }
      if (ch === close) {
        depth -= 1;
        if (depth === 0) {
          return text.slice(startIndex, i + 1);
        }
      }
    }
    return '';
  }

  function parseLooseJsonObject(raw) {
    if (!raw || typeof raw !== 'string') {
      return null;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      return null;
    }
    const strict = parseMaybeJson(trimmed);
    if (strict && typeof strict === 'object') {
      return strict;
    }
    try {
      return (new Function(`return (${trimmed});`))();
    } catch {
      return null;
    }
  }

  function extractValueByToken(raw, token) {
    if (typeof raw !== 'string' || !token) {
      return '';
    }
    const index = raw.indexOf(token);
    if (index < 0) {
      return '';
    }
    let pos = index + token.length;
    while (pos < raw.length && /\s/.test(raw[pos])) {
      pos += 1;
    }
    if (pos >= raw.length) {
      return '';
    }
    const ch = raw[pos];
    if (ch === '{' || ch === '[') {
      return extractBalancedBlock(raw, pos);
    }
    if (ch === '"' || ch === '\'') {
      const start = pos;
      let escaped = false;
      for (let i = pos + 1; i < raw.length; i += 1) {
        const one = raw[i];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (one === '\\') {
          escaped = true;
          continue;
        }
        if (one === ch) {
          return raw.slice(start, i + 1);
        }
      }
    }
    let end = pos;
    while (end < raw.length && !/[,\n;\r]/.test(raw[end])) {
      end += 1;
    }
    return raw.slice(pos, end).trim();
  }

  function parseMetricsPayloadFromHtml(raw) {
    if (!raw || typeof raw !== 'string') {
      return null;
    }
    const cgiDataRaw = extractValueByToken(raw, 'window.wx.cgiData=')
      || extractValueByToken(raw, 'window.wx.cgiData =')
      || extractValueByToken(raw, 'wx.cgiData=')
      || extractValueByToken(raw, 'wx.cgiData =');
    const cgiData = parseLooseJsonObject(cgiDataRaw);
    if (cgiData && typeof cgiData === 'object') {
      return cgiData;
    }

    const articleDataRaw = extractValueByToken(raw, 'articleData:')
      || extractValueByToken(raw, 'articleData =');
    const articleSummaryDataRaw = extractValueByToken(raw, 'articleSummaryData:')
      || extractValueByToken(raw, 'articleSummaryData =');
    const subsTransformRaw = extractValueByToken(raw, 'subs_transform:')
      || extractValueByToken(raw, 'subs_transform =');
    const baseRespRaw = extractValueByToken(raw, 'base_resp:')
      || extractValueByToken(raw, 'base_resp =');
    const retRaw = extractValueByToken(raw, 'ret:')
      || extractValueByToken(raw, 'ret =');
    const errMsgRaw = extractValueByToken(raw, 'err_msg:')
      || extractValueByToken(raw, 'err_msg =');

    const payload = {};
    let articleData = parseLooseJsonObject(articleDataRaw);
    let articleSummaryData = parseLooseJsonObject(articleSummaryDataRaw);
    let subsTransform = parseLooseJsonObject(subsTransformRaw);
    const baseResp = parseLooseJsonObject(baseRespRaw);
    const ret = toLooseNumber(retRaw);
    const errMsg = String(errMsgRaw || '').replace(/^['"]|['"]$/g, '').trim();

    if (!articleData) {
      const articleDataMatch = raw.match(/articleData\s*:\s*(\{[\s\S]*?\})\s*,\s*articleSummaryData\s*:/i);
      if (articleDataMatch?.[1]) {
        articleData = parseLooseJsonObject(articleDataMatch[1]);
      }
    }
    if (!articleSummaryData) {
      const summaryMatch = raw.match(/articleSummaryData\s*:\s*(\[[\s\S]*?\]|\{[\s\S]*?\})\s*,\s*detailData\s*:/i);
      if (summaryMatch?.[1]) {
        articleSummaryData = parseLooseJsonObject(summaryMatch[1]);
      }
    }
    if (!subsTransform && articleData && typeof articleData === 'object') {
      subsTransform = parseLooseJsonObject(articleData.subs_transform);
    }

    if (articleData && typeof articleData === 'object') {
      payload.articleData = articleData;
    }
    if (articleSummaryData) {
      payload.articleSummaryData = articleSummaryData;
    }
    if (subsTransform && typeof subsTransform === 'object') {
      payload.subs_transform = subsTransform;
    }
    if (baseResp && typeof baseResp === 'object') {
      payload.base_resp = baseResp;
    } else if (Number.isFinite(ret) || errMsg) {
      payload.base_resp = {
        ret: Number.isFinite(ret) ? ret : 0,
        err_msg: errMsg,
      };
    }

    if (Object.keys(payload).length === 0) {
      return null;
    }
    return payload;
  }

  function extractMetricNumberFromRaw(raw, key) {
    if (typeof raw !== 'string' || !raw || !key) {
      return 0;
    }
    const escapedKey = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const reg = new RegExp(`["']${escapedKey}["']\\s*:\\s*["']?(-?\\d+(?:\\.\\d+)?)`, 'i');
    const matched = raw.match(reg);
    if (!matched?.[1]) {
      return 0;
    }
    const parsed = Number(matched[1]);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function extractMetricsFromRawHtml(raw) {
    if (!raw || typeof raw !== 'string') {
      return null;
    }
    const readCount = extractMetricNumberFromRaw(raw, 'read_uv')
      || extractMetricNumberFromRaw(raw, 'read_num')
      || extractMetricNumberFromRaw(raw, 'int_page_read_user');
    const sendCount = extractMetricNumberFromRaw(raw, 'send_uv');
    const shareCount = extractMetricNumberFromRaw(raw, 'share_uv')
      || extractMetricNumberFromRaw(raw, 'share_user')
      || extractMetricNumberFromRaw(raw, 'share_count');
    const likeCount = extractMetricNumberFromRaw(raw, 'like_cnt')
      || extractMetricNumberFromRaw(raw, 'like_num');
    const wowCount = extractMetricNumberFromRaw(raw, 'zaikan_cnt')
      || extractMetricNumberFromRaw(raw, 'wow_num')
      || extractMetricNumberFromRaw(raw, 'old_like_num');
    const commentCount = extractMetricNumberFromRaw(raw, 'comment_cnt')
      || extractMetricNumberFromRaw(raw, 'comment_id_count');
    const saveCount = extractMetricNumberFromRaw(raw, 'collection_uv')
      || extractMetricNumberFromRaw(raw, 'fav_num')
      || extractMetricNumberFromRaw(raw, 'save_count');
    const completionRate = extractMetricNumberFromRaw(raw, 'finished_read_pv_ratio')
      || extractMetricNumberFromRaw(raw, 'complete_read_rate');
    const newFollowers = extractMetricNumberFromRaw(raw, 'follow_after_read_uv')
      || extractMetricNumberFromRaw(raw, 'new_fans');

    return {
      readCount,
      sendCount,
      shareCount,
      likeCount,
      wowCount,
      commentCount,
      saveCount,
      completionRate,
      newFollowers,
    };
  }

  function mergeMetricsByPositiveValue(base, fallback) {
    if (!fallback || typeof fallback !== 'object') {
      return base;
    }
    const merged = { ...(base || {}) };
    [
      'readCount',
      'sendCount',
      'shareCount',
      'likeCount',
      'wowCount',
      'commentCount',
      'saveCount',
      'completionRate',
      'newFollowers',
    ].forEach((key) => {
      const baseValue = Number(merged[key] || 0);
      const fallbackValue = Number(fallback[key] || 0);
      if (baseValue <= 0 && fallbackValue > 0) {
        merged[key] = fallbackValue;
      }
    });
    return merged;
  }

  function parsePublishPageFromHtml(raw) {
    if (!raw || typeof raw !== 'string') {
      return null;
    }
    const publishPageRaw = extractValueByToken(raw, 'publish_page:')
      || extractValueByToken(raw, 'publish_page =')
      || extractValueByToken(raw, 'publishPage:')
      || extractValueByToken(raw, 'publishPage =');
    const publishPage = parseLooseJsonObject(publishPageRaw);
    if (publishPage && typeof publishPage === 'object') {
      return publishPage;
    }
    const cgiDataRaw = extractValueByToken(raw, 'window.wx.cgiData=')
      || extractValueByToken(raw, 'window.wx.cgiData =')
      || extractValueByToken(raw, 'wx.cgiData=')
      || extractValueByToken(raw, 'wx.cgiData =');
    const cgiData = parseLooseJsonObject(cgiDataRaw);
    if (cgiData && typeof cgiData === 'object') {
      const one = parseMaybeJson(cgiData.publish_page) || cgiData.publish_page;
      if (one && typeof one === 'object') {
        return one;
      }
    }
    return null;
  }

  async function requestMetricsPayload(token, msgId, publishDate) {
    const url = `/misc/appmsganalysis?action=detailpage&msgid=${encodeURIComponent(msgId)}&publish_date=${publishDate}&type=int&pageVersion=1&token=${encodeURIComponent(token)}&lang=zh_CN`;
    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    const text = await response.text();
    const json = parseMaybeJson(text) || parseMetricsPayloadFromHtml(text);
    if (!json || typeof json !== 'object') {
      throw new Error(`文章指标接口返回格式异常(status=${response.status})`);
    }
    return { json, raw: text };
  }

  async function requestMetricsWithFallback(token, msgIdBase, msgIndex, publishDate) {
    let result = await requestMetricsPayload(token, `${msgIdBase}_${msgIndex}`, publishDate);
    let ret = responseRet(result?.json);
    if (ret !== 0 && msgIndex !== 1) {
      const fallback = await requestMetricsPayload(token, `${msgIdBase}_1`, publishDate).catch(() => null);
      if (fallback) {
        result = fallback;
        ret = responseRet(result?.json);
      }
    }
    return { json: result?.json, raw: result?.raw, ret };
  }

  function toLooseNumber(value) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : NaN;
    }
    if (typeof value !== 'string') {
      return NaN;
    }
    const text = value.trim();
    if (!text) {
      return NaN;
    }
    const normalized = text.replace(/,/g, '').replace(/%/g, '');
    const matched = normalized.match(/-?\d+(?:\.\d+)?/);
    if (!matched) {
      return NaN;
    }
    const num = Number(matched[0]);
    return Number.isFinite(num) ? num : NaN;
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
        const num = toLooseNumber(value);
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

  function extractMetricsFromPayload(payload) {
    const articleData = parseMaybeJson(payload.articleData) || payload.articleData || {};
    const articleDataNew = parseMaybeJson(articleData.article_data_new || payload.article_data_new)
      || articleData.article_data_new
      || payload.article_data_new
      || {};
    const subsTransform = parseMaybeJson(articleData.subs_transform || payload.subs_transform)
      || articleData.subs_transform
      || payload.subs_transform
      || {};

    const root = { json: payload, articleData, articleDataNew, subsTransform };
    return {
      readCount: findFirstNumberByKeys(root, ['int_page_read_user', 'read_num', 'read_uv']),
      sendCount: findFirstNumberByKeys(root, ['send_uv']),
      shareCount: findFirstNumberByKeys(root, ['share_user', 'share_count', 'share_uv']),
      likeCount: findFirstNumberByKeys(root, ['like_num', 'like_cnt']),
      wowCount: findFirstNumberByKeys(root, ['old_like_num', 'wow_num', 'zaikan_cnt']),
      commentCount: findFirstNumberByKeys(root, ['comment_id_count', 'comment_cnt']),
      saveCount: findFirstNumberByKeys(root, ['fav_num', 'save_count', 'collection_uv']),
      completionRate: findFirstNumberByKeys(root, ['complete_read_rate', 'finished_read_pv_ratio']),
      newFollowers: findFirstNumberByKeys(root, ['new_fans', 'follow_after_read_uv']),
      trafficSources: buildTrafficSources(root),
      topKeys: safeObjectKeys(payload),
    };
  }

  function isCoreMetricsZero(metrics) {
    return metrics.readCount === 0
      && metrics.sendCount === 0
      && metrics.shareCount === 0
      && metrics.likeCount === 0
      && metrics.wowCount === 0
      && metrics.commentCount === 0
      && metrics.saveCount === 0;
  }

  function parseArticleMetaFromHtml(html, fallbackUrl) {
    const text = String(html || '');
    const midMatch = text.match(/(?:var|window\.)\s*mid\s*=\s*["']?(\d{4,})["']?/i)
      || text.match(/[?&]mid=(\d{4,})/i)
      || String(fallbackUrl || '').match(/[?&]mid=(\d{4,})/i);
    const ctMatch = text.match(/(?:var|window\.)\s*ct\s*=\s*["']?(\d{9,})["']?/i)
      || text.match(/publish_time["']?\s*:\s*["']?(\d{9,})["']?/i);
    const msgIdBase = sanitizeMsgId(midMatch?.[1] || '');
    const publishTimestamp = Number(ctMatch?.[1] || 0);
    const publishDate = formatChinaDateFromUnixSeconds(publishTimestamp);
    const publishTime = formatIsoFromUnixSeconds(publishTimestamp);
    return { msgIdBase, publishDate, publishTime, publishTimestamp };
  }

  async function resolveMetricParamsFromArticlePage(article) {
    const secureUrl = normalizeMpUrl(article?.contentUrl || '');
    if (!secureUrl) {
      return null;
    }
    const response = await fetch(secureUrl, { credentials: 'include' });
    const html = await response.text();
    const meta = parseArticleMetaFromHtml(html, secureUrl);
    if (!meta.msgIdBase && !meta.publishDate && !meta.publishTime) {
      return null;
    }
    return meta;
  }

  async function fetchArticleMetrics(token, article) {
    const msgIdBase = sanitizeMsgId(article.metricMsgId || parseMidFromUrl(article.contentUrl) || String(article.wxArticleId).split('_')[0]);
    if (!msgIdBase) {
      throw new Error('缺少文章 msgid');
    }

    const msgIndex = toPositiveInt(article.metricMsgIndex, 1);
    const publishDateCandidates = buildPublishDateCandidates(article);
    let usedPublishDate = publishDateCandidates[0] || '';

    const applyResolvedPublishMeta = (resolved) => {
      if (!resolved || typeof resolved !== 'object') {
        return;
      }
      if (resolved.publishTime) {
        article.publishTime = resolved.publishTime;
      }
      if (resolved.publishDate) {
        article.publishDate = resolved.publishDate;
        if (!publishDateCandidates.includes(resolved.publishDate)) {
          publishDateCandidates.unshift(resolved.publishDate);
        }
      }
    };

    let resolvedFromArticlePage = false;
    let currentMsgIdBase = msgIdBase;
    if (!usedPublishDate) {
      const resolved = await resolveMetricParamsFromArticlePage(article).catch(() => null);
      applyResolvedPublishMeta(resolved);
      if (resolved?.publishDate && !usedPublishDate) {
        usedPublishDate = resolved.publishDate;
      }
      if (resolved?.msgIdBase) {
        currentMsgIdBase = resolved.msgIdBase;
        resolvedFromArticlePage = true;
      }
    }
    if (!usedPublishDate) {
      throw new Error('文章指标接口参数缺失: publish_date');
    }

    let requestResult = await requestMetricsWithFallback(token, currentMsgIdBase, msgIndex, usedPublishDate);
    if (requestResult.ret !== 0 && /invalid args/i.test(responseErrMsg(requestResult.json))) {
      const resolved = await resolveMetricParamsFromArticlePage(article).catch(() => null);
      applyResolvedPublishMeta(resolved);
      if (resolved?.msgIdBase) {
        resolvedFromArticlePage = true;
        currentMsgIdBase = resolved.msgIdBase;
        if (resolved.publishDate) {
          usedPublishDate = resolved.publishDate;
        }
        requestResult = await requestMetricsWithFallback(token, currentMsgIdBase, msgIndex, usedPublishDate);
      }
    }
    if (requestResult.ret !== 0) {
      const errMsg = responseErrMsg(requestResult.json);
      throw new Error(`文章指标接口异常(${requestResult.ret})${errMsg ? `: ${errMsg}` : ''}`);
    }
    let metrics = extractMetricsFromPayload(requestResult.json);
    const metricsFromRaw = extractMetricsFromRawHtml(requestResult.raw);
    metrics = mergeMetricsByPositiveValue(metrics, metricsFromRaw);

    if (isCoreMetricsZero(metrics) && !resolvedFromArticlePage && article?.contentUrl) {
      const resolved = await resolveMetricParamsFromArticlePage(article).catch(() => null);
      applyResolvedPublishMeta(resolved);
      if (resolved?.msgIdBase && resolved.publishDate) {
        const resolvedResult = await requestMetricsWithFallback(token, resolved.msgIdBase, msgIndex, resolved.publishDate).catch(() => null);
        if (resolvedResult && resolvedResult.ret === 0) {
          const resolvedMetrics = mergeMetricsByPositiveValue(
            extractMetricsFromPayload(resolvedResult.json),
            extractMetricsFromRawHtml(resolvedResult.raw)
          );
          if (!isCoreMetricsZero(resolvedMetrics)) {
            metrics = resolvedMetrics;
            currentMsgIdBase = resolved.msgIdBase;
            usedPublishDate = resolved.publishDate;
            resolvedFromArticlePage = true;
          }
        }
      }
    }

    if (isCoreMetricsZero(metrics) && publishDateCandidates.length > 1) {
      for (let i = 1; i < publishDateCandidates.length; i += 1) {
        const oneDate = publishDateCandidates[i];
        if (!oneDate || oneDate === usedPublishDate) {
          continue;
        }
        const oneResult = await requestMetricsWithFallback(token, msgIdBase, msgIndex, oneDate).catch(() => null);
        if (!oneResult || oneResult.ret !== 0) {
          continue;
        }
        const oneMetrics = mergeMetricsByPositiveValue(
          extractMetricsFromPayload(oneResult.json),
          extractMetricsFromRawHtml(oneResult.raw)
        );
        if (!isCoreMetricsZero(oneMetrics)) {
          metrics = oneMetrics;
          usedPublishDate = oneDate;
          safeLog('info', 'metrics recovered by publish_date retry', {
            msgIdBase,
            msgIndex,
            originDate: publishDateCandidates[0],
            resolvedDate: oneDate,
          });
          break;
        }
      }
    }

    if (zeroMetricsLogCount < 5 && isCoreMetricsZero(metrics)) {
      zeroMetricsLogCount += 1;
      safeLog('warn', 'metrics all zero', {
        wxArticleId: article?.wxArticleId ?? '',
        title: article?.title ?? '',
        msgIdBase: currentMsgIdBase,
        msgIndex,
        publishDateCandidates,
        usedPublishDate,
        resolvedFromArticlePage,
        topKeys: metrics.topKeys,
      });
    }

    return {
      readCount: metrics.readCount,
      sendCount: metrics.sendCount,
      shareCount: metrics.shareCount,
      likeCount: metrics.likeCount,
      wowCount: metrics.wowCount,
      commentCount: metrics.commentCount,
      saveCount: metrics.saveCount,
      completionRate: metrics.completionRate,
      trafficSources: metrics.trafficSources,
      newFollowers: metrics.newFollowers,
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

  function safeObjectKeys(value) {
    if (!value || typeof value !== 'object') {
      return [];
    }
    try {
      return Object.keys(value);
    } catch {
      return [];
    }
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
    const score = (item) => {
      let val = 0;
      if (item?.contentUrl) {
        val += 2;
      }
      if (item?.metricMsgId) {
        val += 2;
      }
      if (item?.title && item.title !== '未命名文章') {
        val += 2;
      }
      if (item?.publishDate) {
        val += 1;
      }
      return val;
    };
    items.forEach((item) => {
      const prev = map.get(item.wxArticleId);
      if (!prev) {
        map.set(item.wxArticleId, item);
        return;
      }
      const prevScore = score(prev);
      const nextScore = score(item);
      if (nextScore > prevScore) {
        map.set(item.wxArticleId, item);
        return;
      }
      if (nextScore === prevScore) {
        const prevLen = String(prev.contentUrl || '').length;
        const nextLen = String(item.contentUrl || '').length;
        if (nextLen > prevLen) {
          map.set(item.wxArticleId, item);
        }
      }
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
      safeLog('warn', 'bind runtime listener failed', {
        reason: error?.message || String(error),
      });
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
      safeLog('warn', 'bind storage listener failed', {
        reason: error?.message || String(error),
      });
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
        safeLog('warn', 'refreshFromStorage failed', {
          reason: error?.message || String(error),
        });
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
      safeLog('warn', 'init failed', {
        reason: error?.message || String(error),
      });
    }
  });
})();
