const apiBaseInput = document.getElementById('apiBase');
const webBaseInput = document.getElementById('webBase');
const authTokenInput = document.getElementById('authToken');
const saveBtn = document.getElementById('saveBtn');
const stateView = document.getElementById('stateView');
const stateLabel = document.getElementById('stateLabel');
const progressTitle = document.getElementById('progressTitle');
const progressText = document.getElementById('progressText');
const progressFill = document.getElementById('progressFill');
const statusText = document.getElementById('statusText');
const countText = document.getElementById('countText');
const stepText = document.getElementById('stepText');
const summaryText = document.getElementById('summaryText');
const syncRangeSelect = document.getElementById('syncRange');
const primaryBtn = document.getElementById('primaryBtn');
const secondaryBtn = document.getElementById('secondaryBtn');
const HTTP_CONFIG = globalThis.GzhHttpConfig;
if (!HTTP_CONFIG) {
  throw new Error('GzhHttpConfig is required.');
}
const API_BASE_URL = HTTP_CONFIG.getBaseUrl();
const STAGE_LABELS = HTTP_CONFIG.stageLabels;
const RUNNING_STAGES = new Set(HTTP_CONFIG.runningStages);
const DEFAULT_WEB_BASE = HTTP_CONFIG.getDefaultWebBase();
const DEFAULT_SYNC_RANGE_CODE = '30d';
const SYNC_RANGE_OPTIONS = [
  { code: '30d', label: '最近30天' },
  { code: '60d', label: '最近60天' },
  { code: '90d', label: '最近90天' },
  { code: 'all', label: '全部' },
];

let latestAuthToken = '';
let latestLastSync = null;
let currentState = null;
let webBase = DEFAULT_WEB_BASE;
let selectedSyncRangeCode = DEFAULT_SYNC_RANGE_CODE;

function normalizeSyncRangeCode(rawCode) {
  const code = String(rawCode || '').trim().toLowerCase();
  return SYNC_RANGE_OPTIONS.some((item) => item.code === code) ? code : DEFAULT_SYNC_RANGE_CODE;
}

function syncRangeLabelByCode(rawCode) {
  const code = normalizeSyncRangeCode(rawCode);
  return (SYNC_RANGE_OPTIONS.find((item) => item.code === code) || SYNC_RANGE_OPTIONS[0]).label;
}

function normalizeWebBase(raw) {
  if (HTTP_CONFIG.isDebug) {
    return DEFAULT_WEB_BASE;
  }
  const candidate = String(raw || '').trim();
  const value = candidate || DEFAULT_WEB_BASE;
  return value.replace(/\/+$/, '');
}

function formatTime(iso) {
  if (!iso) return '--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--';
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const date = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const minute = String(d.getMinutes()).padStart(2, '0');
  return `${month}-${date} ${hour}:${minute}`;
}

function withDefaultState(state) {
  if (state && RUNNING_STAGES.has(state.stage)) return state;
  if (state && (state.stage === 'done' || state.stage === 'partial_failed' || state.stage === 'login_expired' || state.stage === 'error')) {
    return state;
  }
  if (!latestAuthToken) {
    return {
      stage: 'need_login_web',
      message: '请先前往运营助手登录，才能同步数据。',
      progress: 0,
      synced: 0,
      total: 0,
    };
  }
  return {
    stage: 'ready',
    message: latestLastSync
      ? `上次同步：${formatTime(latestLastSync.updatedAt)} · 当前范围：${syncRangeLabelByCode(selectedSyncRangeCode)}`
      : `已登录，可开始同步（${syncRangeLabelByCode(selectedSyncRangeCode)}）`,
    progress: 0,
    synced: 0,
    total: latestLastSync?.total || 0,
  };
}

function setBadge(stage) {
  stateLabel.textContent = STAGE_LABELS[stage] || '待同步';
  stateLabel.className = 'badge';

  if (stage === 'done') {
    stateLabel.classList.add('badge-connected');
    return;
  }
  if (stage === 'partial_failed' || stage === 'error' || stage === 'need_login_web' || stage === 'login_expired') {
    stateLabel.classList.add('badge-error');
    return;
  }
  if (RUNNING_STAGES.has(stage)) {
    stateLabel.classList.add('badge-running');
    return;
  }
  stateLabel.classList.add('badge-warning');
}

function iconDanger() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5M12 17h.01M5.5 20h13c1.3 0 2.1-1.4 1.4-2.5l-6.5-11a1.6 1.6 0 0 0-2.8 0l-6.5 11c-.7 1.1.1 2.5 1.4 2.5z"/></svg>';
}

function iconSuccess() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7l-10 10-5-5"/></svg>';
}

function iconWarn() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5M12 17h.01M5.5 20h13c1.3 0 2.1-1.4 1.4-2.5l-6.5-11a1.6 1.6 0 0 0-2.8 0l-6.5 11c-.7 1.1.1 2.5 1.4 2.5z"/></svg>';
}

function buildRunningChecklist(stage) {
  const listDone = stage !== 'fetch_list';
  const detailDone = stage === 'upload' || stage === 'done' || stage === 'partial_failed';
  const uploadDone = stage === 'done' || stage === 'partial_failed';

  const tag = (done, loading) => (done ? '✓' : loading ? '…' : '·');

  return `
    <div class="state-kv">
      <div class="state-kv-row"><span>文章列表</span><b>${tag(listDone, stage === 'fetch_list')}</b></div>
      <div class="state-kv-row"><span>文章详情</span><b>${tag(detailDone, stage === 'fetch_detail')}</b></div>
      <div class="state-kv-row"><span>数据上传</span><b>${tag(uploadDone, stage === 'upload')}</b></div>
    </div>
  `;
}

function renderStateView(state) {
  if (!stateView) return;

  if (state.stage === 'need_login_web') {
    stateView.innerHTML = `
      <div class="state-icon-wrap"><div class="state-icon state-icon-danger">${iconDanger()}</div></div>
      <div class="state-title">请先登录</div>
      <div class="state-desc">请先前往运营助手登录，才能同步公众号数据。</div>
      <div class="state-chip-row"><span class="state-chip">未连接账号</span></div>
    `;
    return;
  }

  if (state.stage === 'ready') {
    stateView.innerHTML = `
      <div class="detect-banner"><span class="detect-dot"></span><span class="detect-text">已检测到公众号后台，可开始同步</span></div>
      <div class="state-title">已登录 · 待同步</div>
      <div class="state-desc">将同步文章列表、数据指标和文章全文，可随时重试。</div>
      <div class="last-sync">上次同步：<span>${latestLastSync ? formatTime(latestLastSync.updatedAt) : '--'}</span></div>
      <div class="state-chip-row">
        <span class="state-chip">文章列表</span>
        <span class="state-chip">数据指标</span>
        <span class="state-chip">文章全文</span>
      </div>
    `;
    return;
  }

  if (RUNNING_STAGES.has(state.stage)) {
    stateView.innerHTML = `
      <div class="state-title">正在同步数据</div>
      <div class="state-desc">请保持当前公众号后台页面打开，插件将自动完成抓取和上传。</div>
      ${buildRunningChecklist(state.stage)}
    `;
    return;
  }

  if (state.stage === 'done') {
    stateView.innerHTML = `
      <div class="state-icon-wrap"><div class="state-icon state-icon-success">${iconSuccess()}</div></div>
      <div class="state-title">同步完成</div>
      <div class="state-desc">新增 ${state.newArticles || 0} 篇，更新 ${state.updatedArticles || 0} 篇。</div>
      <div class="state-chip-row"><span class="state-chip">共计 ${state.total || 0} 篇</span></div>
    `;
    return;
  }

  if (state.stage === 'login_expired') {
    stateView.innerHTML = `
      <div class="state-icon-wrap"><div class="state-icon state-icon-warn">${iconWarn()}</div></div>
      <div class="state-title">登录过期</div>
      <div class="state-desc">微信后台登录可能已过期，请刷新公众号后台页面后重试。</div>
    `;
    return;
  }

  if (state.stage === 'partial_failed') {
    const failCount = (state.failedMetrics || 0) + (state.failedContent || 0) + (state.failedUpload || 0);
    stateView.innerHTML = `
      <div class="state-icon-wrap"><div class="state-icon state-icon-warn">${iconWarn()}</div></div>
      <div class="state-title">同步部分完成</div>
      <div class="state-desc">成功 ${state.synced || 0}，失败 ${failCount}，可重试失败项。</div>
      <div class="state-chip-row">
        <span class="state-chip">指标失败 ${state.failedMetrics || 0}</span>
        <span class="state-chip">全文失败 ${state.failedContent || 0}</span>
        <span class="state-chip">上传失败 ${state.failedUpload || 0}</span>
      </div>
    `;
    return;
  }

  stateView.innerHTML = `
    <div class="state-icon-wrap"><div class="state-icon state-icon-danger">${iconDanger()}</div></div>
    <div class="state-title">同步失败</div>
    <div class="state-desc">${state.message || '同步失败，请重试。'}</div>
  `;
}

function renderSteps(state) {
  if (!RUNNING_STAGES.has(state.stage) && state.stage !== 'done' && state.stage !== 'partial_failed') {
    stepText.textContent = '';
    return;
  }
  const listDone = state.stage !== 'fetch_list';
  const detailDone = state.stage === 'upload' || state.stage === 'done' || state.stage === 'partial_failed';
  const uploadDone = state.stage === 'done' || state.stage === 'partial_failed';
  const listMark = listDone ? '✓' : '…';
  const detailMark = detailDone ? '✓' : (state.stage === 'fetch_detail' ? '…' : '·');
  const uploadMark = uploadDone ? '✓' : (state.stage === 'upload' ? '…' : '·');
  stepText.textContent = `文章列表 ${listMark}  文章详情 ${detailMark}  数据上传 ${uploadMark}`;
}

function renderSummary(state) {
  if (state.stage === 'done') {
    summaryText.textContent = `完成时间 ${formatTime(state.updatedAt)}`;
    return;
  }
  if (state.stage === 'partial_failed') {
    const failCount = (state.failedMetrics || 0) + (state.failedContent || 0) + (state.failedUpload || 0);
    summaryText.textContent = `已完成上传，失败 ${failCount}`;
    return;
  }
  if (state.stage === 'ready' && latestLastSync) {
    summaryText.textContent = `上次同步 ${formatTime(latestLastSync.updatedAt)} · ${latestLastSync.total || 0} 篇`;
    return;
  }
  summaryText.textContent = '';
}

function renderButtons(state) {
  let primaryAction = 'start';
  let primaryText = '开始同步';
  let secondaryAction = 'open-web';
  let secondaryText = '前往运营助手';
  let disabled = false;

  if (state.stage === 'need_login_web') {
    primaryAction = 'open-login';
    primaryText = '前往登录';
    secondaryAction = 'open-web';
    secondaryText = '打开运营助手';
  } else if (RUNNING_STAGES.has(state.stage)) {
    primaryAction = 'running';
    primaryText = '同步中...';
    disabled = true;
    secondaryAction = 'open-web';
    secondaryText = '查看工作台';
  } else if (state.stage === 'done') {
    primaryAction = 'open-workspace';
    primaryText = '前往运营助手查看';
    secondaryAction = 'start';
    secondaryText = '重新同步';
  } else if (state.stage === 'partial_failed') {
    primaryAction = 'start';
    primaryText = '重试失败项';
    secondaryAction = 'open-workspace';
    secondaryText = '查看已同步数据';
  } else if (state.stage === 'login_expired') {
    primaryAction = 'refresh-mp';
    primaryText = '刷新公众号后台';
    secondaryAction = 'open-web';
    secondaryText = '打开运营助手';
  } else if (state.stage === 'error') {
    primaryAction = 'start';
    primaryText = '重新同步';
    secondaryAction = 'open-web';
    secondaryText = '查看帮助';
  }

  primaryBtn.dataset.action = primaryAction;
  primaryBtn.textContent = primaryText;
  primaryBtn.disabled = disabled;

  secondaryBtn.dataset.action = secondaryAction;
  secondaryBtn.textContent = secondaryText;

  if (syncRangeSelect instanceof HTMLSelectElement) {
    syncRangeSelect.disabled = RUNNING_STAGES.has(state.stage);
  }
}

function renderState(rawState) {
  const state = withDefaultState(rawState);
  currentState = state;
  setBadge(state.stage);
  renderStateView(state);

  const progress = Number(state.progress || 0);
  progressText.textContent = `${progress}%`;
  progressFill.style.width = `${progress}%`;
  statusText.textContent = state.message || '等待同步';
  countText.textContent = state.total ? `已处理 ${state.synced || 0}/${state.total}` : '';
  progressTitle.textContent = RUNNING_STAGES.has(state.stage) ? '同步进度' : '状态';

  renderSteps(state);
  renderSummary(state);
  renderButtons(state);
}

function openWeb(needLogin) {
  const base = normalizeWebBase(webBase);
  const url = needLogin
    ? `${base}/gzh?openLogin=1&redirect=%2Fgzh%2Fworkspace`
    : `${base}/gzh/workspace`;
  chrome.tabs.create({ url });
}

function triggerSync() {
  if (syncRangeSelect instanceof HTMLSelectElement) {
    syncRangeSelect.disabled = true;
  }
  chrome.runtime.sendMessage({ type: 'trigger-sync' }, (result) => {
    if (!result?.ok) {
      renderState({ stage: 'error', message: `无法开始同步: ${result?.error || '未知错误'}`, progress: 0 });
    }
  });
}

function refreshMpTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab?.id && tab.url && tab.url.includes('https://mp.weixin.qq.com')) {
      chrome.tabs.reload(tab.id);
      return;
    }
    chrome.tabs.create({ url: 'https://mp.weixin.qq.com/' });
  });
}

function handleAction(action) {
  if (action === 'start') {
    triggerSync();
    return;
  }
  if (action === 'open-login') {
    openWeb(true);
    return;
  }
  if (action === 'open-web') {
    openWeb(false);
    return;
  }
  if (action === 'open-workspace') {
    chrome.tabs.create({ url: `${normalizeWebBase(webBase)}/gzh/workspace` });
    return;
  }
  if (action === 'refresh-mp') {
    refreshMpTab();
  }
}

function loadConfig() {
  chrome.storage.local.get(['gzhAuthToken', 'gzhWebBase', 'gzhLastSync', 'gzhSyncRangeCode'], (result) => {
    latestAuthToken = result.gzhAuthToken || '';
    latestLastSync = result.gzhLastSync || null;
    webBase = normalizeWebBase(result.gzhWebBase || DEFAULT_WEB_BASE);
    selectedSyncRangeCode = normalizeSyncRangeCode(result.gzhSyncRangeCode);

    authTokenInput.value = latestAuthToken;
    apiBaseInput.value = API_BASE_URL;
    apiBaseInput.disabled = true;
    webBaseInput.value = webBase;
    if (syncRangeSelect instanceof HTMLSelectElement) {
      syncRangeSelect.value = selectedSyncRangeCode;
    }

    chrome.runtime.sendMessage({ type: 'get-state' }, (state) => {
      renderState(state);
    });
  });
}

saveBtn.addEventListener('click', () => {
  latestAuthToken = authTokenInput.value.trim();
  if (syncRangeSelect instanceof HTMLSelectElement) {
    selectedSyncRangeCode = normalizeSyncRangeCode(syncRangeSelect.value);
  }
  chrome.storage.local.set(
    {
      gzhAuthToken: latestAuthToken,
      gzhWebBase: normalizeWebBase(webBaseInput.value || DEFAULT_WEB_BASE),
      gzhSyncRangeCode: selectedSyncRangeCode,
    },
    () => {
      webBase = normalizeWebBase(webBaseInput.value || DEFAULT_WEB_BASE);
      renderState(currentState || { stage: 'ready', message: '配置已保存', progress: 0, synced: 0, total: 0 });
    }
  );
});

if (syncRangeSelect instanceof HTMLSelectElement) {
  syncRangeSelect.addEventListener('change', () => {
    selectedSyncRangeCode = normalizeSyncRangeCode(syncRangeSelect.value);
    chrome.storage.local.set({ gzhSyncRangeCode: selectedSyncRangeCode }, () => {
      renderState(currentState);
    });
  });
}

primaryBtn.addEventListener('click', () => handleAction(primaryBtn.dataset.action || 'start'));
secondaryBtn.addEventListener('click', () => handleAction(secondaryBtn.dataset.action || 'open-web'));

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'sync-state-broadcast') {
    if (message.payload?.stage === 'done' || message.payload?.stage === 'partial_failed') {
      latestLastSync = {
        updatedAt: message.payload.updatedAt,
        total: message.payload.total,
        synced: message.payload.synced,
        newArticles: message.payload.newArticles,
        updatedArticles: message.payload.updatedArticles,
      };
    }
    renderState(message.payload);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') {
    return;
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'gzhSyncRangeCode')) {
    selectedSyncRangeCode = normalizeSyncRangeCode(changes.gzhSyncRangeCode?.newValue);
    if (syncRangeSelect instanceof HTMLSelectElement) {
      syncRangeSelect.value = selectedSyncRangeCode;
    }
    renderState(currentState);
  }
});

loadConfig();
