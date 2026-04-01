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
  try {
    chrome.storage.local.set({ [STORAGE_KEY]: state }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[gzh-extension][bg] setState failed', chrome.runtime.lastError.message);
      }
    });
  } catch (error) {
    console.warn('[gzh-extension][bg] setState threw', error?.message || error);
  }
}

function safeRespond(sendResponse, payload) {
  try {
    sendResponse(payload);
  } catch (error) {
    console.warn('[gzh-extension][bg] sendResponse failed', error?.message || error);
  }
}

function safeBroadcast(payload) {
  try {
    chrome.runtime.sendMessage(payload, () => {
      if (chrome.runtime.lastError) {
        // No receiver is normal when popup/content-script is not open.
      }
    });
  } catch (error) {
    console.warn('[gzh-extension][bg] broadcast threw', error?.message || error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  setState({ stage: 'idle', message: '等待同步', progress: 0, synced: 0, total: 0 });
  try {
    chrome.storage.local.set({ gzhApiBase: 'http://127.0.0.1:8081' });
  } catch (error) {
    console.warn('[gzh-extension][bg] init api base failed', error?.message || error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
  if (message?.type === 'trigger-sync') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        const state = { stage: 'error', message: '未找到当前页面，请重试', progress: 0, synced: 0, total: 0 };
        setState(state);
        safeBroadcast({ type: 'sync-state-broadcast', payload: state });
        safeRespond(sendResponse, { ok: false, error: 'no-active-tab' });
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
        safeBroadcast({ type: 'sync-state-broadcast', payload: state });
        safeRespond(sendResponse, { ok: false, error: 'not-mp-page' });
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
          safeBroadcast({ type: 'sync-state-broadcast', payload: state });
          safeRespond(sendResponse, { ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        safeRespond(sendResponse, { ok: true, response });
      });
    });
    return true;
  }

  if (message?.type === 'sync-state') {
    setState(message.payload);
    safeBroadcast({ type: 'sync-state-broadcast', payload: message.payload });
    return undefined;
  }

  if (message?.type === 'proxy-fetch-json') {
    const payload = message.payload || {};
    const url = payload.url || '';
    if (!isAllowedProxyUrl(url)) {
      safeRespond(sendResponse, { ok: false, error: 'proxy url not allowed' });
      return undefined;
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
        safeRespond(sendResponse, {
          ok: true,
          status: resp.status,
          httpOk: resp.ok,
          body,
        });
      })
      .catch((error) => {
        safeRespond(sendResponse, { ok: false, error: error?.message || 'proxy fetch failed' });
      });
    return true;
  }

  if (message?.type === 'get-state') {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      safeRespond(sendResponse, result[STORAGE_KEY] ?? null);
    });
    return true;
  }

  return undefined;
  } catch (error) {
    console.error('[gzh-extension][bg] onMessage crash', {
      type: message?.type,
      error: error?.message || String(error),
      stack: error?.stack || '',
    });
    safeRespond(sendResponse, { ok: false, error: error?.message || 'background crashed' });
    return undefined;
  }
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('[gzh-extension][bg] unhandledrejection', event?.reason || event);
});

self.addEventListener('error', (event) => {
  console.error('[gzh-extension][bg] error', {
    message: event?.message,
    filename: event?.filename,
    lineno: event?.lineno,
    colno: event?.colno,
  });
});
