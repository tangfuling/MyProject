const apiBaseInput = document.getElementById('apiBase');
const authTokenInput = document.getElementById('authToken');
const saveBtn = document.getElementById('saveBtn');
const syncBtn = document.getElementById('syncBtn');
const openWebBtn = document.getElementById('openWebBtn');
const statusText = document.getElementById('statusText');
const progressText = document.getElementById('progressText');
const progressInner = document.getElementById('progressInner');
const countText = document.getElementById('countText');

function renderState(state) {
  if (!state) {
    return;
  }
  statusText.textContent = state.message || '等待同步';
  const progress = Number(state.progress || 0);
  progressText.textContent = `${progress}%`;
  progressInner.style.width = `${progress}%`;
  if (state.total) {
    countText.textContent = `已处理 ${state.synced || 0}/${state.total}`;
  } else {
    countText.textContent = '';
  }
}

function loadConfig() {
  chrome.storage.local.get(['gzhAuthToken', 'gzhApiBase'], (result) => {
    authTokenInput.value = result.gzhAuthToken || '';
    apiBaseInput.value = result.gzhApiBase || 'http://127.0.0.1:8081';
  });

  chrome.runtime.sendMessage({ type: 'get-state' }, (state) => {
    renderState(state);
  });
}

saveBtn.addEventListener('click', () => {
  chrome.storage.local.set(
    {
      gzhAuthToken: authTokenInput.value.trim(),
      gzhApiBase: apiBaseInput.value.trim() || 'http://127.0.0.1:8081',
    },
    () => {
      statusText.textContent = '配置已保存';
    }
  );
});

syncBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'trigger-sync' }, (result) => {
    if (!result?.ok) {
      statusText.textContent = `无法开始同步: ${result?.error || '未知错误'}`;
    }
  });
});

openWebBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: 'http://localhost:5173' });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'sync-state-broadcast') {
    renderState(message.payload);
  }
});

loadConfig();
