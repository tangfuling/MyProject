const STORAGE_KEY = 'gzh_extension_state';
const ALLOWED_PROXY_PREFIXES = [
  'http://127.0.0.1:8081/',
  'https://api-gzh.niuma.com/',
  'https://api-gzh.niumatech.com/',
];

function isAllowedProxyUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return false;
  }
  return ALLOWED_PROXY_PREFIXES.some((prefix) => rawUrl.startsWith(prefix));
}

function setState(state) {
  chrome.storage.local.set({ [STORAGE_KEY]: state });
}

chrome.runtime.onInstalled.addListener(() => {
  setState({ stage: 'idle', message: '等待同步', progress: 0, synced: 0, total: 0 });
  chrome.storage.local.set({ gzhApiBase: 'http://127.0.0.1:8081' });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'trigger-sync') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        const state = { stage: 'error', message: '未找到当前页面，请重试', progress: 0, synced: 0, total: 0 };
        setState(state);
        chrome.runtime.sendMessage({ type: 'sync-state-broadcast', payload: state });
        sendResponse({ ok: false, error: 'no-active-tab' });
        return;
      }
      if (!tab.url || !tab.url.includes('https://mp.weixin.qq.com')) {
        const state = {
          stage: 'login_expired',
          message: '请先打开并登录微信公众号后台页面后再同步',
          progress: 0,
          synced: 0,
          total: 0,
        };
        setState(state);
        chrome.runtime.sendMessage({ type: 'sync-state-broadcast', payload: state });
        sendResponse({ ok: false, error: 'not-mp-page' });
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: 'start-sync' }, (response) => {
        if (chrome.runtime.lastError) {
          const state = {
            stage: 'login_expired',
            message: '微信后台登录已过期，请刷新页面后重试',
            progress: 0,
            synced: 0,
            total: 0,
          };
          setState(state);
          chrome.runtime.sendMessage({ type: 'sync-state-broadcast', payload: state });
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse({ ok: true, response });
      });
    });
    return true;
  }

  if (message?.type === 'sync-state') {
    setState(message.payload);
    chrome.runtime.sendMessage({ type: 'sync-state-broadcast', payload: message.payload });
    return undefined;
  }

  if (message?.type === 'proxy-fetch-json') {
    const payload = message.payload || {};
    const url = payload.url || '';
    if (!isAllowedProxyUrl(url)) {
      sendResponse({ ok: false, error: 'proxy url not allowed' });
      return true;
    }

    const requestInit = {
      method: payload.method || 'GET',
      headers: payload.headers || {},
      body: payload.body || undefined,
      credentials: 'omit',
      redirect: 'follow',
    };

    fetch(url, requestInit)
      .then(async (resp) => {
        const text = await resp.text();
        let body;
        try {
          body = text ? JSON.parse(text) : {};
        } catch {
          body = { raw: text };
        }
        sendResponse({
          ok: true,
          status: resp.status,
          httpOk: resp.ok,
          body,
        });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error?.message || 'proxy fetch failed' });
      });
    return true;
  }

  if (message?.type === 'get-state') {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      sendResponse(result[STORAGE_KEY] ?? null);
    });
    return true;
  }

  return undefined;
});
