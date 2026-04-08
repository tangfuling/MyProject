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

  const HTTP_CONFIG = globalThis.GzhHttpConfig;
  if (!HTTP_CONFIG) {
    throw new Error('GzhHttpConfig is required.');
  }
  const API_BASE_URL = HTTP_CONFIG.getBaseUrl();
  const RUNNING_STAGES = new Set(['fetch_list', 'fetch_detail', 'upload']);
  const DEFAULT_WEB_BASE = HTTP_CONFIG.isDebug ? 'http://localhost:5173' : 'https://gzh.niumatech.com';
  const CONTEXT_INVALIDATED_RE = /extension context invalidated|invalidated|receiving end does not exist/i;
  const FREQ_CONTROL_RE = /freq\s*control|频控|频率|频繁|操作过于频繁/i;
  const LOG_PREFIX = '[tfling]';
  const MP_FETCH_BASE_INTERVAL_MS = 1800;
  const MP_FETCH_JITTER_MS = 1200;
  const MP_FREQ_HIT_WINDOW_MS = 3 * 60 * 1000;
  const MP_FREQ_HIT_THRESHOLD = 3;
  const MP_FREQ_COOLDOWN_MS = 30 * 60 * 1000;
  const METRICS_BASE_INTERVAL_MS = 6200;
  const METRICS_MIN_INTERVAL_MS = 4200;
  const METRICS_MAX_INTERVAL_MS = 18000;
  const METRICS_FREQ_RETRY_MIN_MS = 9000;
  const METRICS_FREQ_RETRY_JITTER_MS = 3000;
  const CONTENT_FETCH_CONCURRENCY = 1;
  const CONTENT_PREFETCH_WINDOW = 2;
  const LIST_PAGE_INTERVAL_MS = 2500;
  const LIST_PAGE_JITTER_MS = 900;
  const METRICS_LOOKBACK_DAYS = 45;
  const DEFAULT_SYNC_RANGE_CODE = '30d';
  const SYNC_RANGE_OPTIONS = [
    { code: '30d', label: '最近30天', days: 30 },
    { code: '60d', label: '最近60天', days: 60 },
    { code: '90d', label: '最近90天', days: 90 },
    { code: 'all', label: '全部', days: 0 },
  ];
  const MAX_ARTICLES_PER_RUN = 300;
  const ARTICLE_PAGE_CACHE_MAX = 320;
  const ARTICLE_CONTENT_MAX_LENGTH = 20000;
  const UPLOAD_BATCH_SIZE = 10;

  let latestAuthToken = '';
  let latestLastSync = null;
  let lastAutoSyncAuthToken = '';
  let zeroMetricsLogCount = 0;
  let zeroTrafficSourceLogCount = 0;
  let metricsPayloadParseWarnCount = 0;
  let trafficProbeLogCount = 0;
  let publishListParseHintCount = 0;
  const articlePageCache = new Map();
  const mpFreqHitTimes = [];
  let lastMpFetchAt = 0;
  let mpCooldownUntil = 0;
  let selectedSyncRangeCode = DEFAULT_SYNC_RANGE_CODE;
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

  function normalizeWebBase(raw) {
    if (HTTP_CONFIG.isDebug) {
      return DEFAULT_WEB_BASE;
    }
    const candidate = String(raw || '').trim();
    const value = candidate || DEFAULT_WEB_BASE;
    return value.replace(/\/+$/, '');
  }

  async function getWebBase() {
    const storage = await getStorage(['gzhWebBase']);
    return normalizeWebBase(storage.gzhWebBase || DEFAULT_WEB_BASE);
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
        message: '请先前往运营助手登录，才能同步数据',
        progress: 0,
        synced: 0,
        total: 0,
      };
    }

    return {
      stage: 'ready',
      message: latestLastSync
        ? `上次同步：${formatTime(latestLastSync.updatedAt)}`
        : `已登录，可开始同步（${syncRangeLabelByCode(selectedSyncRangeCode)}）`,
      progress: 0,
      synced: 0,
      total: latestLastSync?.total || 0,
    };
  }

  function normalizeSyncRangeCode(rawCode) {
    const code = String(rawCode || '').trim().toLowerCase();
    if (SYNC_RANGE_OPTIONS.some((item) => item.code === code)) {
      return code;
    }
    return DEFAULT_SYNC_RANGE_CODE;
  }

  function syncRangeOptionByCode(rawCode) {
    const code = normalizeSyncRangeCode(rawCode);
    return SYNC_RANGE_OPTIONS.find((item) => item.code === code) || SYNC_RANGE_OPTIONS[0];
  }

  function syncRangeDaysByCode(rawCode) {
    return Number(syncRangeOptionByCode(rawCode).days || 0);
  }

  function syncRangeLabelByCode(rawCode) {
    return syncRangeOptionByCode(rawCode).label;
  }

  function buildSyncRangeOptionsHtml() {
    return SYNC_RANGE_OPTIONS
      .map((item) => `<option value="${item.code}">${item.label}</option>`)
      .join('');
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
        bottom: 76px;
        width: 340px;
        border-radius: 16px;
        border: 1px solid #dbe7f7;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 24px 56px -28px rgba(15, 23, 42, 0.45);
        overflow: hidden;
        z-index: 1000000;
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif;
      }
      #${PANEL_ID}.hidden {
        display: none;
      }
      .gzh-sync-head {
        height: 42px;
        background: linear-gradient(135deg, #1d4ed8, #0f766e);
        color: #f8fafc;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 12px;
      }
      .gzh-sync-title-wrap {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .gzh-sync-title-icon {
        width: 18px;
        height: 18px;
        border-radius: 5px;
      }
      .gzh-sync-title {
        font-size: 13px;
        font-weight: 800;
      }
      .gzh-sync-close {
        border: none;
        background: none;
        color: rgba(248, 250, 252, 0.76);
        font-size: 14px;
        cursor: pointer;
      }
      .gzh-sync-body {
        padding: 12px;
      }
      .gzh-sync-state-line {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .gzh-sync-state {
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
        padding: 5px 9px;
        color: #92400e;
        background: #fef3c7;
        border: 1px solid #fcd34d;
      }
      .gzh-sync-state.ready {
        color: #0f766e;
        background: #ccfbf1;
        border-color: #5eead4;
      }
      .gzh-sync-state.running {
        color: #4338ca;
        background: #ede9fe;
        border-color: #c4b5fd;
      }
      .gzh-sync-state.done {
        color: #166534;
        background: #dcfce7;
        border-color: #86efac;
      }
      .gzh-sync-state.warn {
        color: #b45309;
        background: #fef3c7;
        border-color: #fcd34d;
      }
      .gzh-sync-state.error {
        color: #991b1b;
        background: #fee2e2;
        border-color: #fecaca;
      }
      .gzh-sync-progress-text {
        color: #64748b;
        font-size: 11px;
      }
      .gzh-sync-message {
        margin-top: 8px;
        color: #334155;
        font-size: 12px;
        line-height: 1.6;
      }
      .gzh-sync-progress-wrap {
        margin-top: 8px;
        height: 8px;
        border-radius: 999px;
        background: #e2e8f0;
        overflow: hidden;
      }
      .gzh-sync-progress-bar {
        display: block;
        height: 100%;
        width: 0;
        border-radius: 999px;
        background: linear-gradient(135deg, #2563eb, #4f46e5);
      }
      .gzh-sync-count,
      .gzh-sync-steps,
      .gzh-sync-summary {
        margin-top: 6px;
        color: #94a3b8;
        font-size: 11px;
        line-height: 1.5;
      }
      .gzh-sync-range-line {
        margin-top: 10px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .gzh-sync-range-label {
        color: #64748b;
        font-size: 11px;
        font-weight: 600;
      }
      .gzh-sync-range-select {
        min-width: 120px;
        height: 30px;
        border: 1px solid #dbe7f7;
        border-radius: 8px;
        color: #334155;
        background: #fff;
        padding: 0 8px;
        font-size: 12px;
      }
      .gzh-sync-range-select:disabled {
        color: #94a3b8;
        background: #f8fafc;
      }
      .gzh-sync-actions {
        margin-top: 10px;
        display: flex;
        gap: 8px;
      }
      .gzh-sync-btn {
        flex: 1;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        background: #fff;
        color: #334155;
        font-size: 12px;
        font-weight: 700;
        padding: 9px 10px;
        cursor: pointer;
      }
      .gzh-sync-btn.primary {
        border: none;
        color: #fff;
        background: linear-gradient(135deg, #2563eb, #4f46e5);
      }
      .gzh-sync-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
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
        color: #fff;
        background: linear-gradient(135deg, #2563eb, #4f46e5);
        box-shadow: 0 16px 34px -18px rgba(37, 99, 235, 0.62);
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        z-index: 999999;
      }
      #${LAUNCHER_ID} img {
        width: 20px;
        height: 20px;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.94);
        padding: 2px;
      }
      #${LAUNCHER_ID}[data-running="true"] {
        opacity: 0.84;
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
      launcher.setAttribute('title', '同步到运营助手');
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
    const rangeSelect = document.getElementById('gzh-sync-range');
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
    let primaryText = '同步到运营助手';
    let secondaryAction = 'close';
    let secondaryText = '关闭';
    let primaryDisabled = false;

    if (state.stage === 'need_login_web') {
      primaryAction = 'open_web_login';
      primaryText = '前往运营助手登录';
      secondaryAction = 'close';
      secondaryText = '取消';
    } else if (state.stage === 'login_expired') {
      primaryAction = 'refresh';
      primaryText = '刷新页面';
      secondaryAction = 'open_web';
      secondaryText = '打开运营助手';
    } else if (RUNNING_STAGES.has(state.stage)) {
      primaryAction = 'running';
      primaryText = '同步中...';
      primaryDisabled = true;
      secondaryAction = 'close';
      secondaryText = '收起';
    } else if (state.stage === 'done' || state.stage === 'partial_failed') {
      primaryAction = 'open_workspace';
      primaryText = '前往运营助手查看 →';
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

    if (rangeSelect instanceof HTMLSelectElement) {
      rangeSelect.value = normalizeSyncRangeCode(selectedSyncRangeCode);
      rangeSelect.disabled = STATE.syncing || RUNNING_STAGES.has(state.stage);
    }
  }

  async function handlePanelAction(action) {
    const webBase = await getWebBase();
    const webHome = `${webBase}/gzh`;
    const workspace = `${webBase}/gzh/workspace`;

    if (action === 'start') {
      openPanel();
      void startSync();
      return;
    }
    if (action === 'open_web') {
      window.open(webHome, '_blank', 'noopener,noreferrer');
      return;
    }
    if (action === 'open_workspace') {
      window.open(workspace, '_blank', 'noopener,noreferrer');
      return;
    }
    if (action === 'open_web_login') {
      try {
        const url = new URL(webHome);
        url.searchParams.set('openLogin', '1');
        url.searchParams.set('redirect', '/gzh/workspace');
        window.open(url.toString(), '_blank', 'noopener,noreferrer');
      } catch {
        window.open(`${webHome}?openLogin=1&redirect=%2Fgzh%2Fworkspace`, '_blank', 'noopener,noreferrer');
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
      ? `<img class="gzh-sync-title-icon" src="${iconUrl}" alt="公众号数据运营助手" />`
      : '<span class="gzh-sync-title-icon" aria-hidden="true"></span>';
    const rangeOptionsHtml = buildSyncRangeOptionsHtml();
    panel.innerHTML = `
      <div class="gzh-sync-head">
        <div class="gzh-sync-title-wrap">
          ${titleIcon}
          <div class="gzh-sync-title">公众号数据运营助手</div>
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
        <div class="gzh-sync-range-line">
          <span class="gzh-sync-range-label">同步范围</span>
          <select id="gzh-sync-range" class="gzh-sync-range-select">${rangeOptionsHtml}</select>
        </div>
        <div class="gzh-sync-actions">
          <button type="button" class="gzh-sync-btn primary" id="gzh-sync-primary" data-action="start">同步到运营助手</button>
          <button type="button" class="gzh-sync-btn" id="gzh-sync-secondary" data-action="close">关闭</button>
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    const closeBtn = document.getElementById('gzh-sync-close');
    const primaryBtn = document.getElementById('gzh-sync-primary');
    const secondaryBtn = document.getElementById('gzh-sync-secondary');
    const rangeSelect = document.getElementById('gzh-sync-range');

    if (closeBtn) {
      closeBtn.addEventListener('click', closePanel);
    }
    if (primaryBtn) {
      primaryBtn.addEventListener('click', () => {
        void handlePanelAction(primaryBtn.dataset.action || 'close');
      });
    }
    if (secondaryBtn) {
      secondaryBtn.addEventListener('click', () => {
        void handlePanelAction(secondaryBtn.dataset.action || 'close');
      });
    }
    if (rangeSelect instanceof HTMLSelectElement) {
      rangeSelect.value = normalizeSyncRangeCode(selectedSyncRangeCode);
      rangeSelect.addEventListener('change', () => {
        const nextCode = normalizeSyncRangeCode(rangeSelect.value);
        selectedSyncRangeCode = nextCode;
        void setStorage({ gzhSyncRangeCode: nextCode });
        renderPanel(panelState);
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
    const launcherIcon = iconUrl ? `<img src="${iconUrl}" alt="公众号数据运营助手" />` : '';
    launcher.innerHTML = `${launcherIcon}<span>同步到运营助手</span>`;
    launcher.addEventListener('click', () => {
      createPanel();
      openPanel();
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

  function createFreqLimitedError(message, extra) {
    const error = new Error(message || '触发频控，请稍后重试');
    error.isFreqLimited = true;
    if (extra && typeof extra === 'object') {
      Object.assign(error, extra);
    }
    return error;
  }

  function compactMpFreqHits(nowMs) {
    while (mpFreqHitTimes.length > 0 && (nowMs - mpFreqHitTimes[0]) > MP_FREQ_HIT_WINDOW_MS) {
      mpFreqHitTimes.shift();
    }
  }

  function noteMpFreqHit(source) {
    const nowMs = Date.now();
    mpFreqHitTimes.push(nowMs);
    compactMpFreqHits(nowMs);
    if (mpFreqHitTimes.length >= MP_FREQ_HIT_THRESHOLD) {
      mpCooldownUntil = Math.max(mpCooldownUntil, nowMs + MP_FREQ_COOLDOWN_MS);
      safeLog('warn', 'mp freq hit threshold reached, enter cooldown', {
        source,
        hits: mpFreqHitTimes.length,
        cooldownUntil: new Date(mpCooldownUntil).toISOString(),
      });
    }
  }

  async function waitForMpFetchSlot() {
    let nowMs = Date.now();
    if (mpCooldownUntil > nowMs) {
      await sleep(mpCooldownUntil - nowMs);
      nowMs = Date.now();
    }
    const targetGap = MP_FETCH_BASE_INTERVAL_MS + Math.floor(Math.random() * MP_FETCH_JITTER_MS);
    const elapsed = nowMs - lastMpFetchAt;
    if (elapsed < targetGap) {
      await sleep(targetGap - elapsed);
    }
    lastMpFetchAt = Date.now();
  }

  async function guardedMpFetchText(url, init, options) {
    const opts = options || {};
    await waitForMpFetchSlot();
    const response = await fetch(url, init);
    const text = await response.text();
    if (response.status === 429) {
      noteMpFreqHit(opts.source || url);
      throw createFreqLimitedError('请求频率过高，已进入冷却');
    }
    const shouldCheckBodyFreq = opts.detectFreqInBody !== false;
    if (shouldCheckBodyFreq && isFreqControlReason(text)) {
      noteMpFreqHit(opts.source || url);
      throw createFreqLimitedError('微信侧触发频控，已自动降速并停止当前流程');
    }
    return { response, text };
  }

  function isWithinLookbackDays(article, days) {
    const value = String(article?.publishTime || '').trim();
    if (!value) {
      return true;
    }
    const ts = Date.parse(value);
    if (!Number.isFinite(ts)) {
      return true;
    }
    return (Date.now() - ts) <= (Math.max(1, days) * 24 * 60 * 60 * 1000);
  }

  function createTaskLimiter(maxConcurrent) {
    const limit = Math.max(1, toPositiveInt(maxConcurrent, 1));
    let running = 0;
    const queue = [];

    const drain = () => {
      while (running < limit && queue.length > 0) {
        const task = queue.shift();
        running += 1;
        Promise.resolve()
          .then(() => task.runner())
          .then(task.resolve, task.reject)
          .finally(() => {
            running -= 1;
            drain();
          });
      }
    };

    return (runner) => new Promise((resolve, reject) => {
      queue.push({ runner, resolve, reject });
      drain();
    });
  }

  function extractArticleTextFromHtml(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(html || ''), 'text/html');
    return (doc.body?.innerText || '').trim().slice(0, ARTICLE_CONTENT_MAX_LENGTH);
  }

  async function fetchArticlePageData(secureUrl) {
    const { text: html } = await guardedMpFetchText(
      secureUrl,
      { credentials: 'include' },
      { source: 'article-page', detectFreqInBody: false }
    );
    return {
      contentText: extractArticleTextFromHtml(html),
      meta: parseArticleMetaFromHtml(html, secureUrl),
    };
  }

  function getArticlePageData(rawUrl) {
    const secureUrl = normalizeMpUrl(rawUrl || '');
    if (!secureUrl) {
      return Promise.resolve({
        secureUrl: '',
        contentText: '',
        meta: null,
      });
    }

    const cachedPromise = articlePageCache.get(secureUrl);
    if (cachedPromise) {
      // Refresh cache order to keep hot entries longer.
      articlePageCache.delete(secureUrl);
      articlePageCache.set(secureUrl, cachedPromise);
      return cachedPromise;
    }

    const requestPromise = fetchArticlePageData(secureUrl)
      .then((data) => ({
        secureUrl,
        contentText: data?.contentText || '',
        meta: data?.meta || null,
      }))
      .catch((error) => {
        articlePageCache.delete(secureUrl);
        throw error;
      });

    articlePageCache.set(secureUrl, requestPromise);
    while (articlePageCache.size > ARTICLE_PAGE_CACHE_MAX) {
      const oldestKey = articlePageCache.keys().next().value;
      articlePageCache.delete(oldestKey);
    }

    return requestPromise;
  }

  function isFreqControlReason(reason) {
    return FREQ_CONTROL_RE.test(String(reason || ''));
  }

  function safeLog(level, message, payload) {
    try {
      if (String(level || '').toLowerCase() === 'info') {
        return;
      }
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

  function safeWarnProbe(message, payload, force = false) {
    if (!force && trafficProbeLogCount >= 30) {
      return;
    }
    trafficProbeLogCount += 1;
    safeLog('warn', message, payload);
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
      avgReadTimeSec: metrics.avgReadTimeSec || 0,
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
      || Number(snapshot.avgReadTimeSec || 0) > 0
      || Number(snapshot.newFollowers || 0) > 0;
  }

  function createUploadError(message, extra) {
    const error = new Error(message || 'sync upload failed');
    if (extra && typeof extra === 'object') {
      Object.assign(error, extra);
    }
    return error;
  }

  function isUnauthorizedUploadError(error) {
    const code = Number(error?.code || 0);
    if (code === 40101) {
      return true;
    }
    const message = String(error?.message || '');
    return /40101|unauthorized|not logged|token/i.test(message);
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

    if (!response.ok) {
      throw createUploadError(
        json.message || `sync upload failed(status=${response.status})`,
        {
          code: Number(json.code || 0),
          status: response.status,
          apiBase,
        }
      );
    }

    if (Number(json.code || 0) !== 0) {
      throw createUploadError(
        json.message || `sync upload failed(code=${json.code})`,
        {
          code: Number(json.code || 0),
          status: response.status,
          apiBase,
        }
      );
    }

    return {
      newArticles: json.data?.newArticles ?? json.data?.new_articles ?? 0,
      updatedArticles: json.data?.updatedArticles ?? json.data?.updated_articles ?? 0,
      status: response.status,
      message: json?.message || 'OK',
      apiBase,
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

      const storage = await getStorage(['gzhAuthToken', 'gzhSyncedArticleIds']);
      const authToken = storage.gzhAuthToken;
      const apiBase = API_BASE_URL;
      const syncedArticleIds = storage.gzhSyncedArticleIds || {};

      latestAuthToken = authToken || '';

      if (!authToken) {
        notifyState({
          stage: 'need_login_web',
          message: '请先前往运营助手登录，才能同步数据',
          progress: 0,
        });
        return;
      }

      const syncRangeCode = normalizeSyncRangeCode(selectedSyncRangeCode);
      const syncRangeDays = syncRangeDaysByCode(syncRangeCode);
      const syncRangeLabel = syncRangeLabelByCode(syncRangeCode);
      notifyState({ stage: 'fetch_list', message: `正在读取文章列表（${syncRangeLabel}）...`, progress: 5 });
      const articles = await fetchAllArticles(token, { syncRangeDays });

      if (articles.length === 0) {
        const lastSync = {
          updatedAt: new Date().toISOString(),
          total: 0,
          synced: 0,
          syncRangeCode,
          syncRangeLabel,
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
      let firstUploadError = '';
      let lastMetricsRequestedAt = 0;
      let metricsRequestIntervalMs = METRICS_BASE_INTERVAL_MS;
      let processedArticles = 0;
      let pendingSyncItems = [];
      let pendingSnapshots = [];
      let pendingArticleIds = [];
      let pendingSnapshotsWithMetrics = 0;
      const runContentFetch = createTaskLimiter(CONTENT_FETCH_CONCURRENCY);
      const contentPromiseByArticleId = new Map();

      const ensureContentFetchTask = (article) => {
        if (!article || !article.contentUrl) {
          return Promise.resolve({ ok: true, text: '' });
        }
        const cacheKey = String(article.wxArticleId || article.contentUrl);
        const cached = contentPromiseByArticleId.get(cacheKey);
        if (cached) {
          return cached;
        }
        const task = runContentFetch(async () => {
          const pageData = await getArticlePageData(article.contentUrl);
          return pageData?.contentText || '';
        })
          .then((text) => ({ ok: true, text }))
          .catch((error) => ({ ok: false, error }));
        contentPromiseByArticleId.set(cacheKey, task);
        return task;
      };

      const warmContentPrefetch = (startIndex) => {
        for (let offset = 0; offset < CONTENT_PREFETCH_WINDOW; offset += 1) {
          const one = articles[startIndex + offset];
          if (!one) {
            break;
          }
          if (mergedIds[one.wxArticleId]) {
            continue;
          }
          ensureContentFetchTask(one);
        }
      };

      const flushPendingUploads = async (index, total) => {
        if (pendingSyncItems.length === 0) {
          return true;
        }

        notifyState({
          stage: 'upload',
          message: `正在上传 ${index}/${total}...`,
          progress: 70 + Math.round((index / Math.max(1, total)) * 28),
          total,
          synced: processedArticles,
        });

        try {
          const uploadResult = await uploadSyncChunk(
            apiBase,
            authToken,
            pendingSyncItems,
            pendingSnapshots
          );
          newArticles += Number(uploadResult.newArticles || 0);
          updatedArticles += Number(uploadResult.updatedArticles || 0);
          uploadedArticles += pendingSyncItems.length;
          uploadedSnapshots += pendingSnapshots.length;
          uploadedSnapshotsWithMetrics += pendingSnapshotsWithMetrics;
          pendingArticleIds.forEach((wxArticleId) => {
            mergedIds[wxArticleId] = true;
          });

          if (index <= 3 || index % 10 === 0 || index === total) {
            safeLog('info', 'sync incremental progress', {
              index,
              total,
              uploadedArticles,
              uploadedSnapshots,
              uploadedSnapshotsWithMetrics,
              newArticles,
              updatedArticles,
              failedMetrics,
              failedContent,
              failedUpload,
              metricsRequestIntervalMs,
              batchSize: pendingSyncItems.length,
            });
          }
        } catch (error) {
          const uploadReason = error?.message || String(error);
          if (!firstUploadError) {
            firstUploadError = uploadReason;
          }
          if (isUnauthorizedUploadError(error)) {
            notifyState({
              stage: 'need_login_web',
              message: 'Web auth expired, please login again and retry sync.',
              progress: 0,
            });
            safeLog('warn', 'upload unauthorized, abort sync', {
              index,
              wxArticleId: pendingArticleIds[0] || '',
              batchSize: pendingSyncItems.length,
              apiBase: error?.apiBase || apiBase,
              status: error?.status || 0,
              code: error?.code || 0,
              reason: uploadReason,
            });
            return false;
          }
          failedUpload += pendingSyncItems.length;
          if (failedUpload <= 10) {
            safeLog('warn', 'upload failed', {
              index,
              wxArticleId: pendingArticleIds[0] || '',
              batchSize: pendingSyncItems.length,
              apiBase: error?.apiBase || apiBase,
              status: error?.status || 0,
              code: error?.code || 0,
              reason: uploadReason,
            });
          }
        } finally {
          pendingSyncItems = [];
          pendingSnapshots = [];
          pendingArticleIds = [];
          pendingSnapshotsWithMetrics = 0;
        }

        return true;
      };

      const stopForFreqLimit = async () => {
        if (pendingSyncItems.length > 0) {
          const flushed = await flushPendingUploads(processedArticles, articles.length);
          if (!flushed) {
            return;
          }
        }
        const nowMs = Date.now();
        const cooldownMs = Math.max(0, mpCooldownUntil - nowMs);
        const cooldownMinutes = Math.max(1, Math.ceil(cooldownMs / (60 * 1000)));
        safeLog('warn', 'sync stopped by freq protection', {
          processedArticles,
          total: articles.length,
          uploadedArticles,
          uploadedSnapshots,
          uploadedSnapshotsWithMetrics,
          cooldownUntil: mpCooldownUntil ? new Date(mpCooldownUntil).toISOString() : '',
        });

        const lastSync = {
          updatedAt: new Date().toISOString(),
          total: articles.length,
          synced: uploadedArticles,
          syncRangeCode,
          syncRangeLabel,
          newArticles,
          updatedArticles,
          failedMetrics,
          failedContent,
          failedUpload,
          uploadedSnapshots,
          uploadedSnapshotsWithMetrics,
        };
        await setStorage({ gzhSyncedArticleIds: mergedIds, gzhLastSync: lastSync });
        notifyState({
          stage: 'partial_failed',
          message: `检测到频控，已自动停止，建议约 ${cooldownMinutes} 分钟后重试`,
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
      };

      for (let index = 0; index < articles.length; index += 1) {
        const article = articles[index];
        const isNew = !mergedIds[article.wxArticleId];
        if (isNew) {
          newCandidates += 1;
        }
        warmContentPrefetch(index);

        notifyState({
          stage: 'fetch_detail',
          message: `${isNew ? '新文章' : '旧文章'}：${index + 1}/${articles.length}`,
          progress: Math.round(((index + 1) / articles.length) * 70) + 10,
          total: articles.length,
          synced: processedArticles,
        });

        const shouldFetchMetrics = isNew || isWithinLookbackDays(article, METRICS_LOOKBACK_DAYS);
        if (!isNew && !shouldFetchMetrics) {
          processedArticles = index + 1;
          continue;
        }

        const contentPromise = isNew
          ? ensureContentFetchTask(article)
          : null;

        let metrics = null;
        if (shouldFetchMetrics) {
          const elapsedMs = Date.now() - lastMetricsRequestedAt;
          const waitMs = metricsRequestIntervalMs - elapsedMs;
          if (waitMs > 0) {
            await sleep(waitMs + Math.floor(Math.random() * 200));
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
              Math.max(metricsRequestIntervalMs + 1500, METRICS_BASE_INTERVAL_MS + 800)
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
              Math.floor(metricsRequestIntervalMs * 0.92)
            );
          }
          if (metricsError) {
            if (metricsError?.isFreqLimited || isFreqControlReason(metricsError?.message || String(metricsError))) {
              await stopForFreqLimit();
              return;
            }
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
        }

        let content = null;
        let wordCount = null;
        if (isNew && contentPromise) {
          const contentResult = await contentPromise;
          contentPromiseByArticleId.delete(String(article.wxArticleId || article.contentUrl || ''));
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
        pendingSyncItems.push(syncItem);
        pendingArticleIds.push(article.wxArticleId);
        if (snapshot) {
          pendingSnapshots.push(snapshot);
          if (snapshotHasMetrics) {
            pendingSnapshotsWithMetrics += 1;
          }
        }

        processedArticles = index + 1;
        const shouldFlush = pendingSyncItems.length >= UPLOAD_BATCH_SIZE || processedArticles === articles.length;
        if (shouldFlush) {
          const continueSync = await flushPendingUploads(processedArticles, articles.length);
          if (!continueSync) {
            return;
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
        firstUploadError,
        newArticles,
        updatedArticles,
      });
      const lastSync = {
        updatedAt: new Date().toISOString(),
        total: articles.length,
        synced: uploadedArticles,
        syncRangeCode,
        syncRangeLabel,
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
      if (error?.isFreqLimited) {
        const cooldownMs = Math.max(0, mpCooldownUntil - Date.now());
        const cooldownMinutes = Math.max(1, Math.ceil(cooldownMs / (60 * 1000)));
        notifyState({
          stage: 'partial_failed',
          message: `${error.message || '检测到频控'}，建议约 ${cooldownMinutes} 分钟后重试`,
          progress: 0,
        });
      } else {
        notifyState({ stage: 'error', message: error.message || '同步失败', progress: 0 });
      }
    } finally {
      STATE.syncing = false;
      updateLauncherState();
    }
  }

  async function fetchAllArticles(token, options = {}) {
    const syncRangeDays = Math.max(0, Number(options.syncRangeDays || 0));
    const all = [];
    let begin = 0;
    const pageSize = 10;

    while (begin < 1000) {
      const url = `/cgi-bin/appmsgpublish?sub=list&begin=${begin}&count=${pageSize}&token=${encodeURIComponent(token)}&lang=zh_CN&f=json&ajax=1`;
      const { response, text } = await guardedMpFetchText(
        url,
        {
          credentials: 'include',
          headers: {
            Accept: 'application/json, text/plain, */*',
            'X-Requested-With': 'XMLHttpRequest',
          },
        },
        { source: 'publish-list' }
      );
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
        if (isFreqControlReason(errMsg)) {
          noteMpFreqHit(`publish-list-ret:${ret}`);
          throw createFreqLimitedError('读取文章列表触发频控，请稍后重试');
        }
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
      if (publishList.length > 0 && parsed.length === 0 && maybeHasArticleShape(publishList[0])) {
        const sample = publishList[0] || {};
        if (publishListParseHintCount < 1) {
          publishListParseHintCount += 1;
          safeLog('info', 'publish list parse empty on non-empty page', {
            sampleKeys: Object.keys(sample),
            samplePublishInfoHead: String(sample.publish_info || sample.publishInfo || '').slice(0, 180),
          });
        }
      }
      if (publishList.length === 0) {
        break;
      }

      all.push(...parsed);
      if (all.length >= MAX_ARTICLES_PER_RUN) {
        break;
      }

      if (syncRangeDays > 0 && parsed.length > 0) {
        const parsedWithPublishTime = parsed.filter((article) => {
          const text = String(article?.publishTime || '').trim();
          if (!text) {
            return false;
          }
          return Number.isFinite(Date.parse(text));
        });
        if (parsedWithPublishTime.length > 0) {
          const hasRecentInPage = parsedWithPublishTime.some((article) => isWithinLookbackDays(article, syncRangeDays));
          if (!hasRecentInPage) {
            break;
          }
        }
      }

      begin += pageSize;
      if (publishList.length < pageSize) {
        break;
      }
      await sleep(LIST_PAGE_INTERVAL_MS + Math.floor(Math.random() * LIST_PAGE_JITTER_MS));
    }

    const deduped = dedupeById(all).slice(0, MAX_ARTICLES_PER_RUN);
    const filtered = syncRangeDays > 0
      ? deduped.filter((article) => isWithinLookbackDays(article, syncRangeDays))
      : deduped;
    safeLog('info', 'appmsgpublish done', {
      syncRangeDays,
      rawCount: all.length,
      dedupedCount: deduped.length,
      filteredCount: filtered.length,
    });
    return filtered;
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
    const close = open === '{' ? '}' : (open === '[' ? ']' : (open === '(' ? ')' : ''));
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

  function extractValueFromPosition(raw, startPos) {
    if (typeof raw !== 'string' || !Number.isFinite(startPos)) {
      return '';
    }
    let pos = Math.max(0, Math.floor(startPos));
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
    const jsonParseMatched = raw.slice(pos).match(/^JSON\.parse\s*\(/i);
    if (jsonParseMatched) {
      const openPos = pos + jsonParseMatched[0].length - 1;
      const jsonParseExpr = extractBalancedBlock(raw, openPos);
      if (jsonParseExpr) {
        return raw.slice(pos, openPos) + jsonParseExpr;
      }
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

    let quote = '';
    let escaped = false;
    let braceDepth = 0;
    let bracketDepth = 0;
    let parenDepth = 0;
    let end = pos;
    for (; end < raw.length; end += 1) {
      const one = raw[end];
      if (quote) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (one === '\\') {
          escaped = true;
          continue;
        }
        if (one === quote) {
          quote = '';
        }
        continue;
      }
      if (one === '"' || one === '\'' || one === '`') {
        quote = one;
        continue;
      }
      if (one === '{') {
        braceDepth += 1;
        continue;
      }
      if (one === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
        continue;
      }
      if (one === '[') {
        bracketDepth += 1;
        continue;
      }
      if (one === ']') {
        bracketDepth = Math.max(0, bracketDepth - 1);
        continue;
      }
      if (one === '(') {
        parenDepth += 1;
        continue;
      }
      if (one === ')') {
        parenDepth = Math.max(0, parenDepth - 1);
        continue;
      }
      if (braceDepth === 0 && bracketDepth === 0 && parenDepth === 0 && /[,\n;\r]/.test(one)) {
        break;
      }
    }
    return raw.slice(pos, end).trim();
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
    return extractValueFromPosition(raw, index + token.length);
  }

  function extractValueByKey(raw, key) {
    if (typeof raw !== 'string' || !key) {
      return '';
    }
    const escapedKey = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`["']${escapedKey}["']\\s*[:=]`, 'i'),
      new RegExp(`\\b${escapedKey}\\b\\s*[:=]`, 'i'),
    ];
    for (const one of patterns) {
      const matched = one.exec(raw);
      if (!matched || matched.index == null) {
        continue;
      }
      const value = extractValueFromPosition(raw, matched.index + matched[0].length);
      if (value) {
        return value;
      }
    }
    return '';
  }

  function parseMetricsPayloadFromHtml(raw) {
    if (!raw || typeof raw !== 'string') {
      return null;
    }
    const cgiDataRaw = extractValueByKey(raw, 'window.wx.cgiData')
      || extractValueByKey(raw, 'wx.cgiData')
      || extractValueByKey(raw, 'cgiData');
    const cgiData = parseStructuredData(parseLooseJsonObject(cgiDataRaw) ?? cgiDataRaw);

    const articleDataRaw = extractValueByKey(raw, 'articleData')
      || extractValueByKey(raw, 'article_data');
    const articleSummaryDataRaw = extractValueByKey(raw, 'articleSummaryData')
      || extractValueByKey(raw, 'article_summary_data')
      || extractValueByKey(raw, 'summaryData')
      || extractValueByKey(raw, 'sourceData');
    const detailDataRaw = extractValueByKey(raw, 'detailData')
      || extractValueByKey(raw, 'detail_data');
    const subsTransformRaw = extractValueByKey(raw, 'subs_transform')
      || extractValueByKey(raw, 'subsTransform');
    const baseRespRaw = extractValueByKey(raw, 'base_resp')
      || extractValueByKey(raw, 'baseResp');
    const retRaw = extractValueByKey(raw, 'ret');
    const errMsgRaw = extractValueByKey(raw, 'err_msg')
      || extractValueByKey(raw, 'errMsg');

    const payload = {};
    if (cgiData && typeof cgiData === 'object') {
      if (Array.isArray(cgiData)) {
        payload.cgiData = cgiData;
      } else {
        Object.assign(payload, cgiData);
      }
    }

    let articleData = parseStructuredData(parseLooseJsonObject(articleDataRaw) ?? articleDataRaw);
    let articleSummaryData = parseStructuredData(parseLooseJsonObject(articleSummaryDataRaw) ?? articleSummaryDataRaw);
    let detailData = parseStructuredData(parseLooseJsonObject(detailDataRaw) ?? detailDataRaw);
    let subsTransform = parseStructuredData(parseLooseJsonObject(subsTransformRaw) ?? subsTransformRaw);
    const baseResp = parseStructuredData(parseLooseJsonObject(baseRespRaw) ?? baseRespRaw);
    const ret = toLooseNumber(retRaw);
    const errMsg = String(errMsgRaw || '').replace(/^['"]|['"]$/g, '').trim();

    if (!articleData) {
      const articleDataMatch = raw.match(/articleData["']?\s*[:=]\s*(\{[\s\S]*?\})\s*,\s*articleSummaryData["']?\s*[:=]/i);
      if (articleDataMatch?.[1]) {
        articleData = parseStructuredData(articleDataMatch[1]);
      }
    }
    if (!articleSummaryData) {
      const summaryMatch = raw.match(/articleSummaryData["']?\s*[:=]\s*(\[[\s\S]*?\]|\{[\s\S]*?\})\s*(?:,\s*detailData["']?\s*[:=]|,\s*base_resp["']?\s*[:=]|,\s*ret["']?\s*[:=])/i);
      if (summaryMatch?.[1]) {
        articleSummaryData = parseStructuredData(summaryMatch[1]);
      }
    }
    if (!detailData) {
      const detailMatch = raw.match(/detailData["']?\s*[:=]\s*(\[[\s\S]*?\]|\{[\s\S]*?\})\s*(?:,\s*(?:base_resp|ret|err_msg|baseResp|errMsg)["']?\s*[:=]|\}\s*;)/i);
      if (detailMatch?.[1]) {
        detailData = parseStructuredData(detailMatch[1]);
      }
    }
    if (!subsTransform && articleData && typeof articleData === 'object') {
      subsTransform = parseStructuredData(articleData.subs_transform ?? articleData.subsTransform);
    }

    if (articleData && typeof articleData === 'object') {
      payload.articleData = articleData;
    }
    if (articleSummaryData) {
      payload.articleSummaryData = articleSummaryData;
    }
    if (detailData) {
      payload.detailData = detailData;
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

  function payloadQualityScore(payload) {
    if (!payload || typeof payload !== 'object') {
      return 0;
    }
    let score = 0;
    const keys = safeObjectKeys(payload);
    score += Math.min(8, keys.length);
    if (Array.isArray(payload)) {
      score += payload.length > 0 ? 1 : 0;
    }

    const root = { json: payload };
    const read = findFirstNumberByKeys(root, ['int_page_read_user', 'read_num', 'read_uv']);
    const send = findFirstNumberByKeys(root, ['send_uv']);
    const sceneCount = collectSceneItems(root).length;
    if (read > 0) {
      score += 8;
    }
    if (send > 0) {
      score += 5;
    }
    if (sceneCount > 0) {
      score += Math.min(10, sceneCount);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'articleData')
      || Object.prototype.hasOwnProperty.call(payload, 'article_data_new')) {
      score += 4;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'articleSummaryData')
      || Object.prototype.hasOwnProperty.call(payload, 'article_summary_data')) {
      score += 8;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'detailData')
      || Object.prototype.hasOwnProperty.call(payload, 'detail_data')) {
      score += 3;
    }
    return score;
  }

  function buildTrafficRawProbe(raw) {
    const text = String(raw || '');
    const summaryIndex = text.search(/articleSummaryData["']?\s*[:=]/i);
    const summaryHead = summaryIndex >= 0
      ? text.slice(summaryIndex, summaryIndex + 220).replace(/\s+/g, ' ')
      : '';
    const countHit = (pattern) => {
      if (!(pattern instanceof RegExp)) {
        return 0;
      }
      const matched = text.match(pattern);
      return matched ? matched.length : 0;
    };
    return {
      textLength: text.length,
      hasArticleSummaryData: /articleSummaryData["']?\s*[:=]/i.test(text),
      hasSceneField: /["']?(?:scene|scene_id|source_scene)["']?\s*[:=]/i.test(text),
      hasSceneDesc: /["']?(?:scene_desc|sceneDesc|scene_name|sceneName|source_name|sourceName)["']?\s*[:=]/i.test(text),
      sourceMarkerHits: {
        fromRecommend: countHit(/fromrecommend|from_recommend|recommend|kandian/gi),
        fromFeed: countHit(/fromfeed|from_feed|friend_circle|friend/gi),
        fromMsg: countHit(/frommsg|from_msg|subscription|message/gi),
        fromHome: countHit(/fromhome|from_home|fromprofile|from_profile|profile/gi),
        fromSession: countHit(/fromsession|from_session|fromchat|from_chat|session|chat/gi),
        fromSearch: countHit(/fromsogou|from_search|search|sogou/gi),
      },
      summaryHead,
    };
  }

  function chooseBestMetricsPayload(primary, fallback) {
    const primaryScore = payloadQualityScore(primary);
    const fallbackScore = payloadQualityScore(fallback);
    if (fallbackScore > primaryScore) {
      return fallback;
    }
    return primary ?? fallback ?? null;
  }

  function extractMetricNumberFromRaw(raw, key) {
    if (typeof raw !== 'string' || !raw || !key) {
      return 0;
    }
    const escapedKey = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const reg = new RegExp(`(?:["']${escapedKey}["']|\\b${escapedKey}\\b)\\s*[:=]\\s*["']?(-?\\d+(?:\\.\\d+)?)`, 'i');
    const matched = raw.match(reg);
    if (!matched?.[1]) {
      return 0;
    }
    const parsed = Number(matched[1]);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizeCompletionRate(rawValue) {
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0) {
      return 0;
    }
    if (value <= 1) {
      return Math.round(value * 10000) / 100;
    }
    if (value > 10000) {
      return 100;
    }
    return Math.round(value * 100) / 100;
  }

  function normalizeAvgReadTimeSec(rawValue) {
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0) {
      return 0;
    }
    // Some endpoints may return milliseconds instead of seconds.
    const seconds = value > 24 * 60 * 60 ? (value / 1000) : value;
    return Math.max(0, Math.round(seconds));
  }

  function pickRawMetricNumber(raw, keys) {
    if (!raw || typeof raw !== 'string' || !Array.isArray(keys)) {
      return 0;
    }
    return keys.reduce((max, key) => {
      const one = extractMetricNumberFromRaw(raw, key);
      if (!Number.isFinite(one) || one <= 0) {
        return max;
      }
      return Math.max(max, one);
    }, 0);
  }

  function extractTrafficSourcesFromRawText(raw) {
    const direct = createEmptyTrafficSources();
    direct.朋友圈 = pickRawMetricNumber(raw, ['fromfeed', 'from_feed', 'from_friend', 'from_feed_read_user', 'from_feed_uv']);
    direct.公众号消息 = pickRawMetricNumber(raw, ['frommsg', 'from_msg', 'from_subscription', 'from_msg_read_user', 'frommsg_read_user', 'from_msg_uv']);
    direct.推荐 = pickRawMetricNumber(raw, ['fromrecommend', 'from_recommend', 'from_kandian', 'from_recommend_read_user', 'from_recommend_uv']);
    direct.公众号主页 = pickRawMetricNumber(raw, ['fromhome', 'from_home', 'fromprofile', 'from_profile', 'from_home_read_user', 'from_profile_read_user']);
    direct.聊天会话 = pickRawMetricNumber(raw, ['fromsession', 'from_session', 'fromchat', 'from_chat', 'from_session_read_user', 'from_chat_read_user']);
    direct.搜一搜 = pickRawMetricNumber(raw, ['fromsogou', 'from_search', 'from_sogou', 'from_search_read_user']);
    direct.其它 = pickRawMetricNumber(raw, ['fromother', 'from_other', 'from_other_read_user']);
    if (trafficSourcesTotal(direct) > 0) {
      return {
        trafficSources: direct,
        trafficDebug: { sceneItemCount: 0, sceneSamples: [] },
        parseScore: 6,
      };
    }

    const byScene = createEmptyTrafficSources();
    const sceneSamples = [];
    let sceneItemCount = 0;

    const pushSceneSample = (scene, label, count, source) => {
      if (sceneSamples.length >= 3) {
        return;
      }
      sceneSamples.push({
        scene: Number.isFinite(Number(scene)) ? Number(scene) : 0,
        label: String(label || ''),
        readNum: Number(count || 0),
        source,
      });
    };

    const parseWithScenePattern = (pattern, sceneGroupIndex, countGroupIndex, spanGroupIndex) => {
      if (!(pattern instanceof RegExp)) {
        return;
      }
      let matched;
      while ((matched = pattern.exec(raw)) !== null) {
        const scene = toLooseNumber(matched?.[sceneGroupIndex]);
        const count = toLooseNumber(matched?.[countGroupIndex]);
        if (!Number.isFinite(scene) || !Number.isFinite(count) || count <= 0) {
          continue;
        }
        const around = String(matched?.[spanGroupIndex] || '');
        const labelMatched = around.match(/["']?(?:scene_desc|sceneDesc|scene_name|sceneName|source_name|sourceName)["']?\s*[:=]\s*["']([^"']{1,28})["']/i);
        const label = String(labelMatched?.[1] || '').trim();
        const doneByLabel = label ? applyTrafficSourceByLabel(byScene, label, count) : false;
        if (!doneByLabel) {
          addTrafficSourceByScene(byScene, scene, count);
        }
        sceneItemCount += 1;
        pushSceneSample(scene, label, count, 'raw-scene');
      }
    };

    const sceneFirstPattern = /["']?(?:scene|scene_id|source_scene)["']?\s*[:=]\s*["']?(-?\d{1,5})["']?([\s\S]{0,260}?)["']?(?:int_page_read_user|read_uv|read_num|read_count|int_page_read_count|user_count|count|uv|pv)["']?\s*[:=]\s*["']?(-?\d+(?:\.\d+)?)["']?/gi;
    parseWithScenePattern(sceneFirstPattern, 1, 3, 2);
    if (sceneItemCount === 0) {
      const countFirstPattern = /["']?(?:int_page_read_user|read_uv|read_num|read_count|int_page_read_count|user_count|count|uv|pv)["']?\s*[:=]\s*["']?(-?\d+(?:\.\d+)?)["']?([\s\S]{0,260}?)["']?(?:scene|scene_id|source_scene)["']?\s*[:=]\s*["']?(-?\d{1,5})["']?/gi;
      parseWithScenePattern(countFirstPattern, 3, 1, 2);
    }

    if (sceneItemCount === 0) {
      const labelFirstPattern = /["']?(?:scene_desc|sceneDesc|scene_name|sceneName|source_name|sourceName)["']?\s*[:=]\s*["']([^"']{1,28})["']([\s\S]{0,220}?)["']?(?:int_page_read_user|read_uv|read_num|read_count|int_page_read_count|user_count|count|uv|pv)["']?\s*[:=]\s*["']?(-?\d+(?:\.\d+)?)["']?/gi;
      let labelMatched;
      while ((labelMatched = labelFirstPattern.exec(raw)) !== null) {
        const label = String(labelMatched?.[1] || '').trim();
        const count = toLooseNumber(labelMatched?.[3]);
        if (!label || !Number.isFinite(count) || count <= 0) {
          continue;
        }
        if (applyTrafficSourceByLabel(byScene, label, count)) {
          sceneItemCount += 1;
          pushSceneSample(0, label, count, 'raw-label');
        }
      }
    }

    return {
      trafficSources: byScene,
      trafficDebug: { sceneItemCount, sceneSamples },
      parseScore: sceneItemCount > 0 ? Math.min(8, 3 + sceneItemCount) : 0,
    };
  }

  function extractMetricsFromRawHtml(raw) {
    if (!raw || typeof raw !== 'string') {
      return null;
    }
    const parsedPayload = parseMetricsPayloadFromHtml(raw);
    const parsedMetrics = parsedPayload && typeof parsedPayload === 'object'
      ? extractMetricsFromPayload(parsedPayload)
      : null;
    const rawTraffic = extractTrafficSourcesFromRawText(raw);
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
    const avgReadTimeSec = extractMetricNumberFromRaw(raw, 'avg_article_read_time')
      || extractMetricNumberFromRaw(raw, 'avg_read_time')
      || extractMetricNumberFromRaw(raw, 'avg_read_duration');
    const newFollowers = extractMetricNumberFromRaw(raw, 'follow_after_read_uv')
      || extractMetricNumberFromRaw(raw, 'new_fans');
    const parsedTrafficSources = parsedMetrics?.trafficSources || {};
    const trafficSources = trafficSourcesTotal(parsedTrafficSources) > 0
      ? parsedTrafficSources
      : (rawTraffic.trafficSources || createEmptyTrafficSources());
    const trafficDebug = (parsedMetrics?.trafficDebug && parsedMetrics.trafficDebug.sceneItemCount > 0)
      ? parsedMetrics.trafficDebug
      : (rawTraffic.trafficDebug || { sceneItemCount: 0, sceneSamples: [] });
    const parseScore = Math.max(
      Number(parsedMetrics?.parseScore || 0),
      Number(rawTraffic?.parseScore || 0)
    );

    return {
      readCount,
      sendCount,
      shareCount,
      likeCount,
      wowCount,
      commentCount,
      saveCount,
      completionRate: normalizeCompletionRate(completionRate),
      avgReadTimeSec: normalizeAvgReadTimeSec(avgReadTimeSec),
      newFollowers,
      trafficSources,
      trafficDebug,
      topKeys: parsedMetrics?.topKeys || [],
      parseScore,
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
      'avgReadTimeSec',
      'newFollowers',
    ].forEach((key) => {
      const baseValue = Number(merged[key] || 0);
      const fallbackValue = Number(fallback[key] || 0);
      if (baseValue <= 0 && fallbackValue > 0) {
        merged[key] = fallbackValue;
      }
    });
    const mergedTrafficTotal = trafficSourcesTotal(merged.trafficSources);
    const fallbackTrafficTotal = trafficSourcesTotal(fallback.trafficSources);
    const mergedParseScore = Number(merged.parseScore || 0);
    const fallbackParseScore = Number(fallback.parseScore || 0);
    const fallbackTrafficLooksBetter = fallbackTrafficTotal > 0 && (
      mergedTrafficTotal <= 0
      || (fallbackParseScore > mergedParseScore && fallbackTrafficTotal >= mergedTrafficTotal)
      || fallbackTrafficTotal >= Math.max(5, mergedTrafficTotal * 3)
    );
    if (fallbackTrafficLooksBetter) {
      merged.trafficSources = fallback.trafficSources;
    }
    if ((!merged.trafficDebug || merged.trafficDebug.sceneItemCount <= 0) && fallback.trafficDebug) {
      merged.trafficDebug = fallback.trafficDebug;
    }
    if ((!Array.isArray(merged.topKeys) || merged.topKeys.length === 0) && Array.isArray(fallback.topKeys)) {
      merged.topKeys = fallback.topKeys;
    }
    if (Number(merged.parseScore || 0) < Number(fallback.parseScore || 0)) {
      merged.parseScore = Number(fallback.parseScore || 0);
    }
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
    const { response, text } = await guardedMpFetchText(
      url,
      {
        credentials: 'include',
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      },
      { source: 'metrics-detail' }
    );
    const fromJson = parseMaybeJson(text);
    const fromHtml = parseMetricsPayloadFromHtml(text);
    const json = chooseBestMetricsPayload(fromJson, fromHtml);
    if (!json || typeof json !== 'object') {
      throw new Error(`文章指标接口返回格式异常(status=${response.status})`);
    }
    if (trafficProbeLogCount < 12) {
      safeWarnProbe('traffic probe raw markers', {
        msgId,
        publishDate,
        status: response.status,
        parseScore: payloadQualityScore(json),
        fromJsonType: fromJson == null ? 'null' : (Array.isArray(fromJson) ? 'array' : typeof fromJson),
        fromHtmlType: fromHtml == null ? 'null' : (Array.isArray(fromHtml) ? 'array' : typeof fromHtml),
        fromJsonKeys: safeObjectKeys(fromJson).slice(0, 10),
        fromHtmlKeys: safeObjectKeys(fromHtml).slice(0, 10),
        rawProbe: buildTrafficRawProbe(text),
      });
    }
    if (metricsPayloadParseWarnCount < 6 && payloadQualityScore(json) <= 1) {
      metricsPayloadParseWarnCount += 1;
      safeLog('warn', 'metrics payload parse weak', {
        msgId,
        publishDate,
        status: response.status,
        textLength: String(text || '').length,
        fromJsonType: fromJson == null ? 'null' : (Array.isArray(fromJson) ? 'array' : typeof fromJson),
        fromJsonKeys: safeObjectKeys(fromJson).slice(0, 10),
        fromHtmlType: fromHtml == null ? 'null' : (Array.isArray(fromHtml) ? 'array' : typeof fromHtml),
        fromHtmlKeys: safeObjectKeys(fromHtml).slice(0, 10),
      });
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

  function findMaxNumberByKeys(root, keys) {
    if (!root || !keys?.length) {
      return 0;
    }
    const keySet = new Set(keys.map((k) => String(k).toLowerCase()));
    const queue = [root];
    const visited = new Set();
    let maxValue = 0;
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
        if (!Number.isFinite(num) || num <= 0) {
          return;
        }
        if (num > maxValue) {
          maxValue = num;
        }
      });
    }
    return Number(maxValue || 0);
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
              || Object.prototype.hasOwnProperty.call(item, 'source_scene')
              || Object.prototype.hasOwnProperty.call(item, 'scene_desc')
              || Object.prototype.hasOwnProperty.call(item, 'sceneDesc')
              || Object.prototype.hasOwnProperty.call(item, 'scene_name')
              || Object.prototype.hasOwnProperty.call(item, 'sceneName')
              || Object.prototype.hasOwnProperty.call(item, 'source_name')
              || Object.prototype.hasOwnProperty.call(item, 'sourceName')) {
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

  function applyTrafficSourceByLabel(target, rawLabel, rawCount) {
    const count = Number(rawCount || 0);
    const label = String(rawLabel || '').trim();
    if (!label || !Number.isFinite(count) || count <= 0 || !target) {
      return false;
    }
    if (label.includes('朋友圈')) {
      target.朋友圈 += count;
      return true;
    }
    if (label.includes('公众号消息') || label.includes('公众号通知') || label.includes('订阅')) {
      target.公众号消息 += count;
      return true;
    }
    if (label.includes('推荐') || label.includes('看一看')) {
      target.推荐 += count;
      return true;
    }
    if (label.includes('公众号主页') || label.includes('主页') || label.includes('资料页')) {
      target.公众号主页 += count;
      return true;
    }
    if (label.includes('聊天') || label.includes('会话') || label.includes('好友转发')) {
      target.聊天会话 += count;
      return true;
    }
    if (label.includes('搜')) {
      target.搜一搜 += count;
      return true;
    }
    if (label.includes('其它') || label.includes('其他')) {
      target.其它 += count;
      return true;
    }
    return false;
  }

  function createEmptyTrafficSources() {
    return {
      朋友圈: 0,
      公众号消息: 0,
      推荐: 0,
      公众号主页: 0,
      聊天会话: 0,
      搜一搜: 0,
      其它: 0,
    };
  }

  function extractSceneMetricCount(item) {
    if (!item || typeof item !== 'object') {
      return 0;
    }
    const strong = findMaxNumberByKeys(item, [
      'int_page_read_user',
      'read_uv',
      'read_num',
      'read_count',
      'int_page_read_count',
      'user_count',
      'userCount',
      'source_read_user',
      'source_read_uv',
      'source_read_num',
      'scene_read_uv',
      'scene_read_num',
      'scene_read_count',
      'from_read_user',
      'from_read_uv',
      'from_read_num',
      'uv',
      'pv',
      'int_page_read_count',
      'int_page_read_num',
    ]);
    if (Number.isFinite(strong) && strong > 0) {
      return strong;
    }

    let best = 0;
    const queue = [item];
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
        current.forEach((one) => queue.push(one));
        continue;
      }
      Object.entries(current).forEach(([key, value]) => {
        if (value && typeof value === 'object') {
          queue.push(value);
        }
        const lower = String(key || '').toLowerCase();
        if (!/(read|user|uv|pv|count|cnt|num|value)/.test(lower)) {
          return;
        }
        if (/(scene|desc|name|id|idx|index|rank|ratio|percent|rate|time|date|day|hour|min|week|month|year|title|type|tag|share|like|comment|fav|save|follow|send)/.test(lower)) {
          return;
        }
        const num = toLooseNumber(value);
        if (!Number.isFinite(num) || num <= 0) {
          return;
        }
        if (num > best) {
          best = num;
        }
      });
    }
    if (best > 0) {
      return best;
    }

    const weak = findFirstNumberByKeys(item, ['count', 'value', 'num']);
    return Number.isFinite(weak) && weak > 0 ? weak : 0;
  }

  function buildTrafficSourcesFromSceneItems(sceneItems) {
    const sourceMap = createEmptyTrafficSources();
    if (!Array.isArray(sceneItems) || sceneItems.length === 0) {
      return sourceMap;
    }

    sceneItems.forEach((item) => {
      const scene = Number(item.scene ?? item.scene_id ?? item.source_scene);
      const sceneDesc = String(
        item.scene_desc
          ?? item.sceneDesc
          ?? item.scene_name
          ?? item.sceneName
          ?? item.source_name
          ?? item.sourceName
          ?? ''
      ).trim();
      const count = extractSceneMetricCount(item);
      if (!Number.isFinite(count) || count <= 0) {
        return;
      }
      if (applyTrafficSourceByLabel(sourceMap, sceneDesc, count)) {
        return;
      }
      addTrafficSourceByScene(sourceMap, scene, count);
    });

    return sourceMap;
  }

  function sourceKeyByScene(scene) {
    const sceneId = Number(scene);
    if (!Number.isFinite(sceneId) || sceneId === 9999) {
      return '';
    }
    if (sceneId === 0) {
      return '公众号消息';
    }
    if (sceneId === 1) {
      return '聊天会话';
    }
    if (sceneId === 2) {
      return '朋友圈';
    }
    if (sceneId === 4) {
      return '公众号主页';
    }
    if (sceneId === 6) {
      return '推荐';
    }
    if (sceneId === 7) {
      return '搜一搜';
    }
    return '其它';
  }

  function addTrafficSourceByScene(target, scene, rawCount) {
    const sourceKey = sourceKeyByScene(scene);
    const count = Number(rawCount || 0);
    if (!sourceKey || !target || !Number.isFinite(count) || count <= 0) {
      return false;
    }
    target[sourceKey] = Number(target[sourceKey] || 0) + count;
    return true;
  }

  function trafficSourcesTotal(sourceMap) {
    if (!sourceMap || typeof sourceMap !== 'object') {
      return 0;
    }
    return Object.values(sourceMap).reduce((sum, value) => {
      const one = toLooseNumber(value);
      if (!Number.isFinite(one) || one <= 0) {
        return sum;
      }
      return sum + one;
    }, 0);
  }

  function buildTrafficDebug(root) {
    const sceneItems = collectSceneItems(root);
    return {
      sceneItemCount: sceneItems.length,
      sceneSamples: sceneItems.slice(0, 3).map((item) => ({
        scene: Number(item.scene ?? item.scene_id ?? item.source_scene),
        label: String(item.scene_desc ?? item.sceneDesc ?? item.scene_name ?? item.sceneName ?? item.source_name ?? item.sourceName ?? '').trim(),
        readNum: extractSceneMetricCount(item),
        keys: safeObjectKeys(item).slice(0, 8),
      })),
    };
  }

  function buildTrafficSources(root) {
    const summaryItems = collectSceneItems(root?.articleSummaryData);
    const bySummary = buildTrafficSourcesFromSceneItems(summaryItems);
    if (trafficSourcesTotal(bySummary) > 0) {
      return bySummary;
    }

    const direct = {
      朋友圈: findFirstNumberByKeys(root, ['fromfeed', 'from_feed', 'from_friend', 'from_feed_read_user', 'from_feed_uv']),
      公众号消息: findFirstNumberByKeys(root, ['frommsg', 'from_msg', 'from_subscription', 'from_msg_read_user', 'frommsg_read_user', 'from_msg_uv']),
      推荐: findFirstNumberByKeys(root, ['fromrecommend', 'from_recommend', 'from_kandian', 'from_recommend_read_user', 'from_recommend_uv']),
      公众号主页: findFirstNumberByKeys(root, ['fromhome', 'from_home', 'fromprofile', 'from_profile', 'from_home_read_user', 'from_profile_read_user']),
      聊天会话: findFirstNumberByKeys(root, ['fromsession', 'from_session', 'fromchat', 'from_chat', 'from_session_read_user', 'from_chat_read_user']),
      搜一搜: findFirstNumberByKeys(root, ['fromsogou', 'from_search', 'from_sogou', 'from_search_read_user']),
      其它: findFirstNumberByKeys(root, ['fromother', 'from_other', 'from_other_read_user']),
    };

    const byScene = buildTrafficSourcesFromSceneItems(collectSceneItems(root));
    const bySceneTotal = trafficSourcesTotal(byScene);
    if (bySceneTotal > 0) {
      return byScene;
    }

    return trafficSourcesTotal(direct) > 0 ? direct : createEmptyTrafficSources();
  }
  function extractMetricsFromPayload(payload) {
    const articleData = parseStructuredData(payload.articleData) || {};
    const articleDataNew = parseStructuredData(
      articleData.article_data_new ?? articleData.articleDataNew ?? payload.article_data_new ?? payload.articleDataNew
    ) || {};
    const articleSummaryData = parseStructuredData(
      payload.articleSummaryData ?? payload.article_summary_data ?? articleData.articleSummaryData ?? articleData.article_summary_data
    ) || [];
    const detailData = parseStructuredData(
      payload.detailData ?? payload.detail_data ?? articleData.detailData ?? articleData.detail_data
    ) || {};
    const subsTransform = parseStructuredData(
      articleData.subs_transform ?? articleData.subsTransform ?? payload.subs_transform ?? payload.subsTransform
    ) || {};

    const root = { json: payload, articleData, articleDataNew, articleSummaryData, detailData, subsTransform };
    const completionRateRaw = findFirstNumberByKeys(root, ['complete_read_rate', 'finished_read_pv_ratio']);
    const avgReadTimeRaw = findFirstNumberByKeys(root, ['avg_article_read_time', 'avg_read_time', 'avg_read_duration', 'read_time_avg']);
    return {
      readCount: findFirstNumberByKeys(root, ['int_page_read_user', 'read_num', 'read_uv']),
      sendCount: findFirstNumberByKeys(root, ['send_uv']),
      shareCount: findFirstNumberByKeys(root, ['share_user', 'share_count', 'share_uv']),
      likeCount: findFirstNumberByKeys(root, ['like_num', 'like_cnt']),
      wowCount: findFirstNumberByKeys(root, ['old_like_num', 'wow_num', 'zaikan_cnt']),
      commentCount: findFirstNumberByKeys(root, ['comment_id_count', 'comment_cnt']),
      saveCount: findFirstNumberByKeys(root, ['fav_num', 'save_count', 'collection_uv']),
      completionRate: normalizeCompletionRate(completionRateRaw),
      avgReadTimeSec: normalizeAvgReadTimeSec(avgReadTimeRaw),
      newFollowers: findFirstNumberByKeys(root, ['new_fans', 'follow_after_read_uv']),
      trafficSources: buildTrafficSources(root),
      topKeys: safeObjectKeys(payload),
      trafficDebug: buildTrafficDebug(root),
      parseScore: payloadQualityScore(payload),
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
    const pageData = await getArticlePageData(article?.contentUrl || '');
    const meta = pageData?.meta || null;
    if (!meta || (!meta.msgIdBase && !meta.publishDate && !meta.publishTime)) {
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
      if (isFreqControlReason(errMsg)) {
        noteMpFreqHit(`metrics-ret:${requestResult.ret}`);
        throw createFreqLimitedError('读取文章指标触发频控，请稍后重试');
      }
      throw new Error(`文章指标接口异常(${requestResult.ret})${errMsg ? `: ${errMsg}` : ''}`);
    }
    let metrics = extractMetricsFromPayload(requestResult.json);
    const metricsFromRaw = extractMetricsFromRawHtml(requestResult.raw);
    metrics = mergeMetricsByPositiveValue(metrics, metricsFromRaw);
    if (trafficProbeLogCount < 30) {
      safeWarnProbe('traffic probe parsed result', {
        wxArticleId: article?.wxArticleId ?? '',
        title: article?.title ?? '',
        msgIdBase: currentMsgIdBase,
        msgIndex,
        usedPublishDate,
        readCount: Number(metrics.readCount || 0),
        sendCount: Number(metrics.sendCount || 0),
        trafficTotal: trafficSourcesTotal(metrics.trafficSources),
        trafficSources: metrics.trafficSources,
        parseScore: Number(metrics.parseScore || 0),
        topKeys: Array.isArray(metrics.topKeys) ? metrics.topKeys.slice(0, 12) : [],
        trafficDebug: metrics.trafficDebug || null,
      });
    }

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
    if (zeroTrafficSourceLogCount < 8
      && !isCoreMetricsZero(metrics)
      && Number(metrics.readCount || 0) > 0
      && trafficSourcesTotal(metrics.trafficSources) <= 0) {
      zeroTrafficSourceLogCount += 1;
      safeLog('warn', 'traffic sources all zero with positive read', {
        wxArticleId: article?.wxArticleId ?? '',
        title: article?.title ?? '',
        msgIdBase: currentMsgIdBase,
        msgIndex,
        usedPublishDate,
        readCount: metrics.readCount,
        sendCount: metrics.sendCount,
        parseScore: metrics.parseScore,
        topKeys: metrics.topKeys,
        trafficDebug: metrics.trafficDebug,
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
      avgReadTimeSec: metrics.avgReadTimeSec,
      trafficSources: metrics.trafficSources,
      newFollowers: metrics.newFollowers,
    };
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

  function parseStructuredData(value) {
    if (value == null) {
      return null;
    }
    let current = value;
    for (let i = 0; i < 4; i += 1) {
      if (current && typeof current === 'object') {
        return current;
      }
      const parsed = parseMaybeJson(current);
      if (parsed == null) {
        return null;
      }
      if (parsed === current) {
        break;
      }
      current = parsed;
    }
    return current && typeof current === 'object' ? current : null;
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

  function maybeHasArticleShape(item) {
    if (!item || typeof item !== 'object') {
      return false;
    }
    const keys = Object.keys(item);
    if (keys.some((key) => /appmsg|publish|article|content|link|url|title|mid|msg/i.test(key))) {
      return true;
    }
    const infoRaw = item.publish_info || item.publishInfo || '';
    const infoText = String(infoRaw || '');
    return /appmsg|content_url|article|link|title|mid|msg/i.test(infoText);
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
      if (Object.prototype.hasOwnProperty.call(changes, 'gzhSyncRangeCode')) {
        selectedSyncRangeCode = normalizeSyncRangeCode(changes.gzhSyncRangeCode?.newValue);
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
      const storage = await getStorage(['gzhAuthToken', 'gzhLastSync', 'gzhSyncRangeCode']);
      latestAuthToken = storage.gzhAuthToken || '';
      latestLastSync = storage.gzhLastSync || null;
      selectedSyncRangeCode = normalizeSyncRangeCode(storage.gzhSyncRangeCode);
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
