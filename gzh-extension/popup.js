const apiBaseInput = document.getElementById('apiBase');
const authTokenInput = document.getElementById('authToken');
const saveBtn = document.getElementById('saveBtn');
const syncBtn = document.getElementById('syncBtn');
const openWebBtn = document.getElementById('openWebBtn');
const statusText = document.getElementById('statusText');
const progressText = document.getElementById('progressText');
const progressInner = document.getElementById('progressInner');
const countText = document.getElementById('countText');
const stateLabel = document.getElementById('stateLabel');
const stepText = document.getElementById('stepText');
const summaryText = document.getElementById('summaryText');

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
let latestAuthToken = '';
let latestLastSync = null;

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
  if (state && (state.stage === 'done' || state.stage === 'partial_failed' || state.stage === 'login_expired' || state.stage === 'error' || state.stage === 'need_login_web')) {
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

function renderSteps(state) {
  const stage = state.stage;
  if (!RUNNING_STAGES.has(stage) && stage !== 'done' && stage !== 'partial_failed') {
    stepText.textContent = '';
    return;
  }

  const listDone = stage !== 'fetch_list';
  const detailDone = stage === 'upload' || stage === 'done' || stage === 'partial_failed';
  const uploadDone = stage === 'done' || stage === 'partial_failed';

  const listMark = listDone ? '✓' : '…';
  const detailMark = detailDone ? '✓' : (stage === 'fetch_detail' ? '…' : '·');
  const uploadMark = uploadDone ? '✓' : (stage === 'upload' ? '…' : '·');
  stepText.textContent = `文章列表 ${listMark}  文章详情 ${detailMark}  数据上传 ${uploadMark}`;
}

function renderSummary(state) {
  if (state.stage === 'done') {
    summaryText.textContent = `新增 ${state.newArticles || 0}，更新 ${state.updatedArticles || 0}`;
    return;
  }
  if (state.stage === 'partial_failed') {
    const failCount = (state.failedMetrics || 0) + (state.failedContent || 0);
    summaryText.textContent = `已完成上传，失败 ${failCount}（指标 ${state.failedMetrics || 0} / 全文 ${state.failedContent || 0}）`;
    return;
  }
  if (state.stage === 'ready' && latestLastSync) {
    summaryText.textContent = `上次同步 ${formatTime(latestLastSync.updatedAt)} · ${latestLastSync.total || 0} 篇`;
    return;
  }
  summaryText.textContent = '';
}

function renderButtons(state) {
  const stage = state.stage;
  syncBtn.disabled = RUNNING_STAGES.has(stage);
  if (stage === 'need_login_web') {
    openWebBtn.textContent = '前往公众号助手登录';
    return;
  }
  if (stage === 'done' || stage === 'partial_failed') {
    openWebBtn.textContent = '前往公众号助手查看 →';
    return;
  }
  openWebBtn.textContent = '前往公众号助手';
}

function renderState(rawState) {
  const state = withDefaultState(rawState);
  stateLabel.textContent = STAGE_LABELS[state.stage] || '待同步';
  stateLabel.className = `state-label ${stageClass(state.stage)}`;

  statusText.textContent = state.message || '等待同步';
  const progress = Number(state.progress || 0);
  progressText.textContent = `${progress}%`;
  progressInner.style.width = `${progress}%`;

  if (state.total) {
    countText.textContent = `已处理 ${state.synced || 0}/${state.total}`;
  } else {
    countText.textContent = '';
  }

  renderSteps(state);
  renderSummary(state);
  renderButtons(state);
}

function loadConfig() {
  chrome.storage.local.get(['gzhAuthToken', 'gzhApiBase', 'gzhLastSync'], (result) => {
    latestAuthToken = result.gzhAuthToken || '';
    latestLastSync = result.gzhLastSync || null;
    authTokenInput.value = latestAuthToken;
    apiBaseInput.value = result.gzhApiBase || 'http://127.0.0.1:8081';

    chrome.runtime.sendMessage({ type: 'get-state' }, (state) => {
      renderState(state);
    });
  });
}

saveBtn.addEventListener('click', () => {
  latestAuthToken = authTokenInput.value.trim();
  chrome.storage.local.set(
    {
      gzhAuthToken: latestAuthToken,
      gzhApiBase: apiBaseInput.value.trim() || 'http://127.0.0.1:8081',
    },
    () => {
      renderState({ stage: 'ready', message: '配置已保存，可开始同步', progress: 0, total: 0, synced: 0 });
    }
  );
});

syncBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'trigger-sync' }, (result) => {
    if (!result?.ok) {
      renderState({ stage: 'error', message: `无法开始同步: ${result?.error || '未知错误'}`, progress: 0 });
    }
  });
});

openWebBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: 'http://localhost:5173' });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'sync-state-broadcast') {
    if (message.payload?.stage === 'done' || message.payload?.stage === 'partial_failed') {
      latestLastSync = {
        updatedAt: message.payload.updatedAt,
        total: message.payload.total,
        synced: message.payload.synced,
        newArticles: message.payload.newArticles,
        updatedArticles: message.payload.updatedArticles,
        failedMetrics: message.payload.failedMetrics,
        failedContent: message.payload.failedContent,
      };
    }
    renderState(message.payload);
  }
});

loadConfig();
