(() => {
  const STATE = {
    syncing: false,
    cancelRequested: false,
  };

  const PANEL_ID = 'gzh-sync-panel';
  const STYLE_ID = 'gzh-sync-style';
  const LAUNCHER_ID = 'gzh-sync-launcher';

  const HTTP_CONFIG = globalThis.GzhHttpConfig;
  if (!HTTP_CONFIG) {
    throw new Error('GzhHttpConfig is required.');
  }
  const STAGE_LABELS = HTTP_CONFIG.stageLabels;
  const API_BASE_URL = HTTP_CONFIG.getBaseUrl();
  const RUNNING_STAGES = new Set(HTTP_CONFIG.runningStages);
  const DEFAULT_WEB_BASE = HTTP_CONFIG.getDefaultWebBase();
  const FREQ_CONTROL_RE = /freq\s*control|频控|频率|频繁|操作过于频繁/i;
  const LOG_PREFIX = HTTP_CONFIG.logPrefix;
  const ENABLE_PLUGIN_LOG = HTTP_CONFIG.enablePluginLog === true;
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
  const MAX_SYNC_ISSUES_PER_RUN = 120;
  const MAX_SYNC_ISSUES_PER_UPLOAD = 40;
  const DEFAULT_SYNC_RANGE_CODE = '30d';
  const SYNC_RANGE_OPTIONS = [
    { code: '7d', label: '最近7天', days: 7 },
    { code: '30d', label: '最近30天', days: 30 },
    { code: '60d', label: '最近60天', days: 60 },
    { code: '90d', label: '最近90天', days: 90 },
    { code: 'all', label: '全部', days: 0 },
  ];
  const MAX_ARTICLES_PER_RUN = 300;
  const ARTICLE_PAGE_CACHE_MAX = 320;
  const ARTICLE_CONTENT_MAX_LENGTH = 20000;
  const ARTICLE_CONTENT_SELECTORS = [
    '#js_content',
    '#img-content #js_content',
    '#img-content .rich_media_content',
    '.rich_media_content#js_content',
    '.rich_media_content',
  ];
  const ARTICLE_CONTENT_REMOVE_SELECTORS = [
    'script',
    'style',
    'noscript',
    'iframe',
    'object',
    'embed',
    'form',
    '#js_toobar3',
    '#js_report_article3',
    '#js_recommend_list',
    '#js_pc_qr_code',
    '.qr_code_pc_outer',
    '.rich_media_tool',
    '.reward_area',
    '.js_not_in_mm',
    '.js_product_section',
    '.js_video_channel_card_container',
    '.js_related_article',
  ];
  const UPLOAD_BATCH_SIZE = 10;

  let latestAuthToken = '';
  let latestLastSync = null;
  let latestDetectedMpAccountName = '';
  let lastAutoSyncAuthToken = '';
  let zeroMetricsLogCount = 0;
  let zeroTrafficSourceLogCount = 0;
  let suspiciousTrafficSourceLogCount = 0;
  let metricsPayloadParseWarnCount = 0;
  let trafficProbeLogCount = 0;
  let publishListParseHintCount = 0;
  const articlePageCache = new Map();
  const syncIssueState = {
    sessionId: '',
    queue: [],
    dedupe: new Set(),
  };
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
    return HTTP_CONFIG.isContextInvalidatedError(errorOrMessage);
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
    if (stage === 'canceled' || stage === 'partial_failed') {
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
      || state.stage === 'canceled'
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
    return SYNC_RANGE_OPTIONS.find((item) => item.code === code)
      || SYNC_RANGE_OPTIONS.find((item) => item.code === DEFAULT_SYNC_RANGE_CODE)
      || SYNC_RANGE_OPTIONS[0];
  }

  function syncRangeDaysByCode(rawCode) {
    return Number(syncRangeOptionByCode(rawCode).days || 0);
  }

  function syncRangeLabelByCode(rawCode) {
    return syncRangeOptionByCode(rawCode).label;
  }

  function buildWorkspacePath() {
    const query = new URLSearchParams();
    query.set('range', normalizeSyncRangeCode(selectedSyncRangeCode));
    query.set('from', 'plugin');
    query.set('autoAnalysis', '1');
    return `/gzh/workspace?${query.toString()}`;
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
      .gzh-sync-message.error {
        color: #b91c1c;
        font-weight: 700;
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
      launcher.setAttribute('title', STATE.cancelRequested ? '正在取消同步，请稍候' : '同步中，点击查看进度');
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
    const isFailureStage = state.stage === 'error' || state.stage === 'partial_failed';
    const reason = String(state.message || '').trim();
    messageEl.textContent = isFailureStage
      ? `失败原因：${reason || '同步失败，请稍后重试'}`
      : (state.message || '等待同步');
    messageEl.className = isFailureStage ? 'gzh-sync-message error' : 'gzh-sync-message';
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
    } else if (state.stage === 'canceled') {
      summaryEl.textContent = '已取消本次同步，可修改范围后重新发起';
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
      primaryAction = 'cancel';
      primaryText = STATE.cancelRequested ? '取消中...' : '取消同步';
      primaryDisabled = STATE.cancelRequested;
      secondaryAction = 'close';
      secondaryText = '收起';
    } else if (state.stage === 'canceled') {
      primaryAction = 'start';
      primaryText = '重新同步';
      secondaryAction = 'open_workspace';
      secondaryText = '前往运营助手查看';
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
    const workspacePath = buildWorkspacePath();
    const workspace = `${webBase}${workspacePath}`;

    if (action === 'start') {
      openPanel();
      void startSync();
      return;
    }
    if (action === 'cancel') {
      if (!window.confirm('确认取消本次同步？')) {
        return;
      }
      requestSyncCancel('panel_action');
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
        url.searchParams.set('redirect', workspacePath);
        window.open(url.toString(), '_blank', 'noopener,noreferrer');
      } catch {
        window.open(`${webHome}?openLogin=1&redirect=${encodeURIComponent(workspacePath)}`, '_blank', 'noopener,noreferrer');
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

  function createSyncCanceledError(message = '已取消同步') {
    const error = new Error(message);
    error.isUserCanceled = true;
    return error;
  }

  function throwIfSyncCanceled() {
    if (STATE.cancelRequested) {
      throw createSyncCanceledError();
    }
  }

  function requestSyncCancel(source = 'unknown') {
    if (!STATE.syncing) {
      return false;
    }
    if (STATE.cancelRequested) {
      return true;
    }
    STATE.cancelRequested = true;
    updateLauncherState();

    const stage = RUNNING_STAGES.has(panelState?.stage) ? panelState.stage : 'fetch_detail';
    notifyState({
      stage,
      message: '正在取消同步，请稍候...',
      progress: Number(panelState?.progress || 0),
      total: Number(panelState?.total || 0),
      synced: Number(panelState?.synced || 0),
      failedMetrics: Number(panelState?.failedMetrics || 0),
      failedContent: Number(panelState?.failedContent || 0),
      failedUpload: Number(panelState?.failedUpload || 0),
    });
    safeLog('info', 'sync cancel requested', { source });
    return true;
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

  function toUnixMsFromEpochLike(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) {
      return NaN;
    }
    if (num >= 1000000000000 && num <= 5000000000000) {
      return Math.floor(num);
    }
    if (num >= 946684800 && num <= 5000000000) {
      return Math.floor(num * 1000);
    }
    return NaN;
  }

  function parseYmdToChinaMs(value) {
    const text = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return NaN;
    }
    return Date.parse(`${text}T00:00:00+08:00`);
  }

  function resolveArticlePublishTimestampMs(article) {
    if (!article || typeof article !== 'object') {
      return NaN;
    }
    const epochLikeKeys = [
      'publishTimestamp',
      'publish_time',
      'publishTimeSec',
      'create_time',
      'createTime',
      'send_time',
      'sent_time',
      'update_time',
      'ct',
    ];
    for (const key of epochLikeKeys) {
      const ts = toUnixMsFromEpochLike(article[key]);
      if (Number.isFinite(ts)) {
        return ts;
      }
    }

    const publishTimeText = String(article.publishTime || '').trim();
    if (publishTimeText) {
      const isoTs = Date.parse(publishTimeText);
      if (Number.isFinite(isoTs)) {
        return isoTs;
      }
      const epochTs = toUnixMsFromEpochLike(publishTimeText);
      if (Number.isFinite(epochTs)) {
        return epochTs;
      }
    }

    const publishDateText = String(article.publishDate || article.publish_date || '').trim();
    const chinaTs = parseYmdToChinaMs(publishDateText);
    if (Number.isFinite(chinaTs)) {
      return chinaTs;
    }
    if (publishDateText) {
      const genericTs = Date.parse(publishDateText);
      if (Number.isFinite(genericTs)) {
        return genericTs;
      }
    }
    return NaN;
  }

  function isWithinLookbackDays(article, days, options = {}) {
    const allowUnknownPublishTime = options.allowUnknownPublishTime !== false;
    const ts = resolveArticlePublishTimestampMs(article);
    if (!Number.isFinite(ts)) {
      return allowUnknownPublishTime;
    }
    return (Date.now() - ts) <= (Math.max(1, Number(days) || 1) * 24 * 60 * 60 * 1000);
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

  function normalizeArticleContentText(rawText) {
    return String(rawText || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, ARTICLE_CONTENT_MAX_LENGTH);
  }

  function findArticleContentNode(doc) {
    if (!doc) {
      return null;
    }
    for (const selector of ARTICLE_CONTENT_SELECTORS) {
      const one = doc.querySelector(selector);
      if (!one) {
        continue;
      }
      if (String(one.textContent || '').trim()) {
        return one;
      }
    }
    return null;
  }

  function stripNoiseNodes(root) {
    if (!root || typeof root.querySelectorAll !== 'function') {
      return;
    }
    ARTICLE_CONTENT_REMOVE_SELECTORS.forEach((selector) => {
      root.querySelectorAll(selector).forEach((node) => node.remove());
    });
  }

  function extractArticleTextFromHtml(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(html || ''), 'text/html');
    const contentNode = findArticleContentNode(doc);
    const target = contentNode ? contentNode.cloneNode(true) : doc.body?.cloneNode(true);
    if (!target) {
      return '';
    }
    stripNoiseNodes(target);
    const contentText = normalizeArticleContentText(target.innerText || target.textContent || '');
    if (contentText) {
      return contentText;
    }
    return normalizeArticleContentText(doc.body?.innerText || '');
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
    if (!ENABLE_PLUGIN_LOG) {
      return;
    }
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

  function safeTrimText(value, maxLen = 255) {
    const text = String(value ?? '').trim();
    if (!text) {
      return '';
    }
    if (!Number.isFinite(Number(maxLen)) || maxLen <= 0 || text.length <= maxLen) {
      return text;
    }
    return text.slice(0, maxLen);
  }

  function normalizeAccountName(rawName) {
    const normalized = safeTrimText(rawName, 128)
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) {
      return '';
    }
    if (normalized.length < 2 || normalized.length > 60) {
      return '';
    }
    if (/[<>]/.test(normalized)) {
      return '';
    }
    // Ignore technical ids like gh_xxx / wxid_xxx; keep only display-like names.
    if (/^(gh_[a-z0-9_]{4,}|wxid_[a-z0-9_]{4,})$/i.test(normalized)) {
      return '';
    }
    if (/^(微信公众平台|公众号运营助手|公众号数据运营助手|图文消息|文章列表|首页|设置)$/i.test(normalized)) {
      return '';
    }
    return normalized;
  }

  function isLikelyAccountNameKey(rawKey) {
    const key = String(rawKey || '').trim();
    if (!key) {
      return false;
    }
    const lower = key.toLowerCase();
    if (lower === 'name' || lower === 'title') {
      return false;
    }
    if (/title|appmsg|article|source_name|scene_name|file|image|headimg|avatar/.test(lower)) {
      return false;
    }
    return /account|biz|nick|nickname|user_name|ori_name|origin_name|gh_name|weixin_name/.test(lower);
  }

  function accountNameScore(rawKey, name) {
    const key = String(rawKey || '').toLowerCase();
    let score = String(name || '').length;
    if (key.includes('account_name') || key.includes('biz_name')) {
      score += 40;
    } else if (key.includes('nickname') || key.includes('nick_name')) {
      score += 34;
    } else if (key.includes('ori_name') || key.includes('origin_name')) {
      score += 30;
    } else if (key.includes('user_name') || key.includes('gh_name')) {
      score += 6;
    } else if (key.includes('account') || key.includes('biz') || key.includes('nick')) {
      score += 16;
    }
    return score;
  }

  function extractAccountNameFromNode(node, depth = 0) {
    if (!node || depth > 5) {
      return '';
    }
    if (Array.isArray(node)) {
      let bestArrayName = '';
      let bestArrayScore = 0;
      const limit = Math.min(node.length, 24);
      for (let i = 0; i < limit; i += 1) {
        const oneName = extractAccountNameFromNode(node[i], depth + 1);
        if (!oneName) {
          continue;
        }
        const oneScore = accountNameScore('', oneName);
        if (oneScore > bestArrayScore) {
          bestArrayScore = oneScore;
          bestArrayName = oneName;
        }
      }
      return bestArrayName;
    }
    if (typeof node !== 'object') {
      return '';
    }

    let bestName = '';
    let bestScore = 0;

    for (const [rawKey, rawValue] of Object.entries(node)) {
      if (typeof rawValue === 'string' && isLikelyAccountNameKey(rawKey)) {
        const candidateName = normalizeAccountName(rawValue);
        if (!candidateName) {
          continue;
        }
        const score = accountNameScore(rawKey, candidateName);
        if (score > bestScore) {
          bestScore = score;
          bestName = candidateName;
        }
      }
      if (rawValue && typeof rawValue === 'object') {
        const nestedName = extractAccountNameFromNode(rawValue, depth + 1);
        if (!nestedName) {
          continue;
        }
        const nestedScore = accountNameScore(rawKey, nestedName);
        if (nestedScore > bestScore) {
          bestScore = nestedScore;
          bestName = nestedName;
        }
      }
    }

    return bestName;
  }

  function readAccountNameFromDom() {
    const selectors = [
      '#js_account_name',
      '.weui-desktop-account__info_name',
      '.weui-desktop-account__info .weui-desktop-account__name',
      '.weui-desktop-layout__hd .weui-desktop-dropdown__name',
      '.weui-desktop-user-info__nickname',
      '.weui-desktop-menu-user__name',
      '[data-account-name]',
    ];
    for (const selector of selectors) {
      try {
        const node = document.querySelector(selector);
        if (!node) {
          continue;
        }
        const candidateName = normalizeAccountName(node.textContent || '');
        if (candidateName) {
          return candidateName;
        }
      } catch {
        // ignore selector failures
      }
    }
    return '';
  }

  function readAccountNameFromWindow() {
    const globalRef = window;
    const directCandidates = [
      globalRef?.wx?.commonData?.account_name,
      globalRef?.wx?.commonData?.biz_name,
      globalRef?.wx?.commonData?.nickname,
      globalRef?.wx?.data?.account_name,
      globalRef?.wx?.data?.biz_name,
      globalRef?.wx?.data?.nickname,
      globalRef?.wx?.data?.user_name,
      globalRef?.wx?.cgiData?.account_name,
      globalRef?.wx?.cgiData?.biz_name,
      globalRef?.wx?.cgiData?.nickname,
      globalRef?.cgiData?.account_name,
      globalRef?.cgiData?.biz_name,
      globalRef?.cgiData?.nickname,
    ];
    for (const one of directCandidates) {
      const candidateName = normalizeAccountName(one);
      if (candidateName) {
        return candidateName;
      }
    }

    return extractAccountNameFromNode(globalRef?.wx?.cgiData)
      || extractAccountNameFromNode(globalRef?.cgiData)
      || '';
  }

  function readAccountNameFromScripts() {
    const scripts = Array.from(document.scripts || []);
    const maxScripts = Math.min(scripts.length, 60);
    const marker = /(?:account_name|biz_name|nickname|nick_name|ori_name|origin_name|user_name)\s*[:=]\s*["']([^"'\n]{2,64})["']/ig;
    for (let i = 0; i < maxScripts; i += 1) {
      const scriptText = String(scripts[i]?.textContent || '');
      if (!scriptText) {
        continue;
      }
      marker.lastIndex = 0;
      let match = marker.exec(scriptText);
      while (match) {
        const candidateName = normalizeAccountName(match[1]);
        if (candidateName) {
          return candidateName;
        }
        match = marker.exec(scriptText);
      }
    }
    return '';
  }

  function noteDetectedAccountName(rawName) {
    const name = normalizeAccountName(rawName);
    if (!name) {
      return latestDetectedMpAccountName;
    }
    if (!latestDetectedMpAccountName || name.length > latestDetectedMpAccountName.length) {
      latestDetectedMpAccountName = name;
    }
    return latestDetectedMpAccountName;
  }

  function resolveSyncAccountName(...hints) {
    hints.forEach((item) => {
      if (Array.isArray(item)) {
        item.forEach((one) => noteDetectedAccountName(one));
        return;
      }
      noteDetectedAccountName(item);
    });
    noteDetectedAccountName(readAccountNameFromWindow());
    noteDetectedAccountName(readAccountNameFromDom());
    if (!latestDetectedMpAccountName) {
      noteDetectedAccountName(readAccountNameFromScripts());
    }
    return latestDetectedMpAccountName;
  }

  function buildSyncIssueSessionId() {
    const timePart = Date.now().toString(36);
    const randPart = Math.random().toString(36).slice(2, 8);
    return `${timePart}${randPart}`;
  }

  function beginSyncIssueSession() {
    syncIssueState.sessionId = buildSyncIssueSessionId();
    syncIssueState.queue = [];
    syncIssueState.dedupe = new Set();
  }

  function clearSyncIssueSession() {
    syncIssueState.sessionId = '';
    syncIssueState.queue = [];
    syncIssueState.dedupe = new Set();
  }

  function takeSyncIssueBatch(limit = MAX_SYNC_ISSUES_PER_UPLOAD) {
    const max = Math.max(0, Number(limit || 0));
    if (max <= 0 || syncIssueState.queue.length <= 0) {
      return [];
    }
    return syncIssueState.queue.splice(0, Math.min(max, syncIssueState.queue.length));
  }

  function pushSyncIssueBatchBack(items) {
    if (!Array.isArray(items) || items.length === 0) {
      return;
    }
    syncIssueState.queue = [...items, ...syncIssueState.queue].slice(0, MAX_SYNC_ISSUES_PER_RUN);
  }

  function compactSyncIssueDetails(payload) {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const detail = {};
    const putNumber = (key) => {
      const num = Number(payload[key]);
      if (Number.isFinite(num)) {
        detail[key] = num;
      }
    };
    const putText = (key, maxLen = 80) => {
      const value = safeTrimText(payload[key], maxLen);
      if (value) {
        detail[key] = value;
      }
    };

    putNumber('readCount');
    putNumber('sendCount');
    putNumber('trafficTotal');
    putNumber('sceneItemCount');
    putNumber('parseScore');
    putNumber('status');
    putNumber('ret');
    putNumber('intervalMs');
    putNumber('index');
    putText('phase', 32);
    putText('source', 32);

    return Object.keys(detail).length > 0 ? detail : null;
  }

  function reportSyncIssue(issueType, stage, payload = null) {
    if (!syncIssueState.sessionId || !issueType) {
      return;
    }
    if (syncIssueState.queue.length >= MAX_SYNC_ISSUES_PER_RUN) {
      return;
    }
    const type = safeTrimText(String(issueType || '').toLowerCase(), 32);
    const safeStage = safeTrimText(stage || '', 32);
    const wxArticleId = safeTrimText(payload?.wxArticleId || payload?.msgId || '', 128);
    const issueCode = safeTrimText(payload?.code || payload?.ret || payload?.status || '', 64);
    const issueMessage = safeTrimText(payload?.message || payload?.reason || '', 200);
    const dedupeKey = `${type}|${safeStage}|${wxArticleId}|${issueCode}|${issueMessage}`;
    if (syncIssueState.dedupe.has(dedupeKey)) {
      return;
    }
    syncIssueState.dedupe.add(dedupeKey);

    syncIssueState.queue.push({
      syncSessionId: syncIssueState.sessionId,
      issueType: type || 'unknown',
      stage: safeStage,
      wxArticleId,
      issueCode,
      issueMessage,
      details: compactSyncIssueDetails(payload),
      occurredAt: new Date().toISOString(),
    });
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
      trafficSourceRates: metrics.trafficSourceRates || {},
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

  async function uploadSyncChunk(apiBase, authToken, articles, snapshots, syncIssues = [], accountName = '') {
    const normalizedAccountName = safeTrimText(accountName || '', 128);
    const proxyResponse = await proxyFetchJson(`${apiBase}/sync/articles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        articles: Array.isArray(articles) ? articles : [],
        snapshots: Array.isArray(snapshots) ? snapshots : [],
        syncIssues: Array.isArray(syncIssues) ? syncIssues : [],
        accountName: normalizedAccountName || undefined,
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
    STATE.cancelRequested = false;
    updateLauncherState();
    let apiBase = API_BASE_URL;
    let authToken = '';
    let syncAccountName = resolveSyncAccountName();
    const flushSyncIssuesBestEffort = async () => {
      if (!authToken || syncIssueState.queue.length <= 0) {
        return;
      }
      let guard = 0;
      while (syncIssueState.queue.length > 0 && guard < 8) {
        guard += 1;
        const issueBatch = takeSyncIssueBatch(MAX_SYNC_ISSUES_PER_UPLOAD);
        if (issueBatch.length === 0) {
          return;
        }
        try {
          await uploadSyncChunk(apiBase, authToken, [], [], issueBatch, syncAccountName);
        } catch (error) {
          pushSyncIssueBatchBack(issueBatch);
          if (guard <= 2) {
            safeLog('warn', 'flush sync issues failed', {
              reason: error?.message || String(error),
              issueBatchSize: issueBatch.length,
            });
          }
          return;
        }
      }
    };
    try {
      throwIfSyncCanceled();
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
      authToken = storage.gzhAuthToken;
      apiBase = API_BASE_URL;
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

      beginSyncIssueSession();
      throwIfSyncCanceled();

      const syncRangeCode = normalizeSyncRangeCode(selectedSyncRangeCode);
      const syncRangeDays = syncRangeDaysByCode(syncRangeCode);
      const syncRangeLabel = syncRangeLabelByCode(syncRangeCode);
      notifyState({ stage: 'fetch_list', message: `正在读取文章列表（${syncRangeLabel}）...`, progress: 5 });
      const articles = await fetchAllArticles(token, { syncRangeDays });
      throwIfSyncCanceled();
      syncAccountName = resolveSyncAccountName(latestDetectedMpAccountName);

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
        throwIfSyncCanceled();
        const issueBatch = takeSyncIssueBatch(MAX_SYNC_ISSUES_PER_UPLOAD);
        if (pendingSyncItems.length === 0 && issueBatch.length === 0) {
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
          throwIfSyncCanceled();
          const uploadResult = await uploadSyncChunk(
            apiBase,
            authToken,
            pendingSyncItems,
            pendingSnapshots,
            issueBatch,
            syncAccountName
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
              issueBatchSize: issueBatch.length,
            });
          }
        } catch (error) {
          pushSyncIssueBatchBack(issueBatch);
          if (error?.isUserCanceled) {
            throw error;
          }
          const uploadReason = error?.message || String(error);
          if (!firstUploadError) {
            firstUploadError = uploadReason;
          }
          if (isUnauthorizedUploadError(error)) {
            reportSyncIssue('upload_unauthorized', 'upload', {
              wxArticleId: pendingArticleIds[0] || '',
              code: error?.code || error?.status || '',
              status: error?.status || 0,
              message: uploadReason,
              index,
            });
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
          reportSyncIssue('upload_failed', 'upload', {
            wxArticleId: pendingArticleIds[0] || '',
            code: error?.code || error?.status || '',
            status: error?.status || 0,
            message: uploadReason,
            index,
          });
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
        reportSyncIssue('mp_freq_limit', 'fetch_detail', {
          message: 'sync stopped by freq protection',
          readCount: 0,
          sendCount: 0,
        });
        if (pendingSyncItems.length > 0) {
          const flushed = await flushPendingUploads(processedArticles, articles.length);
          if (!flushed) {
            return;
          }
        }
        if (syncIssueState.queue.length > 0) {
          await flushPendingUploads(processedArticles, articles.length);
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
        throwIfSyncCanceled();
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
          throwIfSyncCanceled();
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
            throwIfSyncCanceled();
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
            reportSyncIssue('metrics_fetch_failed', 'fetch_detail', {
              wxArticleId: article?.wxArticleId ?? '',
              message: metricsError?.message || String(metricsError),
              intervalMs: metricsRequestIntervalMs,
              index,
            });
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
          throwIfSyncCanceled();
          const contentResult = await contentPromise;
          contentPromiseByArticleId.delete(String(article.wxArticleId || article.contentUrl || ''));
          if (!contentResult.ok) {
            const error = contentResult.error;
            failedContent += 1;
            reportSyncIssue('content_fetch_failed', 'fetch_detail', {
              wxArticleId: article?.wxArticleId ?? '',
              message: error?.message || String(error),
              index,
            });
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

      let issueFlushGuard = 0;
      while (syncIssueState.queue.length > 0 && issueFlushGuard < 8) {
        throwIfSyncCanceled();
        issueFlushGuard += 1;
        const continueSync = await flushPendingUploads(processedArticles, articles.length);
        if (!continueSync) {
          return;
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
      if (error?.isUserCanceled) {
        notifyState({
          stage: 'canceled',
          message: '同步已取消',
          progress: Number(panelState?.progress || 0),
          total: Number(panelState?.total || 0),
          synced: Number(panelState?.synced || 0),
          failedMetrics: Number(panelState?.failedMetrics || 0),
          failedContent: Number(panelState?.failedContent || 0),
          failedUpload: Number(panelState?.failedUpload || 0),
        });
        return;
      }
      if (error?.isFreqLimited) {
        reportSyncIssue('mp_freq_limit', 'sync_run', {
          message: error.message || '频控触发',
        });
        await flushSyncIssuesBestEffort();
        const cooldownMs = Math.max(0, mpCooldownUntil - Date.now());
        const cooldownMinutes = Math.max(1, Math.ceil(cooldownMs / (60 * 1000)));
        notifyState({
          stage: 'partial_failed',
          message: `${error.message || '检测到频控'}，建议约 ${cooldownMinutes} 分钟后重试`,
          progress: 0,
        });
      } else {
        reportSyncIssue('sync_unhandled_error', 'sync_run', {
          message: error?.message || String(error),
        });
        await flushSyncIssuesBestEffort();
        notifyState({ stage: 'error', message: error.message || '同步失败', progress: 0 });
      }
    } finally {
      clearSyncIssueSession();
      STATE.syncing = false;
      STATE.cancelRequested = false;
      renderPanel(panelState);
      updateLauncherState();
    }
  }

  async function fetchAllArticles(token, options = {}) {
    const syncRangeDays = Math.max(0, Number(options.syncRangeDays || 0));
    const all = [];
    let begin = 0;
    const pageSize = 10;

    while (begin < 1000) {
      throwIfSyncCanceled();
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
      throwIfSyncCanceled();
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
        reportSyncIssue('list_parse_error', 'fetch_list', {
          status: response.status,
          message: 'appmsgpublish response not json',
          index: begin,
        });
        throw new Error('读取文章列表失败：接口返回格式异常');
      }

      const ret = Number(json.base_resp?.ret ?? json.ret ?? 0);
      const errMsg = String(json.base_resp?.err_msg || json.err_msg || '');
      if (ret !== 0) {
        safeLog('warn', 'appmsgpublish returned non-zero ret', { ret, errMsg, begin });
        if (isFreqControlReason(errMsg)) {
          reportSyncIssue('list_freq_limited', 'fetch_list', {
            ret,
            message: errMsg || 'list freq control',
            index: begin,
          });
          noteMpFreqHit(`publish-list-ret:${ret}`);
          throw createFreqLimitedError('读取文章列表触发频控，请稍后重试');
        }
        if (ret === 200013 || /invalid|expired|登录|token/i.test(errMsg)) {
          reportSyncIssue('list_login_expired', 'fetch_list', {
            ret,
            message: errMsg || 'login expired',
            index: begin,
          });
          throw new Error('微信后台登录已过期，请刷新页面重新登录后再同步');
        }
        reportSyncIssue('list_api_error', 'fetch_list', {
          ret,
          message: errMsg || 'list api error',
          index: begin,
        });
        throw new Error(`读取文章列表失败(${ret})：${errMsg || '未知错误'}`);
      }

      const publishPage = parseMaybeJson(json.publish_page) || parseMaybeJson(json.publishPage) || {};
      noteDetectedAccountName(extractAccountNameFromNode(publishPage) || extractAccountNameFromNode(json));
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
    let noPublishTimeCount = 0;
    let outOfRangeCount = 0;
    const filtered = syncRangeDays > 0
      ? deduped.filter((article) => {
        const publishTs = resolveArticlePublishTimestampMs(article);
        if (!Number.isFinite(publishTs)) {
          noPublishTimeCount += 1;
          return false;
        }
        const matched = isWithinLookbackDays(article, syncRangeDays, { allowUnknownPublishTime: false });
        if (!matched) {
          outOfRangeCount += 1;
        }
        return matched;
      })
      : deduped;
    safeLog('info', 'appmsgpublish done', {
      syncRangeDays,
      rawCount: all.length,
      dedupedCount: deduped.length,
      filteredCount: filtered.length,
      noPublishTimeCount,
      outOfRangeCount,
    });
    return filtered;
  }

  function normalizePublishTimestampSeconds(value) {
    const raw = value;
    if (raw == null || raw === '') {
      return 0;
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      if (raw >= 1000000000000 && raw <= 5000000000000) {
        return Math.floor(raw / 1000);
      }
      if (raw >= 946684800 && raw <= 5000000000) {
        return Math.floor(raw);
      }
      return 0;
    }
    const text = String(raw).trim();
    if (!text) {
      return 0;
    }
    if (/^\d{9,13}$/.test(text)) {
      const num = Number(text);
      if (!Number.isFinite(num)) {
        return 0;
      }
      if (num >= 1000000000000 && num <= 5000000000000) {
        return Math.floor(num / 1000);
      }
      if (num >= 946684800 && num <= 5000000000) {
        return Math.floor(num);
      }
      return 0;
    }
    const ymdTs = parseYmdToChinaMs(text);
    if (Number.isFinite(ymdTs)) {
      return Math.floor(ymdTs / 1000);
    }
    const genericTs = Date.parse(text);
    if (Number.isFinite(genericTs)) {
      const sec = Math.floor(genericTs / 1000);
      if (sec >= 946684800 && sec <= 5000000000) {
        return sec;
      }
    }
    return 0;
  }

  function isPublishTimestampFieldName(key) {
    const text = String(key || '').toLowerCase();
    if (!text) {
      return false;
    }
    return text === 'ct'
      || text === 'publish_time'
      || text === 'publishtime'
      || text === 'create_time'
      || text === 'createtime'
      || text === 'send_time'
      || text === 'sent_time'
      || text === 'update_time'
      || text === 'datetime'
      || text === 'date_time'
      || text === 'publish_date'
      || text === 'publishdate'
      || text === 'sendtime'
      || text === 'senttime';
  }

  function extractPublishTimestampSecondsFromText(rawText) {
    const text = String(rawText || '');
    if (!text) {
      return 0;
    }
    const tsMatch = text.match(/(?:publish_time|create_time|send_time|sent_time|update_time|ct|date_time|datetime)["']?\s*[:=]\s*["']?(\d{9,13})/i);
    const ts = normalizePublishTimestampSeconds(tsMatch?.[1] || 0);
    if (ts > 0) {
      return ts;
    }
    const dateMatch = text.match(/(?:publish_date|publishDate)["']?\s*[:=]\s*["']?(\d{4}-\d{2}-\d{2})/i);
    return normalizePublishTimestampSeconds(dateMatch?.[1] || 0);
  }

  function extractPublishTimestampSecondsFromNode(node, depth = 0) {
    if (depth > 7 || node == null) {
      return 0;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        const ts = extractPublishTimestampSecondsFromNode(item, depth + 1);
        if (ts > 0) {
          return ts;
        }
      }
      return 0;
    }
    if (typeof node === 'string') {
      const textTs = extractPublishTimestampSecondsFromText(node);
      if (textTs > 0) {
        return textTs;
      }
      const parsed = parseMaybeJson(node);
      if (parsed && typeof parsed === 'object') {
        return extractPublishTimestampSecondsFromNode(parsed, depth + 1);
      }
      return 0;
    }
    if (typeof node !== 'object') {
      return normalizePublishTimestampSeconds(node);
    }

    for (const [key, value] of Object.entries(node)) {
      if (!isPublishTimestampFieldName(key)) {
        continue;
      }
      const ts = normalizePublishTimestampSeconds(value);
      if (ts > 0) {
        return ts;
      }
      const nestedTs = extractPublishTimestampSecondsFromNode(value, depth + 1);
      if (nestedTs > 0) {
        return nestedTs;
      }
      if (typeof value === 'string') {
        const textTs = extractPublishTimestampSecondsFromText(value);
        if (textTs > 0) {
          return textTs;
        }
      }
    }

    for (const value of Object.values(node)) {
      if (value == null) {
        continue;
      }
      if (typeof value === 'object') {
        const ts = extractPublishTimestampSecondsFromNode(value, depth + 1);
        if (ts > 0) {
          return ts;
        }
      } else if (typeof value === 'string' && value.length <= 2400) {
        const ts = extractPublishTimestampSecondsFromText(value);
        if (ts > 0) {
          return ts;
        }
      }
    }
    return 0;
  }

  function resolvePublishTimestampSeconds(article, item, info) {
    const directCandidates = [
      article?.publish_time,
      article?.publishTime,
      article?.create_time,
      article?.createTime,
      article?.send_time,
      article?.sent_time,
      article?.update_time,
      article?.ct,
      article?.publish_date,
      article?.publishDate,
      item?.publish_time,
      item?.create_time,
      item?.send_time,
      item?.sent_time,
      item?.update_time,
      item?.publish_date,
      item?.publishDate,
      info?.publish_time,
      info?.create_time,
      info?.send_time,
      info?.sent_time,
      info?.update_time,
      info?.publish_date,
      info?.publishDate,
    ];
    for (const value of directCandidates) {
      const ts = normalizePublishTimestampSeconds(value);
      if (ts > 0) {
        return ts;
      }
    }

    const sources = [
      article,
      item,
      info,
      item?.publish_info,
      item?.publishInfo,
      info?.publish_info,
      info?.publishInfo,
    ];
    for (const source of sources) {
      const ts = extractPublishTimestampSecondsFromNode(source, 0);
      if (ts > 0) {
        return ts;
      }
    }
    return 0;
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
    const publishTsFallback = resolvePublishTimestampSeconds(null, item, info);
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
      const publishTs = resolvePublishTimestampSeconds(article, item, info) || publishTsFallback || 0;
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
        publishTimestamp: publishTs > 0 ? publishTs : 0,
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
    const parsedTrafficSourceRates = parsedMetrics?.trafficSourceRates || {};
    const trafficSourceRates = trafficSourceRatesTotal(parsedTrafficSourceRates) > 0
      ? parsedTrafficSourceRates
      : createEmptyTrafficSourceRates();
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
      trafficSourceRates,
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
    const mergedRateTotal = trafficSourceRatesTotal(merged.trafficSourceRates);
    const fallbackRateTotal = trafficSourceRatesTotal(fallback.trafficSourceRates);
    if (fallbackRateTotal > 0 && (
      mergedRateTotal <= 0
      || fallbackParseScore > mergedParseScore
      || fallbackRateTotal >= Math.max(10, mergedRateTotal * 1.2)
    )) {
      merged.trafficSourceRates = fallback.trafficSourceRates;
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
    if (ENABLE_PLUGIN_LOG && trafficProbeLogCount < 12) {
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
    if (ENABLE_PLUGIN_LOG && metricsPayloadParseWarnCount < 6 && payloadQualityScore(json) <= 1) {
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

  function sourceKeyByLabel(rawLabel) {
    const label = String(rawLabel || '').trim();
    if (!label) {
      return '';
    }
    if (label.includes('朋友圈')) {
      return '朋友圈';
    }
    if (label.includes('公众号消息') || label.includes('公众号通知') || label.includes('订阅')) {
      return '公众号消息';
    }
    if (label.includes('推荐') || label.includes('看一看')) {
      return '推荐';
    }
    if (label.includes('公众号主页') || label.includes('主页') || label.includes('资料页') || label.includes('历史消息')) {
      return '公众号主页';
    }
    if (label.includes('聊天') || label.includes('会话') || label.includes('好友转发') || label.includes('私聊')) {
      return '聊天会话';
    }
    if (label.includes('搜') || label.includes('搜索')) {
      return '搜一搜';
    }
    if (label.includes('其它') || label.includes('其他')) {
      return '其它';
    }
    return '';
  }

  function applyTrafficSourceByLabel(target, rawLabel, rawCount) {
    const count = Number(rawCount || 0);
    const sourceKey = sourceKeyByLabel(rawLabel);
    if (!sourceKey || !Number.isFinite(count) || count <= 0 || !target) {
      return false;
    }
    target[sourceKey] = Number(target[sourceKey] || 0) + count;
    return true;
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

  function createEmptyTrafficSourceRates() {
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
    if (sceneId === 5) {
      return '其它';
    }
    return '';
  }

  function normalizeAliasKey(key) {
    return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function buildAliasSet(keys) {
    const set = new Set();
    (keys || []).forEach((key) => {
      const lower = String(key || '').toLowerCase();
      set.add(lower);
      set.add(normalizeAliasKey(lower));
    });
    return set;
  }

  const SCENE_COUNT_STRONG_ALIAS_SET = buildAliasSet([
    'int_page_read_user',
    'intPageReadUser',
    'read_user',
    'readUser',
    'read_uv',
    'readUv',
    'read_num',
    'readNum',
    'read_count',
    'readCount',
    'int_page_read_count',
    'intPageReadCount',
    'int_page_read_num',
    'intPageReadNum',
    'source_read_user',
    'sourceReadUser',
    'source_read_uv',
    'sourceReadUv',
    'source_read_num',
    'sourceReadNum',
    'scene_read_uv',
    'sceneReadUv',
    'scene_read_num',
    'sceneReadNum',
    'scene_read_count',
    'sceneReadCount',
    'from_read_user',
    'fromReadUser',
    'from_read_uv',
    'fromReadUv',
    'from_read_num',
    'fromReadNum',
    'readuser',
    'readuv',
    'readcount',
  ]);

  const SCENE_COUNT_WEAK_ALIAS_SET = buildAliasSet([
    'user_count',
    'userCount',
    'uv',
    'pv',
    'count',
  ]);

  const SCENE_RATIO_ALIAS_SET = buildAliasSet([
    'ratio',
    'read_ratio',
    'readRatio',
    'scene_ratio',
    'sceneRatio',
    'rate',
    'read_rate',
    'readRate',
    'percent',
    'percentage',
    'read_percent',
    'readPercent',
    'read_percentage',
    'readPercentage',
    'pct',
  ]);

  const SCENE_METRIC_CONTAINER_KEYS = new Set([
    'data',
    'detail',
    'detaildata',
    'ext',
    'info',
    'item',
    'metric',
    'metrics',
    'source',
    'stat',
    'stats',
    'summary',
  ]);

  function maxNumberByAliasShallow(target, aliasSet) {
    if (!target || typeof target !== 'object' || !aliasSet || aliasSet.size === 0) {
      return 0;
    }
    let maxValue = 0;
    Object.entries(target).forEach(([key, value]) => {
      if (value && typeof value === 'object') {
        return;
      }
      const lower = String(key || '').toLowerCase();
      if (!aliasSet.has(lower) && !aliasSet.has(normalizeAliasKey(lower))) {
        return;
      }
      const num = toLooseNumber(value);
      if (!Number.isFinite(num) || num <= 0) {
        return;
      }
      maxValue = Math.max(maxValue, num);
    });
    return Number(maxValue || 0);
  }

  function collectSceneMetricContainers(item) {
    if (!item || typeof item !== 'object') {
      return [];
    }
    const containers = [item];
    Object.entries(item).forEach(([key, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return;
      }
      if (!SCENE_METRIC_CONTAINER_KEYS.has(normalizeAliasKey(key))) {
        return;
      }
      containers.push(value);
    });
    return containers;
  }

  function extractSceneMetricCount(item) {
    if (!item || typeof item !== 'object') {
      return 0;
    }
    const containers = collectSceneMetricContainers(item);
    let strongMax = 0;
    containers.forEach((one) => {
      strongMax = Math.max(strongMax, maxNumberByAliasShallow(one, SCENE_COUNT_STRONG_ALIAS_SET));
    });
    if (strongMax > 0) {
      return strongMax;
    }

    let weakMax = 0;
    containers.forEach((one) => {
      weakMax = Math.max(weakMax, maxNumberByAliasShallow(one, SCENE_COUNT_WEAK_ALIAS_SET));
    });
    if (weakMax > 1) {
      return weakMax;
    }
    return 0;
  }

  function extractSceneMetricRatio(item) {
    if (!item || typeof item !== 'object') {
      return 0;
    }
    const containers = collectSceneMetricContainers(item);
    let rawRatio = 0;
    containers.forEach((one) => {
      rawRatio = Math.max(rawRatio, maxNumberByAliasShallow(one, SCENE_RATIO_ALIAS_SET));
    });
    if (!Number.isFinite(rawRatio) || rawRatio <= 0) {
      return 0;
    }
    if (rawRatio > 1 && rawRatio <= 100) {
      return rawRatio / 100;
    }
    if (rawRatio > 100 && rawRatio <= 10000) {
      return rawRatio / 10000;
    }
    if (rawRatio > 10000) {
      return 0;
    }
    return rawRatio;
  }

  function buildTrafficSourcesFromSceneItems(sceneItems, totalRead = 0) {
    const sourceMap = createEmptyTrafficSources();
    const sourceRatio = createEmptyTrafficSources();
    if (!Array.isArray(sceneItems) || sceneItems.length === 0) {
      return sourceMap;
    }

    sceneItems.forEach((item) => {
      if (!item || typeof item !== 'object') {
        return;
      }
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
      const sourceKey = sourceKeyByLabel(sceneDesc) || sourceKeyByScene(scene);
      if (!sourceKey) {
        return;
      }

      const count = extractSceneMetricCount(item);
      if (Number.isFinite(count) && count > 0) {
        sourceMap[sourceKey] = Number(sourceMap[sourceKey] || 0) + count;
        return;
      }

      const ratio = extractSceneMetricRatio(item);
      if (!Number.isFinite(ratio) || ratio <= 0) {
        return;
      }
      sourceRatio[sourceKey] = Math.max(Number(sourceRatio[sourceKey] || 0), ratio);
    });

    if (trafficSourcesTotal(sourceMap) > 0) {
      return sourceMap;
    }

    const ratioTotal = Object.values(sourceRatio).reduce((sum, value) => sum + (Number(value) || 0), 0);
    if (ratioTotal > 0 && Number(totalRead || 0) > 0) {
      const normalizedRatioTotal = ratioTotal > 1.2 ? ratioTotal : 1;
      Object.entries(sourceRatio).forEach(([key, value]) => {
        const ratio = Number(value || 0);
        if (!Number.isFinite(ratio) || ratio <= 0) {
          return;
        }
        const estimate = Math.round((Number(totalRead || 0) * ratio) / normalizedRatioTotal);
        if (estimate > 0) {
          sourceMap[key] = estimate;
        }
      });
    }

    return sourceMap;
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

  function trafficSourceNonZeroCount(sourceMap) {
    if (!sourceMap || typeof sourceMap !== 'object') {
      return 0;
    }
    return Object.values(sourceMap).reduce((count, value) => {
      const one = toLooseNumber(value);
      if (!Number.isFinite(one) || one <= 0) {
        return count;
      }
      return count + 1;
    }, 0);
  }

  function trafficSourceRateNonZeroCount(rateMap) {
    if (!rateMap || typeof rateMap !== 'object') {
      return 0;
    }
    return Object.values(rateMap).reduce((count, value) => {
      const one = toLooseNumber(value);
      if (!Number.isFinite(one) || one <= 0) {
        return count;
      }
      return count + 1;
    }, 0);
  }

  function trafficSourceRatesTotal(rateMap) {
    if (!rateMap || typeof rateMap !== 'object') {
      return 0;
    }
    return Object.values(rateMap).reduce((sum, value) => {
      const one = toLooseNumber(value);
      if (!Number.isFinite(one) || one <= 0) {
        return sum;
      }
      return sum + one;
    }, 0);
  }

  function normalizeTrafficSourceRatePercent(rawRate) {
    const value = Number(rawRate || 0);
    if (!Number.isFinite(value) || value <= 0) {
      return 0;
    }
    let percent = value;
    if (percent <= 1) {
      percent = percent * 100;
    } else if (percent > 100 && percent <= 10000) {
      percent = percent / 100;
    }
    if (!Number.isFinite(percent) || percent <= 0) {
      return 0;
    }
    return Math.min(100, percent);
  }

  function roundToRatePercent(value) {
    const one = Number(value || 0);
    if (!Number.isFinite(one) || one <= 0) {
      return 0;
    }
    return Math.round(one * 100) / 100;
  }

  function buildTrafficSourceRatesFromSceneItems(sceneItems) {
    const rateMap = createEmptyTrafficSourceRates();
    if (!Array.isArray(sceneItems) || sceneItems.length === 0) {
      return rateMap;
    }
    sceneItems.forEach((item) => {
      if (!item || typeof item !== 'object') {
        return;
      }
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
      const sourceKey = sourceKeyByLabel(sceneDesc) || sourceKeyByScene(scene);
      if (!sourceKey) {
        return;
      }
      const ratio = extractSceneMetricRatio(item);
      const percent = normalizeTrafficSourceRatePercent(ratio);
      if (percent <= 0) {
        return;
      }
      rateMap[sourceKey] = Math.max(Number(rateMap[sourceKey] || 0), percent);
    });
    Object.keys(rateMap).forEach((key) => {
      rateMap[key] = roundToRatePercent(rateMap[key]);
    });
    return rateMap;
  }

  function sceneReadMetricValue(item) {
    if (!item || typeof item !== 'object') {
      return 0;
    }
    const direct = [
      item.read_count,
      item.readCount,
      item.read_user,
      item.readUser,
      item.read_uv,
      item.readUv,
      item.read_num,
      item.readNum,
      item.int_page_read_user,
      item.intPageReadUser,
      item.int_page_read_count,
      item.intPageReadCount,
    ];
    for (const one of direct) {
      const value = toLooseNumber(one);
      if (Number.isFinite(value) && value > 0) {
        return Number(value);
      }
    }
    return extractSceneMetricCount(item);
  }

  function extractSummarySceneList(summaryData) {
    const parsed = parseStructuredData(summaryData);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed && typeof parsed === 'object') {
      const list = parseStructuredData(parsed.list)
        || parseStructuredData(parsed.data)
        || parseStructuredData(parsed.items)
        || parseStructuredData(parsed.scene_list)
        || parseStructuredData(parsed.sceneList);
      if (Array.isArray(list)) {
        return list;
      }
    }
    return [];
  }

  function buildOfficialTrafficSourceRatesFromSummary(summaryData) {
    const list = extractSummarySceneList(summaryData);
    const sourceCountMap = createEmptyTrafficSources();
    const rateMap = createEmptyTrafficSourceRates();
    if (!Array.isArray(list) || list.length <= 0) {
      return rateMap;
    }

    let baseTotal = 0;
    list.forEach((item) => {
      if (!item || typeof item !== 'object') {
        return;
      }
      const scene = Number(item.scene ?? item.scene_id ?? item.source_scene);
      const value = sceneReadMetricValue(item);
      if (!Number.isFinite(value) || value <= 0) {
        return;
      }
      if (scene === 9999) {
        baseTotal += value;
        return;
      }
      const sceneDesc = String(
        item.scene_desc
          ?? item.sceneDesc
          ?? item.scene_name
          ?? item.sceneName
          ?? item.source_name
          ?? item.sourceName
          ?? ''
      ).trim();
      const sourceKey = sourceKeyByScene(scene) || sourceKeyByLabel(sceneDesc);
      if (!sourceKey) {
        return;
      }
      sourceCountMap[sourceKey] = Number(sourceCountMap[sourceKey] || 0) + Number(value);
    });

    if (baseTotal <= 0) {
      return rateMap;
    }

    Object.keys(rateMap).forEach((key) => {
      const count = Number(sourceCountMap[key] || 0);
      if (!Number.isFinite(count) || count <= 0) {
        return;
      }
      rateMap[key] = roundToRatePercent((count * 100) / baseTotal);
    });
    return rateMap;
  }

  function buildTrafficSourceRates(root, totalRead = 0) {
    void totalRead;
    const officialSummaryRates = buildOfficialTrafficSourceRatesFromSummary(root?.articleSummaryData);
    if (trafficSourceRateNonZeroCount(officialSummaryRates) > 0) {
      return officialSummaryRates;
    }
    const summaryItems = collectSceneItems(root?.articleSummaryData);
    const detailItems = collectSceneItems(root?.detailData);
    const allItems = collectSceneItems(root);
    const candidates = [
      { sceneItemCount: summaryItems.length, map: buildTrafficSourceRatesFromSceneItems(summaryItems) },
      { sceneItemCount: detailItems.length, map: buildTrafficSourceRatesFromSceneItems(detailItems) },
      { sceneItemCount: allItems.length, map: buildTrafficSourceRatesFromSceneItems(allItems) },
    ];

    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      const total = trafficSourceRatesTotal(candidate.map);
      if (total <= 0) {
        continue;
      }
      const nonZeroCount = trafficSourceRateNonZeroCount(candidate.map);
      if (candidate.sceneItemCount >= 6 && nonZeroCount <= 1) {
        continue;
      }
      return candidate.map;
    }
    return createEmptyTrafficSourceRates();
  }

  function buildTrafficSourceRatesFromCounts(sourceMap) {
    const rates = createEmptyTrafficSourceRates();
    const total = trafficSourcesTotal(sourceMap);
    if (total <= 0) {
      return rates;
    }
    Object.keys(rates).forEach((key) => {
      const count = Number(sourceMap?.[key] || 0);
      if (!Number.isFinite(count) || count <= 0) {
        return;
      }
      rates[key] = roundToRatePercent((count * 100) / total);
    });
    return rates;
  }

  function isSuspiciousTrafficDistribution(sourceMap, readCount, sceneItemCount = 0) {
    const total = trafficSourcesTotal(sourceMap);
    if (total <= 0) {
      return false;
    }
    const nonZeroCount = trafficSourceNonZeroCount(sourceMap);
    if (nonZeroCount <= 0) {
      return true;
    }

    const read = Number(readCount || 0);
    if (read <= 0) {
      return false;
    }

    if (nonZeroCount <= 1) {
      if (sceneItemCount >= 6 && read >= 20) {
        return true;
      }
      if (read >= 20 && total <= Math.max(2, Math.round(read * 0.2))) {
        return true;
      }
      if (read >= 20 && total >= Math.round(read * 1.8)) {
        return true;
      }
    }
    return false;
  }

  function buildTrafficDebug(root) {
    const sceneItems = collectSceneItems(root);
    return {
      sceneItemCount: sceneItems.length,
      sceneSamples: sceneItems.slice(0, 3).map((item) => ({
        scene: Number(item.scene ?? item.scene_id ?? item.source_scene),
        label: String(item.scene_desc ?? item.sceneDesc ?? item.scene_name ?? item.sceneName ?? item.source_name ?? item.sourceName ?? '').trim(),
        readNum: extractSceneMetricCount(item),
        readRatio: extractSceneMetricRatio(item),
        sourceKey: sourceKeyByLabel(
          String(item.scene_desc ?? item.sceneDesc ?? item.scene_name ?? item.sceneName ?? item.source_name ?? item.sourceName ?? '').trim()
        ) || sourceKeyByScene(Number(item.scene ?? item.scene_id ?? item.source_scene)),
        keys: safeObjectKeys(item).slice(0, 8),
      })),
    };
  }

  function buildDirectTrafficSources(root) {
    return {
      朋友圈: findMaxNumberByKeys(root, ['fromfeed', 'from_feed', 'from_friend', 'from_feed_read_user', 'from_feed_uv']),
      公众号消息: findMaxNumberByKeys(root, ['frommsg', 'from_msg', 'from_subscription', 'from_msg_read_user', 'frommsg_read_user', 'from_msg_uv']),
      推荐: findMaxNumberByKeys(root, ['fromrecommend', 'from_recommend', 'from_kandian', 'from_recommend_read_user', 'from_recommend_uv']),
      公众号主页: findMaxNumberByKeys(root, ['fromhome', 'from_home', 'fromprofile', 'from_profile', 'from_home_read_user', 'from_profile_read_user']),
      聊天会话: findMaxNumberByKeys(root, ['fromsession', 'from_session', 'fromchat', 'from_chat', 'from_session_read_user', 'from_chat_read_user']),
      搜一搜: findMaxNumberByKeys(root, ['fromsogou', 'from_search', 'from_sogou', 'from_search_read_user']),
      其它: findMaxNumberByKeys(root, ['fromother', 'from_other', 'from_other_read_user']),
    };
  }

  function buildTrafficSources(root, totalRead = 0) {
    const summaryItems = collectSceneItems(root?.articleSummaryData);
    const detailItems = collectSceneItems(root?.detailData);
    const allItems = collectSceneItems(root);
    const direct = buildDirectTrafficSources(root);
    const candidates = [
      { kind: 'summary', sceneItemCount: summaryItems.length, map: buildTrafficSourcesFromSceneItems(summaryItems, totalRead) },
      { kind: 'detail', sceneItemCount: detailItems.length, map: buildTrafficSourcesFromSceneItems(detailItems, totalRead) },
      { kind: 'scene', sceneItemCount: allItems.length, map: buildTrafficSourcesFromSceneItems(allItems, totalRead) },
      { kind: 'direct', sceneItemCount: 0, map: direct },
    ];

    let best = null;
    candidates.forEach((candidate) => {
      const total = trafficSourcesTotal(candidate.map);
      if (total <= 0) {
        return;
      }
      if (!best || total > best.total) {
        best = { ...candidate, total };
      }
    });

    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      const total = trafficSourcesTotal(candidate.map);
      if (total <= 0) {
        continue;
      }
      if (!isSuspiciousTrafficDistribution(candidate.map, totalRead, candidate.sceneItemCount)) {
        return candidate.map;
      }
    }

    if (best && Number(totalRead || 0) <= 0) {
      return best.map;
    }
    return createEmptyTrafficSources();
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
    const readCount = findFirstNumberByKeys(root, ['int_page_read_user', 'read_num', 'read_uv']);
    const sendCount = findFirstNumberByKeys(root, ['send_uv']);
    const shareCount = findFirstNumberByKeys(root, ['share_user', 'share_count', 'share_uv']);
    const likeCount = findFirstNumberByKeys(root, ['like_num', 'like_cnt']);
    const wowCount = findFirstNumberByKeys(root, ['old_like_num', 'wow_num', 'zaikan_cnt']);
    const commentCount = findFirstNumberByKeys(root, ['comment_id_count', 'comment_cnt']);
    const saveCount = findFirstNumberByKeys(root, ['fav_num', 'save_count', 'collection_uv']);
    const newFollowers = findFirstNumberByKeys(root, ['new_fans', 'follow_after_read_uv']);
    const completionRateRaw = findFirstNumberByKeys(root, ['complete_read_rate', 'finished_read_pv_ratio']);
    const avgReadTimeRaw = findFirstNumberByKeys(root, ['avg_article_read_time', 'avg_read_time', 'avg_read_duration', 'read_time_avg']);
    const trafficDebug = buildTrafficDebug(root);
    const trafficSources = buildTrafficSources(root, readCount);
    const trafficSourceRatesRaw = buildTrafficSourceRates(root, readCount);
    const trafficSourceRates = trafficSourceRatesTotal(trafficSourceRatesRaw) > 0
      ? trafficSourceRatesRaw
      : buildTrafficSourceRatesFromCounts(trafficSources);
    return {
      readCount,
      sendCount,
      shareCount,
      likeCount,
      wowCount,
      commentCount,
      saveCount,
      completionRate: normalizeCompletionRate(completionRateRaw),
      avgReadTimeSec: normalizeAvgReadTimeSec(avgReadTimeRaw),
      newFollowers,
      trafficSources,
      trafficSourceRates,
      topKeys: safeObjectKeys(payload),
      trafficDebug,
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

  function sanitizeMetricsTraffic(metrics, probeContext = null) {
    if (!metrics || typeof metrics !== 'object') {
      return metrics;
    }
    const trafficSources = metrics.trafficSources || createEmptyTrafficSources();
    const readCount = Number(metrics.readCount || 0);
    const sceneItemCount = Number(metrics?.trafficDebug?.sceneItemCount || 0);
    if (!isSuspiciousTrafficDistribution(trafficSources, readCount, sceneItemCount)) {
      return metrics;
    }
    if (suspiciousTrafficSourceLogCount < 12) {
      suspiciousTrafficSourceLogCount += 1;
      safeLog('warn', 'traffic sources suspicious, reset to empty', {
        ...(probeContext && typeof probeContext === 'object' ? probeContext : {}),
        readCount,
        sceneItemCount,
        trafficTotal: trafficSourcesTotal(trafficSources),
        nonZeroCount: trafficSourceNonZeroCount(trafficSources),
        trafficSources,
      });
    }
    reportSyncIssue('traffic_suspicious', 'metrics_parse', {
      wxArticleId: probeContext?.wxArticleId || '',
      message: 'traffic sources suspicious, reset to empty',
      readCount,
      sendCount: Number(metrics.sendCount || 0),
      sceneItemCount,
      trafficTotal: trafficSourcesTotal(trafficSources),
      parseScore: Number(metrics.parseScore || 0),
      phase: probeContext?.phase || '',
    });
    return {
      ...metrics,
      trafficSources: createEmptyTrafficSources(),
    };
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
        reportSyncIssue('metrics_freq_limited', 'fetch_detail', {
          wxArticleId: article?.wxArticleId ?? '',
          ret: requestResult.ret,
          message: errMsg || 'metrics freq control',
        });
        noteMpFreqHit(`metrics-ret:${requestResult.ret}`);
        throw createFreqLimitedError('读取文章指标触发频控，请稍后重试');
      }
      reportSyncIssue('metrics_api_error', 'fetch_detail', {
        wxArticleId: article?.wxArticleId ?? '',
        ret: requestResult.ret,
        message: errMsg || 'metrics api error',
      });
      throw new Error(`文章指标接口异常(${requestResult.ret})${errMsg ? `: ${errMsg}` : ''}`);
    }
    let metrics = extractMetricsFromPayload(requestResult.json);
    const metricsFromRaw = extractMetricsFromRawHtml(requestResult.raw);
    metrics = mergeMetricsByPositiveValue(metrics, metricsFromRaw);
    metrics = sanitizeMetricsTraffic(metrics, {
      wxArticleId: article?.wxArticleId ?? '',
      title: article?.title ?? '',
      msgIdBase: currentMsgIdBase,
      msgIndex,
      usedPublishDate,
      phase: 'initial',
    });

    if (isCoreMetricsZero(metrics) && !resolvedFromArticlePage && article?.contentUrl) {
      const resolved = await resolveMetricParamsFromArticlePage(article).catch(() => null);
      applyResolvedPublishMeta(resolved);
      if (resolved?.msgIdBase && resolved.publishDate) {
        const resolvedResult = await requestMetricsWithFallback(token, resolved.msgIdBase, msgIndex, resolved.publishDate).catch(() => null);
        if (resolvedResult && resolvedResult.ret === 0) {
          const resolvedMetrics = sanitizeMetricsTraffic(mergeMetricsByPositiveValue(
            extractMetricsFromPayload(resolvedResult.json),
            extractMetricsFromRawHtml(resolvedResult.raw)
          ), {
            wxArticleId: article?.wxArticleId ?? '',
            title: article?.title ?? '',
            msgIdBase: resolved.msgIdBase || currentMsgIdBase,
            msgIndex,
            usedPublishDate: resolved.publishDate,
            phase: 'resolve-article-page',
          });
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
        const oneMetrics = sanitizeMetricsTraffic(mergeMetricsByPositiveValue(
          extractMetricsFromPayload(oneResult.json),
          extractMetricsFromRawHtml(oneResult.raw)
        ), {
          wxArticleId: article?.wxArticleId ?? '',
          title: article?.title ?? '',
          msgIdBase,
          msgIndex,
          usedPublishDate: oneDate,
          phase: 'publish-date-retry',
        });
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

    metrics = sanitizeMetricsTraffic(metrics, {
      wxArticleId: article?.wxArticleId ?? '',
      title: article?.title ?? '',
      msgIdBase: currentMsgIdBase,
      msgIndex,
      usedPublishDate,
      phase: 'final',
    });
    if (ENABLE_PLUGIN_LOG && trafficProbeLogCount < 30) {
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
        trafficSourceRates: metrics.trafficSourceRates || {},
        parseScore: Number(metrics.parseScore || 0),
        topKeys: Array.isArray(metrics.topKeys) ? metrics.topKeys.slice(0, 12) : [],
        trafficDebug: metrics.trafficDebug || null,
      });
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
    if (isCoreMetricsZero(metrics)) {
      reportSyncIssue('metrics_all_zero', 'metrics_parse', {
        wxArticleId: article?.wxArticleId ?? '',
        message: 'all core metrics are zero',
        readCount: Number(metrics.readCount || 0),
        sendCount: Number(metrics.sendCount || 0),
        parseScore: Number(metrics.parseScore || 0),
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
    if (!isCoreMetricsZero(metrics)
      && Number(metrics.readCount || 0) > 0
      && trafficSourcesTotal(metrics.trafficSources) <= 0) {
      reportSyncIssue('traffic_all_zero_with_read', 'metrics_parse', {
        wxArticleId: article?.wxArticleId ?? '',
        message: 'traffic sources all zero with positive read',
        readCount: Number(metrics.readCount || 0),
        sendCount: Number(metrics.sendCount || 0),
        sceneItemCount: Number(metrics?.trafficDebug?.sceneItemCount || 0),
        parseScore: Number(metrics.parseScore || 0),
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
      trafficSourceRates: metrics.trafficSourceRates || {},
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
      if (message?.type === 'cancel-sync') {
        const accepted = requestSyncCancel('runtime_message');
        if (!accepted) {
          sendResponse({ ok: false, error: 'not-syncing' });
          return true;
        }
        sendResponse({ ok: true, canceling: true });
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
